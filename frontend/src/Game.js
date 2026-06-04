import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { cachedGet } from './utils/api';
import RequestCardModal from './RequestCardModal';

const API_URL = process.env.REACT_APP_API_URL || '/api';
const OPENTDB_CATEGORY_ID = '__opentdb__';
const OPENTDB_CATEGORY_NAME = 'OpenTriviaDB';
const OPENTDB_PREFETCH_AHEAD = 10;

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
    const [showReportOptions, setShowReportOptions] = useState(false);
    const [reportType, setReportType] = useState('general');
    const [reportNote, setReportNote] = useState('');
    const [showRequestModal, setShowRequestModal] = useState(false);
    const [answered, setAnswered] = useState(null);
    const [elapsedMs, setElapsedMs] = useState(0);
    const startRef = useRef(null);
    const reportMenuRef = useRef(null);
    const [categories, setCategories] = useState([]);
    const [categorySearch, setCategorySearch] = useState('');
    const [includeCategoryIds, setIncludeCategoryIds] = useState([]);
    const [excludeCategoryIds, setExcludeCategoryIds] = useState([]);
    const [customGroups, setCustomGroups] = useState([]);
    const [customGroupName, setCustomGroupName] = useState('');
    const [customGroupStatus, setCustomGroupStatus] = useState('');
    const [openTdbQueue, setOpenTdbQueue] = useState([]);
    const [openTdbEnabled, setOpenTdbEnabled] = useState(true);
    const [skipPerHour, setSkipPerHour] = useState(3);
    const [skipBusy, setSkipBusy] = useState(false);
    const [animationsEnabled, setAnimationsEnabled] = useState(() => {
        try {
            const user = JSON.parse(localStorage.getItem('user') || 'null');
            return user?.animations_enabled !== false;
        } catch {
            return true;
        }
    });
    const openTdbFetchingRef = useRef(false);

    const makeGuessCounts = (options = []) => {
        const visibleOptions = Array.isArray(options)
            ? options.filter((opt) => String(opt?.text || '').trim())
            : [];
        if (!visibleOptions.length) return {};
        const base = Math.floor(100 / visibleOptions.length);
        const remainder = 100 - (base * visibleOptions.length);
        return visibleOptions.reduce((acc, opt, index) => {
            acc[opt.char] = base + (index < remainder ? 1 : 0);
            return acc;
        }, {});
    };

    const token = localStorage.getItem('token');
    const isOpenTdbCategory = includeCategoryIds.length === 1 && includeCategoryIds[0] === OPENTDB_CATEGORY_ID;
    const localIncludeIds = includeCategoryIds.filter(id => id !== OPENTDB_CATEGORY_ID);
    const localExcludeIds = excludeCategoryIds.filter(id => id !== OPENTDB_CATEGORY_ID);
    const includeFilterKey = includeCategoryIds.join(',');
    const excludeFilterKey = excludeCategoryIds.join(',');

    const fetchOpenTdbBatch = async (amount) => {
        const n = Number.isFinite(amount) ? Math.max(1, Math.min(50, amount)) : OPENTDB_PREFETCH_AHEAD;
        const res = await axios.get(`${API_URL}/game/opentdb/next-batch`, { params: { amount: n } });
        return Array.isArray(res.data?.questions) ? res.data.questions : [];
    };

    const refillOpenTdbQueue = async (existingQueue = []) => {
        if (openTdbFetchingRef.current) return;
        const missing = OPENTDB_PREFETCH_AHEAD - existingQueue.length;
        if (missing <= 0) return;
        openTdbFetchingRef.current = true;
        try {
            const fetched = await fetchOpenTdbBatch(missing);
            if (!fetched.length) return;
            setOpenTdbQueue(prev => [...prev, ...fetched]);
        } catch {
            // Keep gameplay running; user can retry next question.
        } finally {
            openTdbFetchingRef.current = false;
        }
    };

    const fetchQuestion = async () => {
        setLoading(true);
        try {
            if (isOpenTdbCategory) {
                let queue = openTdbQueue;
                if (!queue.length) {
                    queue = await fetchOpenTdbBatch(OPENTDB_PREFETCH_AHEAD + 1);
                }
                const next = queue[0];
                if (!next) {
                    setQuestion(null);
                    return;
                }
                const remaining = queue.slice(1);
                setQuestion(next);
                setOpenTdbQueue(remaining);
                setGuessCounts(makeGuessCounts(next.options));
                setResult(null);
                setAnswered(null);
                setReportMessage('');
                void refillOpenTdbQueue(remaining);
                return;
            }
            const params = {};
            if (localIncludeIds.length) params.includeCategoryIds = localIncludeIds.join(',');
            if (localExcludeIds.length) params.excludeCategoryIds = localExcludeIds.join(',');
            const res = await axios.get(`${API_URL}/game/next`, { params });
            if (!res.data || !res.data.id) {
                setQuestion(null);
                return;
            }
            setQuestion(res.data);
            setGuessCounts(makeGuessCounts(res.data.options));
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
        if (!showReportOptions) return;
        const handler = (e) => {
            if (!reportMenuRef.current) return;
            if (!reportMenuRef.current.contains(e.target)) {
                setShowReportOptions(false);
            }
        };
        window.addEventListener('mousedown', handler);
        return () => window.removeEventListener('mousedown', handler);
    }, [showReportOptions]);

    useEffect(() => {
        fetchQuestion();
    }, [includeFilterKey, excludeFilterKey]);

    useEffect(() => {
        const loadGameSettings = async () => {
            try {
                const r = await cachedGet(axios, `${API_URL}/game/settings`, {}, 30000);
                const enabled = r.data?.open_trivia_db_enabled !== false;
                const skipCount = Number(r.data?.skip_per_hour);
                setOpenTdbEnabled(enabled);
                setSkipPerHour(Number.isFinite(skipCount) ? Math.max(0, skipCount) : 0);
            } catch {
                // Keep defaults
            }
        };
        loadGameSettings();
    }, []);

    useEffect(() => {
        const loadCategories = async () => {
            try {
                const res = await cachedGet(axios, `${API_URL}/categories`, {}, 30000);
                const baseCats = Array.isArray(res.data) ? res.data : [];
                setCategories(openTdbEnabled
                    ? [...baseCats, { id: OPENTDB_CATEGORY_ID, name: OPENTDB_CATEGORY_NAME }]
                    : baseCats
                );
            } catch {
                setCategories(openTdbEnabled ? [{ id: OPENTDB_CATEGORY_ID, name: OPENTDB_CATEGORY_NAME }] : []);
            }
        };
        loadCategories();
    }, [openTdbEnabled]);

    useEffect(() => {
        const loadGroups = async () => {
            if (!token) return;
            try {
                const res = await axios.get(`${API_URL}/me/category-groups`, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                setCustomGroups(Array.isArray(res.data) ? res.data : []);
            } catch {
                setCustomGroups([]);
            }
        };
        loadGroups();
    }, [token]);

    useEffect(() => {
        if (!openTdbEnabled && (includeCategoryIds.includes(OPENTDB_CATEGORY_ID) || excludeCategoryIds.includes(OPENTDB_CATEGORY_ID))) {
            setIncludeCategoryIds(prev => prev.filter(id => id !== OPENTDB_CATEGORY_ID));
            setExcludeCategoryIds(prev => prev.filter(id => id !== OPENTDB_CATEGORY_ID));
        }
    }, [openTdbEnabled, includeCategoryIds, excludeCategoryIds]);

    useEffect(() => {
        if (!question?.id) return;
        startRef.current = Date.now();
        setElapsedMs(0);
        const tick = setInterval(() => {
            if (startRef.current) setElapsedMs(Date.now() - startRef.current);
        }, 100);
        return () => clearInterval(tick);
    }, [question?.id]);

    useEffect(() => {
        const syncAnimationPref = () => {
            try {
                const user = JSON.parse(localStorage.getItem('user') || 'null');
                setAnimationsEnabled(user?.animations_enabled !== false);
            } catch {
                setAnimationsEnabled(true);
            }
        };
        window.addEventListener('user-updated', syncAnimationPref);
        return () => window.removeEventListener('user-updated', syncAnimationPref);
    }, []);

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
            if (isOpenTdbCategory) {
                const correct = String(question.correctAnswer || '').toUpperCase();
                const elapsed = startRef.current ? Date.now() - startRef.current : null;
                const body = {
                    selectedAnswer: optionChar,
                    correctAnswer: correct,
                    elapsedMs: elapsed,
                    complexity: question.complexity,
                };
                let headers = {};
                if (token) {
                    headers = { Authorization: `Bearer ${token}` };
                } else {
                    const anonId = await getAnonymousId();
                    if (anonId) body.anonymousId = anonId;
                }
                const res = await axios.post(`${API_URL}/game/opentdb/submit`, body, { headers });
                setResult({
                    isCorrect: !!res.data?.isCorrect,
                    correctAnswer: res.data?.correctAnswer || correct || 'A',
                    pointsAwarded: Number(res.data?.pointsAwarded || 0),
                });
                setTimeout(() => fetchQuestion(), 3000);
                return;
            }
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

    const handleReport = async (reasonOverride) => {
        if (!question) return;
        if (isOpenTdbCategory) {
            setReportMessage('⚠️ Reporting is only available for local Open-Trivia questions.');
            return;
        }
        try {
            const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
            await axios.post(
                `${API_URL}/game/report`,
                { questionId: question.id, reason: reasonOverride || 'General Report' },
                { headers }
            );
            setReportMessage('✅ Question reported successfully.');
        } catch (err) {
            const msg = err.response?.data?.error || 'Question flagged for review.';
            setReportMessage(`⚠️ ${msg}`);
        }
    };

    const submitReport = async () => {
        const trimmed = reportNote.trim();
        const requiresNote = reportType === 'inappropriate' || reportType === 'incorrect';
        if (requiresNote && !trimmed) {
            setReportMessage('⚠️ Please add a short description.');
            return;
        }
        const label = reportType === 'inappropriate'
            ? 'Inappropriate'
            : reportType === 'incorrect'
                ? 'Incorrect'
                : 'General Report';
        const reason = requiresNote ? `${label}: ${trimmed}` : label;
        await handleReport(reason);
        setShowReportOptions(false);
        setReportNote('');
        setReportType('general');
    };

    const handleSuggest = () => {
        setShowRequestModal(true);
    };

    const handleSkip = async () => {
        if (!question || answered || result || loading || skipBusy) return;
        setSkipBusy(true);
        try {
            const body = {};
            if (!token) {
                const anonId = await getAnonymousId();
                if (anonId) body.anonymousId = anonId;
            }
            await axios.post(`${API_URL}/game/skip`, body, token
                ? { headers: { Authorization: `Bearer ${token}` } }
                : undefined
            );
            fetchQuestion();
        } catch (err) {
            const msg = err.response?.data?.error || 'Skip failed';
            setReportMessage(`⚠️ ${msg}`);
        } finally {
            setSkipBusy(false);
        }
    };

    const moveCategory = (id, mode) => {
        setIncludeCategoryIds(prev => prev.filter(v => v !== id));
        setExcludeCategoryIds(prev => prev.filter(v => v !== id));
        if (mode === 'include') setIncludeCategoryIds(prev => [...prev, id]);
        if (mode === 'exclude') setExcludeCategoryIds(prev => [...prev, id]);
    };

    const applyCustomGroup = (group) => {
        setIncludeCategoryIds(Array.isArray(group.include_category_ids) ? group.include_category_ids : []);
        setExcludeCategoryIds(Array.isArray(group.exclude_category_ids) ? group.exclude_category_ids : []);
    };

    const saveCustomGroup = async () => {
        if (!token) {
            setCustomGroupStatus('Log in to save custom groups.');
            return;
        }
        const name = customGroupName.trim();
        if (!name) {
            setCustomGroupStatus('Name this group first.');
            return;
        }
        if (!includeCategoryIds.length && !excludeCategoryIds.length) {
            setCustomGroupStatus('Include or exclude at least one category.');
            return;
        }
        try {
            const res = await axios.post(`${API_URL}/me/category-groups`, {
                name,
                includeCategoryIds: localIncludeIds,
                excludeCategoryIds: localExcludeIds,
            }, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setCustomGroups(prev => [res.data, ...prev]);
            setCustomGroupName('');
            setCustomGroupStatus('Saved.');
        } catch (err) {
            setCustomGroupStatus(err.response?.data?.error || 'Save failed.');
        }
    };

    const getButtonStyle = (optChar) => {
        const base = {
            border: '1px solid var(--border-color)',
            padding: '15px',
            fontWeight: 'bold',
            cursor: answered ? 'default' : 'pointer',
            transition: animationsEnabled ? 'all 0.3s ease' : 'none',
            position: 'relative',
            overflow: 'hidden'
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
    const visibleOptions = Array.isArray(question?.options)
        ? question.options.filter((opt) => String(opt?.text || '').trim())
        : [];
    const answerColumns = visibleOptions.length <= 1 ? '1fr' : visibleOptions.length === 2 ? '1fr 1fr' : '1fr 1fr';
    const filteredCategories = categories.filter(c =>
        c.name.toLowerCase().includes(categorySearch.trim().toLowerCase())
    );
    const byId = new Map(categories.map(c => [c.id, c]));
    const pillStyle = (kind) => ({
        border: '1px solid var(--border-color)',
        borderRadius: '999px',
        padding: '5px 10px',
        backgroundColor: kind === 'include' ? '#d4edda' : '#f8d7da',
        color: kind === 'include' ? '#155724' : '#721c24',
        fontSize: '12px',
        display: 'inline-flex',
        gap: '6px',
        alignItems: 'center'
    });

    return (
        <div className="card" style={{ position: 'relative' }}>
            {/* Category filter */}
            <div style={{ display: 'grid', gap: '10px', marginBottom: '16px' }}>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'end' }}>
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
                    {(includeCategoryIds.length || excludeCategoryIds.length) ? (
                        <button className="btn" onClick={() => { setIncludeCategoryIds([]); setExcludeCategoryIds([]); }} style={{ padding: '7px 12px' }}>
                            Clear Filters
                        </button>
                    ) : null}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', maxHeight: '92px', overflowY: 'auto' }}>
                    {filteredCategories.map(c => {
                        const included = includeCategoryIds.includes(c.id);
                        const excluded = excludeCategoryIds.includes(c.id);
                        return (
                            <span key={c.id} style={{ display: 'inline-flex', gap: '4px', alignItems: 'center', border: '1px solid var(--border-color)', borderRadius: '999px', padding: '3px 5px 3px 9px', fontSize: '12px' }}>
                                {c.name}
                                <button type="button" onClick={() => moveCategory(c.id, included ? 'clear' : 'include')} style={{ border: 'none', borderRadius: '999px', padding: '2px 7px', cursor: 'pointer', background: included ? '#28a745' : 'var(--border-color)', color: included ? 'white' : 'inherit' }}>
                                    Include
                                </button>
                                <button type="button" onClick={() => moveCategory(c.id, excluded ? 'clear' : 'exclude')} style={{ border: 'none', borderRadius: '999px', padding: '2px 7px', cursor: 'pointer', background: excluded ? '#dc3545' : 'var(--border-color)', color: excluded ? 'white' : 'inherit' }}>
                                    Exclude
                                </button>
                            </span>
                        );
                    })}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {includeCategoryIds.map(id => byId.get(id)).filter(Boolean).map(c => (
                        <span key={`in-${c.id}`} style={pillStyle('include')}>Include {c.name}<button type="button" onClick={() => moveCategory(c.id, 'clear')} style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}>×</button></span>
                    ))}
                    {excludeCategoryIds.map(id => byId.get(id)).filter(Boolean).map(c => (
                        <span key={`ex-${c.id}`} style={pillStyle('exclude')}>Exclude {c.name}<button type="button" onClick={() => moveCategory(c.id, 'clear')} style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}>×</button></span>
                    ))}
                    {!includeCategoryIds.length && !excludeCategoryIds.length && <span style={{ fontSize: '12px', color: '#888' }}>Showing all categories.</span>}
                </div>
                {(customGroups.length > 0 || token) && (
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', borderTop: '1px solid var(--border-color)', paddingTop: '10px' }}>
                        {customGroups.map(group => (
                            <button key={group.id} className="btn" onClick={() => applyCustomGroup(group)} style={{ padding: '5px 10px', fontSize: '12px' }}>
                                {group.name}
                            </button>
                        ))}
                        {token && (
                            <>
                                <input value={customGroupName} onChange={e => setCustomGroupName(e.target.value)} placeholder="Preset name" style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
                                <button className="btn btn-primary" onClick={saveCustomGroup} style={{ padding: '6px 12px' }}>Save Preset</button>
                            </>
                        )}
                        {customGroupStatus && <span style={{ fontSize: '12px', color: customGroupStatus === 'Saved.' ? '#28a745' : '#888' }}>{customGroupStatus}</span>}
                    </div>
                )}
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
                    fontSize: '13px',
                    fontWeight: 'bold',
                    color: 'var(--text-color)',
                    display: 'inline-flex',
                    justifyContent: 'center',
                    minWidth: '82px',
                    fontVariantNumeric: 'tabular-nums'
                }}>
                    ⏱ {Math.min(99.9, elapsedMs / 1000).toFixed(1)}s
                </span>
            </div>

            {/* Question text */}
            {question.image_url && (
                <div style={{ margin: '10px 0 18px' }}>
                    <img
                        src={question.image_url}
                        alt="Question"
                        style={{
                            width: '100%',
                            maxHeight: '320px',
                            objectFit: 'contain',
                            borderRadius: '8px',
                            border: '1px solid var(--border-color)',
                            backgroundColor: 'var(--card-bg)'
                        }}
                    />
                </div>
            )}
            <h2 style={{ marginTop: '10px', marginBottom: '25px', color: 'var(--text-color)', lineHeight: '1.4' }}>
                {question.text}
            </h2>

            {/* Guess ratio bars */}
            <div style={{ marginBottom: '20px', borderTop: '1px dashed var(--border-color)', paddingTop: '10px' }}>
                <small style={{ color: 'var(--text-color)', opacity: 0.7 }}>Community Guess Ratios</small>
                <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                    {visibleOptions.map(opt => {
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
            <div style={{ display: 'grid', gridTemplateColumns: answerColumns, gap: '10px' }}>
                {visibleOptions.map((opt) => (
                    <button
                        key={opt.char}
                        className={`btn trivia-answer-btn ${animationsEnabled ? 'animations-on' : 'animations-off'} ${result && opt.char === result.correctAnswer ? 'answer-correct' : ''} ${result && opt.char === answered && opt.char !== result.correctAnswer ? 'answer-wrong' : ''}`}
                        style={getButtonStyle(opt.char)}
                        onClick={() => handleAnswer(opt.char)}
                        disabled={!!answered}
                    >
                        {opt.text}
                        {animationsEnabled && result && opt.char === result.correctAnswer && (
                            <span className="answer-star-burst" aria-hidden="true">
                                {['✨', '🌟', '⭐', '💫', '✨', '⭐'].map((sprite, index) => (
                                    <span key={`${opt.char}-star-${index}`} className={`answer-star answer-star-${index + 1}`}>{sprite}</span>
                                ))}
                            </span>
                        )}
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
                        backgroundColor: skipPerHour > 0 ? '#17a2b8' : '#6c757d',
                        color: 'white',
                        padding: '8px 15px',
                        cursor: (skipPerHour > 0 && !skipBusy && !answered && !result) ? 'pointer' : 'not-allowed',
                        opacity: (skipPerHour > 0 && !skipBusy && !answered && !result) ? 1 : 0.65
                    }}
                    onClick={handleSkip}
                    disabled={skipPerHour <= 0 || skipBusy || !!answered || !!result}
                    title={skipPerHour > 0 ? `Skip is limited to ${skipPerHour} per hour` : 'Skip is disabled by admin'}
                >
                    {skipBusy ? '⏭ Skipping...' : '⏭ Skip'}
                </button>
                <button
                    className="btn"
                    style={{
                        backgroundColor: 'var(--header-bg)',
                        color: 'white', padding: '8px 15px',
                        cursor: 'pointer'
                    }}
                    onClick={handleSuggest}
                >
                    📝 Suggest a Question
                </button>
                <div style={{ position: 'relative' }} ref={reportMenuRef}>
                    <button
                        className="btn"
                        style={{
                            backgroundColor: '#6c757d',
                            color: 'white', padding: '8px 20px',
                            cursor: 'pointer'
                        }}
                        onClick={() => {
                            setShowReportOptions((v) => !v);
                            setReportMessage('');
                        }}
                    >
                        ⚠ Report
                    </button>
                    {showReportOptions && (
                        <div style={{
                            position: 'absolute',
                            right: 0,
                            marginTop: '6px',
                            backgroundColor: 'var(--card-bg)',
                            border: '1px solid var(--border-color)',
                            borderRadius: '8px',
                            padding: '10px',
                            width: '260px',
                            zIndex: 10,
                            boxShadow: '0 6px 18px rgba(0,0,0,0.12)'
                        }}>
                            <label style={{ display: 'block', fontSize: '12px', color: '#888', marginBottom: '6px' }}>
                                Report Type
                            </label>
                            <select
                                value={reportType}
                                onChange={e => setReportType(e.target.value)}
                                style={{
                                    width: '100%',
                                    padding: '6px 8px',
                                    borderRadius: '6px',
                                    border: '1px solid var(--border-color)',
                                    backgroundColor: 'var(--card-bg)',
                                    color: 'var(--text-color)'
                                }}
                            >
                                <option value="general">General Report</option>
                                <option value="inappropriate">Inappropriate</option>
                                <option value="incorrect">Incorrect</option>
                            </select>
                            {(reportType === 'inappropriate' || reportType === 'incorrect') && (
                                <textarea
                                    value={reportNote}
                                    onChange={e => setReportNote(e.target.value)}
                                    placeholder="Add a short description..."
                                    rows={3}
                                    style={{
                                        marginTop: '8px',
                                        width: '100%',
                                        padding: '6px 8px',
                                        borderRadius: '6px',
                                        border: '1px solid var(--border-color)',
                                        backgroundColor: 'var(--card-bg)',
                                        color: 'var(--text-color)',
                                        resize: 'vertical'
                                    }}
                                />
                            )}
                            <div style={{ display: 'flex', gap: '8px', marginTop: '10px', justifyContent: 'flex-end' }}>
                                <button className="btn" onClick={() => setShowReportOptions(false)} style={{ padding: '6px 10px' }}>
                                    Cancel
                                </button>
                                <button className="btn" onClick={submitReport} style={{ padding: '6px 10px', backgroundColor: '#6c757d', color: 'white' }}>
                                    Submit
                                </button>
                            </div>
                        </div>
                    )}
                </div>
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
