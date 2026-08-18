import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { gravatarUrl } from './utils/gravatar';

const API_URL = process.env.REACT_APP_API_URL || '/api';

const authCfg = () => {
    const token = localStorage.getItem('token');
    return token ? { headers: { Authorization: `Bearer ${token}` } } : {};
};

const diffColor = { easy: '#28a745', medium: '#ffc107', hard: '#dc3545' };

const Badge = ({ color, text }) => (
    <span style={{
        backgroundColor: color, color: color === '#ffc107' ? '#333' : 'white',
        padding: '2px 9px', borderRadius: '20px', fontSize: '11px', fontWeight: 'bold',
        textTransform: 'uppercase', whiteSpace: 'nowrap'
    }}>{text}</span>
);

const getUserAvatarUrl = (user, size = 48) => {
    if (user?.discord_avatar_url) return user.discord_avatar_url;
    if (user?.email) return gravatarUrl(user.email, size);
    return '';
};

const getFilledOptionKeys = (options) => ['A', 'B', 'C', 'D'].filter((key) => String(options[key] || '').trim());
const normalizeSearchText = (value) => String(value || '').trim().toLowerCase();
const QUESTION_PAGE_SIZE_OPTIONS = ['25', '100', 'ALL'];

const Toast = ({ msg }) => msg ? (
    <div style={{
        padding: '12px 18px', marginBottom: '18px', borderRadius: '8px',
        backgroundColor: msg.startsWith('❌') ? '#f8d7da' : '#d4edda',
        color: msg.startsWith('❌') ? '#721c24' : '#155724',
        fontWeight: 'bold', border: `1px solid ${msg.startsWith('❌') ? '#f5c6cb' : '#c3e6cb'}`
    }}>{msg}</div>
) : null;

// ─── Question Form ─────────────────────────────────────────────────────────────
function QuestionForm({ categories, onSubmit, initial = {}, submitLabel = '✅ Add Question', onCancel }) {
    const [catId, setCatId]     = useState(initial.category_id ?? categories[0]?.id ?? '');
    const [text, setText]       = useState(initial.text ?? '');
    const [optA, setOptA]       = useState(initial.option_a ?? '');
    const [optB, setOptB]       = useState(initial.option_b ?? '');
    const [optC, setOptC]       = useState(initial.option_c ?? '');
    const [optD, setOptD]       = useState(initial.option_d ?? '');
    const [imageUrl, setImageUrl] = useState(initial.image_url ?? '');
    const [imageFile, setImageFile] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [correct, setCorrect] = useState(initial.correct_answer?.toUpperCase() ?? 'A');
    const [level, setLevel]     = useState(initial.complexity ?? 'easy');

    useEffect(() => {
        if (!initial.category_id && categories.length > 0) setCatId(categories[0].id);
    }, [categories]);

    const optionMap = { A: optA, B: optB, C: optC, D: optD };
    const filledOptionKeys = getFilledOptionKeys(optionMap);
    const usesFourOptions = filledOptionKeys.includes('C') || filledOptionKeys.includes('D');

    useEffect(() => {
        if (!filledOptionKeys.includes(correct)) {
            setCorrect(filledOptionKeys[0] || 'A');
        }
    }, [correct, filledOptionKeys]);

    const iStyle = {
        width: '100%', boxSizing: 'border-box', padding: '8px 10px',
        borderRadius: '6px', border: '1px solid var(--border-color)',
        backgroundColor: 'var(--card-bg)', color: 'var(--text-color)', fontSize: '14px'
    };

    const handleSubmit = () => {
        if (!text.trim() || !optA.trim() || !optB.trim())
            return alert('Option A and Option B are required.');
        const hasC = !!optC.trim();
        const hasD = !!optD.trim();
        if (hasC !== hasD) {
            return alert('Use either 2 options or 4 options. Option C and Option D must both be filled or both be blank.');
        }
        if (!catId) return alert('Select a category first.');
        onSubmit({
            categoryId: Number(catId),
            text,
            options: { a: optA, b: optB, c: optC, d: optD },
            correctAnswer: correct,
            complexity: level,
            imageUrl: imageUrl.trim() || null
        });
    };

    const uploadImage = async () => {
        if (!imageFile) return;
        setUploading(true);
        try {
            const token = localStorage.getItem('token');
            const form = new FormData();
            form.append('image', imageFile);
            const res = await axios.post(`${API_URL}/admin/images/upload`, form, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'multipart/form-data'
                }
            });
            if (res.data?.url) setImageUrl(res.data.url);
        } catch (e) {
            alert('Upload failed: ' + (e.response?.data?.error || e.message));
        } finally {
            setUploading(false);
        }
    };

    if (categories.length === 0) return (
        <div style={{ padding: '20px', backgroundColor: '#fff3cd', borderRadius: '8px', color: '#856404' }}>
            ⚠️ No categories exist. Go to the <strong>Categories</strong> tab and create one first.
        </div>
    );

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
                <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold', fontSize: '13px' }}>Category</label>
                <select value={catId} onChange={e => setCatId(e.target.value)} style={iStyle}>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}{c.disabled ? ' (disabled)' : ''}</option>)}
                </select>
            </div>
            <div>
                <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold', fontSize: '13px' }}>Question</label>
                <textarea value={text} onChange={e => setText(e.target.value)} rows={3} style={iStyle} placeholder="Write the question here..." />
            </div>
            <div>
                <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold', fontSize: '13px' }}>Image URL (optional)</label>
                <input
                    value={imageUrl}
                    onChange={e => setImageUrl(e.target.value)}
                    style={iStyle}
                    placeholder="https://example.com/image.png"
                />
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginTop: '8px' }}>
                <input
                        type="file"
                        accept=".png,.jpg,.jpeg,.svg,.webp,.gif"
                        onChange={e => setImageFile(e.target.files?.[0] || null)}
                        style={{ fontSize: '12px' }}
                    />
                    <button type="button" className="btn" onClick={uploadImage} disabled={!imageFile || uploading}
                        style={{ padding: '6px 10px', fontSize: '12px', backgroundColor: '#6c757d', color: 'white' }}>
                        {uploading ? 'Uploading...' : 'Upload Image'}
                    </button>
                </div>
                <div style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>
                    Allowed: png, jpg, jpeg, svg, webp, gif
                </div>
                {imageUrl?.trim() && (
                    <div style={{ marginTop: '8px' }}>
                        <img
                            src={imageUrl}
                            alt="Question preview"
                            style={{ maxWidth: '100%', maxHeight: '180px', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                        />
                    </div>
                )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                {[['A', optA, setOptA], ['B', optB, setOptB], ['C', optC, setOptC], ['D', optD, setOptD]].map(([lbl, val, set]) => (
                    <div key={lbl}>
                        <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold', fontSize: '13px' }}>
                            Option {lbl}{(lbl === 'A' || lbl === 'B') ? '' : ' (optional)'}
                        </label>
                        <input value={val} onChange={e => set(e.target.value)} style={iStyle} placeholder={`Option ${lbl}...`} />
                    </div>
                ))}
            </div>
            <div style={{ fontSize: '12px', color: '#666' }}>
                Questions can have 2 answers or 4 answers. Option A and Option B are required. Option C and Option D must both be filled or both be left blank.
            </div>
            <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', alignItems: 'center' }}>
                <div>
                    <strong style={{ fontSize: '13px' }}>Correct: </strong>
                    {(usesFourOptions ? ['A', 'B', 'C', 'D'] : ['A', 'B']).map(c => (
                        <label key={c} style={{ marginLeft: '10px', cursor: 'pointer', fontSize: '14px' }}>
                            <input type="radio" name={`correct-${submitLabel}`} value={c}
                                checked={correct === c} onChange={e => setCorrect(e.target.value)} /> {c}
                        </label>
                    ))}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <strong style={{ fontSize: '13px' }}>Difficulty:</strong>
                    <select value={level} onChange={e => setLevel(e.target.value)}
                        style={{ ...iStyle, width: 'auto', padding: '6px 10px' }}>
                        <option value="easy">Easy</option>
                        <option value="medium">Medium</option>
                        <option value="hard">Hard</option>
                    </select>
                </div>
            </div>
            <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
                <button onClick={handleSubmit} className="btn btn-primary" style={{ flex: 1, padding: '11px', fontSize: '14px' }}>
                    {submitLabel}
                </button>
                {onCancel && (
                    <button onClick={onCancel} className="btn" style={{ padding: '11px 20px', fontSize: '14px' }}>Cancel</button>
                )}
            </div>
        </div>
    );
}

// ─── Reset Password Modal ──────────────────────────────────────────────────────
function ResetPasswordModal({ user, onClose, onSuccess, flash }) {
    const [newPassword, setNewPassword] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (newPassword.length < 6) { flash('❌ Password must be at least 6 characters'); return; }
        setLoading(true);
        try {
            await axios.post(`${API_URL}/admin/users/${user.id}/reset-password`, { newPassword }, authCfg());
            flash(`✅ Password reset for ${user.email}`);
            onSuccess();
            onClose();
        } catch (err) {
            flash('❌ ' + (err.response?.data?.error || 'Reset failed'));
        } finally { setLoading(false); }
    };

    const iStyle = {
        width: '100%', boxSizing: 'border-box', padding: '9px 12px',
        borderRadius: '6px', border: '1px solid var(--border-color)',
        backgroundColor: 'var(--card-bg)', color: 'var(--text-color)', fontSize: '14px'
    };

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
            backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', justifyContent: 'center', alignItems: 'center'
        }}>
            <div className="card" style={{ width: '90%', maxWidth: '380px', padding: '28px', position: 'relative' }}>
                <button onClick={onClose} style={{ position: 'absolute', top: '12px', right: '14px', background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#888' }}>×</button>
                <h4 style={{ marginBottom: '6px' }}>🔑 Reset Password</h4>
                <p style={{ fontSize: '13px', color: '#666', marginBottom: '16px' }}>
                    Setting new password for <strong>{user.email}</strong>
                </p>
                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <input
                        type="password" placeholder="New password (min 6 chars)"
                        value={newPassword} onChange={e => setNewPassword(e.target.value)}
                        required style={iStyle}
                    />
                    <button type="submit" className="btn btn-primary" style={{ padding: '10px' }} disabled={loading}>
                        {loading ? 'Saving...' : 'Set Password'}
                    </button>
                </form>
            </div>
        </div>
    );
}

// ─── Main Admin Component ──────────────────────────────────────────────────────
export default function Admin() {
    const [tab, setTab]               = useState('review');
    const [toast, setToast]           = useState('');
    const [categories, setCategories] = useState([]);
    const [selCat, setSelCat]         = useState(null);
    const [questions, setQuestions]   = useState([]);
    const [qLoading, setQLoading]     = useState(false);
    const [qRefreshing, setQRefreshing] = useState(false);
    const [editingQ, setEditingQ]     = useState(null);
    const [newCatName, setNewCatName] = useState('');
    const [editingCategoryId, setEditingCategoryId] = useState(null);
    const [editingCategoryName, setEditingCategoryName] = useState('');
    const [pending, setPending]       = useState([]);
    const [reported, setReported]     = useState([]);
    // Users tab
    const [users, setUsers]           = useState([]);
    const [usersLoading, setUsersLoading] = useState(false);
    const [resetTarget, setResetTarget]   = useState(null); // user to reset password for
    const [showAnon, setShowAnon]         = useState(false);
    // Audit log tab
    const [auditLog, setAuditLog]     = useState([]);
    const [auditLoading, setAuditLoading] = useState(false);
    // Leaderboard schedule
    const [lbSchedule, setLbSchedule] = useState([]);
    const [lbLoading, setLbLoading] = useState(false);
    // Scoring settings
    const [scoring, setScoring] = useState(null);
    const [scoringSaving, setScoringSaving] = useState(false);
    // Privacy settings
    const [privacy, setPrivacy] = useState(null);
    const [privacySaving, setPrivacySaving] = useState(false);
    // Rate limit settings
    const [rateLimits, setRateLimits] = useState(null);
    const [rateLimitsSaving, setRateLimitsSaving] = useState(false);
    // Image settings
    const [imageSettings, setImageSettings] = useState(null);
    const [imageSettingsSaving, setImageSettingsSaving] = useState(false);
    // Category packs
    const [categoryExportIds, setCategoryExportIds] = useState([]);
    const [exportingCats, setExportingCats] = useState(false);
    const [importingCats, setImportingCats] = useState(false);
    const [githubRepoUrl, setGithubRepoUrl] = useState('');
    // Data management
    const [backups, setBackups] = useState([]);
    const [backupLoading, setBackupLoading] = useState(false);
    const [discordSso, setDiscordSso] = useState(null);
    const [discordSsoSaving, setDiscordSsoSaving] = useState(false);
    const [discordBot, setDiscordBot] = useState(null);
    const [discordBotSaving, setDiscordBotSaving] = useState(false);
    const [userSearch, setUserSearch] = useState('');
    const [userRoleFilter, setUserRoleFilter] = useState('all');
    const [userStatusFilter, setUserStatusFilter] = useState('all');
    const [questionSearch, setQuestionSearch] = useState('');
    const [questionDifficultyFilter, setQuestionDifficultyFilter] = useState('all');
    const [questionStatusFilter, setQuestionStatusFilter] = useState('all');
    const [questionMinAttempts, setQuestionMinAttempts] = useState('');
    const [questionPage, setQuestionPage] = useState(1);
    const [kickWarnings, setKickWarnings] = useState([]);
    const [shareplayBans, setShareplayBans] = useState([]);
    const [shareplayAppeals, setShareplayAppeals] = useState([]);
    const [shareplayLoading, setShareplayLoading] = useState(false);
    const [kickWarningFilter, setKickWarningFilter] = useState('');
    const [expandedKickUser, setExpandedKickUser] = useState(null);
    const [questionPageSize, setQuestionPageSize] = useState(() => {
        try {
            const stored = localStorage.getItem('admin_question_page_size');
            return QUESTION_PAGE_SIZE_OPTIONS.includes(stored) ? stored : 'ALL';
        } catch {
            return 'ALL';
        }
    });

    const flash = useCallback((m) => { setToast(m); setTimeout(() => setToast(''), 3500); }, []);

    const loadCategories = useCallback(async () => {
        try {
            const r = await axios.get(`${API_URL}/categories?includeDisabled=1`, authCfg());
            setCategories(r.data);
            if (r.data.length > 0 && !selCat) setSelCat(r.data[0]);
        } catch { flash('❌ Failed to load categories'); }
    }, []);

    const loadQuestions = useCallback(async (catId) => {
        if (questions.length > 0) setQRefreshing(true);
        else setQLoading(true);
        try {
            const r = await axios.get(`${API_URL}/categories/${catId}/questions`, authCfg());
            setQuestions(r.data);
        } catch { flash('❌ Failed to load questions'); }
        finally { setQLoading(false); setQRefreshing(false); }
    }, []);

    const loadReview = useCallback(async () => {
        try {
            const [pRes, rRes] = await Promise.all([
                axios.get(`${API_URL}/admin/queue`, authCfg()),
                axios.get(`${API_URL}/admin/reported`, authCfg()),
            ]);
            setPending(pRes.data);
            setReported(rRes.data);
        } catch { flash('❌ Failed to load review queue'); }
    }, []);

    const loadUsers = useCallback(async () => {
        setUsersLoading(true);
        try {
            const r = await axios.get(`${API_URL}/admin/users`, authCfg());
            setUsers(r.data);
        } catch { flash('❌ Failed to load users'); }
        finally { setUsersLoading(false); }
    }, []);

    const loadAuditLog = useCallback(async () => {
        setAuditLoading(true);
        try {
            const r = await axios.get(`${API_URL}/admin/audit-log`, authCfg());
            setAuditLog(r.data);
        } catch { flash('❌ Failed to load audit log'); }
        finally { setAuditLoading(false); }
    }, []);

    const loadLeaderboardSchedule = useCallback(async () => {
        setLbLoading(true);
        try {
            const r = await axios.get(`${API_URL}/admin/leaderboard/schedule`, authCfg());
            setLbSchedule(r.data);
        } catch { flash('❌ Failed to load leaderboard schedule'); }
        finally { setLbLoading(false); }
    }, []);

    const loadBackups = useCallback(async () => {
        setBackupLoading(true);
        try {
            const r = await axios.get(`${API_URL}/admin/backup`, authCfg());
            setBackups(r.data);
        } catch { flash('❌ Failed to load backups'); }
        finally { setBackupLoading(false); }
    }, []);

    const loadDiscordSsoSettings = useCallback(async () => {
        try {
            const r = await axios.get(`${API_URL}/admin/discord-sso-settings`, authCfg());
            setDiscordSso(r.data);
        } catch { flash('❌ Failed to load Discord SSO settings'); }
    }, []);

    const loadDiscordBotSettings = useCallback(async () => {
        try {
            const r = await axios.get(`${API_URL}/admin/discord-bot-settings`, authCfg());
            setDiscordBot(r.data);
        } catch { flash('❌ Failed to load Discord bot settings'); }
    }, []);

    const loadScoringSettings = useCallback(async () => {
        try {
            const r = await axios.get(`${API_URL}/admin/scoring-settings`, authCfg());
            setScoring(r.data);
        } catch { flash('❌ Failed to load scoring settings'); }
    }, []);

    const loadPrivacySettings = useCallback(async () => {
        try {
            const r = await axios.get(`${API_URL}/admin/privacy-settings`, authCfg());
            setPrivacy(r.data);
        } catch { flash('❌ Failed to load privacy settings'); }
    }, []);

    const loadRateLimitSettings = useCallback(async () => {
        try {
            const r = await axios.get(`${API_URL}/admin/rate-limit-settings`, authCfg());
            setRateLimits(r.data);
        } catch { flash('❌ Failed to load rate limit settings'); }
    }, []);

    const loadImageSettings = useCallback(async () => {
        try {
            const r = await axios.get(`${API_URL}/admin/image-settings`, authCfg());
            setImageSettings(r.data);
        } catch { flash('❌ Failed to load image settings'); }
    }, []);

    const loadShareplayData = useCallback(async () => {
        setShareplayLoading(true);
        try {
            const [kwRes, bansRes, appealsRes] = await Promise.all([
                axios.get(`${API_URL}/admin/shareplay/kick-warnings`, authCfg()),
                axios.get(`${API_URL}/admin/shareplay/bans`, authCfg()),
                axios.get(`${API_URL}/admin/shareplay/appeals`, authCfg()),
            ]);
            setKickWarnings(kwRes.data);
            setShareplayBans(bansRes.data);
            setShareplayAppeals(appealsRes.data);
        } catch { flash('❌ Failed to load SharePlay data'); }
        finally { setShareplayLoading(false); }
    }, []);

    useEffect(() => { loadCategories(); }, []);
    useEffect(() => { if (tab === 'review') loadReview(); }, [tab]);
    useEffect(() => { if (tab === 'questions' && selCat) loadQuestions(selCat.id); }, [selCat, tab]);
    useEffect(() => { if (tab === 'users') loadUsers(); }, [tab]);
    useEffect(() => { if (tab === 'audit') loadAuditLog(); }, [tab]);
    useEffect(() => { if (tab === 'leaderboard') loadLeaderboardSchedule(); }, [tab]);
    useEffect(() => { if (tab === 'leaderboard') loadScoringSettings(); }, [tab]);
    useEffect(() => { if (tab === 'leaderboard') loadPrivacySettings(); }, [tab]);
    useEffect(() => { if (tab === 'leaderboard') loadRateLimitSettings(); }, [tab]);
    useEffect(() => { if (tab === 'leaderboard') loadImageSettings(); }, [tab]);
    useEffect(() => { if (tab === 'data') loadBackups(); }, [tab]);
    useEffect(() => { if (tab === 'data') loadDiscordSsoSettings(); }, [tab]);
    useEffect(() => { if (tab === 'data') loadDiscordBotSettings(); }, [tab]);
    useEffect(() => { if (tab === 'shareplay') loadShareplayData(); }, [tab]);
    useEffect(() => { setQuestionPage(1); }, [selCat?.id, questionSearch, questionDifficultyFilter, questionStatusFilter, questionMinAttempts, questionPageSize]);
    useEffect(() => {
        try {
            localStorage.setItem('admin_question_page_size', questionPageSize);
        } catch {}
    }, [questionPageSize]);

    const filteredRealUsers = useMemo(() => {
        const search = normalizeSearchText(userSearch);
        return users
            .filter((u) => !u.is_anonymous)
            .filter((u) => {
                if (userRoleFilter !== 'all' && u.role !== userRoleFilter) return false;
                const blockedUntil = u.blocked_until ? new Date(u.blocked_until) : null;
                const isBlocked = blockedUntil && blockedUntil > new Date();
                if (userStatusFilter === 'blocked' && !isBlocked) return false;
                if (userStatusFilter === 'active' && isBlocked) return false;
                if (!search) return true;
                return [u.email, u.display_name, u.discord_username, u.role]
                    .some((value) => normalizeSearchText(value).includes(search));
            });
    }, [users, userSearch, userRoleFilter, userStatusFilter]);

    const filteredQuestions = useMemo(() => {
        const search = normalizeSearchText(questionSearch);
        const minAttempts = Number(questionMinAttempts);
        return questions.filter((q) => {
            if (questionDifficultyFilter !== 'all' && q.complexity !== questionDifficultyFilter) return false;
            if (questionStatusFilter === 'enabled' && q.disabled) return false;
            if (questionStatusFilter === 'disabled' && !q.disabled) return false;
            if (questionMinAttempts !== '' && (Number.isNaN(minAttempts) || Number(q.total_attempts || 0) < minAttempts)) return false;
            if (!search) return true;
            return [
                q.text,
                q.option_a,
                q.option_b,
                q.option_c,
                q.option_d,
                q.correct_answer,
                q.complexity,
                q.id
            ].some((value) => normalizeSearchText(value).includes(search));
        });
    }, [questions, questionSearch, questionDifficultyFilter, questionStatusFilter, questionMinAttempts]);

    const paginatedQuestions = useMemo(() => {
        if (questionPageSize === 'ALL') return filteredQuestions;
        const pageSize = Number(questionPageSize);
        const start = (questionPage - 1) * pageSize;
        return filteredQuestions.slice(start, start + pageSize);
    }, [filteredQuestions, questionPage, questionPageSize]);

    const totalQuestionPages = useMemo(() => {
        if (questionPageSize === 'ALL') return 1;
        return Math.max(1, Math.ceil(filteredQuestions.length / Number(questionPageSize)));
    }, [filteredQuestions.length, questionPageSize]);

    useEffect(() => {
        setQuestionPage((current) => Math.min(current, totalQuestionPages));
    }, [totalQuestionPages]);

    // ── Category actions ───────────────────────────────────────────────────────
    const addCategory = async () => {
        if (!newCatName.trim()) return alert('Enter a name.');
        try {
            await axios.post(`${API_URL}/categories`, { name: newCatName.trim() }, authCfg());
            setNewCatName('');
            flash('✅ Category created');
            loadCategories();
        } catch (e) { flash('❌ ' + (e.response?.data?.error || 'Failed')); }
    };

    const deleteCategory = async (cat) => {
        if (!window.confirm(`Delete "${cat.name}" and ALL its questions? This cannot be undone.`)) return;
        try {
            await axios.delete(`${API_URL}/categories/${cat.id}`, authCfg());
            flash('🗑️ Category deleted');
            setSelCat(null); setQuestions([]);
            loadCategories();
        } catch (e) { flash('❌ ' + (e.response?.data?.error || 'Delete failed')); }
    };

    const toggleCategoryDisabled = async (cat) => {
        try {
            await axios.patch(`${API_URL}/categories/${cat.id}`, { disabled: !cat.disabled }, authCfg());
            flash(cat.disabled ? '✅ Category enabled' : '🚫 Category disabled');
            loadCategories();
            if (selCat?.id === cat.id) {
                setSelCat({ ...cat, disabled: !cat.disabled });
            }
        } catch (e) {
            flash('❌ ' + (e.response?.data?.error || 'Category update failed'));
        }
    };

    const startRenameCategory = (cat) => {
        setEditingCategoryId(cat.id);
        setEditingCategoryName(cat.name);
    };

    const cancelRenameCategory = () => {
        setEditingCategoryId(null);
        setEditingCategoryName('');
    };

    const saveCategoryName = async (cat) => {
        const nextName = editingCategoryName.trim();
        if (!nextName) return flash('❌ Category name required');
        if (nextName === cat.name) {
            cancelRenameCategory();
            return;
        }
        try {
            const res = await axios.patch(`${API_URL}/categories/${cat.id}`, { name: nextName }, authCfg());
            flash('✅ Category renamed');
            setEditingCategoryId(null);
            setEditingCategoryName('');
            loadCategories();
            if (selCat?.id === cat.id) {
                setSelCat(res.data);
            }
        } catch (e) {
            flash('❌ ' + (e.response?.data?.error || 'Rename failed'));
        }
    };

    // ── Question actions ───────────────────────────────────────────────────────
    const addQuestion = async (data) => {
        try {
            await axios.post(`${API_URL}/questions`, data, authCfg());
            flash('✅ Question added');
            const targetCat = categories.find(c => c.id === data.categoryId);
            if (targetCat) { setSelCat(targetCat); loadQuestions(data.categoryId); setTab('questions'); }
        } catch (e) { flash('❌ ' + (e.response?.data?.error || 'Failed')); }
    };

    const saveEdit = async (data) => {
        try {
            await axios.put(`${API_URL}/questions/${editingQ.id}`, data, authCfg());
            flash('✅ Question updated');
            setEditingQ(null);
            loadQuestions(selCat.id);
        } catch (e) { flash('❌ ' + (e.response?.data?.error || 'Failed')); }
    };

    const toggleDisable = async (q) => {
        try {
            await axios.patch(`${API_URL}/questions/${q.id}`, { disabled: !q.disabled }, authCfg());
            flash(q.disabled ? '✅ Question enabled' : '🚫 Question disabled');
            loadQuestions(selCat.id);
        } catch { flash('❌ Toggle failed'); }
    };

    const deleteQuestion = async (id) => {
        if (!window.confirm('Permanently delete this question?')) return;
        try {
            await axios.delete(`${API_URL}/questions/${id}`, authCfg());
            flash('🗑️ Question deleted');
            loadQuestions(selCat.id);
        } catch { flash('❌ Delete failed'); }
    };

    // ── Review actions ─────────────────────────────────────────────────────────
    const approvePending = async (id) => {
        try {
            await axios.post(`${API_URL}/admin/approve/${id}`, {}, authCfg());
            flash('✅ Approved & added to game');
            loadReview(); loadCategories();
        } catch { flash('❌ Approval failed'); }
    };

    const denyPending = async (id) => {
        try {
            await axios.post(`${API_URL}/admin/deny/${id}`, {}, authCfg());
            flash('Submission denied');
            loadReview();
        } catch { flash('❌ Denial failed'); }
    };

    const dismissReport = async (reportId) => {
        try {
            await axios.delete(`${API_URL}/admin/reports/${reportId}`, authCfg());
            flash('👍 Report dismissed');
            loadReview();
        } catch { flash('❌ Failed to dismiss'); }
    };

    const disableFromReport = async (questionId, reportId) => {
        try {
            await axios.patch(`${API_URL}/questions/${questionId}`, { disabled: true }, authCfg());
            await axios.delete(`${API_URL}/admin/reports/${reportId}`, authCfg());
            flash('🚫 Question disabled & report cleared');
            loadReview();
        } catch { flash('❌ Failed'); }
    };

    // ── User actions ───────────────────────────────────────────────────────────
    const changeRole = async (userId, newRole) => {
        try {
            await axios.patch(`${API_URL}/admin/users/${userId}/role`, { role: newRole }, authCfg());
            flash(`✅ Role updated to ${newRole}`);
            loadUsers();
        } catch (e) { flash('❌ ' + (e.response?.data?.error || 'Role change failed')); }
    };

    const blockUser = async (userId) => {
        const minutesStr = window.prompt('Block duration in minutes (0 = forever):', '60');
        if (minutesStr === null) return;
        const minutes = Number(minutesStr);
        if (!Number.isFinite(minutes) || minutes < 0) {
            flash('❌ Invalid duration');
            return;
        }
        const reason = window.prompt('Reason (optional):', '');
        try {
            await axios.post(`${API_URL}/admin/users/${userId}/block`, { minutes, reason }, authCfg());
            flash('✅ User blocked');
            loadUsers();
        } catch (e) { flash('❌ ' + (e.response?.data?.error || 'Block failed')); }
    };

    const unblockUser = async (userId) => {
        try {
            await axios.post(`${API_URL}/admin/users/${userId}/unblock`, {}, authCfg());
            flash('✅ User unblocked');
            loadUsers();
        } catch (e) { flash('❌ ' + (e.response?.data?.error || 'Unblock failed')); }
    };

    const unblockShareplayUser = async (userId) => {
        try {
            await axios.post(`${API_URL}/admin/shareplay/unblock/${userId}`, {}, authCfg());
            flash('✅ User unblocked from SharePlay');
            loadShareplayData();
        } catch (e) { flash('❌ ' + (e.response?.data?.error || 'Unblock failed')); }
    };

    const resolveAppeal = async (appealId, status) => {
        try {
            await axios.post(`${API_URL}/admin/shareplay/appeals/${appealId}/resolve`, { status, admin_response: '' }, authCfg());
            flash(`✅ Appeal ${status}`);
            loadShareplayData();
        } catch (e) { flash('❌ ' + (e.response?.data?.error || 'Failed')); }
    };

    const clearLeaderboard = async (userId) => {
        if (!window.confirm('Clear this user\'s leaderboard data?')) return;
        try {
            await axios.post(`${API_URL}/admin/users/${userId}/clear-leaderboard`, {}, authCfg());
            flash('✅ Leaderboard cleared');
            loadUsers();
        } catch (e) { flash('❌ ' + (e.response?.data?.error || 'Failed')); }
    };

    const deleteUserAccount = async (userId) => {
        if (!window.confirm('Are you sure? This cannot be undone.')) return;
        try {
            await axios.delete(`${API_URL}/admin/users/${userId}`, authCfg());
            flash('✅ User account deleted');
            loadUsers();
        } catch (e) { flash('❌ ' + (e.response?.data?.error || 'Failed')); }
    };

    const blockFromServer = async (userId) => {
        const minutesStr = window.prompt('Block duration in minutes (0 = forever):', '60');
        if (minutesStr === null) return;
        const minutes = Number(minutesStr);
        if (!Number.isFinite(minutes) || minutes < 0) {
            flash('❌ Invalid duration');
            return;
        }
        const reason = window.prompt('Reason (optional):', '');
        try {
            await axios.post(`${API_URL}/admin/shareplay/block/${userId}`, { minutes, reason }, authCfg());
            flash('✅ User blocked from server');
            loadUsers();
        } catch (e) { flash('❌ ' + (e.response?.data?.error || 'Block failed')); }
    };

    // ── Leaderboard actions ───────────────────────────────────────────────────
    const setSchedule = async (period, enabled) => {
        try {
            await axios.post(`${API_URL}/admin/leaderboard/schedule`, { period, enabled }, authCfg());
            flash(`✅ ${period} schedule ${enabled ? 'enabled' : 'disabled'}`);
            loadLeaderboardSchedule();
        } catch (e) { flash('❌ ' + (e.response?.data?.error || 'Schedule update failed')); }
    };

    const resetLeaderboardNow = async () => {
        if (!window.confirm('Reset the global leaderboard now? This affects all categories.')) return;
        try {
            await axios.post(`${API_URL}/admin/leaderboard/reset`, {}, authCfg());
            flash('✅ Leaderboard reset');
        } catch (e) { flash('❌ ' + (e.response?.data?.error || 'Reset failed')); }
    };

    const saveScoringSettings = async () => {
        if (!scoring) return;
        setScoringSaving(true);
        try {
            await axios.post(`${API_URL}/admin/scoring-settings`, {
                min_points: Number(scoring.min_points),
                max_easy: Number(scoring.max_easy),
                max_med: Number(scoring.max_med),
                max_hard: Number(scoring.max_hard),
                discord_easy: Number(scoring.discord_easy),
                discord_med: Number(scoring.discord_med),
                discord_hard: Number(scoring.discord_hard),
                fast_ms: Number(scoring.fast_ms),
                slow_ms: Number(scoring.slow_ms),
                diff_min_attempts: Number(scoring.diff_min_attempts),
                diff_up_threshold: Number(scoring.diff_up_threshold),
                diff_down_threshold: Number(scoring.diff_down_threshold),
            }, authCfg());
            flash('✅ Scoring settings saved');
        } catch (e) { flash('❌ ' + (e.response?.data?.error || 'Save failed')); }
        finally { setScoringSaving(false); }
    };

    const savePrivacySettings = async () => {
        if (!privacy) return;
        setPrivacySaving(true);
        try {
            const r = await axios.post(`${API_URL}/admin/privacy-settings`, {
                hide_emails_globally: !!privacy.hide_emails_globally,
                hide_emails_by_default: !!privacy.hide_emails_by_default
            }, authCfg());
            setPrivacy(r.data);
            flash('✅ Privacy settings saved');
        } catch (e) { flash('❌ ' + (e.response?.data?.error || 'Save failed')); }
        finally { setPrivacySaving(false); }
    };

    const saveRateLimitSettings = async () => {
        if (!rateLimits) return;
        setRateLimitsSaving(true);
        try {
            const r = await axios.post(`${API_URL}/admin/rate-limit-settings`, {
                guest_min_interval_ms: Number(rateLimits.guest_min_interval_ms),
                user_burst_window_ms: Number(rateLimits.user_burst_window_ms),
                user_burst_max: Number(rateLimits.user_burst_max),
                user_cooldown_ms: Number(rateLimits.user_cooldown_ms),
                open_trivia_db_enabled: !!rateLimits.open_trivia_db_enabled,
                skip_per_hour: Number(rateLimits.skip_per_hour),
            }, authCfg());
            setRateLimits(r.data);
            flash('✅ Rate limit settings saved');
        } catch (e) { flash('❌ ' + (e.response?.data?.error || 'Save failed')); }
        finally { setRateLimitsSaving(false); }
    };

    const saveImageSettings = async () => {
        if (!imageSettings) return;
        setImageSettingsSaving(true);
        try {
            const r = await axios.post(`${API_URL}/admin/image-settings`, {
                max_image_kb: Number(imageSettings.max_image_kb),
            }, authCfg());
            setImageSettings(r.data);
            flash('✅ Image settings saved');
        } catch (e) { flash('❌ ' + (e.response?.data?.error || 'Save failed')); }
        finally { setImageSettingsSaving(false); }
    };

    const createBackup = async () => {
        const note = window.prompt('Backup note (optional):', '');
        try {
            await axios.post(`${API_URL}/admin/backup`, { note: note || null }, authCfg());
            flash('✅ Backup created');
            loadBackups();
        } catch (e) { flash('❌ ' + (e.response?.data?.error || 'Backup failed')); }
    };

    const saveDiscordSsoSettings = async () => {
        if (!discordSso) return;
        setDiscordSsoSaving(true);
        try {
            const r = await axios.post(`${API_URL}/admin/discord-sso-settings`, {
                enabled: !!discordSso.enabled,
                client_id: discordSso.client_id || '',
                client_secret: discordSso.client_secret || '',
                redirect_uri: discordSso.redirect_uri || '',
            }, authCfg());
            setDiscordSso(r.data);
            flash(r.data.active ? '✅ Discord SSO saved and active' : '✅ Discord SSO settings saved');
        } catch (e) { flash('❌ ' + (e.response?.data?.error || 'Save failed')); }
        finally { setDiscordSsoSaving(false); }
    };

    const saveDiscordBotSettings = async () => {
        if (!discordBot) return;
        setDiscordBotSaving(true);
        try {
            const r = await axios.post(`${API_URL}/admin/discord-bot-settings`, {
                enabled: !!discordBot.enabled,
                api_token: discordBot.api_token || '',
                public_app_url: discordBot.public_app_url || '',
                service_url: discordBot.service_url || '',
                invite_url: discordBot.invite_url || '',
            }, authCfg());
            setDiscordBot(r.data);
            flash(r.data.active ? '✅ Discord bot settings saved and active' : '✅ Discord bot settings saved');
        } catch (e) { flash('❌ ' + (e.response?.data?.error || 'Save failed')); }
        finally { setDiscordBotSaving(false); }
    };

    const exportData = async () => {
        try {
            const r = await axios.get(`${API_URL}/admin/export`, authCfg());
            const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `open-trivia-export-${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.json`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (e) { flash('❌ ' + (e.response?.data?.error || 'Export failed')); }
    };

    const exportCategoryPacks = async () => {
        if (!categoryExportIds.length) {
            flash('❌ Select at least one category');
            return;
        }
        setExportingCats(true);
        try {
            const r = await axios.post(
                `${API_URL}/admin/categories/export-zip`,
                { categoryIds: categoryExportIds },
                { ...authCfg(), responseType: 'arraybuffer' }
            );
            const blob = new Blob([r.data], { type: 'application/zip' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `category_packs_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.zip`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (e) { flash('❌ Category export failed'); }
        finally { setExportingCats(false); }
    };

    const importCategoryPack = async (file) => {
        setImportingCats(true);
        try {
            const form = new FormData();
            form.append('file', file);
            await axios.post(`${API_URL}/admin/categories/import-zip`, form, {
                headers: {
                    ...authCfg().headers,
                    'Content-Type': 'multipart/form-data'
                }
            });
            flash('✅ Category import completed');
            loadCategories();
        } catch (e) { flash('❌ ' + (e.response?.data?.error || 'Category import failed')); }
        finally { setImportingCats(false); }
    };

    const importFromGithub = async () => {
        if (!githubRepoUrl.trim()) return;
        setImportingCats(true);
        try {
            await axios.post(`${API_URL}/admin/categories/import-github`, { repoUrl: githubRepoUrl.trim() }, authCfg());
            flash('✅ Imported from URL');
            setGithubRepoUrl('');
            loadCategories();
        } catch (e) { flash('❌ ' + (e.response?.data?.error || 'URL import failed')); }
        finally { setImportingCats(false); }
    };

    const importData = async (file, mode) => {
        try {
            const text = await file.text();
            const payload = JSON.parse(text);
            await axios.post(`${API_URL}/admin/import`, { data: payload.data || payload, mode }, authCfg());
            flash('✅ Import completed');
            loadBackups();
        } catch (e) { flash('❌ ' + (e.response?.data?.error || 'Import failed')); }
    };

    const restoreUser = async () => {
        const input = window.prompt('Restore user by ID or email:', '');
        if (!input) return;
        let userId = Number(input);
        if (!Number.isFinite(userId)) {
            const u = users.find(x => x.email.toLowerCase() === String(input).toLowerCase());
            if (!u) { flash('❌ User not found'); return; }
            userId = u.id;
        }
        try {
            await axios.post(`${API_URL}/admin/backup/restore-user`, { userId }, authCfg());
            flash('✅ User restored from latest backup');
            loadUsers();
        } catch (e) { flash('❌ ' + (e.response?.data?.error || 'Restore failed')); }
    };

    // ── Styles ─────────────────────────────────────────────────────────────────
    const tabStyle = (t) => ({
        padding: '9px 18px', borderRadius: '6px', border: 'none', cursor: 'pointer',
        fontWeight: 'bold', fontSize: '13px',
        backgroundColor: tab === t ? 'var(--btn-primary)' : 'var(--card-bg)',
        color: tab === t ? 'white' : 'var(--text-color)',
        boxShadow: tab === t ? '0 2px 8px rgba(0,0,0,0.15)' : '0 1px 3px rgba(0,0,0,0.08)',
    });

    const cardStyle = {
        border: '1px solid var(--border-color)', borderRadius: '8px',
        padding: '16px', backgroundColor: 'var(--card-bg)', marginBottom: '10px'
    };

    const reviewBadgeCount = pending.length + reported.length;
    const realUsers = filteredRealUsers;
    const anonUsers = users.filter(u => u.is_anonymous);

    return (
        <div style={{ paddingBottom: '40px' }}>
            <h2 style={{ marginBottom: '4px' }}>🛠️ Admin Dashboard</h2>
            <p style={{ color: '#888', marginBottom: '20px', fontSize: '13px' }}>
                Manage categories, questions, users, and review submissions.
            </p>

            <Toast msg={toast} />

            {/* Tab bar */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '28px', flexWrap: 'wrap' }}>
                <button style={tabStyle('questions')}  onClick={() => setTab('questions')}>📚 Questions</button>
                <button style={tabStyle('add')}        onClick={() => setTab('add')}>➕ Add Question</button>
                <button style={tabStyle('categories')} onClick={() => setTab('categories')}>📁 Categories</button>
                <button style={tabStyle('review')}     onClick={() => setTab('review')}>
                    📋 Review Queue
                    {reviewBadgeCount > 0 && (
                        <span style={{ marginLeft: '7px', backgroundColor: '#dc3545', color: 'white', borderRadius: '50%', padding: '1px 6px', fontSize: '11px' }}>
                            {reviewBadgeCount}
                        </span>
                    )}
                </button>
                <button style={tabStyle('users')}      onClick={() => setTab('users')}>
                    👥 Users
                    {realUsers.length > 0 && (
                        <span style={{ marginLeft: '7px', backgroundColor: '#6c757d', color: 'white', borderRadius: '10px', padding: '1px 6px', fontSize: '11px' }}>
                            {realUsers.length}
                        </span>
                    )}
                </button>
                <button style={tabStyle('leaderboard')} onClick={() => setTab('leaderboard')}>🏆 Leaderboard</button>
                <button style={tabStyle('data')} onClick={() => setTab('data')}>🗄️ Data</button>
                <button style={tabStyle('audit')}      onClick={() => setTab('audit')}>📜 Audit Log</button>
                <button style={tabStyle('shareplay')}  onClick={() => setTab('shareplay')}>🛡️ SharePlay</button>
            </div>

            {/* ── QUESTIONS ──────────────────────────────────────────────────── */}
            {tab === 'questions' && (
                <div>
                    {categories.length === 0 ? (
                        <div style={{ ...cardStyle, textAlign: 'center', padding: '40px', color: '#888' }}>
                            <div style={{ fontSize: '40px', marginBottom: '12px' }}>📁</div>
                            No categories yet.{' '}
                            <button className="btn btn-primary" style={{ marginLeft: '8px' }} onClick={() => setTab('categories')}>Create one →</button>
                        </div>
                    ) : (
                        <>
                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '20px' }}>
                                {categories.map(c => (
                                    <button key={c.id} onClick={() => { setSelCat(c); setEditingQ(null); loadQuestions(c.id); }}
                                        style={{
                                            padding: '6px 16px', borderRadius: '20px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px',
                                            border: '2px solid var(--btn-primary)',
                                            backgroundColor: selCat?.id === c.id ? 'var(--btn-primary)' : 'transparent',
                                            color: selCat?.id === c.id ? 'white' : 'var(--text-color)',
                                            opacity: c.disabled ? 0.55 : 1,
                                        }}>
                                        {c.name}{c.disabled ? ' (disabled)' : ''}
                                    </button>
                                ))}
                            </div>

                            {selCat && (
                                <>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                                        <h3 style={{ margin: 0 }}>
                                            {selCat.name}
                                            <span style={{ marginLeft: '10px', fontSize: '14px', color: '#888', fontWeight: 'normal' }}>
                                                - {filteredQuestions.length} matching question{filteredQuestions.length !== 1 ? 's' : ''}
                                            </span>
                                        </h3>
                                        {selCat.disabled && <Badge color="#6c757d" text="category disabled" />}
                                    </div>

                                    <div style={{ ...cardStyle, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px', marginBottom: '14px' }}>
                                        <input
                                            value={questionSearch}
                                            onChange={e => setQuestionSearch(e.target.value)}
                                            placeholder="Search text or answers..."
                                            style={{ padding: '9px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--card-bg)', color: 'var(--text-color)' }}
                                        />
                                        <select value={questionDifficultyFilter} onChange={e => setQuestionDifficultyFilter(e.target.value)} style={{ padding: '9px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--card-bg)', color: 'var(--text-color)' }}>
                                            <option value="all">All difficulties</option>
                                            <option value="easy">Easy</option>
                                            <option value="medium">Medium</option>
                                            <option value="hard">Hard</option>
                                        </select>
                                        <select value={questionStatusFilter} onChange={e => setQuestionStatusFilter(e.target.value)} style={{ padding: '9px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--card-bg)', color: 'var(--text-color)' }}>
                                            <option value="all">All statuses</option>
                                            <option value="enabled">Enabled only</option>
                                            <option value="disabled">Disabled only</option>
                                        </select>
                                        <input
                                            type="number"
                                            min="0"
                                            value={questionMinAttempts}
                                            onChange={e => setQuestionMinAttempts(e.target.value)}
                                            placeholder="Min guesses"
                                            style={{ padding: '9px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--card-bg)', color: 'var(--text-color)' }}
                                        />
                                        <select value={questionPageSize} onChange={e => setQuestionPageSize(e.target.value)} style={{ padding: '9px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--card-bg)', color: 'var(--text-color)' }}>
                                            {QUESTION_PAGE_SIZE_OPTIONS.map((size) => (
                                                <option key={size} value={size}>{size === 'ALL' ? 'Show all' : `${size} per page`}</option>
                                            ))}
                                        </select>
                                    </div>

                                    {qLoading && <p style={{ color: '#888' }}>Loading...</p>}
                                    {qRefreshing && <p style={{ color: '#888' }}>Refreshing...</p>}

                                    {!qLoading && filteredQuestions.length === 0 && (
                                        <div style={{ ...cardStyle, textAlign: 'center', padding: '30px', color: '#888' }}>
                                            No matching questions in this category.{' '}
                                            <button className="btn btn-primary" style={{ marginLeft: '8px' }} onClick={() => setTab('add')}>Add one →</button>
                                        </div>
                                    )}

                                    {paginatedQuestions.map(q => (
                                        <div key={q.id} style={{ ...cardStyle, opacity: q.disabled ? 0.55 : 1, borderLeft: `4px solid ${q.disabled ? '#6c757d' : (diffColor[q.complexity] || '#aaa')}` }}>
                                            {editingQ?.id === q.id ? (
                                                <>
                                                    <p style={{ fontWeight: 'bold', marginBottom: '12px', color: 'var(--text-color)' }}>✏️ Editing Question #{q.id}</p>
                                                    <QuestionForm categories={categories} initial={editingQ}
                                                        onSubmit={saveEdit} submitLabel="💾 Save Changes" onCancel={() => setEditingQ(null)} />
                                                </>
                                            ) : (
                                                <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
                                                            <Badge color={diffColor[q.complexity] || '#6c757d'} text={q.complexity} />
                                                            {q.disabled && <Badge color="#6c757d" text="disabled" />}
                                                            <span style={{ fontSize: '11px', color: '#aaa' }}>#{q.id}</span>
                                                            <span style={{ fontSize: '11px', color: '#888' }}>
                                                                Difficulty (auto): {String(q.complexity || '').toUpperCase()}
                                                            </span>
                                                        </div>
                                                        <div style={{ fontSize: '12px', color: '#888', marginBottom: '6px' }}>
                                                            {(() => {
                                                                const total = q.total_attempts || 0;
                                                                const correct = q.correct_attempts || 0;
                                                                const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
                                                                return `Accuracy: ${pct}% (${correct}/${total})`;
                                                            })()}
                                                        </div>
                                                        <p style={{ margin: '0 0 10px', fontWeight: '600', color: 'var(--text-color)', lineHeight: '1.4' }}>{q.text}</p>
                                                        {q.image_url && (
                                                            <img
                                                                src={q.image_url}
                                                                alt="Question"
                                                                style={{ maxWidth: '100%', maxHeight: '160px', borderRadius: '6px', border: '1px solid var(--border-color)', marginBottom: '10px' }}
                                                            />
                                                        )}
                                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
                                                            {['a','b','c','d'].map(l => {
                                                                const isCorrect = q.correct_answer?.toLowerCase() === l;
                                                                return (
                                                                    <div key={l} style={{
                                                                        padding: '4px 8px', borderRadius: '4px', fontSize: '13px',
                                                                        backgroundColor: isCorrect ? '#d4edda' : 'var(--bg-color)',
                                                                        color: isCorrect ? '#155724' : 'var(--text-color)',
                                                                        fontWeight: isCorrect ? 'bold' : 'normal'
                                                                    }}>
                                                                        {l.toUpperCase()}) {q[`option_${l}`]}{isCorrect ? ' ✓' : ''}
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flexShrink: 0 }}>
                                                        <button className="btn" style={{ fontSize: '12px', padding: '5px 10px' }} onClick={() => setEditingQ(q)}>✏️ Edit</button>
                                                        <button className="btn" onClick={() => toggleDisable(q)}
                                                            style={{ fontSize: '12px', padding: '5px 10px', backgroundColor: q.disabled ? '#28a745' : '#ffc107', color: q.disabled ? 'white' : '#333' }}>
                                                            {q.disabled ? '✅ Enable' : '🚫 Disable'}
                                                        </button>
                                                        <button className="btn" onClick={() => deleteQuestion(q.id)}
                                                            style={{ fontSize: '12px', padding: '5px 10px', backgroundColor: '#dc3545', color: 'white' }}>
                                                            🗑️ Delete
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ))}

                                    {questionPageSize !== 'ALL' && totalQuestionPages > 1 && (
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', marginTop: '14px', flexWrap: 'wrap' }}>
                                            <span style={{ fontSize: '13px', color: '#888' }}>
                                                Page {questionPage} of {totalQuestionPages}
                                            </span>
                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                <button className="btn" disabled={questionPage <= 1} onClick={() => setQuestionPage(p => Math.max(1, p - 1))}>← Previous</button>
                                                <button className="btn" disabled={questionPage >= totalQuestionPages} onClick={() => setQuestionPage(p => Math.min(totalQuestionPages, p + 1))}>Next →</button>
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </>
                    )}
                </div>
            )}

            {/* ── ADD QUESTION ───────────────────────────────────────────────── */}
            {tab === 'add' && (
                <div style={cardStyle}>
                    <h3 style={{ marginBottom: '18px' }}>➕ Add New Question</h3>
                    <QuestionForm categories={categories} onSubmit={addQuestion} />
                </div>
            )}

            {/* ── CATEGORIES ─────────────────────────────────────────────────── */}
            {tab === 'categories' && (
                <div>
                    <div style={{ ...cardStyle, marginBottom: '20px' }}>
                        <h3 style={{ marginBottom: '14px' }}>➕ New Category</h3>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <input value={newCatName} onChange={e => setNewCatName(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && addCategory()}
                                placeholder="e.g. Science, History, Sports..."
                                style={{ flex: 1, padding: '9px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--card-bg)', color: 'var(--text-color)', fontSize: '14px' }}
                            />
                            <button onClick={addCategory} className="btn btn-primary" style={{ padding: '9px 20px' }}>Add</button>
                        </div>
                    </div>

                    <h3 style={{ marginBottom: '12px' }}>Existing ({categories.length})</h3>
                    {categories.length === 0 && <p style={{ color: '#888' }}>No categories yet.</p>}
                    {categories.map(c => (
                        <div key={c.id} style={{ ...cardStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                            <div style={{ flex: 1, minWidth: '220px' }}>
                                {editingCategoryId === c.id ? (
                                    <input
                                        value={editingCategoryName}
                                        onChange={e => setEditingCategoryName(e.target.value)}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter') saveCategoryName(c);
                                            if (e.key === 'Escape') cancelRenameCategory();
                                        }}
                                        autoFocus
                                        style={{ width: '100%', maxWidth: '360px', padding: '7px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--card-bg)', color: 'var(--text-color)' }}
                                    />
                                ) : (
                                    <>
                                        <span style={{ fontWeight: 'bold', color: 'var(--text-color)' }}>{c.name}</span>
                                        {c.disabled && <span style={{ marginLeft: '8px', fontSize: '12px', color: '#6c757d', fontWeight: 'bold' }}>Disabled</span>}
                                    </>
                                )}
                            </div>
                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                {editingCategoryId === c.id ? (
                                    <>
                                        <button className="btn btn-primary" style={{ fontSize: '12px', padding: '5px 12px' }}
                                            onClick={() => saveCategoryName(c)}>
                                            Save
                                        </button>
                                        <button className="btn" style={{ fontSize: '12px', padding: '5px 12px' }}
                                            onClick={cancelRenameCategory}>
                                            Cancel
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <button className="btn" style={{ fontSize: '12px', padding: '5px 12px' }}
                                            onClick={() => { setSelCat(c); loadQuestions(c.id); setTab('questions'); }}>
                                            📚 Browse
                                        </button>
                                        <button className="btn" style={{ fontSize: '12px', padding: '5px 12px' }}
                                            onClick={() => startRenameCategory(c)}>
                                            Rename
                                        </button>
                                        <button className="btn" style={{ fontSize: '12px', padding: '5px 12px', backgroundColor: c.disabled ? '#28a745' : '#ffc107', color: c.disabled ? 'white' : '#333' }}
                                            onClick={() => toggleCategoryDisabled(c)}>
                                            {c.disabled ? '✅ Enable' : '🚫 Disable'}
                                        </button>
                                        <button className="btn" style={{ fontSize: '12px', padding: '5px 12px', backgroundColor: '#dc3545', color: 'white' }}
                                            onClick={() => deleteCategory(c)}>
                                            🗑️ Delete
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* ── REVIEW QUEUE ───────────────────────────────────────────────── */}
            {tab === 'review' && (
                <div>
                    <h3 style={{ marginBottom: '12px' }}>
                        📥 User Submissions
                        <span style={{ marginLeft: '8px', color: '#888', fontWeight: 'normal', fontSize: '14px' }}>({pending.length} pending)</span>
                    </h3>
                    {pending.length === 0 ? (
                        <p style={{ color: '#888', marginBottom: '28px' }}>No pending submissions.</p>
                    ) : pending.map(q => (
                        <div key={q.id} style={{ ...cardStyle, borderLeft: '4px solid #ffc107', marginBottom: '14px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
                                <span style={{ fontSize: '12px', color: '#888' }}>
                                    From <strong>{q.submitted_by_email || 'anonymous'}</strong> · {new Date(q.submitted_at).toLocaleDateString()}
                                </span>
                                <div style={{ display: 'flex', gap: '6px' }}>
                                    {q.submitted_via === 'discord_bot' && <Badge color="#5865F2" text="Discord Bot" />}
                                    <Badge color="#6c757d" text={q.category_name} />
                                    <Badge color={diffColor[q.complexity] || '#6c757d'} text={q.complexity} />
                                </div>
                            </div>
                            {Array.isArray(q.duplicate_matches) && q.duplicate_matches.length > 0 && (
                                <div style={{ marginBottom: '10px', padding: '10px', borderRadius: '8px', backgroundColor: '#fff3cd', color: '#856404', border: '1px solid #ffe69c' }}>
                                    <div style={{ fontWeight: 'bold', marginBottom: '6px' }}>Possible duplicates</div>
                                    <div style={{ display: 'grid', gap: '6px' }}>
                                        {q.duplicate_matches.map((match) => (
                                            <div key={`${match.kind}-${match.id}`} style={{ fontSize: '12px' }}>
                                                <strong>{match.kind === 'existing' ? 'Existing' : 'Pending'} #{match.id}</strong>
                                                {' · '}
                                                {match.category_name || 'Uncategorized'}
                                                {' · '}
                                                {Math.round((match.similarity || 0) * 100)}% similar
                                                <div style={{ color: '#6c757d', marginTop: '2px' }}>{match.text}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            <p style={{ fontWeight: '600', color: 'var(--text-color)', margin: '0 0 10px' }}>{q.text}</p>
                            {q.image_url && (
                                <img
                                    src={q.image_url}
                                    alt="Question"
                                    style={{ maxWidth: '100%', maxHeight: '160px', borderRadius: '6px', border: '1px solid var(--border-color)', marginBottom: '10px' }}
                                />
                            )}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', marginBottom: '14px' }}>
                                {['a','b','c','d'].map(l => {
                                    const isCorrect = q.correct_answer?.toLowerCase() === l;
                                    return (
                                        <div key={l} style={{
                                            padding: '4px 8px', borderRadius: '4px', fontSize: '13px',
                                            backgroundColor: isCorrect ? '#d4edda' : 'var(--bg-color)',
                                            color: isCorrect ? '#155724' : 'var(--text-color)',
                                            fontWeight: isCorrect ? 'bold' : 'normal'
                                        }}>
                                            {l.toUpperCase()}) {q[`option_${l}`]}{isCorrect ? ' ✓' : ''}
                                        </div>
                                    );
                                })}
                            </div>
                            <div style={{ display: 'flex', gap: '10px' }}>
                                <button className="btn" onClick={() => approvePending(q.id)}
                                    style={{ flex: 1, backgroundColor: '#28a745', color: 'white', padding: '8px' }}>
                                    ✅ Approve & Add
                                </button>
                                <button className="btn" onClick={() => denyPending(q.id)}
                                    style={{ flex: 1, backgroundColor: '#dc3545', color: 'white', padding: '8px' }}>
                                    ❌ Deny
                                </button>
                            </div>
                        </div>
                    ))}

                    <h3 style={{ margin: '28px 0 12px' }}>
                        🚩 Reported Questions
                        <span style={{ marginLeft: '8px', color: '#888', fontWeight: 'normal', fontSize: '14px' }}>({reported.length} reports)</span>
                    </h3>
                    {reported.length === 0 ? (
                        <p style={{ color: '#888' }}>No reported questions.</p>
                    ) : reported.map(r => (
                        <div key={r.report_id} style={{ ...cardStyle, borderLeft: '4px solid #dc3545', marginBottom: '14px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
                                <span style={{ fontSize: '12px', color: '#888' }}>
                                    Q#{r.id} · reported {new Date(r.reported_at).toLocaleDateString()}
                                </span>
                                <div style={{ display: 'flex', gap: '6px' }}>
                                    <Badge color="#6c757d" text={r.category_name} />
                                    <Badge color={diffColor[r.complexity] || '#6c757d'} text={r.complexity} />
                                    {r.disabled && <Badge color="#6c757d" text="already disabled" />}
                                </div>
                            </div>
                            {r.reason && (
                                <p style={{ fontSize: '13px', color: '#dc3545', fontStyle: 'italic', margin: '0 0 8px' }}>
                                    Reason: "{r.reason}"
                                </p>
                            )}
                            <p style={{ fontWeight: '600', color: 'var(--text-color)', margin: '0 0 10px' }}>{r.text}</p>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', marginBottom: '14px' }}>
                                {['a','b','c','d'].map(l => {
                                    const isCorrect = r.correct_answer?.toLowerCase() === l;
                                    return (
                                        <div key={l} style={{
                                            padding: '4px 8px', borderRadius: '4px', fontSize: '13px',
                                            backgroundColor: isCorrect ? '#d4edda' : 'var(--bg-color)',
                                            color: isCorrect ? '#155724' : 'var(--text-color)',
                                            fontWeight: isCorrect ? 'bold' : 'normal'
                                        }}>
                                            {l.toUpperCase()}) {r[`option_${l}`]}{isCorrect ? ' ✓' : ''}
                                        </div>
                                    );
                                })}
                            </div>
                            <div style={{ display: 'flex', gap: '10px' }}>
                                <button className="btn" onClick={() => dismissReport(r.report_id)}
                                    style={{ flex: 1, backgroundColor: '#ffc107', color: '#333', padding: '8px' }}>
                                    👍 Dismiss
                                </button>
                                <button className="btn" onClick={() => disableFromReport(r.id, r.report_id)}
                                    style={{ flex: 1, backgroundColor: '#dc3545', color: 'white', padding: '8px' }}
                                    disabled={r.disabled}>
                                    🚫 Disable Question
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* ── USERS ──────────────────────────────────────────────────────── */}
            {tab === 'users' && (
                <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
                        <h3 style={{ margin: 0 }}>
                            👥 Registered Users
                            <span style={{ marginLeft: '8px', color: '#888', fontWeight: 'normal', fontSize: '14px' }}>({realUsers.length} users)</span>
                        </h3>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <label style={{ fontSize: '13px', color: '#888', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}>
                                <input type="checkbox" checked={showAnon} onChange={e => setShowAnon(e.target.checked)} />
                                Show anonymous ({anonUsers.length})
                            </label>
                            <button className="btn" onClick={loadUsers} style={{ fontSize: '12px', padding: '5px 12px' }}>🔄 Refresh</button>
                        </div>
                    </div>

                    <div style={{ ...cardStyle, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px', marginBottom: '16px' }}>
                        <input
                            value={userSearch}
                            onChange={e => setUserSearch(e.target.value)}
                            placeholder="Search email, display, Discord..."
                            style={{ padding: '9px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--card-bg)', color: 'var(--text-color)' }}
                        />
                        <select value={userRoleFilter} onChange={e => setUserRoleFilter(e.target.value)} style={{ padding: '9px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--card-bg)', color: 'var(--text-color)' }}>
                            <option value="all">All roles</option>
                            <option value="player">Players</option>
                            <option value="admin">Admins</option>
                        </select>
                        <select value={userStatusFilter} onChange={e => setUserStatusFilter(e.target.value)} style={{ padding: '9px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--card-bg)', color: 'var(--text-color)' }}>
                            <option value="all">All statuses</option>
                            <option value="active">Active only</option>
                            <option value="blocked">Blocked only</option>
                        </select>
                    </div>

                    {usersLoading ? (
                        <p style={{ color: '#888' }}>Loading users...</p>
                    ) : (
                        <div>
                            {/* Registered users table */}
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                            <thead>
                                <tr style={{ borderBottom: '2px solid var(--border-color)', textAlign: 'left' }}>
                                    <th style={{ padding: '10px 8px', color: 'var(--text-color)' }}>User</th>
                                    <th style={{ padding: '10px 8px', color: 'var(--text-color)' }}>Role</th>
                                    <th style={{ padding: '10px 8px', color: 'var(--text-color)' }}>Score</th>
                                    <th style={{ padding: '10px 8px', color: 'var(--text-color)' }}>Games</th>
                                    <th style={{ padding: '10px 8px', color: 'var(--text-color)' }}>Correct</th>
                                    <th style={{ padding: '10px 8px', color: 'var(--text-color)' }}>Status</th>
                                    <th style={{ padding: '10px 8px', color: 'var(--text-color)' }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {realUsers.length === 0 && (
                                    <tr><td colSpan="7" style={{ padding: '20px', textAlign: 'center', color: '#888' }}>No users yet.</td></tr>
                                )}
                                {realUsers.map(u => (
                                    (() => {
                                        const blockedUntil = u.blocked_until ? new Date(u.blocked_until) : null;
                                        const isBlocked = blockedUntil && blockedUntil > new Date();
                                        return (
                                            <tr key={u.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                <td style={{ padding: '10px 8px' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        <img
                                                            src={getUserAvatarUrl(u, 48)}
                                                            alt={u.display_name || u.email}
                                                            width={24}
                                                            height={24}
                                                            style={{ borderRadius: '50%', border: '1px solid var(--border-color)' }}
                                                        />
                                                        <span style={{ fontWeight: 'bold', color: 'var(--text-color)' }}>{u.email.split('@')[0]}</span>
                                                    </div>
                                                    <div style={{ fontSize: '11px', color: '#888' }}>{u.email}</div>
                                                </td>
                                                <td style={{ padding: '10px 8px' }}>
                                                    <Badge
                                                        color={u.role === 'admin' ? '#ff9800' : '#28a745'}
                                                        text={u.role}
                                                    />
                                                </td>
                                                <td style={{ padding: '10px 8px', fontWeight: 'bold', color: 'var(--btn-primary)' }}>{u.score}</td>
                                                <td style={{ padding: '10px 8px', color: 'var(--text-color)' }}>{u.games_played}</td>
                                                <td style={{ padding: '10px 8px', color: 'var(--text-color)' }}>
                                                    {u.games_played > 0
                                                        ? `${u.correct_answers} (${Math.round(u.correct_answers / u.games_played * 100)}%)`
                                                        : '-'}
                                                </td>
                                                <td style={{ padding: '10px 8px' }}>
                                                    {isBlocked ? (
                                                        <span style={{ color: '#dc3545', fontWeight: 'bold', fontSize: '12px' }}>
                                                            Blocked{blockedUntil && blockedUntil.getFullYear() < 9999 ? ` until ${blockedUntil.toLocaleString()}` : ' (forever)'}
                                                        </span>
                                                    ) : (
                                                        <span style={{ color: '#28a745', fontWeight: 'bold', fontSize: '12px' }}>Active</span>
                                                    )}
                                                </td>
                                                <td style={{ padding: '10px 8px' }}>
                                                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                                        <button
                                                            className="btn"
                                                            style={{ fontSize: '12px', padding: '4px 10px' }}
                                                            onClick={() => setResetTarget(u)}
                                                        >
                                                            🔑 Reset PW
                                                        </button>
                                                        <button
                                                            className="btn"
                                                            style={{ fontSize: '12px', padding: '4px 10px', backgroundColor: u.role === 'admin' ? '#6c757d' : '#ff9800', color: 'white' }}
                                                            onClick={() => changeRole(u.id, u.role === 'admin' ? 'player' : 'admin')}
                                                        >
                                                            {u.role === 'admin' ? '↓ Player' : '↑ Admin'}
                                                        </button>
                                                        {isBlocked ? (
                                                            <button
                                                                className="btn"
                                                                style={{ fontSize: '12px', padding: '4px 10px', backgroundColor: '#28a745', color: 'white' }}
                                                                onClick={() => unblockUser(u.id)}
                                                            >
                                                                ✅ Unblock
                                                            </button>
                                                        ) : (
                                                            <button
                                                                className="btn"
                                                                style={{ fontSize: '12px', padding: '4px 10px', backgroundColor: '#dc3545', color: 'white' }}
                                                                onClick={() => blockUser(u.id)}
                                                            >
                                                                🚫 Block
                                                            </button>
                                                        )}
                                                        <button
                                                            className="btn"
                                                            style={{ fontSize: '12px', padding: '4px 10px', backgroundColor: '#6c757d', color: 'white' }}
                                                            onClick={() => clearLeaderboard(u.id)}
                                                        >
                                                            🏆 Clear LB
                                                        </button>
                                                        <button
                                                            className="btn"
                                                            style={{ fontSize: '12px', padding: '4px 10px', backgroundColor: '#dc3545', color: 'white' }}
                                                            onClick={() => deleteUserAccount(u.id)}
                                                        >
                                                            🗑️ Delete
                                                        </button>
                                                        <button
                                                            className="btn"
                                                            style={{ fontSize: '12px', padding: '4px 10px', backgroundColor: '#ff9800', color: 'white' }}
                                                            onClick={() => blockFromServer(u.id)}
                                                        >
                                                            🛡️ Block Server
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })()
                                ))}
                            </tbody>
                        </table>
                    </div>

                            {/* Anonymous users section */}
                            {showAnon && anonUsers.length > 0 && (
                                <div style={{ marginTop: '24px' }}>
                                    <h4 style={{ color: '#888', marginBottom: '10px', fontWeight: 'normal' }}>
                                        👤 Anonymous Sessions ({anonUsers.length}) - excluded from leaderboard
                                    </h4>
                                    <div style={{ overflowX: 'auto' }}>
                                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', opacity: 0.75 }}>
                                            <thead>
                                                <tr style={{ borderBottom: '1px solid var(--border-color)', textAlign: 'left' }}>
                                                    <th style={{ padding: '8px', color: '#888' }}>ID</th>
                                                    <th style={{ padding: '8px', color: '#888' }}>Score</th>
                                                    <th style={{ padding: '8px', color: '#888' }}>Games</th>
                                                    <th style={{ padding: '8px', color: '#888' }}>Correct</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {anonUsers.map(u => (
                                                    <tr key={u.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                        <td style={{ padding: '8px', color: '#888' }}>anon#{u.id}</td>
                                                        <td style={{ padding: '8px', color: '#888' }}>{u.score}</td>
                                                        <td style={{ padding: '8px', color: '#888' }}>{u.games_played}</td>
                                                        <td style={{ padding: '8px', color: '#888' }}>
                                                            {u.games_played > 0
                                                                ? `${u.correct_answers} (${Math.round(u.correct_answers / u.games_played * 100)}%)`
                                                                : '-'}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* ── AUDIT LOG ──────────────────────────────────────────────────── */}
            {tab === 'audit' && (
                <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                        <h3 style={{ margin: 0 }}>📜 Admin Audit Log</h3>
                        <button className="btn" onClick={loadAuditLog} style={{ fontSize: '12px', padding: '5px 12px' }}>🔄 Refresh</button>
                    </div>
                    {auditLoading ? (
                        <p style={{ color: '#888' }}>Loading...</p>
                    ) : auditLog.length === 0 ? (
                        <div style={{ ...cardStyle, textAlign: 'center', padding: '30px', color: '#888' }}>
                            No admin actions recorded yet.
                        </div>
                    ) : (
                        <div>
                            {auditLog.map(entry => (
                                <div key={entry.id} style={{ ...cardStyle, display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                                    <div style={{
                                        width: '36px', height: '36px', borderRadius: '50%', flexShrink: 0,
                                        backgroundColor: '#e9ecef', display: 'flex', alignItems: 'center',
                                        justifyContent: 'center', fontSize: '16px'
                                    }}>
                                        {entry.action.includes('PASSWORD') ? '🔑' : entry.action.includes('ROLE') ? '👤' : '📝'}
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '4px', marginBottom: '4px' }}>
                                            <strong style={{ color: 'var(--text-color)', fontSize: '13px' }}>{entry.action}</strong>
                                            <span style={{ fontSize: '11px', color: '#aaa' }}>
                                                {new Date(entry.created_at).toLocaleString()}
                                            </span>
                                        </div>
                                        <div style={{ fontSize: '13px', color: '#666' }}>{entry.details}</div>
                                        <div style={{ fontSize: '11px', color: '#aaa', marginTop: '2px' }}>by {entry.admin_email || 'system'}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* ── DATA MANAGEMENT ─────────────────────────────────────────── */}
            {tab === 'data' && (
                <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
                        <h3 style={{ margin: 0 }}>🗄️ Data Management</h3>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            <button className="btn btn-primary" onClick={createBackup}>Create Backup</button>
                            <button className="btn" onClick={exportData} style={{ backgroundColor: '#6c757d', color: 'white' }}>Export Data</button>
                            <button className="btn" onClick={restoreUser} style={{ backgroundColor: '#ff9800', color: 'white' }}>Restore User</button>
                        </div>
                    </div>

                    <div style={{ ...cardStyle, marginBottom: '16px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '12px' }}>
                            <h4 style={{ margin: 0 }}>Discord SSO</h4>
                            {discordSso?.active ? (
                                <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#155724', backgroundColor: '#d4edda', padding: '4px 8px', borderRadius: '999px' }}>
                                    Active
                                </span>
                            ) : discordSso?.configured ? (
                                <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#856404', backgroundColor: '#fff3cd', padding: '4px 8px', borderRadius: '999px' }}>
                                    Configured but disabled
                                </span>
                            ) : (
                                <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#721c24', backgroundColor: '#f8d7da', padding: '4px 8px', borderRadius: '999px' }}>
                                    Not configured
                                </span>
                            )}
                        </div>
                        {!discordSso ? (
                            <p style={{ color: '#888' }}>Loading Discord SSO settings...</p>
                        ) : (
                            <div style={{ display: 'grid', gap: '10px' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}>
                                    <input
                                        type="checkbox"
                                        checked={!!discordSso.enabled}
                                        onChange={e => setDiscordSso({ ...discordSso, enabled: e.target.checked })}
                                    />
                                    Enable Discord login button and OAuth flow
                                </label>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                    <div>
                                        <label style={{ fontSize: '12px', color: '#888' }}>Discord Client ID</label>
                                        <input
                                            value={discordSso.client_id || ''}
                                            onChange={e => setDiscordSso({ ...discordSso, client_id: e.target.value })}
                                            placeholder="123456789012345678"
                                            style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                                        />
                                    </div>
                                    <div>
                                        <label style={{ fontSize: '12px', color: '#888' }}>Discord Client Secret</label>
                                        <input
                                            type="password"
                                            value={discordSso.client_secret || ''}
                                            onChange={e => setDiscordSso({ ...discordSso, client_secret: e.target.value })}
                                            placeholder="Paste the Discord application secret"
                                            style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label style={{ fontSize: '12px', color: '#888' }}>Redirect URI</label>
                                    <input
                                        value={discordSso.redirect_uri || ''}
                                        onChange={e => setDiscordSso({ ...discordSso, redirect_uri: e.target.value })}
                                        placeholder="http://localhost:3000/api/auth/discord/callback"
                                        style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                                    />
                                    <div style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>
                                        Leave blank to use the default callback based on `APP_URL`.
                                    </div>
                                </div>

                                <div style={{ fontSize: '12px', color: '#666', lineHeight: 1.5 }}>
                                    Current callback in use: <code>{discordSso.redirect_uri || 'http://localhost:3000/api/auth/discord/callback'}</code>
                                </div>

                                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                                    <button className="btn btn-primary" onClick={saveDiscordSsoSettings} disabled={discordSsoSaving}>
                                        {discordSsoSaving ? 'Saving...' : 'Save Discord SSO Settings'}
                                    </button>
                                    <button
                                        className="btn"
                                        onClick={loadDiscordSsoSettings}
                                        style={{ backgroundColor: '#6c757d', color: 'white' }}
                                    >
                                        Reload
                                    </button>
                                </div>

                                <details style={{ marginTop: '4px' }}>
                                    <summary style={{ cursor: 'pointer', fontWeight: 'bold' }}>Setup Instructions</summary>
                                    <div style={{ marginTop: '10px', fontSize: '13px', color: '#555', display: 'grid', gap: '8px' }}>
                                        <div>1. Open the Discord Developer Portal and create an application.</div>
                                        <div>2. Under OAuth2, copy the Client ID and generate a Client Secret.</div>
                                        <div>3. Add this redirect URI in Discord: <code>{discordSso.redirect_uri || 'http://localhost:3000/api/auth/discord/callback'}</code></div>
                                        <div>4. Save the Client ID, Client Secret, and redirect URI here.</div>
                                        <div>5. Turn on “Enable Discord login button and OAuth flow” and save again.</div>
                                        <div>6. Test sign-in from the public login modal. Discord must return a verified email address.</div>
                                    </div>
                                </details>
                            </div>
                        )}
                    </div>

                    <div style={{ ...cardStyle, marginBottom: '16px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '12px' }}>
                            <h4 style={{ margin: 0 }}>Discord Bot</h4>
                            {discordBot?.active ? (
                                <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#155724', backgroundColor: '#d4edda', padding: '4px 8px', borderRadius: '999px' }}>
                                    Active
                                </span>
                            ) : discordBot?.configured ? (
                                <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#856404', backgroundColor: '#fff3cd', padding: '4px 8px', borderRadius: '999px' }}>
                                    Configured but disabled
                                </span>
                            ) : (
                                <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#721c24', backgroundColor: '#f8d7da', padding: '4px 8px', borderRadius: '999px' }}>
                                    Not configured
                                </span>
                            )}
                        </div>
                        {!discordBot ? (
                            <p style={{ color: '#888' }}>Loading Discord bot settings...</p>
                        ) : (
                            <div style={{ display: 'grid', gap: '10px' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}>
                                    <input
                                        type="checkbox"
                                        checked={!!discordBot.enabled}
                                        onChange={e => setDiscordBot({ ...discordBot, enabled: e.target.checked })}
                                    />
                                    Enable Discord bot integration APIs
                                </label>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                    <div>
                                        <label style={{ fontSize: '12px', color: '#888' }}>Bot API Token</label>
                                        <input
                                            type="password"
                                            value={discordBot.api_token || ''}
                                            onChange={e => setDiscordBot({ ...discordBot, api_token: e.target.value })}
                                            placeholder="Shared secret used by the bot service"
                                            style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                                        />
                                    </div>
                                    <div>
                                        <label style={{ fontSize: '12px', color: '#888' }}>Bot Service URL</label>
                                        <input
                                            value={discordBot.service_url || ''}
                                            onChange={e => setDiscordBot({ ...discordBot, service_url: e.target.value })}
                                            placeholder="http://discord-bot:3002"
                                            style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label style={{ fontSize: '12px', color: '#888' }}>Public App URL</label>
                                    <input
                                        value={discordBot.public_app_url || ''}
                                        onChange={e => setDiscordBot({ ...discordBot, public_app_url: e.target.value })}
                                        placeholder="http://localhost:3000"
                                        style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                                    />
                                    <div style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>
                                        Used for account-link prompts and Discord deep links back to Open-Trivia.
                                    </div>
                                </div>

                                <div>
                                    <label style={{ fontSize: '12px', color: '#888' }}>Discord Bot Invite URL</label>
                                    <input
                                        value={discordBot.invite_url || ''}
                                        onChange={e => setDiscordBot({ ...discordBot, invite_url: e.target.value })}
                                        placeholder="https://discord.com/oauth2/authorize?client_id=1485851351366766755"
                                        style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                                    />
                                    <div style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>
                                        Link used to add the Discord bot to a server.
                                    </div>
                                </div>

                                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                                    <button className="btn btn-primary" onClick={saveDiscordBotSettings} disabled={discordBotSaving}>
                                        {discordBotSaving ? 'Saving...' : 'Save Discord Bot Settings'}
                                    </button>
                                    <button
                                        className="btn"
                                        onClick={loadDiscordBotSettings}
                                        style={{ backgroundColor: '#6c757d', color: 'white' }}
                                    >
                                        Reload
                                    </button>
                                </div>

                                <details style={{ marginTop: '4px' }}>
                                    <summary style={{ cursor: 'pointer', fontWeight: 'bold' }}>Bot Setup Instructions</summary>
                                    <div style={{ marginTop: '10px', fontSize: '13px', color: '#555', display: 'grid', gap: '8px' }}>
                                        <div>
                                            1. Invite the Discord bot application to your server with message, slash-command, and button permissions.
                                            {' '}
                                            <a href={discordBot.invite_url || 'https://discord.com/oauth2/authorize?client_id=1485851351366766755'} target="_blank" rel="noreferrer">Add bot to server</a>
                                        </div>
                                        <div>2. Set the same Bot API token here and in the bot service environment.</div>
                                        <div>3. Set the Public App URL to your Open-Trivia site so the bot can send account-link prompts.</div>
                                        <div>4. Enable Discord bot integration here, then start the bot service from the `services/open-trivia-discord` submodule.</div>
                                        <div>5. Use `/ot` for immediate questions, talk directly to the bot for solo play, and `/otschedule` to configure recurring trivia in a channel.</div>
                                    </div>
                                </details>
                            </div>
                        )}
                    </div>

                    <div style={{ ...cardStyle, marginBottom: '16px' }}>
                        <h4 style={{ marginTop: 0 }}>Import Data</h4>
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                            <input
                                type="file"
                                accept="application/json"
                                onChange={e => {
                                    const file = e.target.files?.[0];
                                    if (!file) return;
                                    const mode = window.confirm('Import mode: OK = replace, Cancel = merge') ? 'replace' : 'merge';
                                    importData(file, mode);
                                    e.target.value = '';
                                }}
                            />
                            <span style={{ fontSize: '12px', color: '#888' }}>
                                Replace will overwrite current data. Merge will upsert by ID.
                            </span>
                        </div>
                    </div>

                    <div style={{ ...cardStyle, marginBottom: '16px' }}>
                        <h4 style={{ marginTop: 0 }}>Category Packs (CSV + Images)</h4>
                        <div style={{ fontSize: '12px', color: '#888', marginBottom: '10px' }}>
                            You can share packs via GitHub. Browse collections at <a href="https://questions.trivia.gamedirection.net" target="_blank" rel="noreferrer">questions.trivia.gamedirection.net</a>.
                            Template repo: <a href="https://github.com/Gamedirection/Open-Trivia-Questions.git" target="_blank" rel="noreferrer">Open-Trivia-Questions</a>.
                            Upload a CSV directly when there are no images, or use a zip when bundling images or multiple CSV files.
                        </div>
                        <div style={{ display: 'grid', gap: '10px' }}>
                            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                                <button className="btn btn-primary" onClick={exportCategoryPacks} disabled={exportingCats}>
                                    {exportingCats ? 'Exporting...' : 'Export Selected Categories'}
                                </button>
                                <button
                                    className="btn"
                                    onClick={async () => {
                                        try {
                                            const r = await axios.get(`${API_URL}/admin/categories/template-zip`, { ...authCfg(), responseType: 'arraybuffer' });
                                            const blob = new Blob([r.data], { type: 'application/zip' });
                                            const url = URL.createObjectURL(blob);
                                            const a = document.createElement('a');
                                            a.href = url;
                                            a.download = 'category_pack_template.zip';
                                            a.click();
                                            URL.revokeObjectURL(url);
                                        } catch (e) { flash('❌ Template download failed'); }
                                    }}
                                    style={{ backgroundColor: '#6c757d', color: 'white' }}
                                >
                                    Download Template
                                </button>
                                <label style={{ fontSize: '12px', color: '#666', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <input
                                        type="checkbox"
                                        checked={categoryExportIds.length === categories.length && categories.length > 0}
                                        onChange={e => setCategoryExportIds(e.target.checked ? categories.map(c => c.id) : [])}
                                    />
                                    Select all
                                </label>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '8px' }}>
                                {categories.map(c => (
                                    <label key={c.id} style={{ fontSize: '12px', color: '#444', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <input
                                            type="checkbox"
                                            checked={categoryExportIds.includes(c.id)}
                                            onChange={e => {
                                                setCategoryExportIds(prev =>
                                                    e.target.checked ? [...prev, c.id] : prev.filter(id => id !== c.id)
                                                );
                                            }}
                                        />
                                        {c.name}
                                    </label>
                                ))}
                            </div>

                            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                                <input
                                    type="file"
                                    accept=".zip,.csv,application/zip,text/csv"
                                    onChange={e => {
                                        const file = e.target.files?.[0];
                                        if (!file) return;
                                        importCategoryPack(file);
                                        e.target.value = '';
                                    }}
                                />
                                {importingCats && <span style={{ fontSize: '12px', color: '#888' }}>Importing...</span>}
                            </div>

                            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                                <input
                                    value={githubRepoUrl}
                                    onChange={e => setGithubRepoUrl(e.target.value)}
                                    placeholder="GitHub repo, zip URL, CSV URL, or Google Sheets share URL"
                                    style={{ flex: 1, minWidth: '220px', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                                />
                                <button className="btn" onClick={importFromGithub} disabled={importingCats || !githubRepoUrl.trim()}>
                                    Import from URL
                                </button>
                            </div>
                        </div>
                    </div>

                    <div style={{ ...cardStyle }}>
                        <h4 style={{ marginTop: 0 }}>Backups</h4>
                        {backupLoading ? (
                            <p style={{ color: '#888' }}>Loading backups...</p>
                        ) : backups.length === 0 ? (
                            <p style={{ color: '#888' }}>No backups yet.</p>
                        ) : (
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                                    <thead>
                                        <tr style={{ borderBottom: '1px solid var(--border-color)', textAlign: 'left' }}>
                                            <th style={{ padding: '8px' }}>ID</th>
                                            <th style={{ padding: '8px' }}>Created</th>
                                            <th style={{ padding: '8px' }}>Note</th>
                                            <th style={{ padding: '8px' }}>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {backups.map(b => (
                                            <tr key={b.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                <td style={{ padding: '8px' }}>{b.id}</td>
                                                <td style={{ padding: '8px' }}>{new Date(b.created_at).toLocaleString()}</td>
                                                <td style={{ padding: '8px' }}>{b.note || '-'}</td>
                                                <td style={{ padding: '8px' }}>
                                                    <button
                                                        className="btn"
                                                        style={{ padding: '4px 10px', fontSize: '12px' }}
                                                        onClick={async () => {
                                                            try {
                                                                const r = await axios.get(`${API_URL}/admin/backup/${b.id}`, authCfg());
                                                                const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: 'application/json' });
                                                                const url = URL.createObjectURL(blob);
                                                                const a = document.createElement('a');
                                                                a.href = url;
                                                                a.download = `open-trivia-backup-${b.id}.json`;
                                                                a.click();
                                                                URL.revokeObjectURL(url);
                                                            } catch (e) { flash('❌ Download failed'); }
                                                        }}
                                                    >
                                                        Download
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ── LEADERBOARD ───────────────────────────────────────────────── */}    
            {tab === 'leaderboard' && (
                <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
                        <h3 style={{ margin: 0 }}>🏆 Leaderboard Resets</h3>
                        <button className="btn" onClick={resetLeaderboardNow} style={{ fontSize: '12px', padding: '6px 12px', backgroundColor: '#dc3545', color: 'white' }}>
                            Reset Now
                        </button>
                    </div>

                    <div style={{ ...cardStyle }}>
                        <h4 style={{ marginTop: 0 }}>Scheduled Resets</h4>
                        {lbLoading ? (
                            <p style={{ color: '#888' }}>Loading schedule...</p>
                        ) : (
                            <div style={{ display: 'grid', gap: '8px' }}>
                                {['daily', 'weekly', 'monthly', 'yearly'].map(period => {
                                    const row = lbSchedule.find(r => r.period === period);
                                    const enabled = row?.enabled;
                                    return (
                                        <div key={period} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <div>
                                                <strong style={{ textTransform: 'capitalize' }}>{period}</strong>
                                                <div style={{ fontSize: '12px', color: '#888' }}>
                                                    Next run: {row?.next_run ? new Date(row.next_run).toLocaleString() : '-'}
                                                </div>
                                            </div>
                                            <button
                                                className="btn"
                                                onClick={() => setSchedule(period, !enabled)}
                                                style={{ fontSize: '12px', padding: '6px 12px', backgroundColor: enabled ? '#6c757d' : '#28a745', color: 'white' }}
                                            >
                                                {enabled ? 'Disable' : 'Enable'}
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    <div style={{ ...cardStyle, marginTop: '16px' }}>
                        <h4 style={{ marginTop: 0 }}>Privacy Settings</h4>
                        {!privacy ? (
                            <p style={{ color: '#888' }}>Loading settings...</p>
                        ) : (
                            <div style={{ display: 'grid', gap: '10px' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}>
                                    <input
                                        type="checkbox"
                                        checked={!!privacy.hide_emails_globally}
                                        onChange={e => setPrivacy({ ...privacy, hide_emails_globally: e.target.checked })}
                                    />
                                    Hide all emails on the leaderboard (global override)
                                </label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}>
                                    <input
                                        type="checkbox"
                                        checked={!!privacy.hide_emails_by_default}
                                        onChange={e => setPrivacy({ ...privacy, hide_emails_by_default: e.target.checked })}
                                    />
                                    Hide emails by default for new users (users can opt in)
                                </label>
                                <div style={{ display: 'flex', gap: '10px' }}>
                                    <button className="btn btn-primary" onClick={savePrivacySettings} disabled={privacySaving}>
                                        {privacySaving ? 'Saving...' : 'Save Privacy Settings'}
                                    </button>
                                    <button
                                        className="btn"
                                        onClick={loadPrivacySettings}
                                        style={{ backgroundColor: '#6c757d', color: 'white' }}
                                    >
                                        Reload
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    <div style={{ ...cardStyle, marginTop: '16px' }}>
                        <h4 style={{ marginTop: 0 }}>Report & Suggestion Rate Limits</h4>
                        {!rateLimits ? (
                            <p style={{ color: '#888' }}>Loading settings...</p>
                        ) : (
                            <div style={{ display: 'grid', gap: '10px' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                    <div>
                                        <label style={{ fontSize: '12px', color: '#888' }}>Guest Min Interval (ms)</label>
                                        <input
                                            type="number"
                                            value={rateLimits.guest_min_interval_ms}
                                            onChange={e => setRateLimits({ ...rateLimits, guest_min_interval_ms: e.target.value })}
                                            style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                                        />
                                        <div style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>
                                            0 disables guest limits
                                        </div>
                                    </div>
                                    <div>
                                        <label style={{ fontSize: '12px', color: '#888' }}>User Burst Window (ms)</label>
                                        <input
                                            type="number"
                                            value={rateLimits.user_burst_window_ms}
                                            onChange={e => setRateLimits({ ...rateLimits, user_burst_window_ms: e.target.value })}
                                            style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                                        />
                                    </div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                    <div>
                                        <label style={{ fontSize: '12px', color: '#888' }}>User Burst Max</label>
                                        <input
                                            type="number"
                                            value={rateLimits.user_burst_max}
                                            onChange={e => setRateLimits({ ...rateLimits, user_burst_max: e.target.value })}
                                            style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                                        />
                                        <div style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>
                                            0 disables user limits
                                        </div>
                                    </div>
                                    <div>
                                        <label style={{ fontSize: '12px', color: '#888' }}>User Cooldown (ms)</label>
                                        <input
                                            type="number"
                                            value={rateLimits.user_cooldown_ms}
                                            onChange={e => setRateLimits({ ...rateLimits, user_cooldown_ms: e.target.value })}
                                            style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                                        />
                                    </div>
                                </div>
                                <div style={{ borderTop: '1px dashed var(--border-color)', paddingTop: '10px', marginTop: '4px' }}>
                                    <h5 style={{ margin: '0 0 8px 0' }}>Gameplay Controls</h5>
                                    <div style={{ display: 'grid', gap: '10px' }}>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}>
                                            <input
                                                type="checkbox"
                                                checked={rateLimits.open_trivia_db_enabled !== false}
                                                onChange={e => setRateLimits({ ...rateLimits, open_trivia_db_enabled: e.target.checked })}
                                            />
                                            Enable OpenTriviaDB category in the game
                                        </label>
                                        <div>
                                            <label style={{ fontSize: '12px', color: '#888' }}>Skips Per Hour (per user/session)</label>
                                            <input
                                                type="number"
                                                min="0"
                                                value={rateLimits.skip_per_hour ?? 3}
                                                onChange={e => setRateLimits({ ...rateLimits, skip_per_hour: e.target.value })}
                                                style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                                            />
                                            <div style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>
                                                Set to 0 to disable skip.
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: '10px' }}>
                                    <button className="btn btn-primary" onClick={saveRateLimitSettings} disabled={rateLimitsSaving}>
                                        {rateLimitsSaving ? 'Saving...' : 'Save Rate Limits'}
                                    </button>
                                    <button
                                        className="btn"
                                        onClick={loadRateLimitSettings}
                                        style={{ backgroundColor: '#6c757d', color: 'white' }}
                                    >
                                        Reload
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    <div style={{ ...cardStyle, marginTop: '16px' }}>
                        <h4 style={{ marginTop: 0 }}>Question Image Limits</h4>
                        {!imageSettings ? (
                            <p style={{ color: '#888' }}>Loading settings...</p>
                        ) : (
                            <div style={{ display: 'grid', gap: '10px' }}>
                                <div>
                                    <label style={{ fontSize: '12px', color: '#888' }}>Max Image Size (KB)</label>
                                    <input
                                        type="number"
                                        value={imageSettings.max_image_kb}
                                        onChange={e => setImageSettings({ ...imageSettings, max_image_kb: e.target.value })}
                                        style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                                    />
                                    <div style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>
                                        0 disables the size limit. Only png, jpg, jpeg, svg, webp, gif are accepted.
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: '10px' }}>
                                    <button className="btn btn-primary" onClick={saveImageSettings} disabled={imageSettingsSaving}>
                                        {imageSettingsSaving ? 'Saving...' : 'Save Image Settings'}
                                    </button>
                                    <button
                                        className="btn"
                                        onClick={loadImageSettings}
                                        style={{ backgroundColor: '#6c757d', color: 'white' }}
                                    >
                                        Reload
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    <div style={{ ...cardStyle, marginTop: '16px' }}>
                        <h4 style={{ marginTop: 0 }}>Scoring Settings (Defaults)</h4>
                        {!scoring ? (
                            <p style={{ color: '#888' }}>Loading settings...</p>
                        ) : (
                            <div style={{ display: 'grid', gap: '10px' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                                    <div>
                                        <label style={{ fontSize: '12px', color: '#888' }}>Min Points</label>
                                        <input
                                            type="number"
                                            value={scoring.min_points}
                                            onChange={e => setScoring({ ...scoring, min_points: e.target.value })}
                                            style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                                        />
                                    </div>
                                    <div>
                                        <label style={{ fontSize: '12px', color: '#888' }}>Easy Max</label>
                                        <input
                                            type="number"
                                            value={scoring.max_easy}
                                            onChange={e => setScoring({ ...scoring, max_easy: e.target.value })}
                                            style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                                        />
                                    </div>
                                    <div>
                                        <label style={{ fontSize: '12px', color: '#888' }}>Medium Max</label>
                                        <input
                                            type="number"
                                            value={scoring.max_med}
                                            onChange={e => setScoring({ ...scoring, max_med: e.target.value })}
                                            style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                                        />
                                    </div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                                    <div>
                                        <label style={{ fontSize: '12px', color: '#888' }}>Hard Max</label>
                                        <input
                                            type="number"
                                            value={scoring.max_hard}
                                            onChange={e => setScoring({ ...scoring, max_hard: e.target.value })}
                                            style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                                        />
                                    </div>
                                    <div>
                                        <label style={{ fontSize: '12px', color: '#888' }}>Discord Easy</label>
                                        <input
                                            type="number"
                                            value={scoring.discord_easy}
                                            onChange={e => setScoring({ ...scoring, discord_easy: e.target.value })}
                                            style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                                        />
                                    </div>
                                    <div>
                                        <label style={{ fontSize: '12px', color: '#888' }}>Discord Medium</label>
                                        <input
                                            type="number"
                                            value={scoring.discord_med}
                                            onChange={e => setScoring({ ...scoring, discord_med: e.target.value })}
                                            style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                                        />
                                    </div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                                    <div>
                                        <label style={{ fontSize: '12px', color: '#888' }}>Discord Hard</label>
                                        <input
                                            type="number"
                                            value={scoring.discord_hard}
                                            onChange={e => setScoring({ ...scoring, discord_hard: e.target.value })}
                                            style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                                        />
                                    </div>
                                    <div>
                                        <label style={{ fontSize: '12px', color: '#888' }}>Fast Time (ms)</label>
                                        <input
                                            type="number"
                                            value={scoring.fast_ms}
                                            onChange={e => setScoring({ ...scoring, fast_ms: e.target.value })}
                                            style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                                        />
                                    </div>
                                    <div>
                                        <label style={{ fontSize: '12px', color: '#888' }}>Slow Time (ms)</label>
                                        <input
                                            type="number"
                                            value={scoring.slow_ms}
                                            onChange={e => setScoring({ ...scoring, slow_ms: e.target.value })}
                                            style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                                        />
                                    </div>
                                </div>
                                <div style={{ fontSize: '12px', color: '#666', lineHeight: 1.5 }}>
                                    Discord scores are fixed values with no time bonus. Defaults: Easy +5, Medium +10, Hard +15.
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                                    <div>
                                        <label style={{ fontSize: '12px', color: '#888' }}>Min Attempts</label>
                                        <input
                                            type="number"
                                            value={scoring.diff_min_attempts}
                                            onChange={e => setScoring({ ...scoring, diff_min_attempts: e.target.value })}
                                            style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                                        />
                                    </div>
                                    <div>
                                        <label style={{ fontSize: '12px', color: '#888' }}>Up Threshold</label>
                                        <input
                                            type="number"
                                            step="0.01"
                                            value={scoring.diff_up_threshold}
                                            onChange={e => setScoring({ ...scoring, diff_up_threshold: e.target.value })}
                                            style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                                        />
                                    </div>
                                    <div>
                                        <label style={{ fontSize: '12px', color: '#888' }}>Down Threshold</label>
                                        <input
                                            type="number"
                                            step="0.01"
                                            value={scoring.diff_down_threshold}
                                            onChange={e => setScoring({ ...scoring, diff_down_threshold: e.target.value })}
                                            style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                                        />
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: '10px' }}>
                                    <button className="btn btn-primary" onClick={saveScoringSettings} disabled={scoringSaving}>
                                        {scoringSaving ? 'Saving...' : 'Save Scoring Settings'}
                                    </button>
                                    <button
                                        className="btn"
                                        onClick={loadScoringSettings}
                                        style={{ backgroundColor: '#6c757d', color: 'white' }}
                                    >
                                        Reload Defaults
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ── SHAREPLAY ─────────────────────────────────────────────────── */}
            {tab === 'shareplay' && (
                <div>
                    <h3 style={{ marginBottom: '12px' }}>⚠️ Kick Warnings</h3>
                    <div style={{ ...cardStyle, marginBottom: '20px' }}>
                        <input
                            value={kickWarningFilter}
                            onChange={e => setKickWarningFilter(e.target.value)}
                            placeholder="Filter by email or name..."
                            style={{ width: '100%', padding: '9px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--card-bg)', color: 'var(--text-color)', marginBottom: '12px' }}
                        />
                        {shareplayLoading ? (
                            <p style={{ color: '#888' }}>Loading...</p>
                        ) : (
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                                    <thead>
                                        <tr style={{ borderBottom: '2px solid var(--border-color)', textAlign: 'left' }}>
                                            <th style={{ padding: '10px 8px', color: 'var(--text-color)' }}>User</th>
                                            <th style={{ padding: '10px 8px', color: 'var(--text-color)' }}>Display Name</th>
                                            <th style={{ padding: '10px 8px', color: 'var(--text-color)' }}>Strikes</th>
                                            <th style={{ padding: '10px 8px', color: 'var(--text-color)' }}>Last Kick</th>
                                            <th style={{ padding: '10px 8px', color: 'var(--text-color)' }}>Total Kicks</th>
                                            <th style={{ padding: '10px 8px', color: 'var(--text-color)' }}>Banned</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {kickWarnings
                                            .filter(w => {
                                                if (!kickWarningFilter) return true;
                                                const search = kickWarningFilter.toLowerCase();
                                                return (w.email || '').toLowerCase().includes(search) || (w.display_name || '').toLowerCase().includes(search);
                                            })
                                            .map(w => (
                                                <React.Fragment key={w.user_id}>
                                                    <tr
                                                        style={{ borderBottom: '1px solid var(--border-color)', cursor: 'pointer' }}
                                                        onClick={() => setExpandedKickUser(expandedKickUser === w.user_id ? null : w.user_id)}
                                                    >
                                                        <td style={{ padding: '10px 8px' }}>{w.email}</td>
                                                        <td style={{ padding: '10px 8px' }}>{w.display_name || '-'}</td>
                                                        <td style={{ padding: '10px 8px' }}>
                                                            <span style={{
                                                                color: w.strike_count === 1 ? '#28a745' : w.strike_count === 2 ? '#ffc107' : '#dc3545',
                                                                fontWeight: 'bold'
                                                            }}>{w.strike_count}</span>
                                                        </td>
                                                        <td style={{ padding: '10px 8px', fontSize: '12px', color: '#888' }}>
                                                            {w.last_kick_date ? new Date(w.last_kick_date).toLocaleString() : '-'}
                                                        </td>
                                                        <td style={{ padding: '10px 8px' }}>{w.total_kicks}</td>
                                                        <td style={{ padding: '10px 8px' }}>
                                                            {w.shareplay_banned ? (
                                                                <Badge color="#dc3545" text="banned" />
                                                            ) : (
                                                                <span style={{ color: '#28a745', fontSize: '12px' }}>active</span>
                                                            )}
                                                        </td>
                                                    </tr>
                                                    {expandedKickUser === w.user_id && w.kick_history && (
                                                        <tr>
                                                            <td colSpan="6" style={{ padding: '12px 16px', backgroundColor: 'var(--bg-color)' }}>
                                                                <div style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: '6px' }}>Kick History</div>
                                                                {w.kick_history.map((h, i) => (
                                                                    <div key={i} style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>
                                                                        {new Date(h.date).toLocaleString()} - {h.reason || 'No reason'}
                                                                    </div>
                                                                ))}
                                                            </td>
                                                        </tr>
                                                    )}
                                                </React.Fragment>
                                            ))
                                        }
                                        {kickWarnings.length === 0 && (
                                            <tr><td colSpan="6" style={{ padding: '20px', textAlign: 'center', color: '#888' }}>No kick warnings.</td></tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>

                    <h3 style={{ marginBottom: '12px' }}>🚫 SharePlay Bans</h3>
                    <div style={{ ...cardStyle, marginBottom: '20px' }}>
                        {shareplayLoading ? (
                            <p style={{ color: '#888' }}>Loading...</p>
                        ) : (
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                                    <thead>
                                        <tr style={{ borderBottom: '2px solid var(--border-color)', textAlign: 'left' }}>
                                            <th style={{ padding: '10px 8px', color: 'var(--text-color)' }}>User</th>
                                            <th style={{ padding: '10px 8px', color: 'var(--text-color)' }}>Display Name</th>
                                            <th style={{ padding: '10px 8px', color: 'var(--text-color)' }}>Ban Type</th>
                                            <th style={{ padding: '10px 8px', color: 'var(--text-color)' }}>Reason</th>
                                            <th style={{ padding: '10px 8px', color: 'var(--text-color)' }}>Banned Until</th>
                                            <th style={{ padding: '10px 8px', color: 'var(--text-color)' }}>Banned By</th>
                                            <th style={{ padding: '10px 8px', color: 'var(--text-color)' }}>Created</th>
                                            <th style={{ padding: '10px 8px', color: 'var(--text-color)' }}>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {shareplayBans.length === 0 && (
                                            <tr><td colSpan="8" style={{ padding: '20px', textAlign: 'center', color: '#888' }}>No active bans.</td></tr>
                                        )}
                                        {shareplayBans.map(b => (
                                            <tr key={b.user_id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                <td style={{ padding: '10px 8px' }}>{b.email}</td>
                                                <td style={{ padding: '10px 8px' }}>{b.display_name || '-'}</td>
                                                <td style={{ padding: '10px 8px' }}><Badge color={b.ban_type === 'permanent' ? '#dc3545' : '#ffc107'} text={b.ban_type} /></td>
                                                <td style={{ padding: '10px 8px', fontSize: '12px' }}>{b.reason || '-'}</td>
                                                <td style={{ padding: '10px 8px', fontSize: '12px' }}>
                                                    {b.banned_until ? new Date(b.banned_until).toLocaleString() : 'Permanent'}
                                                </td>
                                                <td style={{ padding: '10px 8px', fontSize: '12px' }}>{b.banned_by_email || '-'}</td>
                                                <td style={{ padding: '10px 8px', fontSize: '12px', color: '#888' }}>
                                                    {new Date(b.created_at).toLocaleString()}
                                                </td>
                                                <td style={{ padding: '10px 8px' }}>
                                                    <button
                                                        className="btn"
                                                        style={{ fontSize: '12px', padding: '4px 10px', backgroundColor: '#28a745', color: 'white' }}
                                                        onClick={() => {
                                                            if (window.confirm(`Unblock ${b.email} from SharePlay?`)) {
                                                                unblockShareplayUser(b.user_id);
                                                            }
                                                        }}
                                                    >
                                                        Unblock
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>

                    <h3 style={{ marginBottom: '12px' }}>📨 Pending Appeals</h3>
                    <div style={{ ...cardStyle }}>
                        {shareplayLoading ? (
                            <p style={{ color: '#888' }}>Loading...</p>
                        ) : shareplayAppeals.length === 0 ? (
                            <p style={{ color: '#888' }}>No pending appeals.</p>
                        ) : shareplayAppeals.map(a => (
                            <div key={a.id} style={{ ...cardStyle, borderLeft: `4px solid ${a.status === 'pending' ? '#ffc107' : a.status === 'approved' ? '#28a745' : '#dc3545'}`, marginBottom: '14px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
                                    <span style={{ fontSize: '12px', color: '#888' }}>
                                        <strong>{a.email}</strong> · {a.display_name || 'No display name'}
                                    </span>
                                    <Badge color={a.status === 'pending' ? '#ffc107' : a.status === 'approved' ? '#28a745' : '#dc3545'} text={a.status} />
                                </div>
                                <p style={{ fontSize: '13px', color: 'var(--text-color)', margin: '0 0 8px', fontStyle: 'italic' }}>"{a.message}"</p>
                                <div style={{ fontSize: '11px', color: '#888', marginBottom: '8px' }}>
                                    {new Date(a.created_at).toLocaleString()}
                                </div>
                                {a.status === 'pending' && (
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <button
                                            className="btn"
                                            style={{ fontSize: '12px', padding: '5px 12px', backgroundColor: '#28a745', color: 'white' }}
                                            onClick={() => resolveAppeal(a.id, 'approved')}
                                        >
                                            Approve
                                        </button>
                                        <button
                                            className="btn"
                                            style={{ fontSize: '12px', padding: '5px 12px', backgroundColor: '#dc3545', color: 'white' }}
                                            onClick={() => resolveAppeal(a.id, 'denied')}
                                        >
                                            Deny
                                        </button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Reset Password Modal */}
            {resetTarget && (
                <ResetPasswordModal
                    user={resetTarget}
                    onClose={() => setResetTarget(null)}
                    onSuccess={loadUsers}
                    flash={flash}
                />
            )}
        </div>
    );
}
