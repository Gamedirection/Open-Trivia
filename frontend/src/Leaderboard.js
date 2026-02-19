import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { gravatarUrl } from './utils/gravatar';

const API_URL = process.env.REACT_APP_API_URL || '/api';

export default function Leaderboard() {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [categories, setCategories] = useState([]);
    const [categoryId, setCategoryId] = useState('');
    const [timeframe, setTimeframe] = useState('all');
    const [resetting, setResetting] = useState(false);

    const token = localStorage.getItem('token');

    useEffect(() => {
        fetchCategories();
    }, []);

    useEffect(() => {
        fetchLeaderboard();
    }, [categoryId, timeframe]);

    const fetchCategories = async () => {
        try {
            const res = await axios.get(`${API_URL}/categories`);
            setCategories(res.data || []);
        } catch (err) {
            console.error("Failed to load categories", err);
            setCategories([]);
        }
    };

    const fetchLeaderboard = async () => {
        try {
            setLoading(true);
            const params = {};
            if (categoryId) params.categoryId = categoryId;
            if (timeframe && timeframe !== 'all') params.timeframe = timeframe;
            const res = await axios.get(`${API_URL}/leaderboard`, { params });
            setUsers(res.data);
        } catch (err) {
            console.error("Failed to load leaderboard", err);
            setUsers([]); // Ensure state is always set
        } finally {
            setLoading(false);
        }
    };

    const handleResetScore = async () => {
        if (!token) return;
        const scopeLabel = categoryId
            ? (categories.find(c => String(c.id) === String(categoryId))?.name || 'selected category')
            : 'all categories';
        if (!window.confirm(`Reset your score for ${scopeLabel}? This will only affect leaderboard totals.`)) return;
        setResetting(true);
        try {
            await axios.post(
                `${API_URL}/me/reset-score`,
                { categoryId: categoryId || null },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            await fetchLeaderboard();
        } catch (err) {
            console.error("Failed to reset score", err);
            alert('Reset failed. Please try again.');
        } finally {
            setResetting(false);
        }
    };

    const gradeFromPct = (pct) => {
        if (pct >= 97) return 'A+';
        if (pct >= 93) return 'A';
        if (pct >= 90) return 'A-';
        if (pct >= 87) return 'B+';
        if (pct >= 83) return 'B';
        if (pct >= 80) return 'B-';
        if (pct >= 77) return 'C+';
        if (pct >= 73) return 'C';
        if (pct >= 70) return 'C-';
        if (pct >= 67) return 'D+';
        if (pct >= 63) return 'D';
        if (pct >= 60) return 'D-';
        if (pct >= 57) return 'F+';
        if (pct >= 53) return 'F';
        return 'F-';
    };

    if (loading) return <div className="card" style={{ textAlign: 'center' }}>Loading Top Players...</div>;

    return (
        <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                <h2 style={{ margin: 0 }}>🏆 Global Leaderboard</h2>
                {token && (
                    <button className="btn" onClick={handleResetScore} disabled={resetting}
                        style={{ padding: '6px 12px', backgroundColor: '#6c757d', color: 'white' }}>
                        {resetting ? 'Resetting...' : 'Reset My Score'}
                    </button>
                )}
            </div>

            <div style={{ display: 'flex', gap: '10px', margin: '16px 0 6px', flexWrap: 'wrap' }}>
                <div>
                    <label style={{ fontSize: '12px', color: '#888' }}>Category</label>
                    <div>
                        <select
                            value={categoryId}
                            onChange={e => setCategoryId(e.target.value)}
                            style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                        >
                            <option value="">All Categories</option>
                            {categories.map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                        </select>
                    </div>
                </div>
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

            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                    <tr style={{ borderBottom: '2px solid var(--border-color)', textAlign: 'left', color: 'var(--text-color)' }}>
                        <th style={{ padding: '10px' }}>Rank</th>
                        <th style={{ padding: '10px' }}>Player</th>
                        <th style={{ padding: '10px' }}>Score</th>
                        <th style={{ padding: '10px' }}>Correct</th>
                        <th style={{ padding: '10px' }}>Incorrect</th>
                        <th style={{ padding: '10px' }}>Ratio</th>
                        <th style={{ padding: '10px' }}>Role</th>
                    </tr>
                </thead>
                <tbody>
                    {users.length === 0 ? (
                        <tr><td colSpan="7" style={{ textAlign: 'center' }}>No users yet. Be the first to play!</td></tr>
                    ) : 
                    users.map((user, index) => {
                        const total = user.total_answered || 0;
                        const correct = user.correct_answered || 0;
                        const incorrect = Math.max(0, total - correct);
                        const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
                        const grade = gradeFromPct(pct);
                        return (
                        <tr key={user.id} style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-color)' }}>
                            <td style={{ padding: '10px', fontWeight: 'bold' }}>{index + 1}</td>
                            <td style={{ padding: '10px' }}>
                                <div style={{ display: 'flex', alignItems: 'center' }}>
                                    <img
                                        src={gravatarUrl(user.email, 70)}
                                        alt={user.email}
                                        width={35}
                                        height={35}
                                        style={{
                                            borderRadius: '50%',
                                            marginRight: '15px',
                                            border: '2px solid var(--header-bg)',
                                            flexShrink: 0
                                        }}
                                    />
                                    <div>
                                        <div style={{ fontWeight: 'bold' }}>{user.email.split('@')[0]}</div>
                                        <div style={{ fontSize: '0.8rem', opacity: '0.7' }}>{user.email}</div>
                                    </div>
                                </div>
                            </td>
                            <td style={{ padding: '10px', fontWeight: 'bold', color: 'var(--btn-primary)' }}>{user.score}</td>
                            <td style={{ padding: '10px' }}>{correct}</td>
                            <td style={{ padding: '10px' }}>{incorrect}</td>
                            <td style={{ padding: '10px', fontWeight: 'bold' }}>
                                {pct}% ({grade})
                            </td>
                            <td style={{ padding: '10px' }}>
                                <span style={{ 
                                    backgroundColor: user.role === 'admin' ? '#ff9800' : '#28a745',
                                    color: 'white',
                                    padding: '4px 12px',
                                    borderRadius: '20px',
                                    fontSize: '12px'
                                }}>
                                    {user.role}
                                </span>
                            </td>
                        </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
