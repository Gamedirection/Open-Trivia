import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import axios from 'axios';
import RequestCardModal from './RequestCardModal';

const API_URL    = process.env.REACT_APP_API_URL || 'http://localhost:5000';
// REACT_APP_SOCKET_URL lets production override the socket target directly
// (needed when a front proxy drops WebSocket upgrades on the /socket.io path).
// Falls back to: the API URL if absolute, or window.location.origin for proxy mode.
const SOCKET_URL = process.env.REACT_APP_SOCKET_URL ||
    ((API_URL || '').startsWith('http') ? API_URL : window.location.origin);
const REST_BASE  = (API_URL || '').startsWith('http') ? API_URL.replace(/\/api\/?$/, '') : '';
const LIVE_CODE  = 'LIVE';

function getStoredUser() { try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch { return null; } }
function getToken()      { return localStorage.getItem('token') || null; }

// ── Mini components ───────────────────────────────────────────────────────────

function MedalBadge({ medal }) {
    if (!medal) return null;
    const map = { gold: { label: '🥇 1st', bg: '#FFD700', color: '#333' }, silver: { label: '🥈 2nd', bg: '#C0C0C0', color: '#333' }, bronze: { label: '🥉 3rd', bg: '#CD7F32', color: '#fff' } };
    const m = map[medal];
    if (!m) return null;
    return <span style={{ padding: '2px 8px', borderRadius: '10px', backgroundColor: m.bg, color: m.color, fontSize: '0.75rem', fontWeight: 'bold', marginLeft: '6px' }}>{m.label}</span>;
}

function RatingBadge({ rating }) {
    if (!rating) return null;
    const colors = { A: '#28a745', B: '#5cb85c', C: '#f0ad4e', D: '#d9534f', F: '#c9302c' };
    return <span style={{ padding: '1px 6px', borderRadius: '8px', backgroundColor: colors[rating] || '#888', color: '#fff', fontSize: '0.75rem', fontWeight: 'bold', marginLeft: '4px' }}>{rating}</span>;
}

function TimerRing({ timeLeft, total }) {
    const pct  = total > 0 ? Math.max(0, timeLeft / total) : 0;
    const r    = 28;
    const circ = 2 * Math.PI * r;
    const color = pct > 0.5 ? '#28a745' : pct > 0.25 ? '#fd7e14' : '#dc3545';
    return (
        <svg width="72" height="72" style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
            <circle cx="36" cy="36" r={r} fill="none" stroke="var(--border-color,#ddd)" strokeWidth="6" />
            <circle cx="36" cy="36" r={r} fill="none" stroke={color} strokeWidth="6"
                strokeDasharray={`${circ * pct} ${circ}`}
                style={{ transition: 'stroke-dasharray 0.1s linear, stroke 0.3s' }} />
            <text x="36" y="36" textAnchor="middle" dominantBaseline="central"
                fontSize="16" fontWeight="bold" fill="var(--text-color,#333)"
                style={{ transform: 'rotate(90deg)', transformOrigin: '36px 36px' }}>
                {timeLeft}
            </text>
        </svg>
    );
}

function VoteBar({ label, count, total, isCorrect, isMyVote }) {
    const pct = total > 0 ? Math.round(count / total * 100) : 0;
    return (
        <div style={{ marginBottom: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '3px' }}>
                <span style={{ fontWeight: isMyVote ? 'bold' : 'normal' }}>{isMyVote ? '▶ ' : ''}{label}</span>
                <span>{count} ({pct}%)</span>
            </div>
            <div style={{ height: '8px', background: 'var(--border-color,#eee)', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: isCorrect ? '#28a745' : '#6c757d', borderRadius: '4px', transition: 'width 0.4s ease' }} />
            </div>
        </div>
    );
}

// ── Styles helpers ────────────────────────────────────────────────────────────

const card = { background: 'var(--card-bg,#fff)', border: '1px solid var(--border-color,#ddd)', borderRadius: '12px', padding: '20px' };
const btn  = (bg = 'var(--btn-primary,#007bff)', extra = {}) => ({ padding: '9px 18px', backgroundColor: bg, color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.9rem', ...extra });
const label = { fontSize: '0.85rem', fontWeight: 'bold', display: 'block', marginBottom: '4px' };
const rangeRow = (name, value, min, max, step, onChange) => (
    <label style={{ display: 'block', fontSize: '0.85rem' }}>
        <strong>{name}: {value}</strong>
        <input type="range" min={min} max={max} step={step} value={value}
            onChange={e => onChange(Number(e.target.value))}
            style={{ display: 'block', width: '100%', marginTop: '3px' }} />
    </label>
);
const toggle = (name, value, onChange) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.85rem' }}>
        <input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)} />
        {name}
    </label>
);

const COMPLEXITY_COLOR = { easy: '#28a745', medium: '#fd7e14', hard: '#dc3545' };

// ── Settings panel (shared by admin/host) ────────────────────────────────────

function SettingsPanel({ settings, categories, onChange, onApply, title, players, myUserId, onSetHost }) {
    const [local, setLocal] = useState(settings);
    const [showCategoryModal, setShowCategoryModal] = useState(false);
    const [categorySearch, setCategorySearch] = useState('');
    useEffect(() => setLocal(settings), [settings]);
    const set = (key, val) => setLocal(prev => ({ ...prev, [key]: val }));
    const includeIds = local.includeCategoryIds || local.categoryIds || [];
    const excludeIds = local.excludeCategoryIds || [];
    const byId = new Map(categories.map(c => [c.id, c]));
    const filteredCategories = categories
        .filter(c => !c.disabled)
        .filter(c => c.name.toLowerCase().includes(categorySearch.trim().toLowerCase()));
    const moveCategory = (id, mode) => {
        const nextInclude = includeIds.filter(v => v !== id);
        const nextExclude = excludeIds.filter(v => v !== id);
        if (mode === 'include') nextInclude.push(id);
        if (mode === 'exclude') nextExclude.push(id);
        setLocal(prev => ({ ...prev, categoryIds: nextInclude, includeCategoryIds: nextInclude, excludeCategoryIds: nextExclude }));
    };

    return (
        <div style={{ ...card, fontSize: '0.85rem' }}>
            {showCategoryModal && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
                    <div style={{ ...card, width: 'min(720px, 100%)', maxHeight: '86vh', overflowY: 'auto' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center', marginBottom: '12px' }}>
                            <h3 style={{ margin: 0 }}>Categories</h3>
                            <button style={btn('var(--border-color,#eee)', { color: 'inherit', padding: '5px 10px' })} onClick={() => setShowCategoryModal(false)}>Close</button>
                        </div>
                        <div style={{ display: 'grid', gap: '12px' }}>
                            <input
                                value={categorySearch}
                                onChange={e => setCategorySearch(e.target.value)}
                                placeholder="Search categories..."
                                style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border-color,#ddd)', background: 'var(--card-bg,#fff)', color: 'var(--text-color,#333)' }}
                            />
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', maxHeight: '260px', overflowY: 'auto' }}>
                                {filteredCategories.map(cat => {
                                    const included = includeIds.includes(cat.id);
                                    const excluded = excludeIds.includes(cat.id);
                                    return (
                                        <span key={cat.id} style={{ fontSize: '0.78rem', padding: '4px 6px', borderRadius: '999px', border: '1px solid var(--border-color,#ddd)', display: 'inline-flex', gap: '4px', alignItems: 'center' }}>
                                            {cat.name}
                                            <button type="button" onClick={() => moveCategory(cat.id, included ? 'clear' : 'include')} style={{ border: 'none', borderRadius: '999px', cursor: 'pointer', background: included ? 'var(--btn-primary,#007bff)' : 'var(--border-color,#eee)', color: included ? '#fff' : 'inherit' }}>Include</button>
                                            <button type="button" onClick={() => moveCategory(cat.id, excluded ? 'clear' : 'exclude')} style={{ border: 'none', borderRadius: '999px', cursor: 'pointer', background: excluded ? '#dc3545' : 'var(--border-color,#eee)', color: excluded ? '#fff' : 'inherit' }}>Exclude</button>
                                        </span>
                                    );
                                })}
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                                {includeIds.map(id => byId.get(id)).filter(Boolean).map(cat => (
                                    <span key={`settings-in-${cat.id}`} style={{ fontSize: '0.75rem', borderRadius: '999px', padding: '3px 8px', background: '#d4edda', color: '#155724' }}>Include {cat.name}</span>
                                ))}
                                {excludeIds.map(id => byId.get(id)).filter(Boolean).map(cat => (
                                    <span key={`settings-ex-${cat.id}`} style={{ fontSize: '0.75rem', borderRadius: '999px', padding: '3px 8px', background: '#f8d7da', color: '#721c24' }}>Exclude {cat.name}</span>
                                ))}
                                {!includeIds.length && !excludeIds.length && <span style={{ color: '#888', fontSize: '0.8rem' }}>All categories included.</span>}
                            </div>
                        </div>
                    </div>
                </div>
            )}
            <h4 style={{ margin: '0 0 14px', fontSize: '0.95rem' }}>{title || 'Settings'}</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {rangeRow('Timer', local.timerSeconds, 5, 120, 5, v => set('timerSeconds', v))}
                {rangeRow('Base pts (correct)', local.pointsCorrect, 1, 50, 1, v => set('pointsCorrect', v))}
                {rangeRow('Pts (incorrect)', local.pointsIncorrect, 0, 20, 1, v => set('pointsIncorrect', v))}
                {rangeRow('Time bonus (×sec)', local.timeBonus, 0, 2, 0.05, v => set('timeBonus', v))}

                <div style={{ borderTop: '1px solid var(--border-color,#ddd)', paddingTop: '10px' }}>
                    <span style={label}>Speed medals</span>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px' }}>
                        <div><span style={{ fontSize: '0.75rem', color: '#888' }}>🥇 1st</span><input type="number" min="0" max="50" value={local.goldBonus} onChange={e => set('goldBonus', Number(e.target.value))} style={{ width: '100%', padding: '5px', borderRadius: '6px', border: '1px solid var(--border-color,#ddd)', background: 'var(--card-bg,#fff)', color: 'var(--text-color,#333)' }} /></div>
                        <div><span style={{ fontSize: '0.75rem', color: '#888' }}>🥈 2nd</span><input type="number" min="0" max="50" value={local.silverBonus} onChange={e => set('silverBonus', Number(e.target.value))} style={{ width: '100%', padding: '5px', borderRadius: '6px', border: '1px solid var(--border-color,#ddd)', background: 'var(--card-bg,#fff)', color: 'var(--text-color,#333)' }} /></div>
                        <div><span style={{ fontSize: '0.75rem', color: '#888' }}>🥉 3rd</span><input type="number" min="0" max="50" value={local.bronzeBonus} onChange={e => set('bronzeBonus', Number(e.target.value))} style={{ width: '100%', padding: '5px', borderRadius: '6px', border: '1px solid var(--border-color,#ddd)', background: 'var(--card-bg,#fff)', color: 'var(--text-color,#333)' }} /></div>
                    </div>
                </div>

                <div style={{ borderTop: '1px solid var(--border-color,#ddd)', paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <span style={label}>Display</span>
                    {toggle('Allow guess changes', local.allowChangeGuess, v => set('allowChangeGuess', v))}
                    {toggle('Show live vote breakdown (bars per option)', local.showLiveVotes, v => set('showLiveVotes', v))}
                    {toggle('Show voter count (X/Y voted)', local.showVoteCount, v => set('showVoteCount', v))}
                    {toggle("Show players' answers (not just count)", local.showOtherGuesses, v => set('showOtherGuesses', v))}
                    {toggle('Show player stats (answered/correct)', local.showPlayerStats, v => set('showPlayerStats', v))}
                    {toggle('Show A–F accuracy rating', local.showQualityRating, v => set('showQualityRating', v))}
                </div>

                {categories.length > 0 && (
                    <div style={{ borderTop: '1px solid var(--border-color,#ddd)', paddingTop: '10px' }}>
                        <span style={label}>Categories</span>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                            <button type="button" style={btn('var(--border-color,#eee)', { color: 'inherit', padding: '6px 10px' })} onClick={() => setShowCategoryModal(true)}>
                                Edit Categories
                            </button>
                            <span style={{ fontSize: '0.78rem', color: '#888' }}>
                                {includeIds.length || excludeIds.length ? `${includeIds.length} included, ${excludeIds.length} excluded` : 'All categories'}
                            </span>
                        </div>
                    </div>
                )}

                {onChange && <div style={{ borderTop: '1px solid var(--border-color,#ddd)', paddingTop: '10px' }}>{toggle('Public (show in room list)', local.isPublic, v => set('isPublic', v))}</div>}

                {onSetHost && players && players.length > 1 && (
                    <div style={{ borderTop: '1px solid var(--border-color,#ddd)', paddingTop: '10px' }}>
                        <span style={label}>Transfer Host</span>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <select id="set-host-select" style={{ flex: 1, padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color,#ddd)', background: 'var(--card-bg,#fff)', color: 'var(--text-color,#333)', fontSize: '0.85rem' }}>
                                {players.filter(p => p.userId && p.userId !== myUserId).map(p => (
                                    <option key={p.userId} value={p.socketId}>{p.displayName}{p.isHost ? ' (current host)' : ''}</option>
                                ))}
                            </select>
                            <button style={btn('#6c757d', { padding: '6px 12px', fontSize: '0.8rem' })} onClick={() => {
                                const sel = document.getElementById('set-host-select');
                                if (sel?.value) onSetHost(sel.value);
                            }}>Transfer</button>
                        </div>
                    </div>
                )}

                <button style={btn()} onClick={() => onApply(local)}>Apply Settings</button>
            </div>
        </div>
    );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SharePlay() {
    const socketRef = useRef(null);
    const [connected, setConnected] = useState(false);
    const [connError, setConnError]  = useState('');

    // Lobby
    const [publicRooms, setPublicRooms] = useState([]);
    const [joinCode, setJoinCode]       = useState('');
    const [creating, setCreating]       = useState(false);
    const [createPublic, setCreatePublic] = useState(false);
    const [createTimer, setCreateTimer]  = useState(15);
    const [createCats, setCreateCats]    = useState([]);
    const [createExcludeCats, setCreateExcludeCats] = useState([]);
    const [showCreateCategories, setShowCreateCategories] = useState(false);
    const [createCategorySearch, setCreateCategorySearch] = useState('');
    const [createAllow, setCreateAllow]  = useState(true);

    // In-room state
    const [roomCode, setRoomCode]   = useState(null);
    const [isHost, setIsHost]       = useState(false);
    const [isLive, setIsLive]       = useState(false);
    const [phase, setPhase]         = useState('lobby');
    const [settings, setSettings]   = useState({ timerSeconds: 15, allowChangeGuess: true, showOtherGuesses: false, showLiveVotes: false, showVoteCount: true, showPlayerStats: true, showQualityRating: false, pointsCorrect: 5, pointsIncorrect: 1, timeBonus: 0.25, goldBonus: 5, silverBonus: 3, bronzeBonus: 1, categoryIds: [], includeCategoryIds: [], excludeCategoryIds: [], isPublic: false });
    const [earlyEndSecs, setEarlyEndSecs] = useState(null);
    const [tvMode, setTvMode] = useState(false);

    // Report / Suggest (persist across question changes intentionally)
    const [showRequestModal, setShowRequestModal] = useState(false);
    const [showReportMenu,   setShowReportMenu]   = useState(false);
    const [reportType,       setReportType]       = useState('general');
    const [reportNote,       setReportNote]       = useState('');
    const [reportMessage,    setReportMessage]    = useState('');
    const reportMenuRef      = useRef(null);
    const reportingQIdRef    = useRef(null);
    // Player report
    const [showPlayerReportMenu, setShowPlayerReportMenu] = useState(false);
    const [reportPlayerId,   setReportPlayerId]   = useState('');
    const [playerReportType, setPlayerReportType] = useState('general');
    const [playerReportNote, setPlayerReportNote] = useState('');
    const [playerReportMsg,  setPlayerReportMsg]  = useState('');
    const playerReportRef    = useRef(null);

    // Question / voting
    const [currentQuestion, setCurrentQuestion] = useState(null);
    const [endsAt, setEndsAt]   = useState(null);
    const [timeLeft, setTimeLeft] = useState(0);
    const [myVote, setMyVote]   = useState(null);
    const [vCounts, setVCounts] = useState({ A: 0, B: 0, C: 0, D: 0 });
    const [vDetails, setVDetails] = useState(null);
    const [totalVoters, setTotalVoters] = useState(0);

    // Results
    const [roundResult, setRoundResult]         = useState(null);
    const [resultsCountdown, setResultsCountdown] = useState(5);

    // Players + UI
    const [players, setPlayers]       = useState([]);
    const [categories, setCategories] = useState([]);
    const [roomError, setRoomError]   = useState('');
    const [statusMsg, setStatusMsg]   = useState('');
    const [copied, setCopied]         = useState(false);

    const [kickTarget, setKickTarget] = useState(null);
    const [kickVote, setKickVote] = useState(null);
    const [kickVoteCounts, setKickVoteCounts] = useState({ votesFor: 0, votesAgainst: 0 });

    const user = getStoredUser();
    const isAdmin = user?.role === 'admin';
    const myPlayer = players.find(p => p.userId && p.userId === user?.id);

    // ── Socket ───────────────────────────────────────────────────────────────

    useEffect(() => {
        const token = getToken();
        const sock = io(SOCKET_URL, {
            auth: token ? { token } : {},
            transports: ['polling', 'websocket'],
            reconnectionDelay: 1000,
            reconnectionDelayMax: 10000,
            reconnectionAttempts: 30,
            timeout: 20000,
        });

        sock.on('connect',       () => { setConnected(true); setConnError(''); sock.emit('get_rooms'); });
        sock.on('disconnect',    (reason) => { setConnected(false); if (reason === 'io server disconnect') { setConnError('Disconnected by server. Reconnecting...'); } });
        sock.on('connect_error', err => { console.error('[SharePlay] connect_error:', err.message); setConnError(`Cannot connect: ${err.message}`); });
        sock.io.on('reconnect_attempt', (attempt) => { setStatusMsg(`Reconnecting... (attempt ${attempt})`); });
        sock.io.on('reconnect', () => { setStatusMsg(''); });

        sock.on('rooms_list', data => setPublicRooms(data.rooms || []));

        sock.on('room_joined', data => {
            setRoomCode(data.roomCode);
            setIsHost(data.isHost);
            setIsLive(data.isLive);
            setSettings(data.settings || settings);
            setPlayers(data.players || []);
            setRoomError('');
            if (data.phase === 'question' && data.currentQuestion) {
                setCurrentQuestion(data.currentQuestion);
                setEndsAt(data.endsAt);
                setMyVote(data.myVote || null);
                setPhase('question');
            } else if (data.phase === 'results') {
                setPhase('results');
            } else {
                setPhase('waiting');
            }
        });

        sock.on('promoted_host', data => { setIsHost(true); setStatusMsg(data.message || 'You are now the host.'); });
        sock.on('room_error',  data => setRoomError(data.message));
        sock.on('room_status', data => { if (data.phase) setPhase(data.phase); if (data.message) setStatusMsg(data.message); });

        sock.on('room_settings', data => setSettings(prev => ({ ...prev, ...data })));

        sock.on('question_start', data => {
            setCurrentQuestion(data.question);
            setEndsAt(data.endsAt);
            if (data.settings) setSettings(prev => ({ ...prev, ...data.settings }));
            setMyVote(null);
            setVCounts({ A: 0, B: 0, C: 0, D: 0 });
            setVDetails(null);
            setTotalVoters(0);
            setRoundResult(null);
            setEarlyEndSecs(null);
            setPhase('question');
            setStatusMsg('');
        });

        sock.on('early_end_warning', data => {
            setEarlyEndSecs(data.secondsLeft);
        });

        sock.on('vote_update', data => {
            setVCounts(data.counts);
            setTotalVoters(data.totalVoters);
            if (data.details) setVDetails(data.details);
        });

        sock.on('vote_confirmed', data => setMyVote(data.answer));

        sock.on('round_end', data => {
            setRoundResult(data);
            setVCounts(data.counts);
            if (data.details) setVDetails(data.details);
            setTotalVoters(data.totalVoters);
            setPlayers(data.topPlayers || []);
            setPhase('results');
            setResultsCountdown(5);
        });

        sock.on('players_update', data => setPlayers(data.players || []));

        socketRef.current = sock;
        return () => sock.disconnect();
    }, []); // eslint-disable-line

    useEffect(() => {
        axios.get(`${REST_BASE}/api/categories`).then(r => setCategories(r.data || [])).catch(() => {});
    }, []);

    // Refresh rooms list every 10s while in lobby
    useEffect(() => {
        if (roomCode) return;
        const id = setInterval(() => socketRef.current?.emit('get_rooms'), 10_000);
        return () => clearInterval(id);
    }, [roomCode]);

    // ── Timer countdown ───────────────────────────────────────────────────────

    useEffect(() => {
        if (phase !== 'question' || !endsAt) return;
        const tick = () => setTimeLeft(Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)));
        tick();
        const id = setInterval(tick, 100);
        return () => clearInterval(id);
    }, [phase, endsAt]);

    useEffect(() => {
        if (phase !== 'results') return;
        setResultsCountdown(5);
        const id = setInterval(() => setResultsCountdown(p => Math.max(0, p - 1)), 1000);
        return () => clearInterval(id);
    }, [phase]);

    useEffect(() => {
        if (earlyEndSecs === null || earlyEndSecs <= 0) return;
        const id = setInterval(() => setEarlyEndSecs(p => (p <= 1 ? null : p - 1)), 1000);
        return () => clearInterval(id);
    }, [earlyEndSecs]);

    useEffect(() => {
        if (!showReportMenu) return;
        const handler = e => { if (reportMenuRef.current && !reportMenuRef.current.contains(e.target)) setShowReportMenu(false); };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [showReportMenu]);

    useEffect(() => {
        if (!showPlayerReportMenu) return;
        const handler = e => { if (playerReportRef.current && !playerReportRef.current.contains(e.target)) setShowPlayerReportMenu(false); };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [showPlayerReportMenu]);

    useEffect(() => {
        const handler = e => { if (e.key === 'Escape') setTvMode(false); };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, []);

    useEffect(() => {
        const socket = socketRef.current;
        if (!socket) return;

        const onKickStarted = (data) => {
            setKickVote({ ...data, hasVoted: false });
        };
        const onKickUpdate = (data) => {
            setKickVote(v => v ? { ...v, votesFor: data.votesFor, votesAgainst: data.votesAgainst } : null);
        };
        const onKickCancelled = () => {
            setKickVote(null);
        };
        const onPlayerKicked = (data) => {
            setKickVote(null);
        };
        const onKicked = (data) => {
            alert(data.message || 'You have been kicked.');
        };

        socket.on('kick_vote_started', onKickStarted);
        socket.on('kick_vote_update', onKickUpdate);
        socket.on('kick_vote_cancelled', onKickCancelled);
        socket.on('player_kicked', onPlayerKicked);
        socket.on('kicked', onKicked);

        return () => {
            socket.off('kick_vote_started', onKickStarted);
            socket.off('kick_vote_update', onKickUpdate);
            socket.off('kick_vote_cancelled', onKickCancelled);
            socket.off('player_kicked', onPlayerKicked);
            socket.off('kicked', onKicked);
        };
    }, []);

    // ── Actions ───────────────────────────────────────────────────────────────

    const joinLive  = useCallback(() => { setRoomError(''); socketRef.current?.emit('join_live_room'); }, []);
    const joinByCode = useCallback(() => {
        if (!joinCode.trim()) return;
        setRoomError('');
        socketRef.current?.emit('join_room', { code: joinCode.trim() });
    }, [joinCode]);
    const joinPublicRoom = useCallback(code => {
        setRoomError('');
        socketRef.current?.emit('join_room', { code });
    }, []);
    const createRoom = useCallback(() => {
        setRoomError('');
        socketRef.current?.emit('create_room', {
            timerSeconds: createTimer,
            categoryIds: createCats,
            includeCategoryIds: createCats,
            excludeCategoryIds: createExcludeCats,
            allowChangeGuess: createAllow,
            isPublic: createPublic,
        });
    }, [createTimer, createCats, createExcludeCats, createAllow, createPublic]);

    const leaveRoom = useCallback(() => {
        socketRef.current?.emit('leave_room');
        setRoomCode(null); setPhase('lobby'); setCurrentQuestion(null);
        setRoundResult(null); setMyVote(null); setPlayers([]);
        setStatusMsg(''); setRoomError(''); setIsHost(false);
        setKickTarget(null); setKickVote(null);
        socketRef.current?.emit('get_rooms');
    }, []);

    const vote = useCallback(answer => {
        if (!settings.allowChangeGuess && myVote) return;
        socketRef.current?.emit('submit_vote', { answer });
    }, [settings.allowChangeGuess, myVote]);

    const startGame   = useCallback(() => socketRef.current?.emit('host_start'), []);

    const applyHostSettings = useCallback(s => {
        socketRef.current?.emit('host_settings', s);
        setSettings(prev => ({ ...prev, ...s }));
    }, []);

    const applyAdminLiveSettings = useCallback(s => {
        socketRef.current?.emit('admin_live_settings', { ...s, roomCode: LIVE_CODE });
        setSettings(prev => ({ ...prev, ...s }));
    }, []);

    const handleSuggest = useCallback(() => setShowRequestModal(true), []);

    const handleQuestionReport = useCallback(async (reasonOverride) => {
        const qId = reportingQIdRef.current;
        if (!qId) return;
        try {
            const token = getToken();
            const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
            await axios.post(`${REST_BASE}/api/game/report`, { questionId: qId, reason: reasonOverride || 'General Report' }, { headers });
            setReportMessage('✅ Reported successfully.');
        } catch (err) {
            setReportMessage(`⚠️ ${err.response?.data?.error || 'Question flagged for review.'}`);
        }
    }, []);

    const submitQuestionReport = useCallback(async () => {
        const trimmed = reportNote.trim();
        const needsNote = reportType === 'inappropriate' || reportType === 'incorrect';
        if (needsNote && !trimmed) { setReportMessage('⚠️ Please add a short description.'); return; }
        const label = reportType === 'inappropriate' ? 'Inappropriate' : reportType === 'incorrect' ? 'Incorrect Answer' : 'General Report';
        await handleQuestionReport(needsNote ? `${label}: ${trimmed}` : label);
        setShowReportMenu(false);
        setReportNote('');
        setReportType('general');
    }, [reportNote, reportType, handleQuestionReport]);

    const handlePlayerReport = useCallback(async (reasonOverride) => {
        if (!reportPlayerId) return;
        try {
            const token = getToken();
            const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
            const reportedPlayer = players.find(p => p.userId === Number(reportPlayerId));
            await axios.post(`${REST_BASE}/api/game/report-player`, {
                reportedUserId: Number(reportPlayerId),
                roomCode,
                reason: reasonOverride || 'General Report',
                note: playerReportNote.trim() || undefined,
            }, { headers });
            setPlayerReportMsg(`✅ Reported ${reportedPlayer?.displayName || 'player'} successfully.`);
        } catch (err) {
            setPlayerReportMsg(`⚠️ ${err.response?.data?.error || 'Failed to report player.'}`);
        }
    }, [reportPlayerId, players, roomCode, playerReportNote]);

    const submitPlayerReport = useCallback(async () => {
        if (!reportPlayerId) { setPlayerReportMsg('⚠️ Select a player to report.'); return; }
        const trimmed = playerReportNote.trim();
        const needsNote = playerReportType === 'inappropriate' || playerReportType === 'cheating' || playerReportType === 'harassment';
        if (needsNote && !trimmed) { setPlayerReportMsg('⚠️ Please add a short description.'); return; }
        const label = playerReportType === 'inappropriate' ? 'Inappropriate' : playerReportType === 'cheating' ? 'Cheating' : playerReportType === 'harassment' ? 'Harassment' : 'General Report';
        await handlePlayerReport(needsNote ? `${label}: ${trimmed}` : label);
        setShowPlayerReportMenu(false);
        setPlayerReportNote('');
        setPlayerReportType('general');
        setReportPlayerId('');
    }, [playerReportNote, playerReportType, reportPlayerId, handlePlayerReport]);

    const copyCode = useCallback(() => {
        navigator.clipboard?.writeText(roomCode).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {});
    }, [roomCode]);

    // ── LOBBY ─────────────────────────────────────────────────────────────────

    if (!roomCode) {
        const liveRoom = publicRooms.find(r => r.isLive);
        const customRooms = publicRooms.filter(r => !r.isLive);
        const filteredCreateCategories = categories
            .filter(c => !c.disabled)
            .filter(c => c.name.toLowerCase().includes(createCategorySearch.trim().toLowerCase()));
        const moveCreateCategory = (cat, mode) => {
            setCreateCats(p => p.filter(id => id !== cat.id));
            setCreateExcludeCats(p => p.filter(id => id !== cat.id));
            if (mode === 'include') setCreateCats(p => [...p, cat.id]);
            if (mode === 'exclude') setCreateExcludeCats(p => [...p, cat.id]);
        };

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {showCreateCategories && (
                    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
                        <div style={{ ...card, width: 'min(720px, 100%)', maxHeight: '86vh', overflowY: 'auto' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center', marginBottom: '12px' }}>
                                <h3 style={{ margin: 0 }}>Categories</h3>
                                <button style={btn('var(--border-color,#eee)', { color: 'inherit', padding: '5px 10px' })} onClick={() => setShowCreateCategories(false)}>Close</button>
                            </div>
                            <div style={{ display: 'grid', gap: '12px' }}>
                                <input
                                    value={createCategorySearch}
                                    onChange={e => setCreateCategorySearch(e.target.value)}
                                    placeholder="Search categories..."
                                    style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border-color,#ddd)', background: 'var(--card-bg,#fff)', color: 'var(--text-color,#333)' }}
                                />
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', maxHeight: '260px', overflowY: 'auto' }}>
                                    {filteredCreateCategories.map(cat => {
                                        const included = createCats.includes(cat.id);
                                        const excluded = createExcludeCats.includes(cat.id);
                                        return (
                                            <span key={cat.id} style={{ fontSize: '0.78rem', padding: '4px 6px', borderRadius: '999px', border: '1px solid var(--border-color,#ddd)', display: 'inline-flex', gap: '4px', alignItems: 'center' }}>
                                                {cat.name}
                                                <button type="button" onClick={() => moveCreateCategory(cat, included ? 'clear' : 'include')} style={{ border: 'none', borderRadius: '999px', cursor: 'pointer', background: included ? 'var(--btn-primary,#007bff)' : 'var(--border-color,#eee)', color: included ? '#fff' : 'inherit' }}>Include</button>
                                                <button type="button" onClick={() => moveCreateCategory(cat, excluded ? 'clear' : 'exclude')} style={{ border: 'none', borderRadius: '999px', cursor: 'pointer', background: excluded ? '#dc3545' : 'var(--border-color,#eee)', color: excluded ? '#fff' : 'inherit' }}>Exclude</button>
                                            </span>
                                        );
                                    })}
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                                    {createCats.length || createExcludeCats.length ? (
                                        <span style={{ color: '#888', fontSize: '0.8rem' }}>{createCats.length} included, {createExcludeCats.length} excluded</span>
                                    ) : (
                                        <span style={{ color: '#888', fontSize: '0.8rem' }}>All categories included.</span>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
                <div style={{ ...card, textAlign: 'center' }}>
                    <h2 style={{ margin: '0 0 6px' }}>Share Play</h2>
                    <p style={{ margin: 0, color: '#888', fontSize: '0.9rem' }}>Real-time multiplayer trivia - join the live room or start your own.</p>
                    {!connected && <div style={{ color: '#dc3545', marginTop: '8px', fontSize: '0.85rem' }}>{connError || 'Connecting…'}</div>}
                </div>

                {roomError && <div style={{ background: '#f8d7da', color: '#721c24', padding: '10px 16px', borderRadius: '8px' }}>{roomError}</div>}

                <div className="sp-lobby">
                    {/* ── Live Room ── */}
                    <div style={{ ...card, borderColor: '#28a745', borderWidth: '2px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                            <span style={{ background: '#28a745', color: '#fff', borderRadius: '12px', padding: '2px 10px', fontSize: '0.8rem', fontWeight: 'bold' }}>● LIVE</span>
                            <strong style={{ fontSize: '1.1rem' }}>Live Room</strong>
                        </div>
                        <p style={{ color: '#888', fontSize: '0.88rem', margin: '0 0 14px' }}>
                            Always-on public game. Questions cycle continuously - join any time.
                            {liveRoom && <span> <strong>{liveRoom.playerCount}</strong> player{liveRoom.playerCount !== 1 ? 's' : ''} currently playing.</span>}
                        </p>
                        <button style={btn('#28a745', { width: '100%', padding: '12px', fontSize: '1rem' })} onClick={joinLive} disabled={!connected}>
                            Join Live Room →
                        </button>
                    </div>

                    {/* ── Join by code ── */}
                    <div style={card}>
                        <strong style={{ display: 'block', marginBottom: '10px' }}>Join by Code</strong>
                        <p style={{ color: '#888', fontSize: '0.88rem', margin: '0 0 12px' }}>Enter a 4-digit room code shared by a friend.</p>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <input value={joinCode} onChange={e => setJoinCode(e.target.value.replace(/\D/g, ''))} onKeyDown={e => e.key === 'Enter' && joinByCode()}
                                maxLength={4} placeholder="0000"
                                style={{ flex: 1, padding: '10px', borderRadius: '8px', border: '2px solid var(--border-color,#ddd)', fontSize: '1.3rem', textAlign: 'center', letterSpacing: '0.2em', background: 'var(--card-bg,#fff)', color: 'var(--text-color,#333)' }} />
                            <button style={btn()} onClick={joinByCode} disabled={!connected || joinCode.length !== 4}>Join</button>
                        </div>
                    </div>
                </div>

                {/* ── Create room / public rooms list ── */}
                <div className="sp-lobby">
                    {/* Create */}
                    <div style={card}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                            <strong>Create Your Room</strong>
                            <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--btn-primary,#007bff)', fontSize: '0.85rem' }} onClick={() => setCreating(p => !p)}>
                                {creating ? 'Hide options' : 'Show options'}
                            </button>
                        </div>
                        {creating && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '14px' }}>
                                {rangeRow('Timer', createTimer, 5, 120, 5, setCreateTimer)}
                                {toggle('Allow guess changes', createAllow, setCreateAllow)}
                                {toggle('Make room public (visible to all)', createPublic, setCreatePublic)}
                                {categories.length > 0 && (
                                    <div>
                                        <span style={label}>Categories</span>
                                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                                            <button type="button" style={btn('var(--border-color,#eee)', { color: 'inherit', padding: '6px 10px' })} onClick={() => setShowCreateCategories(true)}>
                                                Edit Categories
                                            </button>
                                            <span style={{ fontSize: '0.78rem', color: '#888' }}>
                                                {createCats.length || createExcludeCats.length ? `${createCats.length} included, ${createExcludeCats.length} excluded` : 'All categories'}
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                        <button style={btn('#6c757d', { width: '100%' })} onClick={createRoom} disabled={!connected}>
                            Create Room
                        </button>
                    </div>

                    {/* Public custom rooms */}
                    <div style={card}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                            <strong>Public Rooms</strong>
                            <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888', fontSize: '0.8rem' }} onClick={() => socketRef.current?.emit('get_rooms')}>↻ Refresh</button>
                        </div>
                        {customRooms.length === 0 ? (
                            <p style={{ color: '#888', fontSize: '0.88rem', margin: 0 }}>No public rooms right now. Create one!</p>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '240px', overflowY: 'auto' }}>
                                {customRooms.map(r => (
                                    <div key={r.code} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border-color,#ddd)' }}>
                                        <div>
                                            <strong style={{ letterSpacing: '0.1em' }}>{r.code}</strong>
                                            <span style={{ color: '#888', fontSize: '0.8rem', marginLeft: '10px' }}>
                                                {r.playerCount} player{r.playerCount !== 1 ? 's' : ''} · {r.timerSeconds}s
                                                <span style={{ marginLeft: '6px', padding: '1px 6px', borderRadius: '8px', background: r.phase === 'question' ? '#dc3545' : '#fd7e14', color: '#fff', fontSize: '0.75rem' }}>
                                                    {r.phase === 'question' ? '● Live' : r.phase}
                                                </span>
                                            </span>
                                        </div>
                                        <button style={btn('var(--btn-primary,#007bff)', { padding: '5px 12px', fontSize: '0.8rem' })} onClick={() => joinPublicRoom(r.code)}>Join</button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    // ── IN-ROOM LAYOUT ────────────────────────────────────────────────────────

    const showAdminLivePanel = isAdmin && isLive;
    const showHostPanel      = isHost && !isLive;

    // ── TV / Fullscreen Mode ───────────────────────────────────────────────────
    if (tvMode) {
        const tvBg    = '#0d1117';
        const tvCard  = { background: '#161b22', border: '1px solid #30363d', borderRadius: '16px', padding: '24px' };
        const tvBtn   = (bg, extra = {}) => ({ background: bg, color: '#fff', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: 'bold', padding: '12px 24px', fontSize: '1rem', ...extra });
        const tvCorrectColor = '#238636';
        const tvWrongColor   = '#6e7681';

        return (
            <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: tvBg, color: '#e6edf3', display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: 'system-ui, sans-serif' }}>
                {/* ── TV Header ── */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 28px', borderBottom: '1px solid #30363d', flexShrink: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                        <span style={{ fontWeight: 'bold', fontSize: '1.1rem', color: '#58a6ff' }}>Open-Trivia Share Play</span>
                        {isLive
                            ? <span style={{ background: '#238636', color: '#fff', borderRadius: '20px', padding: '4px 14px', fontSize: '0.85rem', fontWeight: 'bold' }}>● LIVE</span>
                            : <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: '#21262d', borderRadius: '12px', padding: '6px 18px' }}>
                                <span style={{ color: '#8b949e', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Code</span>
                                <span style={{ fontFamily: 'monospace', fontSize: '2rem', fontWeight: 'bold', letterSpacing: '0.3em', color: '#f0f6fc' }}>{roomCode}</span>
                              </div>
                        }
                        <span style={{ color: '#8b949e', fontSize: '0.9rem' }}>{players.length} player{players.length !== 1 ? 's' : ''}</span>
                        {myPlayer && <span style={{ background: '#1f6feb', color: '#fff', borderRadius: '20px', padding: '4px 14px', fontSize: '0.85rem', fontWeight: 'bold' }}>You: {myPlayer.sessionScore} pts</span>}
                    </div>
                    <button onClick={() => setTvMode(false)} style={{ ...tvBtn('#21262d'), fontSize: '0.85rem', padding: '8px 16px' }}>✕ Exit TV  <span style={{ color: '#8b949e', marginLeft: '6px', fontSize: '0.75rem' }}>ESC</span></button>
                </div>

                {/* ── TV Body ── */}
                <div className="sp-tv-grid" style={{ flex: 1, padding: '20px 28px', overflow: 'hidden' }}>

                    {/* Center */}
                    <div className="sp-tv-center" style={{ display: 'flex', flexDirection: 'column', gap: '16px', overflow: 'hidden' }}>

                        {phase === 'waiting' && (
                            <div style={{ ...tvCard, flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '20px' }}>
                                {!isLive && (
                                    <div style={{ textAlign: 'center' }}>
                                        <div style={{ color: '#8b949e', fontSize: '1rem', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Join with code</div>
                                        <div style={{ fontFamily: 'monospace', fontSize: '5rem', fontWeight: 'bold', letterSpacing: '0.4em', color: '#58a6ff' }}>{roomCode}</div>
                                    </div>
                                )}
                                <div style={{ color: '#8b949e', fontSize: '1.2rem' }}>{statusMsg || 'Waiting for game to start…'}</div>
                                {isHost && <button onClick={startGame} style={tvBtn('#238636', { fontSize: '1.2rem', padding: '16px 40px' })}>▶ Start Game</button>}
                            </div>
                        )}

                        {phase === 'question' && currentQuestion && (
                            <div style={{ ...tvCard, flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                {/* Question meta + timer */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
                                            {currentQuestion.categoryName && <span style={{ background: '#21262d', color: '#8b949e', borderRadius: '8px', padding: '3px 12px', fontSize: '0.85rem' }}>{currentQuestion.categoryName}</span>}
                                            {currentQuestion.complexity  && <span style={{ background: COMPLEXITY_COLOR[currentQuestion.complexity] || '#888', color: '#fff', borderRadius: '8px', padding: '3px 12px', fontSize: '0.85rem', textTransform: 'capitalize' }}>{currentQuestion.complexity}</span>}
                                            {settings.showVoteCount && <span style={{ color: '#8b949e', fontSize: '0.9rem', alignSelf: 'center' }}>{totalVoters}/{players.length} voted</span>}
                                        </div>
                                        <p style={{ fontSize: 'clamp(1.4rem, 3vw, 2.4rem)', fontWeight: '600', margin: 0, lineHeight: 1.4, color: '#f0f6fc' }}>{currentQuestion.text}</p>
                                    </div>
                                    <div style={{ marginLeft: '20px', flexShrink: 0 }}>
                                        <TimerRing timeLeft={timeLeft} total={settings.timerSeconds} />
                                    </div>
                                </div>

                                {earlyEndSecs !== null && (
                                    <div style={{ background: '#3d2b00', border: '1px solid #d29922', borderRadius: '10px', padding: '12px 18px', color: '#d29922', fontWeight: 'bold', textAlign: 'center' }}>
                                        All voted - ending in {earlyEndSecs}s
                                    </div>
                                )}

                                {currentQuestion.imageUrl && <img src={currentQuestion.imageUrl} alt="" style={{ maxHeight: '180px', objectFit: 'contain', borderRadius: '10px', alignSelf: 'flex-start' }} />}

                                {/* Answer grid */}
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: '14px', flex: 1, minHeight: 0 }}>
                                    {currentQuestion.options.map((opt, idx) => {
                                        const label    = String.fromCharCode(65 + idx);
                                        const selected = myVote === opt.key;
                                        const count    = vCounts[opt.key] || 0;
                                        const pct      = totalVoters > 0 ? Math.round(count / totalVoters * 100) : 0;
                                        const voters   = vDetails?.[opt.key] || [];
                                        return (
                                            <button key={opt.key} onClick={() => vote(opt.key)}
                                                disabled={!!myVote && !settings.allowChangeGuess}
                                                style={{ background: selected ? '#1f6feb' : '#21262d', border: selected ? '2px solid #58a6ff' : '2px solid #30363d', borderRadius: '12px', padding: '12px 16px', color: '#e6edf3', cursor: 'pointer', textAlign: 'center', fontSize: 'clamp(1.1rem, 2vw, 1.5rem)', transition: 'all 0.15s', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
                                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', marginBottom: settings.showLiveVotes ? '8px' : '0', width: '100%' }}>
                                                    <span style={{ background: selected ? '#58a6ff' : '#30363d', color: selected ? '#0d1117' : '#8b949e', borderRadius: '50%', width: '44px', height: '44px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '1.1rem', flexShrink: 0, marginBottom: '8px' }}>{label}</span>
                                                    <span style={{ flex: 1 }}>{opt.text}</span>
                                                    {settings.showLiveVotes && count > 0 && <span style={{ color: '#8b949e', fontSize: '0.85rem' }}>{count}</span>}
                                                </div>
                                                {settings.showLiveVotes && (
                                                    <div style={{ height: '4px', background: '#30363d', borderRadius: '2px', overflow: 'hidden' }}>
                                                        <div style={{ height: '100%', width: `${pct}%`, background: '#58a6ff', transition: 'width 0.3s ease' }} />
                                                    </div>
                                                )}
                                                {settings.showOtherGuesses && voters.length > 0 && (
                                                    <div style={{ fontSize: '0.75rem', color: '#8b949e', marginTop: '5px' }}>{voters.slice(0, 4).join(', ')}{voters.length > 4 ? ` +${voters.length - 4}` : ''}</div>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>

                                {!settings.showLiveVotes && settings.showVoteCount && (
                                    <div style={{ textAlign: 'center', color: '#8b949e', fontSize: '1rem' }}>
                                        <strong style={{ fontSize: '1.4rem', color: '#58a6ff' }}>{totalVoters}</strong> / {players.length} voted
                                        <div style={{ height: '6px', background: '#21262d', borderRadius: '3px', marginTop: '6px', overflow: 'hidden' }}>
                                            <div style={{ height: '100%', width: `${players.length > 0 ? Math.round(totalVoters / players.length * 100) : 0}%`, background: '#238636', transition: 'width 0.3s' }} />
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {phase === 'results' && roundResult && currentQuestion && (
                            <div style={{ ...tvCard, flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <h2 style={{ margin: 0, color: '#f0f6fc' }}>Round Results</h2>
                                    <span style={{ color: '#8b949e' }}>Next in {resultsCountdown}s…</span>
                                </div>
                                <p style={{ fontSize: 'clamp(1rem, 2vw, 1.3rem)', fontWeight: '600', color: '#e6edf3', margin: 0 }}>{currentQuestion.text}</p>

                                {roundResult.myResult && (
                                    <div style={{ padding: '12px 18px', borderRadius: '10px', fontWeight: 'bold', fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '10px', background: roundResult.myResult.isCorrect ? '#1a3a1a' : '#3a1a1a', border: `1px solid ${roundResult.myResult.isCorrect ? '#238636' : '#da3633'}`, color: roundResult.myResult.isCorrect ? '#56d364' : '#f85149' }}>
                                        {roundResult.myResult.isCorrect ? `✓ Correct! +${roundResult.myResult.points} pts` : `✗ Wrong. +${roundResult.myResult.points} pt`}
                                        <MedalBadge medal={roundResult.myResult.medal} />
                                    </div>
                                )}

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: '12px', flex: 1, minHeight: 0 }}>
                                    {currentQuestion.options.map((opt, idx) => {
                                        const isCorrect = opt.key === roundResult.correctAnswer;
                                        const isMyVote  = roundResult.myResult?.answer === opt.key;
                                        const count     = roundResult.counts?.[opt.key] || 0;
                                        const pct       = roundResult.totalVoters > 0 ? Math.round(count / roundResult.totalVoters * 100) : 0;
                                        const voters    = roundResult.details?.[opt.key] || [];
                                        return (
                                            <div key={opt.key} style={{ background: isCorrect ? '#1a3a1a' : '#161b22', border: `2px solid ${isCorrect ? tvCorrectColor : '#30363d'}`, borderRadius: '12px', padding: '14px 18px' }}>
                                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', marginBottom: '8px', textAlign: 'center' }}>
                                                    <span style={{ background: isCorrect ? tvCorrectColor : '#30363d', color: '#fff', borderRadius: '50%', width: '44px', height: '44px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '1rem', flexShrink: 0 }}>{String.fromCharCode(65 + idx)}</span>
                                                    <span style={{ flex: 1, color: isCorrect ? '#56d364' : '#e6edf3', fontWeight: isCorrect ? 'bold' : 'normal', textAlign: 'center' }}>{isMyVote ? '▶ ' : ''}{opt.text}</span>
                                                    <span style={{ color: '#8b949e', fontSize: '0.9rem' }}>{count} ({pct}%)</span>
                                                </div>
                                                <div style={{ height: '6px', background: '#21262d', borderRadius: '3px', overflow: 'hidden' }}>
                                                    <div style={{ height: '100%', width: `${pct}%`, background: isCorrect ? tvCorrectColor : tvWrongColor, transition: 'width 0.4s' }} />
                                                </div>
                                                {settings.showOtherGuesses && voters.length > 0 && (
                                                    <div style={{ fontSize: '0.75rem', color: '#8b949e', marginTop: '5px' }}>{voters.join(', ')}</div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Right: scoreboard */}
                    <div className="sp-tv-right" style={{ ...tvCard, display: 'flex', flexDirection: 'column', gap: '10px', overflow: 'hidden' }}>
                        <div style={{ fontSize: '0.78rem', color: '#8b949e', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 'bold', marginBottom: '4px' }}>Top Players</div>
                        {players.length === 0 && <div style={{ color: '#8b949e', fontSize: '0.9rem' }}>Waiting…</div>}
                        {players.map((p, i) => (
                            <div key={p.userId || p.displayName} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: i < players.length - 1 ? '1px solid #21262d' : 'none', background: p.userId === user?.id ? 'rgba(31,111,235,0.1)' : 'transparent', borderRadius: '6px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                                    <span style={{ color: i === 0 ? '#d29922' : i === 1 ? '#8b949e' : i === 2 ? '#cd7f32' : '#6e7681', fontWeight: 'bold', fontSize: '0.85rem', flexShrink: 0, width: '20px' }}>#{i + 1}</span>
                                    {p.isHost && <span style={{ fontSize: '0.7rem' }}>👑</span>}
                                    <span style={{ fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: p.userId === user?.id ? 'bold' : 'normal' }}>{p.displayName}</span>
                                    {p.rating && <RatingBadge rating={p.rating} />}
                                </div>
                                <span style={{ fontWeight: 'bold', fontSize: '1rem', color: '#58a6ff', flexShrink: 0, marginLeft: '8px' }}>{p.sessionScore}</span>
                            </div>
                        ))}

                        {!isLive && (
                            <div style={{ marginTop: 'auto', paddingTop: '12px', borderTop: '1px solid #21262d', textAlign: 'center' }}>
                                <div style={{ color: '#8b949e', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>Join code</div>
                                <div style={{ fontFamily: 'monospace', fontSize: '2.2rem', fontWeight: 'bold', letterSpacing: '0.3em', color: '#58a6ff' }}>{roomCode}</div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div>
            {/* ── Room header ── */}
            <div style={{ ...card, marginBottom: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                    {isLive ? (
                        <span style={{ background: '#28a745', color: '#fff', borderRadius: '12px', padding: '3px 12px', fontWeight: 'bold' }}>● LIVE ROOM</span>
                    ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <div style={{ background: 'var(--border-color,#eee)', borderRadius: '10px', padding: '6px 16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <span style={{ fontSize: '0.75rem', color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Room Code</span>
                                <strong style={{ fontSize: '1.6rem', letterSpacing: '0.3em', fontFamily: 'monospace' }}>{roomCode}</strong>
                                <button onClick={copyCode} style={{ background: 'none', border: 'none', cursor: 'pointer', color: copied ? '#28a745' : '#888', fontSize: '0.85rem', padding: '0' }}>
                                    {copied ? '✓ Copied' : 'Copy'}
                                </button>
                            </div>
                            {isHost && <span style={{ background: '#fd7e14', color: '#fff', borderRadius: '10px', padding: '2px 10px', fontSize: '0.8rem', fontWeight: 'bold' }}>👑 HOST</span>}
                            {settings.isPublic && <span style={{ background: '#6c757d', color: '#fff', borderRadius: '10px', padding: '2px 10px', fontSize: '0.8rem' }}>PUBLIC</span>}
                        </div>
                    )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    {myPlayer && <span style={{ padding: '4px 12px', borderRadius: '20px', background: 'var(--btn-primary,#007bff)', color: '#fff', fontWeight: 'bold', fontSize: '0.85rem' }}>Score: {myPlayer.sessionScore}</span>}
                    <span style={{ color: '#888', fontSize: '0.85rem' }}>{players.length} player{players.length !== 1 ? 's' : ''}</span>
                    <button style={btn('#343a40', { padding: '6px 14px', fontSize: '0.85rem' })} onClick={() => setTvMode(true)} title="Fullscreen TV mode">📺 TV</button>
                    <button style={btn('#dc3545', { padding: '6px 14px', fontSize: '0.85rem' })} onClick={leaveRoom}>Leave</button>
                </div>
            </div>

            {roomError && <div style={{ background: '#f8d7da', color: '#721c24', padding: '10px 16px', borderRadius: '8px', marginBottom: '12px' }}>{roomError}</div>}

            {kickVote && (
                <div style={{ background: '#fff3cd', border: '2px solid #ffc107', borderRadius: '10px', padding: '14px', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                        <span style={{ fontSize: '1.2rem' }}>⚠</span>
                        <span style={{ fontWeight: 'bold' }}>{kickVote.initiatedByName} wants to kick {kickVote.targetDisplayName}</span>
                    </div>
                    <div style={{ display: 'flex', gap: '6px', marginBottom: '8px', fontSize: '0.85rem' }}>
                        <span style={{ color: '#dc3545' }}>{kickVote.votesFor} for</span>
                        <span>|</span>
                        <span style={{ color: '#28a745' }}>{kickVote.votesAgainst} against</span>
                        <span>|</span>
                        <span>{kickVote.totalPlayers - 1} voters</span>
                    </div>
                    {kickVote.targetSocketId !== socketRef.current?.id && !kickVote.hasVoted && (
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button style={{ padding: '6px 14px', background: '#dc3545', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem' }} onClick={() => { socketRef.current?.emit('vote_kick', { vote: 'for' }); setKickVote(v => ({ ...v, hasVoted: true, votesFor: v.votesFor + 1 })); }}>
                                Vote FOR kick
                            </button>
                            <button style={{ padding: '6px 14px', background: '#28a745', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem' }} onClick={() => { socketRef.current?.emit('vote_kick', { vote: 'against' }); setKickVote(v => ({ ...v, hasVoted: true, votesAgainst: v.votesAgainst + 1 })); }}>
                                Vote AGAINST
                            </button>
                        </div>
                    )}
                    {kickVote.hasVoted && <div style={{ fontSize: '0.82rem', color: '#856404' }}>You voted. Waiting for others...</div>}
                </div>
            )}

            <div className="sp-grid">

                {/* ── LEFT: Players ── */}
                <div className="sp-players" style={{ ...card, padding: '14px' }}>
                    <div style={{ fontSize: '0.78rem', color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px', fontWeight: 'bold' }}>Top Players</div>
                    {players.length === 0 && <div style={{ color: '#888', fontSize: '0.85rem' }}>Waiting…</div>}
                    {players.map((p, i) => (
                        <div key={p.userId || p.displayName} style={{ padding: '6px 0', borderBottom: i < players.length - 1 ? '1px solid var(--border-color,#eee)' : 'none', background: p.userId === user?.id ? 'rgba(0,123,255,0.07)' : 'transparent', borderRadius: '4px', cursor: (p.userId && p.userId !== user?.id && !p.isHost) ? 'pointer' : 'default' }} onClick={() => { if (p.userId && p.userId !== user?.id && !p.isHost) { setKickTarget(p); } }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', minWidth: 0 }}>
                                    <span style={{ fontWeight: 'bold', color: '#888', fontSize: '0.75rem', flexShrink: 0 }}>#{i + 1}</span>
                                    {p.isHost && <span style={{ fontSize: '0.7rem' }}>👑</span>}
                                    <span style={{ fontSize: '0.82rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: p.userId === user?.id ? 'bold' : 'normal' }}>{p.displayName}</span>
                                    {p.rating && <RatingBadge rating={p.rating} />}
                                </div>
                                <span style={{ fontWeight: 'bold', fontSize: '0.88rem', flexShrink: 0, marginLeft: '4px' }}>{p.sessionScore}</span>
                            </div>
                            {settings.showPlayerStats && p.totalAnswered > 0 && (
                                <div style={{ fontSize: '0.72rem', color: '#888', marginTop: '2px', paddingLeft: '18px' }}>
                                    {p.correctCount}/{p.totalAnswered} correct
                                </div>
                            )}
                        </div>
                    ))}
                </div>

                {/* Scoring guide */}
                <div className="sp-scoring" style={{ ...card, padding: '12px', fontSize: '0.78rem', color: '#888' }}>
                    <strong style={{ display: 'block', color: 'var(--text-color)', marginBottom: '5px' }}>Scoring</strong>
                    <div>✓ Correct: {settings.pointsCorrect} + {settings.timeBonus}×sec</div>
                    <div>✗ Wrong: {settings.pointsIncorrect} pt</div>
                    <div style={{ marginTop: '4px' }}>🥇 +{settings.goldBonus} &nbsp;🥈 +{settings.silverBonus} &nbsp;🥉 +{settings.bronzeBonus}</div>
                    <div style={{ marginTop: '4px' }}>Session resets after 30 min idle</div>
                </div>

                {/* ── CENTER: Game area ── */}
                <div className="sp-center">
                    {/* WAITING */}
                    {phase === 'waiting' && (
                        <div style={{ ...card, textAlign: 'center', padding: '40px 20px' }}>
                            <p style={{ color: '#888', marginBottom: '20px' }}>{statusMsg || 'Waiting for the game to start…'}</p>
                            {isHost && (
                                <button style={btn('#28a745', { fontSize: '1.1rem', padding: '14px 36px' })} onClick={startGame}>▶ Start Game</button>
                            )}
                        </div>
                    )}

                    {/* QUESTION */}
                    {phase === 'question' && currentQuestion && (
                        <div style={card}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px', gap: '10px' }}>
                                <div style={{ flex: 1 }}>
                                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
                                        {currentQuestion.categoryName && <span style={{ fontSize: '0.78rem', padding: '2px 10px', borderRadius: '10px', background: 'var(--border-color,#eee)', color: '#666' }}>{currentQuestion.categoryName}</span>}
                                        {currentQuestion.complexity  && <span style={{ fontSize: '0.78rem', padding: '2px 10px', borderRadius: '10px', background: COMPLEXITY_COLOR[currentQuestion.complexity] || '#888', color: '#fff', textTransform: 'capitalize' }}>{currentQuestion.complexity}</span>}
                                        {settings.showVoteCount && <span style={{ fontSize: '0.78rem', color: '#888' }}>{totalVoters}/{players.length} voted</span>}
                                    </div>
                                    <p style={{ fontSize: '1.05rem', fontWeight: '600', margin: 0, lineHeight: 1.4 }}>{currentQuestion.text}</p>
                                </div>
                                <TimerRing timeLeft={timeLeft} total={settings.timerSeconds} />
                            </div>

                            {currentQuestion.imageUrl && <img src={currentQuestion.imageUrl} alt="" style={{ display: 'block', maxWidth: '100%', maxHeight: '200px', objectFit: 'contain', margin: '0 auto 14px', borderRadius: '8px' }} />}

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                {currentQuestion.options.map((opt, idx) => {
                                    const label2 = String.fromCharCode(65 + idx);
                                    const selected = myVote === opt.key;
                                    const disabled = !!myVote && !settings.allowChangeGuess;
                                    const count    = vCounts[opt.key] || 0;
                                    const voters   = vDetails?.[opt.key] || [];
                                    return (
                                        <button key={opt.key} onClick={() => vote(opt.key)} disabled={disabled} style={{ padding: '14px 12px', borderRadius: '10px', border: selected ? '3px solid var(--btn-primary,#007bff)' : '2px solid var(--border-color,#ddd)', background: selected ? 'rgba(0,123,255,0.1)' : 'var(--card-bg,#fff)', color: 'var(--text-color,#333)', cursor: disabled ? 'not-allowed' : 'pointer', textAlign: 'left', fontSize: '0.9rem', fontWeight: selected ? 'bold' : 'normal', opacity: disabled ? 0.7 : 1, transition: 'border-color 0.15s' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '24px', height: '24px', borderRadius: '50%', background: selected ? 'var(--btn-primary,#007bff)' : 'var(--border-color,#ddd)', color: selected ? '#fff' : 'var(--text-color)', fontSize: '0.78rem', fontWeight: 'bold', flexShrink: 0 }}>{label2}</span>
                                                <span style={{ flex: 1 }}>{opt.text}</span>
                                                {settings.showLiveVotes && count > 0 && <span style={{ fontSize: '0.75rem', color: '#888', flexShrink: 0 }}>{count}</span>}
                                            </div>
                                            {settings.showOtherGuesses && voters.length > 0 && (
                                                <div style={{ fontSize: '0.72rem', color: '#888', marginTop: '5px', paddingLeft: '32px' }}>
                                                    {voters.slice(0, 4).join(', ')}{voters.length > 4 ? ` +${voters.length - 4}` : ''}
                                                </div>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                            {myVote && !settings.allowChangeGuess && <p style={{ textAlign: 'center', color: '#888', fontSize: '0.85rem', marginTop: '10px' }}>Answer locked - waiting for round to end.</p>}
                            {myVote && settings.allowChangeGuess  && !earlyEndSecs && <p style={{ textAlign: 'center', color: '#888', fontSize: '0.85rem', marginTop: '10px' }}>You can change your answer before time runs out.</p>}
                            {earlyEndSecs !== null && (
                                <div style={{ marginTop: '12px', padding: '10px 16px', borderRadius: '8px', background: '#fff3cd', color: '#856404', textAlign: 'center', fontWeight: 'bold', fontSize: '0.9rem' }}>
                                    All players voted - ending in {earlyEndSecs}s unless someone changes their answer
                                </div>
                            )}
                        </div>
                    )}

                    {/* RESULTS */}
                    {phase === 'results' && roundResult && currentQuestion && (
                        <div style={card}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                                <h3 style={{ margin: 0 }}>Round Results</h3>
                                <span style={{ color: '#888', fontSize: '0.85rem' }}>Next in {resultsCountdown}s…</span>
                            </div>
                            <p style={{ fontWeight: '600', marginBottom: '14px' }}>{currentQuestion.text}</p>

                            {roundResult.myResult ? (
                                <div style={{ padding: '12px 16px', borderRadius: '10px', marginBottom: '14px', background: roundResult.myResult.isCorrect ? '#d4edda' : '#f8d7da', color: roundResult.myResult.isCorrect ? '#155724' : '#721c24', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    {roundResult.myResult.isCorrect ? `✓ Correct! +${roundResult.myResult.points} pts` : `✗ Wrong. +${roundResult.myResult.points} pt`}
                                    <MedalBadge medal={roundResult.myResult.medal} />
                                </div>
                            ) : (
                                <div style={{ padding: '12px 16px', borderRadius: '10px', marginBottom: '14px', background: '#fff3cd', color: '#856404' }}>You didn't answer this round.</div>
                            )}

                            {currentQuestion.options.map((opt, idx) => {
                                const isCorrect = opt.key === roundResult.correctAnswer;
                                const isMyVote  = roundResult.myResult?.answer === opt.key;
                                const voters    = roundResult.details?.[opt.key] || [];
                                return (
                                    <div key={opt.key} style={{ padding: '8px 10px', borderRadius: '8px', marginBottom: '6px', background: isCorrect ? 'rgba(40,167,69,0.1)' : 'transparent', border: isCorrect ? '2px solid #28a745' : '2px solid transparent' }}>
                                        <VoteBar label={`${isCorrect ? '✓ ' : ''}${String.fromCharCode(65 + idx)}: ${opt.text}`} count={roundResult.counts?.[opt.key] || 0} total={roundResult.totalVoters} isCorrect={isCorrect} isMyVote={isMyVote} />
                                        {settings.showOtherGuesses && voters.length > 0 && (
                                            <div style={{ fontSize: '0.75rem', color: '#888', marginTop: '2px', paddingLeft: '4px' }}>
                                                {voters.join(', ')}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {phase === 'results' && !currentQuestion && (
                        <div style={{ ...card, textAlign: 'center', color: '#888' }}>Loading next question…</div>
                    )}
                </div>

                {/* ── RIGHT: Live vote counts + settings ── */}
                <div className="sp-right" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    {/* Live vote tally */}
                    {phase === 'question' && currentQuestion && settings.showLiveVotes && (
                        <div style={{ ...card, padding: '14px' }}>
                            <div style={{ fontSize: '0.78rem', color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px', fontWeight: 'bold' }}>Live Votes</div>
                            {currentQuestion.options.map((opt, idx) => {
                                const count = vCounts[opt.key] || 0;
                                const pct   = totalVoters > 0 ? Math.round(count / totalVoters * 100) : 0;
                                return (
                                    <div key={opt.key} style={{ marginBottom: '10px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '3px' }}>
                                            <span>{String.fromCharCode(65 + idx)}: {opt.text.slice(0, 18)}{opt.text.length > 18 ? '…' : ''}</span>
                                            <span>{count} ({pct}%)</span>
                                        </div>
                                        <div style={{ height: '6px', background: 'var(--border-color,#eee)', borderRadius: '3px', overflow: 'hidden' }}>
                                            <div style={{ height: '100%', width: `${pct}%`, background: 'var(--btn-primary,#007bff)', borderRadius: '3px', transition: 'width 0.3s ease' }} />
                                        </div>
                                        {settings.showOtherGuesses && (vDetails?.[opt.key] || []).length > 0 && (
                                            <div style={{ fontSize: '0.72rem', color: '#888', marginTop: '2px' }}>
                                                {(vDetails[opt.key] || []).slice(0, 3).join(', ')}{(vDetails[opt.key]?.length || 0) > 3 ? '…' : ''}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                            {settings.showVoteCount && <div style={{ fontSize: '0.78rem', color: '#888', textAlign: 'right', marginTop: '4px' }}>{totalVoters}/{players.length} answered</div>}
                        </div>
                    )}

                    {/* Vote count only - shown when showLiveVotes is off but showVoteCount is on */}
                    {phase === 'question' && !settings.showLiveVotes && settings.showVoteCount && (
                        <div style={{ ...card, padding: '14px', textAlign: 'center' }}>
                            <div style={{ fontSize: '0.78rem', color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px', fontWeight: 'bold' }}>Votes In</div>
                            <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>{totalVoters}</div>
                            <div style={{ fontSize: '0.85rem', color: '#888' }}>of {players.length}</div>
                            <div style={{ marginTop: '10px', height: '8px', background: 'var(--border-color,#eee)', borderRadius: '4px', overflow: 'hidden' }}>
                                <div style={{ height: '100%', width: `${players.length > 0 ? Math.round(totalVoters / players.length * 100) : 0}%`, background: '#28a745', borderRadius: '4px', transition: 'width 0.3s ease' }} />
                            </div>
                        </div>
                    )}

                    {/* Admin live room settings */}
                    {showAdminLivePanel && (
                        <SettingsPanel
                            settings={settings}
                            categories={categories}
                            onApply={applyAdminLiveSettings}
                            title="⚙ Live Room Settings (Admin)"
                        />
                    )}

                    {/* Host settings for private room */}
                    {showHostPanel && (
                        <SettingsPanel
                            settings={settings}
                            categories={categories}
                            onChange={true}
                            onApply={applyHostSettings}
                            title="⚙ Room Settings"
                            players={players}
                            myUserId={user?.id}
                            onSetHost={(targetSocketId) => socketRef.current?.emit('transfer_host', { targetSocketId })}
                        />
                    )}
                </div>

            {/* ── Question actions bar (grid child for mobile reorder) ── */}
            {currentQuestion && (
                <div className="sp-actions-wrap" style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <button
                        style={{ ...btn('var(--header-bg,#343a40)'), fontSize: '0.85rem', padding: '7px 14px' }}
                        onClick={handleSuggest}
                    >
                        📝 Suggest a Question
                    </button>

                    <div style={{ position: 'relative' }} ref={reportMenuRef}>
                        <button
                            style={{ ...btn('#6c757d'), fontSize: '0.85rem', padding: '7px 14px' }}
                            onClick={() => {
                                reportingQIdRef.current = currentQuestion.id;
                                setShowReportMenu(v => !v);
                                setReportMessage('');
                            }}
                        >
                            ⚠ Report
                        </button>

                        {showReportMenu && (
                            <div style={{ position: 'absolute', bottom: '110%', left: 0, background: 'var(--card-bg,#fff)', border: '1px solid var(--border-color,#ddd)', borderRadius: '10px', padding: '14px', width: '260px', zIndex: 20, boxShadow: '0 6px 20px rgba(0,0,0,0.15)' }}>
                                <div style={{ fontSize: '0.8rem', color: '#888', marginBottom: '6px' }}>Report Question</div>
                                <select value={reportType} onChange={e => setReportType(e.target.value)}
                                    style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color,#ddd)', background: 'var(--card-bg,#fff)', color: 'var(--text-color,#333)', marginBottom: '8px' }}>
                                    <option value="general">General Report</option>
                                    <option value="inappropriate">Inappropriate</option>
                                    <option value="incorrect">Incorrect Answer</option>
                                </select>
                                {(reportType === 'inappropriate' || reportType === 'incorrect') && (
                                    <textarea value={reportNote} onChange={e => setReportNote(e.target.value)}
                                        placeholder="Add a short description..."
                                        rows={3}
                                        style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color,#ddd)', background: 'var(--card-bg,#fff)', color: 'var(--text-color,#333)', resize: 'vertical', boxSizing: 'border-box', marginBottom: '8px' }} />
                                )}
                                {reportMessage && (
                                    <div style={{ fontSize: '0.8rem', marginBottom: '8px', color: reportMessage.startsWith('✅') ? '#155724' : '#856404' }}>
                                        {reportMessage}
                                    </div>
                                )}
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <button style={{ ...btn(), flex: 1, padding: '7px', fontSize: '0.85rem' }} onClick={submitQuestionReport}>Submit</button>
                                    <button style={{ ...btn('#6c757d'), padding: '7px 12px', fontSize: '0.85rem' }} onClick={() => { setShowReportMenu(false); setReportMessage(''); }}>Cancel</button>
                                </div>
                            </div>
                        )}
                    </div>

                    <div style={{ position: 'relative' }} ref={playerReportRef}>
                        <button
                            style={{ ...btn('#6c757d'), fontSize: '0.85rem', padding: '7px 14px' }}
                            onClick={() => {
                                setShowPlayerReportMenu(v => !v);
                                setPlayerReportMsg('');
                                setReportPlayerId('');
                            }}
                        >
                            🚩 Report Player
                        </button>

                        {showPlayerReportMenu && (
                            <div style={{ position: 'absolute', bottom: '110%', left: 0, background: 'var(--card-bg,#fff)', border: '1px solid var(--border-color,#ddd)', borderRadius: '10px', padding: '14px', width: '280px', zIndex: 20, boxShadow: '0 6px 20px rgba(0,0,0,0.15)' }}>
                                <div style={{ fontSize: '0.8rem', color: '#888', marginBottom: '6px' }}>Report Player</div>
                                <select value={reportPlayerId} onChange={e => setReportPlayerId(e.target.value)}
                                    style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color,#ddd)', background: 'var(--card-bg,#fff)', color: 'var(--text-color,#333)', marginBottom: '8px' }}>
                                    <option value="">Select a player...</option>
                                    {players.filter(p => p.userId && p.userId !== user?.id).map(p => (
                                        <option key={p.userId} value={p.userId}>{p.displayName}</option>
                                    ))}
                                </select>
                                <select value={playerReportType} onChange={e => setPlayerReportType(e.target.value)}
                                    style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color,#ddd)', background: 'var(--card-bg,#fff)', color: 'var(--text-color,#333)', marginBottom: '8px' }}>
                                    <option value="general">General Report</option>
                                    <option value="inappropriate">Inappropriate Behavior</option>
                                    <option value="cheating">Cheating</option>
                                    <option value="harassment">Harassment</option>
                                </select>
                                {(playerReportType === 'inappropriate' || playerReportType === 'cheating' || playerReportType === 'harassment') && (
                                    <textarea value={playerReportNote} onChange={e => setPlayerReportNote(e.target.value)}
                                        placeholder="Add a short description..."
                                        rows={3}
                                        style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color,#ddd)', background: 'var(--card-bg,#fff)', color: 'var(--text-color,#333)', resize: 'vertical', boxSizing: 'border-box', marginBottom: '8px' }} />
                                )}
                                {playerReportMsg && (
                                    <div style={{ fontSize: '0.8rem', marginBottom: '8px', color: playerReportMsg.startsWith('✅') ? '#155724' : '#856404' }}>
                                        {playerReportMsg}
                                    </div>
                                )}
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <button style={{ ...btn(), flex: 1, padding: '7px', fontSize: '0.85rem' }} onClick={submitPlayerReport}>Submit</button>
                                    <button style={{ ...btn('#6c757d'), padding: '7px 12px', fontSize: '0.85rem' }} onClick={() => { setShowPlayerReportMenu(false); setPlayerReportMsg(''); }}>Cancel</button>
                                </div>
                            </div>
                        )}
                    </div>

                    {reportMessage && !showReportMenu && (
                        <span style={{ fontSize: '0.85rem', color: reportMessage.startsWith('✅') ? '#155724' : '#856404' }}>{reportMessage}</span>
                    )}
                    {playerReportMsg && !showPlayerReportMenu && (
                        <span style={{ fontSize: '0.85rem', color: playerReportMsg.startsWith('✅') ? '#155724' : '#856404' }}>{playerReportMsg}</span>
                    )}
                </div>
            )}

            </div>

            {kickTarget && (
                <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: 'var(--card-bg,#fff)', border: '2px solid #ffc107', borderRadius: '12px', padding: '20px', zIndex: 100, boxShadow: '0 8px 24px rgba(0,0,0,0.2)', minWidth: '280px' }}>
                    <div style={{ fontSize: '1.2rem', textAlign: 'center', marginBottom: '6px' }}>⚠</div>
                    <div style={{ fontWeight: 'bold', fontSize: '1rem', marginBottom: '4px', textAlign: 'center' }}>Kick {kickTarget.displayName}?</div>
                    <div style={{ fontSize: '0.82rem', color: '#888', marginBottom: '14px', textAlign: 'center' }}>Vote to remove this player from the room.</div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button style={{ flex: 1, padding: '10px', background: '#dc3545', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }} onClick={() => { socketRef.current?.emit('initiate_kick', { targetSocketId: kickTarget.socketId }); setKickTarget(null); }}>
                            Vote to Kick
                        </button>
                        <button style={{ padding: '10px 16px', background: 'var(--border-color,#ddd)', color: 'var(--text-color,#333)', border: 'none', borderRadius: '8px', cursor: 'pointer' }} onClick={() => setKickTarget(null)}>Cancel</button>
                    </div>
                </div>
            )}

            {showRequestModal && (
                <RequestCardModal onClose={() => setShowRequestModal(false)} />
            )}
        </div>
    );
}
