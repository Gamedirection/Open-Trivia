import React, { useEffect, useState } from 'react';
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || '/api';

export default function Dashboard() {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [timeframe, setTimeframe] = useState('all');
    const token = localStorage.getItem('token');

    const fetchStats = async () => {
        if (!token) return;
        setLoading(true);
        try {
            const params = {};
            if (timeframe !== 'all') params.timeframe = timeframe;
            const res = await axios.get(`${API_URL}/me/stats`, {
                params,
                headers: { Authorization: `Bearer ${token}` }
            });
            setStats(res.data);
        } catch (err) {
            console.error('Failed to load stats', err);
            setStats(null);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchStats();
    }, [timeframe]);

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
                <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
                    <h2 style={{ margin: 0 }}>📊 My Stats</h2>
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
