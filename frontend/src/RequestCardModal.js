import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { cachedGet } from './utils/api';

const API_URL = process.env.REACT_APP_API_URL || '/api';

export default function RequestCardModal({ onClose }) {
    const [form, setForm] = useState({
        categoryName: '', text: '',
        optionA: '', optionB: '', optionC: '', optionD: '',
        correctAnswer: 'A', complexity: 'medium',
        imageUrl: ''
    });
    const [categories, setCategories] = useState([]);
    const [categorySearch, setCategorySearch] = useState('');
    const [selectedCategoryId, setSelectedCategoryId] = useState('');
    const [customCategory, setCustomCategory] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [success, setSuccess]       = useState(false);

    const set = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }));

    const handleSubmit = async (e) => {
        e.preventDefault();
        const chosenCategory = customCategory.trim()
            ? customCategory.trim()
            : (categories.find(c => String(c.id) === String(selectedCategoryId))?.name || form.categoryName.trim());
        const { text, optionA, optionB, optionC, optionD } = form;
        if (!chosenCategory || !text.trim() || !optionA.trim() || !optionB.trim() || !optionC.trim() || !optionD.trim())
            return alert('Please fill in all fields.');

        setSubmitting(true);
        try {
            const token = localStorage.getItem('token');
            await axios.post(
                `${API_URL}/pending-questions`,
                {
                    categoryName: chosenCategory,
                    text: form.text.trim(),
                    options: { a: form.optionA, b: form.optionB, c: form.optionC, d: form.optionD },
                    correctAnswer: form.correctAnswer,
                    complexity: form.complexity,
                    imageUrl: form.imageUrl.trim() || null
                },
                token ? { headers: { Authorization: `Bearer ${token}` } } : {}
            );
            setSuccess(true);
        } catch (err) {
            alert('Submission failed: ' + (err.response?.data?.error || err.message));
        } finally {
            setSubmitting(false);
        }
    };

    const iStyle = {
        width: '100%', boxSizing: 'border-box', padding: '8px 12px',
        borderRadius: '6px', border: '1px solid var(--border-color)',
        backgroundColor: 'var(--card-bg)', color: 'var(--text-color)', fontSize: '14px'
    };

    useEffect(() => {
        const loadCategories = async () => {
            try {
                const res = await cachedGet(axios, `${API_URL}/categories`, {}, 30000);
                setCategories(res.data || []);
            } catch {
                setCategories([]);
            }
        };
        loadCategories();
    }, []);

    const filteredCategories = categories.filter(c =>
        c.name.toLowerCase().includes(categorySearch.trim().toLowerCase())
    );

    return (
        <div style={{
            position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)',
            zIndex: 1000, display: 'flex', justifyContent: 'center', alignItems: 'center',
            padding: '20px', boxSizing: 'border-box'
        }}>
            <div className="card" style={{ width: '100%', maxWidth: '580px', padding: '28px', maxHeight: '90vh', overflowY: 'auto', position: 'relative' }}>
                <button onClick={onClose} style={{
                    position: 'absolute', top: '14px', right: '16px',
                    background: 'none', border: 'none', fontSize: '26px', cursor: 'pointer', color: '#888', lineHeight: 1
                }}>×</button>

                <h2 style={{ marginBottom: '6px', paddingRight: '30px' }}>📝 Suggest a Question</h2>
                <p style={{ color: '#888', marginBottom: '20px', fontSize: '13px' }}>
                    Submitted questions go to the admin review queue before appearing in the game.
                </p>

                {success ? (
                    <div style={{ textAlign: 'center', padding: '24px 0' }}>
                        <div style={{ fontSize: '52px', marginBottom: '14px' }}>🎉</div>
                        <h3 style={{ color: '#28a745', marginBottom: '8px' }}>Submitted!</h3>
                        <p style={{ color: '#888', marginBottom: '22px' }}>An admin will review your question soon.</p>
                        <button onClick={onClose} className="btn btn-primary" style={{ padding: '10px 32px' }}>Close</button>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold', fontSize: '13px' }}>Category</label>
                            <div style={{ display: 'grid', gap: '8px' }}>
                                <input
                                    value={categorySearch}
                                    onChange={e => setCategorySearch(e.target.value)}
                                    placeholder="Search categories..."
                                    style={iStyle}
                                />
                                <select
                                    value={selectedCategoryId}
                                    onChange={e => { setSelectedCategoryId(e.target.value); setCustomCategory(''); }}
                                    style={iStyle}
                                >
                                    <option value="">Select a category</option>
                                    {filteredCategories.map(c => (
                                        <option key={c.id} value={c.id}>{c.name}</option>
                                    ))}
                                </select>
                                <input
                                    value={customCategory}
                                    onChange={e => { setCustomCategory(e.target.value); setSelectedCategoryId(''); }}
                                    placeholder="Or create a new category..."
                                    style={iStyle}
                                />
                            </div>
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold', fontSize: '13px' }}>Question</label>
                            <textarea value={form.text} onChange={set('text')}
                                placeholder="What is your trivia question?" required rows={3} style={iStyle} />
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold', fontSize: '13px' }}>Image URL (optional)</label>
                            <input
                                value={form.imageUrl}
                                onChange={set('imageUrl')}
                                placeholder="https://example.com/image.png"
                                style={iStyle}
                            />
                            <div style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>
                                Allowed: png, jpg, jpeg, svg, webp, gif
                            </div>
                            {form.imageUrl?.trim() && (
                                <div style={{ marginTop: '8px' }}>
                                    <img
                                        src={form.imageUrl}
                                        alt="Question preview"
                                        style={{ maxWidth: '100%', maxHeight: '180px', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                                    />
                                </div>
                            )}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                            {[['optionA','A'],['optionB','B'],['optionC','C'],['optionD','D']].map(([field, lbl]) => (
                                <div key={lbl}>
                                    <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold', fontSize: '13px' }}>Option {lbl}</label>
                                    <input value={form[field]} onChange={set(field)} placeholder={`Option ${lbl}...`} required style={iStyle} />
                                </div>
                            ))}
                        </div>
                        <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', alignItems: 'center' }}>
                            <div>
                                <strong style={{ fontSize: '13px' }}>Correct: </strong>
                                {['A','B','C','D'].map(c => (
                                    <label key={c} style={{ marginLeft: '10px', cursor: 'pointer', fontSize: '14px' }}>
                                        <input type="radio" name="modalCorrect" value={c}
                                            checked={form.correctAnswer === c} onChange={set('correctAnswer')} /> {c}
                                    </label>
                                ))}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <strong style={{ fontSize: '13px' }}>Difficulty:</strong>
                                <select value={form.complexity} onChange={set('complexity')}
                                    style={{ ...iStyle, width: 'auto', padding: '6px 10px' }}>
                                    <option value="easy">Easy</option>
                                    <option value="medium">Medium</option>
                                    <option value="hard">Hard</option>
                                </select>
                            </div>
                        </div>
                        <button type="submit" className="btn btn-primary"
                            style={{ padding: '12px', fontSize: '14px', marginTop: '6px' }}
                            disabled={submitting}>
                            {submitting ? '⏳ Submitting...' : '📨 Submit for Review'}
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
}
