import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import RequestCardModal from './RequestCardModal';

const API_URL = process.env.REACT_APP_API_URL || '/api';

// Retrieve or create an anonymous session ID for guest players
async function getAnonymousId() {
    let anonId = localStorage.getItem('anonymousId');
    if (anonId) return anonId;
    try {
        const res = await axios.post(`${API_URL}/game/anonymous-session`);
        anonId = String(res.data.anonymousId);
        localStorage.setItem('anonymousId', anonId);
        return anonId;
    } catch {
        return null;
    }
}

export default function Game() {
    const [question, setQuestion] = useState(null);
    const [loading, setLoading] = useState(true);
    const [guessCounts, setGuessCounts] = useState({});
    const [result, setResult] = useState(null);
    const [reportMessage, setReportMessage] = useState('');
    const [showRequestModal, setShowRequestModal] = useState(false);
    const [answered, setAnswered] = useState(null);
    const [elapsedMs, setElapsedMs] = useState(0);
    const startRef = useRef(null);
    const [categories, setCategories] = useState([]);
    const [categorySearch, setCategorySearch] = useState('');
    const [selectedCategoryId, setSelectedCategoryId] = useState('');

    const token = localStorage.getItem('token');
    const isLoggedIn = !!token;

    const fetchQuestion = async () => {
        setLoading(true);
        try {
            const params = {};
            if (selectedCategoryId) params.categoryId = selectedCategoryId;
            const res = await axios.get(`${API_URL}/game/next`, { params });
            if (!res.data || !res.data.id) {
                setQuestion(null);
                return;
            }
            setQuestion(res.data);
            setGuessCounts({ A: 25, B: 25, C: 25, D: 25 });
            setResult(null);
            setAnswered(null);
            setReportMessage('');
        } catch (err) {
            console.error("Error fetching question:", err);
            setQuestion(null);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchQuestion();
    }, []);

    useEffect(() => {
        if (selectedCategoryId !== '') fetchQuestion();
    }, [selectedCategoryId]);

    useEffect(() => {
        const loadCategories = async () => {
            try {
                const res = await axios.get(`${API_URL}/categories`);
                setCategories(res.data || []);
            } catch {
                setCategories([]);
            }
        };
        loadCategories();
    }, []);

    useEffect(() => {
        if (!question?.id) return;
        startRef.current = Date.now();
        setElapsedMs(0);
        const tick = setInterval(() => {
            if (startRef.current) setElapsedMs(Date.now() - startRef.current);
        }, 100);
        return () => clearInterval(tick);
    }, [question?.id]);

    const handleAnswer = async (optionChar) => {
        if (!question || result || answered) return;

        setAnswered(optionChar);

        setGuessCounts(prev => {
            const total = Object.values(prev).reduce((a, b) => a + b, 0) + 10;
            const updated = { ...prev, [optionChar]: (prev[optionChar] || 25) + 10 };
            const normalized = {};
            Object.keys(updated).forEach(k => {
                normalized[k] = Math.round((updated[k] / total) * 100);
            });
            return normalized;
        });

        try {
            const elapsed = startRef.current ? Date.now() - startRef.current : null;
            const body = { questionId: question.id, selectedAnswer: optionChar, elapsedMs: elapsed };

            let headers = {};
            if (token) {
                headers = { Authorization: `Bearer ${token}` };
            } else {
                // Attach anonymous session id for guest tracking
                const anonId = await getAnonymousId();
                if (anonId) body.anonymousId = anonId;
            }

            const res = await axios.post(`${API_URL}/game/submit`, body, { headers });
            setResult({
                isCorrect: res.data.isCorrect,
                correctAnswer: res.data.correctAnswer,
                pointsAwarded: res.data.pointsAwarded,
            });
            setTimeout(() => fetchQuestion(), 3000);
        } catch (err) {
            console.error('Submit error:', err);
            setAnswered(null);
            alert('Error submitting answer. Please try again.');
        }
    };

    const handleReport = async () => {
        if (!question) return;
        if (!isLoggedIn) {
            setReportMessage('⚠️ You must be logged in to report a question.');
            return;
        }
        try {
            await axios.post(
                `${API_URL}/game/report`,
                { questionId: question.id, reason: 'User report' },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            setReportMessage('✅ Question reported successfully.');
        } catch (err) {
            if (err.response?.status === 401) {
                setReportMessage('⚠️ You must be logged in to report a question.');
            } else {
                setReportMessage('Question flagged for review.');
            }
        }
    };

    const handleSuggest = () => {
        if (!isLoggedIn) {
            setReportMessage('⚠️ You must be logged in to suggest a question.');
            return;
        }
        setShowRequestModal(true);
    };

    const getButtonStyle = (optChar) => {
        const base = {
            border: '1px solid var(--border-color)',
            padding: '15px',
            fontWeight: 'bold',
            cursor: answered ? 'default' : 'pointer',
            transition: 'all 0.3s ease'
        };

        if (!result) {
            return {
                ...base,
                backgroundColor: answered === optChar ? '#6c757d' : 'var(--card-bg)',
                color: answered === optChar ? 'white' : 'var(--text-color)',
            };
        }

        if (optChar === result.correctAnswer) {
            return { ...base, backgroundColor: '#28a745', color: 'white' };
        }
        if (optChar === answered && optChar !== result.correctAnswer) {
            return { ...base, backgroundColor: '#dc3545', color: 'white' };
        }
        return { ...base, backgroundColor: 'var(--card-bg)', color: 'var(--text-color)', opacity: 0.6 };
    };

    if (loading) {
        return (
            <div className="card" style={{ textAlign: 'center', padding: '40px' }}>
                <div style={{ fontSize: '48px', marginBottom: '20px' }}>⏳</div>
                <h3>Loading Question...</h3>
            </div>
        );
    }

    if (!question) {
        return (
            <div className="card" style={{ textAlign: 'center', padding: '40px' }}>
                <div style={{ fontSize: '48px', marginBottom: '20px' }}>🔍</div>
                <h2>No Questions Available Yet!</h2>
                <p style={{ color: '#666', marginBottom: '30px' }}>
                    Ask an admin to add some trivia questions to get started.
                </p>
                <button onClick={fetchQuestion} className="btn btn-primary" style={{ padding: '12px 30px' }}>
                    🔄 Retry
                </button>
            </div>
        );
    }

    const complexityColors = { easy: '#28a745', medium: '#ffc107', hard: '#dc3545' };
    const filteredCategories = categories.filter(c =>
        c.name.toLowerCase().includes(categorySearch.trim().toLowerCase())
    );

    return (
        <div className="card" style={{ position: 'relative' }}>
            {/* Category filter */}
            <div style={{
                display: 'flex', gap: '10px', flexWrap: 'wrap',
                alignItems: 'center', marginBottom: '16px'
            }}>
                <div>
                    <label style={{ display: 'block', fontSize: '12px', color: '#888', marginBottom: '4px' }}>
                        Search Categories
                    </label>
                    <input
                        value={categorySearch}
                        onChange={e => setCategorySearch(e.target.value)}
                        placeholder="Type to filter..."
                        style={{
                            padding: '6px 8px', borderRadius: '6px',
                            border: '1px solid var(--border-color)', backgroundColor: 'var(--card-bg)',
                            color: 'var(--text-color)', width: '200px'
                        }}
                    />
                </div>
                <div>
                    <label style={{ display: 'block', fontSize: '12px', color: '#888', marginBottom: '4px' }}>
                        Category
                    </label>
                    <select
                        value={selectedCategoryId}
                        onChange={e => setSelectedCategoryId(e.target.value)}
                        style={{
                            padding: '6px 8px', borderRadius: '6px',
                            border: '1px solid var(--border-color)', backgroundColor: 'var(--card-bg)',
                            color: 'var(--text-color)', minWidth: '200px'
                        }}
                    >
                        <option value="">All Categories</option>
                        {filteredCategories.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Category + Difficulty header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', gap: '10px', flexWrap: 'wrap' }}>
                <span style={{
                    padding: '5px 12px', borderRadius: '20px',
                    backgroundColor: '#e2e6ea', fontSize: '14px', fontWeight: 'bold', color: '#333'
                }}>
                    📝 {question?.category || 'General'}
                </span>
                <span style={{
                    padding: '5px 12px', borderRadius: '20px',
                    backgroundColor: complexityColors[question?.complexity] || '#ffc107',
                    color: question?.complexity === 'medium' ? '#856404' : 'white',
                    fontSize: '14px', fontWeight: 'bold'
                }}>
                    {question?.complexity?.toUpperCase() || 'MEDIUM'}
                </span>
                <span style={{
                    padding: '5px 12px', borderRadius: '20px',
                    backgroundColor: 'var(--card-bg)', border: '1px solid var(--border-color)',
                    fontSize: '13px', fontWeight: 'bold', color: 'var(--text-color)'
                }}>
                    ⏱ {Math.min(99.9, elapsedMs / 1000).toFixed(1)}s
                </span>
            </div>

            {/* Question text */}
            <h2 style={{ marginTop: '10px', marginBottom: '25px', color: 'var(--text-color)', lineHeight: '1.4' }}>
                {question.text}
            </h2>

            {/* Guess ratio bars */}
            <div style={{ marginBottom: '20px', borderTop: '1px dashed var(--border-color)', paddingTop: '10px' }}>
                <small style={{ color: 'var(--text-color)', opacity: 0.7 }}>Community Guess Ratios</small>
                <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                    {question.options.map(opt => {
                        const pct = guessCounts[opt.char] || 25;
                        return (
                            <div key={opt.char} style={{ flex: 1 }}>
                                <div style={{ fontSize: '10px', marginBottom: '2px', color: 'var(--text-color)' }}>
                                    {opt.char}
                                </div>
                                <div style={{
                                    width: '100%', backgroundColor: 'var(--border-color)',
                                    borderRadius: '5px', height: '8px', overflow: 'hidden'
                                }}>
                                    <div style={{
                                        width: `${Math.min(pct, 100)}%`,
                                        backgroundColor: result && opt.char === result.correctAnswer ? '#28a745' : 'var(--btn-primary)',
                                        height: '100%', transition: 'width 0.5s ease'
                                    }} />
                                </div>
                                <div style={{ textAlign: 'right', fontSize: '10px', marginTop: '2px', color: 'var(--text-color)' }}>
                                    {pct}%
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Answer buttons */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                {question.options.map((opt) => (
                    <button
                        key={opt.char}
                        className="btn"
                        style={getButtonStyle(opt.char)}
                        onClick={() => handleAnswer(opt.char)}
                        disabled={!!answered}
                    >
                        <strong>{opt.char})</strong> {opt.text}
                    </button>
                ))}
            </div>

            {/* Result banner */}
            {result && (
                <div style={{
                    marginTop: '20px', padding: '15px', borderRadius: '8px',
                    backgroundColor: result.isCorrect ? '#d4edda' : '#f8d7da',
                    color: result.isCorrect ? '#155724' : '#721c24',
                    textAlign: 'center', fontSize: '1.1rem', fontWeight: 'bold',
                    border: result.isCorrect ? '1px solid #c3e6cb' : '1px solid #f5c6cb'
                }}>
                    {result.isCorrect
                        ? `🎉 Correct! +${result.pointsAwarded ?? 0} points! Next question in 3 seconds...`
                        : `❌ Wrong! The correct answer was ${result.correctAnswer}. Next question in 3 seconds...`}
                </div>
            )}

            {/* Action buttons */}
            <div style={{ marginTop: '20px', display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <button
                    className="btn"
                    style={{
                        backgroundColor: isLoggedIn ? 'var(--header-bg)' : '#adb5bd',
                        color: 'white', padding: '8px 15px',
                        cursor: isLoggedIn ? 'pointer' : 'default'
                    }}
                    onClick={handleSuggest}
                    title={!isLoggedIn ? 'Log in to suggest a question' : ''}
                >
                    📝 Suggest a Question {!isLoggedIn && '🔒'}
                </button>
                <button
                    className="btn"
                    style={{
                        backgroundColor: isLoggedIn ? '#6c757d' : '#adb5bd',
                        color: 'white', padding: '8px 20px',
                        cursor: isLoggedIn ? 'pointer' : 'default'
                    }}
                    onClick={handleReport}
                    title={!isLoggedIn ? 'Log in to report a question' : ''}
                >
                    ⚠ Report {!isLoggedIn && '🔒'}
                </button>
            </div>

            {reportMessage && (
                <p style={{
                    color: reportMessage.startsWith('⚠️') ? '#856404' : 'orange',
                    backgroundColor: reportMessage.startsWith('⚠️') ? '#fff3cd' : 'transparent',
                    padding: reportMessage.startsWith('⚠️') ? '8px 12px' : '0',
                    borderRadius: '5px',
                    marginTop: '10px', fontStyle: 'italic', textAlign: 'center'
                }}>
                    {reportMessage}
                </p>
            )}

            {showRequestModal && (
                <RequestCardModal onClose={() => setShowRequestModal(false)} />
            )}
        </div>
    );
}
