import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, Navigate } from 'react-router-dom';
import Game from './Game';
import Admin from './Admin';
import Leaderboard from './Leaderboard';
import ResetPasswordPage from './ResetPasswordPage';
import Dashboard from './Dashboard';
import { ThemeProvider, useTheme } from './ThemeContext';
import { gravatarUrl } from './utils/gravatar';
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

console.log('🔧 API URL configured as:', API_URL);

// ── Header ─────────────────────────────────────────────────────────────────────
const AppHeader = ({ user, onLogout }) => {
    const { isDark, toggleTheme } = useTheme();
    const token = localStorage.getItem('token');
    const [storedUser, setStoredUser] = useState(() => {
        const saved = localStorage.getItem('user');
        return saved ? JSON.parse(saved) : null;
    });

    useEffect(() => {
        if (user) setStoredUser(user);
    }, [user]);

    const userRole = storedUser?.role || 'player';
    const userEmail = storedUser?.email || 'Guest';

    return (
        <div className="header" style={{
            padding: '20px',
            backgroundColor: 'var(--header-bg)',
            color: 'var(--header-text)',
            borderRadius: '12px 12px 0 0',
            marginBottom: '20px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            boxShadow: '0 2px 5px rgba(0,0,0,0.1)'
        }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
                <h1 style={{ margin: 0, fontSize: '1.5rem', display: 'flex', alignItems: 'center' }}>
                    🏆 Open-Trivia
                </h1>
                {token && storedUser && (
                    <div style={{ marginLeft: '20px' }}>
                        <span className="badge" style={{
                            padding: '5px 10px', borderRadius: '15px',
                            backgroundColor: userRole === 'admin' ? '#ff9800' : '#28a745',
                            fontSize: '12px', fontWeight: 'bold'
                        }}>
                            {userRole.toUpperCase()}
                        </span>
                    </div>
                )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                <button
                    className="btn"
                    style={{
                        backgroundColor: 'transparent', border: '1px solid var(--header-text)',
                        color: 'var(--header-text)', borderRadius: '50px', padding: '8px 15px', cursor: 'pointer'
                    }}
                    onClick={toggleTheme}
                >
                    {isDark ? '☀ Light' : '🌙 Dark'}
                </button>
                {!token ? (
                    <LoginModal />
                ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        {storedUser?.email && (
                            <img
                                src={gravatarUrl(storedUser.email, 48)}
                                alt={storedUser.email}
                                width={28}
                                height={28}
                                style={{ borderRadius: '50%', border: '2px solid rgba(255,255,255,0.6)' }}
                            />
                        )}
                        <span style={{ fontSize: '0.9rem' }}>
                            Welcome, <strong>{userEmail.split('@')[0]}</strong>
                        </span>
                        <button
                            className="btn"
                            style={{
                                backgroundColor: 'rgba(0,0,0,0.2)', color: 'white',
                                padding: '8px 16px', border: 'none', borderRadius: '5px', cursor: 'pointer'
                            }}
                            onClick={onLogout}
                        >
                            Logout
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

// ── Login / Register / Forgot Password Modal ───────────────────────────────────
const LoginModal = () => {
    const [isOpen, setIsOpen] = useState(false);
    // 'login' | 'register' | 'forgot'
    const [view, setView]         = useState('login');
    const [email, setEmail]       = useState('');
    const [password, setPassword] = useState('');
    const [error, setError]       = useState('');
    const [success, setSuccess]   = useState('');

    const clearMessages = () => { setError(''); setSuccess(''); };
    const switchView = (v) => { clearMessages(); setView(v); };

    const handleLogin = async (e) => {
        e.preventDefault();
        clearMessages();
        try {
            const res = await axios.post(`${API_URL}/login`, { email, password });
            localStorage.setItem('token', res.data.token);
            localStorage.setItem('user', JSON.stringify(res.data.user));
            window.location.reload();
        } catch (err) {
            setError(err.response?.data?.error || 'Login failed. Check your credentials.');
        }
    };

    const handleRegister = async (e) => {
        e.preventDefault();
        clearMessages();
        try {
            const res = await axios.post(`${API_URL}/register`, { email, password });
            localStorage.setItem('token', res.data.token);
            localStorage.setItem('user', JSON.stringify(res.data.user));
            window.location.reload();
        } catch (err) {
            setError(err.response?.data?.error || 'Registration failed. User might already exist.');
        }
    };

    const handleRequestReset = async (e) => {
        e.preventDefault();
        clearMessages();
        try {
            const res = await axios.post(`${API_URL}/auth/request-reset`, { email });
            if (res.data.emailSent) {
                setSuccess('📧 Reset link sent! Check your inbox (and spam folder).');
            } else if (res.data.token) {
                // Dev mode — no SMTP. Direct them to the reset page with the token in the URL.
                const resetUrl = `/reset-password?reset_token=${res.data.token}`;
                setSuccess(
                    <span>
                        ⚠️ No email server configured.{' '}
                        <a href={resetUrl} style={{ color: '#155724', fontWeight: 'bold' }}>
                            Click here to set your password →
                        </a>
                    </span>
                );
            } else {
                setSuccess('If that email is registered, a reset link has been sent.');
            }
        } catch (err) {
            setError(err.response?.data?.error || 'Request failed.');
        }
    };

    if (!isOpen) {
        return (
            <button
                className="btn"
                style={{
                    backgroundColor: 'white', color: 'var(--header-bg)',
                    padding: '8px 16px', fontWeight: 'bold', borderRadius: '5px', cursor: 'pointer',
                }}
                onClick={() => setIsOpen(true)}
            >
                Login / Register
            </button>
        );
    }

    const iStyle = {
        width: '100%', padding: '10px', boxSizing: 'border-box',
        borderRadius: '5px', border: '1px solid #ddd', fontSize: '14px',
    };
    const linkStyle = {
        color: '#007bff', cursor: 'pointer', textDecoration: 'underline',
        background: 'none', border: 'none', padding: 0, fontSize: '0.85rem',
    };

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
            backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 1000,
            display: 'flex', justifyContent: 'center', alignItems: 'center',
        }}>
            <div className="card" style={{ width: '90%', maxWidth: '420px', padding: '30px', position: 'relative' }}>
                <button
                    onClick={() => setIsOpen(false)}
                    style={{ position: 'absolute', top: '15px', right: '15px', background: 'none', border: 'none', fontSize: '22px', cursor: 'pointer', color: '#888' }}
                >
                    ×
                </button>

                {error && (
                    <div style={{ color: '#721c24', backgroundColor: '#f8d7da', padding: '8px 12px', borderRadius: '5px', marginBottom: '12px', fontSize: '0.9rem' }}>
                        {error}
                    </div>
                )}
                {success && (
                    <div style={{ color: '#155724', backgroundColor: '#d4edda', padding: '8px 12px', borderRadius: '5px', marginBottom: '12px', fontSize: '0.9rem' }}>
                        {success}
                    </div>
                )}

                {/* ── LOGIN ── */}
                {view === 'login' && (
                    <>
                        <h3 style={{ marginBottom: '16px' }}>Sign In</h3>
                        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required style={iStyle} />
                            <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required style={iStyle} />
                            <button type="submit" className="btn btn-primary" style={{ padding: '10px' }}>Sign In</button>
                        </form>
                        <div style={{ marginTop: '14px', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}>
                            <button style={linkStyle} onClick={() => switchView('forgot')}>Forgot password?</button>
                            <button style={linkStyle} onClick={() => switchView('register')}>Create an account →</button>
                        </div>
                    </>
                )}

                {/* ── REGISTER ── */}
                {view === 'register' && (
                    <>
                        <h3 style={{ marginBottom: '16px' }}>Create Account</h3>
                        <form onSubmit={handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required style={iStyle} />
                            <input type="password" placeholder="Password (min 6 chars)" value={password} onChange={e => setPassword(e.target.value)} required style={iStyle} />
                            <button type="submit" className="btn" style={{ padding: '10px', backgroundColor: '#6c757d', color: 'white' }}>Register</button>
                        </form>
                        <div style={{ marginTop: '14px' }}>
                            <button style={linkStyle} onClick={() => switchView('login')}>← Back to sign in</button>
                        </div>
                    </>
                )}

                {/* ── FORGOT PASSWORD ── */}
                {view === 'forgot' && (
                    <>
                        <h3 style={{ marginBottom: '8px' }}>Forgot Password</h3>
                        <p style={{ fontSize: '0.85rem', color: '#666', marginBottom: '16px' }}>
                            Enter your email and we'll send you a reset link. You can also{' '}
                            <a href="/reset-password" style={{ color: '#007bff' }}>go directly to the reset page</a>
                            {' '}if you already have a token.
                        </p>
                        <form onSubmit={handleRequestReset} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            <input type="email" placeholder="Your email" value={email} onChange={e => setEmail(e.target.value)} required style={iStyle} />
                            <button type="submit" className="btn btn-primary" style={{ padding: '10px' }}>Send Reset Link</button>
                        </form>
                        <div style={{ marginTop: '14px' }}>
                            <button style={linkStyle} onClick={() => switchView('login')}>← Back to sign in</button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

// ── Main App ───────────────────────────────────────────────────────────────────
function App() {
    const [user, setUser] = useState(() => {
        const saved = localStorage.getItem('user');
        return saved ? JSON.parse(saved) : null;
    });

    const handleLogout = () => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        setUser(null);
        window.location.reload();
    };

    useEffect(() => {
        const stored = localStorage.getItem('user');
        if (stored) setUser(JSON.parse(stored));
    }, []);

    return (
        <ThemeProvider>
            <Router>
                <Routes>
                    {/* Standalone reset page — no app chrome */}
                    <Route path="/reset-password" element={<ResetPasswordPage />} />

                    {/* Main app shell */}
                    <Route path="*" element={
                        <div className="container" style={{ maxWidth: '900px', margin: '0 auto', padding: '20px' }}>
                            <AppHeader user={user} onLogout={handleLogout} />

                            <nav style={{ marginBottom: '30px', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px', display: 'flex', gap: '30px' }}>
                                <Link to="/" style={{ textDecoration: 'none', color: 'var(--text-color)', fontWeight: 'bold' }}>Play Game</Link>
                                {user && (
                                    <Link to="/dashboard" style={{ textDecoration: 'none', color: 'var(--text-color)', fontWeight: 'bold' }}>My Stats</Link>
                                )}
                                <Link to="/leaderboard" style={{ textDecoration: 'none', color: 'var(--text-color)', fontWeight: 'bold' }}>Leaderboard</Link>
                                {user && user.role === 'admin' && (
                                    <Link to="/admin" style={{ textDecoration: 'none', color: 'var(--text-color)', fontWeight: 'bold' }}>Admin Panel</Link>
                                )}
                            </nav>

                            <Routes>
                                <Route path="/" element={<Game />} />
                                <Route path="/dashboard" element={user ? <Dashboard /> : <Navigate to="/" replace />} />
                                <Route path="/leaderboard" element={<Leaderboard />} />
                                <Route path="/admin" element={user?.role === 'admin' ? <Admin /> : <Navigate to="/" replace />} />
                            </Routes>

                            <footer style={{ textAlign: 'center', marginTop: '50px', color: '#888', fontSize: '0.9rem' }}>
                                <p>Open-Trivia</p>
                                <p style={{ margin: '6px 0 0' }}>
                                    Created by <a href="https://gamedirection.net" style={{ color: '#007bff', textDecoration: 'none' }}>gamedirection.net © 2026</a>
                                </p>
                                <p style={{ margin: '6px 0 0' }}>
                                    Discord: <a href="https://join.gamedirection.net" style={{ color: '#007bff', textDecoration: 'none' }}>join.gamedirection.net</a>
                                </p>
                                <p style={{ margin: '6px 0 0' }}>
                                    Credits: Alex Sierputowski @ <a href="https://gamedirection.net" style={{ color: '#007bff', textDecoration: 'none' }}>GameDirection.net</a>
                                </p>
                            </footer>
                        </div>
                    } />
                </Routes>
            </Router>
        </ThemeProvider>
    );
}

export default App;
