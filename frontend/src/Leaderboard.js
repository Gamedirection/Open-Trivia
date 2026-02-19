import React, { useState, useEffect } from 'react';
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || '/api';

export default function Leaderboard() {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchLeaderboard();
    }, []);

    const fetchLeaderboard = async () => {
        try {
            const res = await axios.get(`${API_URL}/leaderboard`);
            setUsers(res.data);
        } catch (err) {
            console.error("Failed to load leaderboard", err);
            setUsers([]); // Ensure state is always set
        } finally {
            setLoading(false);
        }
    };

    if (loading) return <div className="card" style={{ textAlign: 'center' }}>Loading Top Players...</div>;

    return (
        <div className="card">
            <h2>🏆 Global Leaderboard</h2>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                    <tr style={{ borderBottom: '2px solid var(--border-color)', textAlign: 'left', color: 'var(--text-color)' }}>
                        <th style={{ padding: '10px' }}>Rank</th>
                        <th style={{ padding: '10px' }}>Player</th>
                        <th style={{ padding: '10px' }}>Score</th>
                        <th style={{ padding: '10px' }}>Role</th>
                    </tr>
                </thead>
                <tbody>
                    {users.length === 0 ? (
                        <tr><td colSpan="4" style={{ textAlign: 'center' }}>No users yet. Be the first to play!</td></tr>
                    ) : 
                    users.map((user, index) => (
                        <tr key={user.id} style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-color)' }}>
                            <td style={{ padding: '10px', fontWeight: 'bold' }}>{index + 1}</td>
                            <td style={{ padding: '10px' }}>
                                <div style={{ display: 'flex', alignItems: 'center' }}>
                                    <div style={{
                                        width: '35px', height: '35px', borderRadius: '50%', marginRight: '15px',
                                        border: '2px solid var(--header-bg)', backgroundColor: 'var(--header-bg)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        color: 'white', fontWeight: 'bold', fontSize: '14px', flexShrink: 0
                                    }}>
                                        {user.email[0].toUpperCase()}
                                    </div>
                                    <div>
                                        <div style={{ fontWeight: 'bold' }}>{user.email.split('@')[0]}</div>
                                        <div style={{ fontSize: '0.8rem', opacity: '0.7' }}>{user.email}</div>
                                    </div>
                                </div>
                            </td>
                            <td style={{ padding: '10px', fontWeight: 'bold', color: 'var(--btn-primary)' }}>{user.score}</td>
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
                    ))}
                </tbody>
            </table>
        </div>
    );
}
