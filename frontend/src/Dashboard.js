import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { cachedGet } from './utils/api';

const API_URL = process.env.REACT_APP_API_URL || '/api';

export default function Dashboard() {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [timeframe, setTimeframe] = useState('all');
    const token = localStorage.getItem('token');
    const [resetting, setResetting] = useState(false);
    const [profile, setProfile] = useState(null);
    const [profileLoading, setProfileLoading] = useState(true);
    const [profileSaving, setProfileSaving] = useState(false);
    const [displayName, setDisplayName] = useState('');
    const [showEmail, setShowEmail] = useState(true);
    const [profileNotice, setProfileNotice] = useState('');
    const [censorNames, setCensorNames] = useState(() => {
        try {
            return localStorage.getItem('leaderboard_censor_names') === 'true';
        } catch {
            return false;
        }
    });
    const [showAnonymous, setShowAnonymous] = useState(() => {
        try {
            return localStorage.getItem('leaderboard_show_anonymous') === 'true';
        } catch {
            return false;
        }
    });
    const [showGravatar, setShowGravatar] = useState(() => {
        try {
            const v = localStorage.getItem('leaderboard_show_gravatar');
            return v === null ? true : v === 'true';
        } catch {
            return true;
        }
    });

    const fetchStats = async () => {
        if (!token) return;
        if (stats) setRefreshing(true);
        else setLoading(true);
        try {
            const params = {};
            if (timeframe !== 'all') params.timeframe = timeframe;
            const res = await cachedGet(axios, `${API_URL}/me/stats`, {
                params,
                headers: { Authorization: `Bearer ${token}` }
            }, 5000);
            setStats(res.data);
        } catch (err) {
            console.error('Failed to load stats', err);
            setStats(null);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    const fetchProfile = async () => {
        if (!token) return;
        setProfileLoading(true);
        try {
            const res = await axios.get(`${API_URL}/me/profile`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setProfile(res.data);
            setDisplayName(res.data.display_name || '');
            setShowEmail(!!res.data.show_email);
        } catch (err) {
            console.error('Failed to load profile', err);
            setProfile(null);
        } finally {
            setProfileLoading(false);
        }
    };

    const saveProfile = async () => {
        if (!token) return;
        setProfileSaving(true);
        setProfileNotice('');
        try {
            const res = await axios.post(`${API_URL}/me/profile`, {
                displayName,
                showEmail
            }, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setProfile(res.data);
            setDisplayName(res.data.display_name || '');
            setShowEmail(!!res.data.show_email);
            const stored = localStorage.getItem('user');
            if (stored) {
                const u = JSON.parse(stored);
                u.display_name = res.data.display_name;
                localStorage.setItem('user', JSON.stringify(u));
                window.dispatchEvent(new Event('user-updated'));
            }
            setProfileNotice('Saved.');
        } catch (err) {
            console.error('Failed to save profile', err);
            setProfileNotice('Save failed. Please try again.');
        } finally {
            setProfileSaving(false);
        }
    };

    const saveCensorPreference = (next) => {
        setCensorNames(next);
        try {
            localStorage.setItem('leaderboard_censor_names', next ? 'true' : 'false');
        } catch {}
        window.dispatchEvent(new Event('leaderboard-pref-updated'));
    };

    const saveAnonymousPreference = (next) => {
        setShowAnonymous(next);
        try {
            localStorage.setItem('leaderboard_show_anonymous', next ? 'true' : 'false');
        } catch {}
        window.dispatchEvent(new Event('leaderboard-pref-updated'));
    };

    const saveGravatarPreference = (next) => {
        setShowGravatar(next);
        try {
            localStorage.setItem('leaderboard_show_gravatar', next ? 'true' : 'false');
        } catch {}
        window.dispatchEvent(new Event('leaderboard-pref-updated'));
    };

    const resetScore = async (categoryId) => {
        if (!token) return;
        const label = categoryId ? 'this category' : 'all categories';
        if (!window.confirm(`Reset your stats for ${label}?`)) return;
        setResetting(true);
        try {
            await axios.post(
                `${API_URL}/me/reset-score`,
                { categoryId: categoryId || null },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            await fetchStats();
        } catch (err) {
            console.error('Reset failed', err);
            alert('Reset failed. Please try again.');
        } finally {
            setResetting(false);
        }
    };

    useEffect(() => {
        fetchStats();
    }, [timeframe]);

    useEffect(() => {
        fetchProfile();
    }, []);

    if (!token) {
        return (
            <div className="card" style={{ textAlign: 'center' }}>
                Log in to view your stats.
            </div>
        );
    }

    if (loading) {
        return <div className="card" style={{ textAlign: 'center' }}>Loading stats…</div>;
    }

    if (!stats) {
        return <div className="card" style={{ textAlign: 'center' }}>No stats available.</div>;
    }

    const totals = stats.totals || {};
    const totalAnswered = totals.total_answered || 0;
    const correct = totals.correct_answered || 0;
    const accuracy = totalAnswered > 0 ? Math.round((correct / totalAnswered) * 100) : 0;

    return (
        <div>
            <div className="card" style={{ marginBottom: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
                    <h2 style={{ margin: 0 }}>👤 Profile & Privacy</h2>
                    {profileNotice && (
                        <span style={{ fontSize: '12px', color: profileNotice === 'Saved.' ? '#28a745' : '#dc3545' }}>
                            {profileNotice}
                        </span>
                    )}
                </div>
                {profileLoading ? (
                    <p style={{ color: '#888' }}>Loading profile...</p>
                ) : (
                    <div style={{ display: 'grid', gap: '12px', marginTop: '12px' }}>
                        <div>
                            <label style={{ fontSize: '12px', color: '#888' }}>Display Name</label>
                            <input
                                type="text"
                                value={displayName}
                                onChange={e => setDisplayName(e.target.value)}
                                placeholder="Display name (default username)"
                                style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                            />
                            <div style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>
                                Shown on the leaderboard instead of your email.
                            </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <label style={{ fontSize: '13px', color: '#444', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <input
                                    type="checkbox"
                                    checked={showEmail}
                                    onChange={e => setShowEmail(e.target.checked)}
                                    disabled={profile?.hide_emails_globally}
                                />
                                Show my email on the leaderboard (logged-in users only)
                            </label>
                            {profile?.hide_emails_globally && (
                                <span style={{ fontSize: '12px', color: '#dc3545' }}>
                                    Disabled by admin (global hide).
                                </span>
                            )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <label style={{ fontSize: '13px', color: '#444', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <input
                                    type="checkbox"
                                    checked={censorNames}
                                    onChange={e => saveCensorPreference(e.target.checked)}
                                />
                                Censor leaderboard names (show first 2 letters)
                            </label>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <label style={{ fontSize: '13px', color: '#444', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <input
                                    type="checkbox"
                                    checked={showAnonymous}
                                    onChange={e => saveAnonymousPreference(e.target.checked)}
                                />
                                Show anonymous users on the leaderboard
                            </label>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <label style={{ fontSize: '13px', color: '#444', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <input
                                    type="checkbox"
                                    checked={showGravatar}
                                    onChange={e => saveGravatarPreference(e.target.checked)}
                                />
                                Show Gravatar icons on the leaderboard
                            </label>
                            <a href="https://gravatar.com/site/signup" style={{ fontSize: '12px', color: '#007bff', textDecoration: 'none' }} target="_blank" rel="noreferrer">
                                Create a Gravatar account
                            </a>
                        </div>
                        <div>
                            <button className="btn btn-primary" onClick={saveProfile} disabled={profileSaving}>
                                {profileSaving ? 'Saving...' : 'Save Profile'}
                            </button>
                        </div>
                    </div>
                )}
            </div>
            <div className="card" style={{ marginBottom: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
                    <h2 style={{ margin: 0 }}>📊 My Stats</h2>
                    <button
                        className="btn"
                        onClick={() => resetScore(null)}
                        disabled={resetting}
                        style={{ backgroundColor: '#6c757d', color: 'white', padding: '6px 12px' }}
                    >
                        {resetting ? 'Resetting...' : 'Reset All Stats'}
                    </button>
                    {refreshing && (
                        <span style={{ fontSize: '12px', color: '#888' }}>Refreshing…</span>
                    )}
                    <div>
                        <label style={{ fontSize: '12px', color: '#888' }}>Timeframe</label>
                        <div>
                            <select
                                value={timeframe}
                                onChange={e => setTimeframe(e.target.value)}
                                style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                            >
                                <option value="all">All Time</option>
                                <option value="day">Today</option>
                                <option value="month">This Month</option>
                                <option value="year">This Year</option>
                            </select>
                        </div>
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginTop: '16px' }}>
                    <div style={{ padding: '12px', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                        <div style={{ fontSize: '12px', color: '#888' }}>Total Points</div>
                        <div style={{ fontSize: '22px', fontWeight: 'bold' }}>{totals.total_points || 0}</div>
                    </div>
                    <div style={{ padding: '12px', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                        <div style={{ fontSize: '12px', color: '#888' }}>Answered</div>
                        <div style={{ fontSize: '22px', fontWeight: 'bold' }}>{totalAnswered}</div>
                    </div>
                    <div style={{ padding: '12px', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                        <div style={{ fontSize: '12px', color: '#888' }}>Correct</div>
                        <div style={{ fontSize: '22px', fontWeight: 'bold' }}>{correct}</div>
                    </div>
                    <div style={{ padding: '12px', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                        <div style={{ fontSize: '12px', color: '#888' }}>Accuracy</div>
                        <div style={{ fontSize: '22px', fontWeight: 'bold' }}>{accuracy}%</div>
                    </div>
                </div>
            </div>

            <div className="card" style={{ marginBottom: '20px' }}>
                <h3 style={{ marginTop: 0 }}>By Category</h3>
                {stats.byCategory?.length ? (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ borderBottom: '2px solid var(--border-color)', textAlign: 'left' }}>
                                    <th style={{ padding: '8px' }}>Category</th>
                                    <th style={{ padding: '8px' }}>Points</th>
                                    <th style={{ padding: '8px' }}>Correct</th>
                                    <th style={{ padding: '8px' }}>Answered</th>
                                    <th style={{ padding: '8px' }}>Accuracy</th>
                                    <th style={{ padding: '8px' }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {stats.byCategory.map(c => {
                                    const total = c.total_answered || 0;
                                    const corr = c.correct_answered || 0;
                                    const acc = total > 0 ? Math.round((corr / total) * 100) : 0;
                                    return (
                                        <tr key={c.category_id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                            <td style={{ padding: '8px' }}>{c.category_name}</td>
                                            <td style={{ padding: '8px', fontWeight: 'bold', color: 'var(--btn-primary)' }}>{c.points}</td>
                                            <td style={{ padding: '8px' }}>{corr}</td>
                                            <td style={{ padding: '8px' }}>{total}</td>
                                            <td style={{ padding: '8px' }}>{acc}%</td>
                                            <td style={{ padding: '8px' }}>
                                                <button
                                                    className="btn"
                                                    onClick={() => resetScore(c.category_id)}
                                                    disabled={resetting}
                                                    style={{ padding: '4px 10px', fontSize: '12px', backgroundColor: '#dc3545', color: 'white' }}
                                                >
                                                    Reset
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <p style={{ color: '#888' }}>No category stats yet.</p>
                )}
            </div>

            <div className="card">
                <h3 style={{ marginTop: 0 }}>Recent Activity</h3>
                {stats.recent?.length ? (
                    <div style={{ display: 'grid', gap: '10px' }}>
                        {stats.recent.map(r => (
                            <div key={r.id} style={{ padding: '10px', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                                <div style={{ fontSize: '12px', color: '#888' }}>
                                    {new Date(r.created_at).toLocaleString()} · {r.category_name} · {String(r.complexity).toUpperCase()}
                                </div>
                                <div style={{ marginTop: '4px', fontWeight: 'bold' }}>{r.question_text}</div>
                                <div style={{ marginTop: '6px', color: r.is_correct ? '#28a745' : '#dc3545' }}>
                                    {r.is_correct ? `Correct (+${r.points})` : 'Incorrect'}
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p style={{ color: '#888' }}>No recent activity.</p>
                )}
            </div>
        </div>
    );
}
