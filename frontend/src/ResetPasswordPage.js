import React, { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import axios from 'axios';
import { useTheme } from './ThemeContext';
import { BRAND_LOGO_URL } from './branding';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

// ── Small shared input style ──────────────────────────────────────────────────
const iStyle = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '12px 14px',
    borderRadius: '8px',
    border: '1px solid #ddd',
    fontSize: '15px',
    outline: 'none',
    transition: 'border-color 0.2s',
};

// ── Step indicator ─────────────────────────────────────────────────────────────
const Steps = ({ current }) => {
    const steps = ['Enter token', 'New password', 'Done'];
    return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '32px', gap: 0 }}>
            {steps.map((label, i) => {
                const active  = i === current;
                const done    = i < current;
                return (
                    <React.Fragment key={label}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                            <div style={{
                                width: '32px', height: '32px', borderRadius: '50%',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontWeight: 'bold', fontSize: '14px',
                                backgroundColor: done ? '#28a745' : active ? 'var(--btn-primary, #007bff)' : '#e9ecef',
                                color: (done || active) ? 'white' : '#aaa',
                                transition: 'all 0.3s',
                            }}>
                                {done ? '✓' : i + 1}
                            </div>
                            <span style={{
                                fontSize: '11px', fontWeight: active ? '700' : '400',
                                color: active ? 'var(--text-color)' : '#aaa',
                                whiteSpace: 'nowrap',
                            }}>
                                {label}
                            </span>
                        </div>
                        {i < steps.length - 1 && (
                            <div style={{
                                flex: 1, height: '2px', margin: '0 6px', marginBottom: '22px',
                                backgroundColor: done ? '#28a745' : '#e9ecef',
                                transition: 'background-color 0.3s',
                            }} />
                        )}
                    </React.Fragment>
                );
            })}
        </div>
    );
};

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ResetPasswordPage() {
    const { isDark } = useTheme();
    const [searchParams] = useSearchParams();

    // step 0 = token entry, 1 = new password, 2 = success
    const [step, setStep]               = useState(0);
    const [token, setToken]             = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPw, setConfirmPw]     = useState('');
    const [showPw, setShowPw]           = useState(false);
    const [error, setError]             = useState('');
    const [loading, setLoading]         = useState(false);

    // Pre-fill token from URL and skip straight to step 1 if present
    useEffect(() => {
        const urlToken = searchParams.get('reset_token') || '';
        if (urlToken) {
            setToken(urlToken);
            setStep(1);
        }
    }, []);

    const handleTokenSubmit = (e) => {
        e.preventDefault();
        setError('');
        if (!token.trim()) { setError('Please enter your reset token.'); return; }
        setStep(1);
    };

    const handlePasswordSubmit = async (e) => {
        e.preventDefault();
        setError('');
        if (newPassword.length < 6) { setError('Password must be at least 6 characters.'); return; }
        if (newPassword !== confirmPw)  { setError('Passwords do not match.'); return; }

        setLoading(true);
        try {
            await axios.post(`${API_URL}/auth/reset-password`, {
                token: token.trim(),
                newPassword,
            });
            setStep(2);
        } catch (err) {
            const msg = err.response?.data?.error || 'Reset failed.';
            setError(msg);
            // If the token is bad/expired let them go back and re-enter it
            if (msg.toLowerCase().includes('invalid') || msg.toLowerCase().includes('expired')) {
                setStep(0);
                setToken('');
            }
        } finally {
            setLoading(false);
        }
    };

    const cardStyle = {
        backgroundColor: 'var(--card-bg, #fff)',
        borderRadius: '16px',
        padding: '40px',
        boxShadow: '0 4px 24px rgba(0,0,0,0.10)',
        width: '100%',
        maxWidth: '460px',
        margin: '0 auto',
    };

    const pwStrength = (pw) => {
        if (!pw) return null;
        if (pw.length < 6)  return { label: 'Too short', color: '#dc3545', pct: 20 };
        if (pw.length < 8)  return { label: 'Weak',      color: '#fd7e14', pct: 40 };
        if (pw.length < 12 && !/[^a-zA-Z0-9]/.test(pw))
                            return { label: 'Fair',      color: '#ffc107', pct: 60 };
        if (pw.length >= 8 && /[^a-zA-Z0-9]/.test(pw))
                            return { label: 'Strong',    color: '#28a745', pct: 100 };
        return               { label: 'Good',       color: '#20c997', pct: 80 };
    };
    const strength = pwStrength(newPassword);

    return (
        <div style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
            backgroundColor: 'var(--bg-color, #f0f2f5)',
        }}>
            {/* Logo / back link */}
            <div style={{ marginBottom: '28px', textAlign: 'center' }}>
                <Link to="/" style={{ textDecoration: 'none' }}>
                    {BRAND_LOGO_URL ? (
                        <img
                            src={BRAND_LOGO_URL}
                            alt="Open-Trivia logo"
                            width={48}
                            height={48}
                            style={{ display: 'inline-block', objectFit: 'contain' }}
                        />
                    ) : (
                        <span style={{ fontSize: '2rem' }}>🏆</span>
                    )}
                    <span style={{
                        display: 'block', fontSize: '1.4rem', fontWeight: '800',
                        color: 'var(--text-color, #333)', marginTop: '4px',
                    }}>
                        Open-Trivia
                    </span>
                </Link>
            </div>

            <div style={cardStyle}>
                <h2 style={{ textAlign: 'center', margin: '0 0 8px', color: 'var(--text-color, #333)', fontSize: '1.4rem' }}>
                    Reset your password
                </h2>
                <p style={{ textAlign: 'center', color: '#888', fontSize: '0.9rem', marginBottom: '28px' }}>
                    {step === 0 && 'Enter the token from your reset email, or paste the full link into your browser.'}
                    {step === 1 && 'Choose a new password for your account.'}
                    {step === 2 && 'All done — you can now sign in with your new password.'}
                </p>

                <Steps current={step} />

                {/* ── Error banner ── */}
                {error && (
                    <div style={{
                        backgroundColor: '#f8d7da', color: '#721c24',
                        padding: '10px 14px', borderRadius: '8px',
                        marginBottom: '18px', fontSize: '0.9rem',
                        border: '1px solid #f5c6cb',
                    }}>
                        {error}
                    </div>
                )}

                {/* ── STEP 0 — Token entry ── */}
                {step === 0 && (
                    <form onSubmit={handleTokenSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                        <div>
                            <label style={{ display: 'block', fontWeight: '600', marginBottom: '6px', fontSize: '14px', color: 'var(--text-color)' }}>
                                Reset token
                            </label>
                            <textarea
                                value={token}
                                onChange={e => setToken(e.target.value)}
                                placeholder="Paste your reset token here…"
                                rows={3}
                                style={{
                                    ...iStyle,
                                    fontFamily: 'monospace',
                                    fontSize: '13px',
                                    resize: 'vertical',
                                    lineHeight: '1.5',
                                }}
                                autoFocus
                            />
                            <p style={{ fontSize: '12px', color: '#aaa', marginTop: '6px' }}>
                                The token is the long string at the end of the reset link in your email.
                                If you have the full link, you can also just click it directly.
                            </p>
                        </div>
                        <button
                            type="submit"
                            className="btn btn-primary"
                            style={{ padding: '13px', fontSize: '15px', borderRadius: '8px', fontWeight: '600' }}
                        >
                            Continue →
                        </button>
                    </form>
                )}

                {/* ── STEP 1 — New password ── */}
                {step === 1 && (
                    <form onSubmit={handlePasswordSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                        {/* Token summary — collapsed but editable */}
                        <div style={{
                            backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#f8f9fa',
                            borderRadius: '8px', padding: '10px 14px',
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        }}>
                            <div style={{ overflow: 'hidden' }}>
                                <div style={{ fontSize: '11px', color: '#aaa', marginBottom: '2px' }}>Reset token</div>
                                <div style={{
                                    fontFamily: 'monospace', fontSize: '12px',
                                    color: 'var(--text-color)', whiteSpace: 'nowrap',
                                    overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '280px',
                                }}>
                                    {token}
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => { setError(''); setStep(0); }}
                                style={{
                                    background: 'none', border: 'none', color: '#007bff',
                                    cursor: 'pointer', fontSize: '12px', flexShrink: 0, marginLeft: '8px',
                                }}
                            >
                                Change
                            </button>
                        </div>

                        <div>
                            <label style={{ display: 'block', fontWeight: '600', marginBottom: '6px', fontSize: '14px', color: 'var(--text-color)' }}>
                                New password
                            </label>
                            <div style={{ position: 'relative' }}>
                                <input
                                    type={showPw ? 'text' : 'password'}
                                    placeholder="Minimum 6 characters"
                                    value={newPassword}
                                    onChange={e => setNewPassword(e.target.value)}
                                    required
                                    style={{ ...iStyle, paddingRight: '50px' }}
                                    autoFocus
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPw(p => !p)}
                                    style={{
                                        position: 'absolute', right: '12px', top: '50%',
                                        transform: 'translateY(-50%)', background: 'none',
                                        border: 'none', cursor: 'pointer', color: '#aaa', fontSize: '18px',
                                    }}
                                    title={showPw ? 'Hide password' : 'Show password'}
                                >
                                    {showPw ? '🙈' : '👁'}
                                </button>
                            </div>
                            {/* Strength bar */}
                            {strength && (
                                <div style={{ marginTop: '8px' }}>
                                    <div style={{ height: '4px', borderRadius: '2px', backgroundColor: '#e9ecef', overflow: 'hidden' }}>
                                        <div style={{
                                            width: `${strength.pct}%`, height: '100%',
                                            backgroundColor: strength.color, transition: 'all 0.3s',
                                        }} />
                                    </div>
                                    <div style={{ fontSize: '11px', color: strength.color, marginTop: '3px', textAlign: 'right' }}>
                                        {strength.label}
                                    </div>
                                </div>
                            )}
                        </div>

                        <div>
                            <label style={{ display: 'block', fontWeight: '600', marginBottom: '6px', fontSize: '14px', color: 'var(--text-color)' }}>
                                Confirm password
                            </label>
                            <input
                                type={showPw ? 'text' : 'password'}
                                placeholder="Repeat your new password"
                                value={confirmPw}
                                onChange={e => setConfirmPw(e.target.value)}
                                required
                                style={{
                                    ...iStyle,
                                    borderColor: confirmPw && confirmPw !== newPassword ? '#dc3545' : undefined,
                                }}
                            />
                            {confirmPw && confirmPw !== newPassword && (
                                <div style={{ fontSize: '12px', color: '#dc3545', marginTop: '4px' }}>Passwords don't match</div>
                            )}
                        </div>

                        <button
                            type="submit"
                            className="btn btn-primary"
                            disabled={loading || (confirmPw && confirmPw !== newPassword)}
                            style={{ padding: '13px', fontSize: '15px', borderRadius: '8px', fontWeight: '600', marginTop: '4px' }}
                        >
                            {loading ? 'Saving…' : 'Set new password'}
                        </button>
                    </form>
                )}

                {/* ── STEP 2 — Success ── */}
                {step === 2 && (
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '56px', marginBottom: '16px' }}>🎉</div>
                        <h3 style={{ color: '#28a745', marginBottom: '10px' }}>Password updated!</h3>
                        <p style={{ color: '#666', marginBottom: '28px', fontSize: '0.95rem' }}>
                            Your password has been changed. Head back to the game and sign in.
                        </p>
                        <Link
                            to="/"
                            className="btn btn-primary"
                            style={{ display: 'inline-block', padding: '13px 32px', borderRadius: '8px', fontWeight: '600', textDecoration: 'none', fontSize: '15px' }}
                        >
                            Go to Open-Trivia →
                        </Link>
                    </div>
                )}

                {/* Footer links */}
                {step < 2 && (
                    <div style={{ marginTop: '24px', textAlign: 'center', fontSize: '13px', color: '#aaa' }}>
                        <Link to="/" style={{ color: '#007bff', textDecoration: 'none' }}>← Back to Open-Trivia</Link>
                        <div style={{ marginTop: '12px' }}>
                            Created by <a href="https://gamedirection.net" style={{ color: '#007bff', textDecoration: 'none' }}>gamedirection.net © 2026</a>
                        </div>
                        <div style={{ marginTop: '6px' }}>
                            Discord: <a href="https://join.gamedirection.net" style={{ color: '#007bff', textDecoration: 'none' }}>join.gamedirection.net</a>
                        </div>
                        <div style={{ marginTop: '6px' }}>
                            Credits: Alex Sierputowski @ <a href="https://gamedirection.net" style={{ color: '#007bff', textDecoration: 'none' }}>GameDirection.net</a>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
