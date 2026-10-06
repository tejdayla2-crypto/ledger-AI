// src/components/expenses/TransactionRow.jsx
import { useState, useRef, useEffect } from 'react';
import api from '../../lib/api';
import { formatINR, catClass, CATEGORIES } from '../../lib/parse';

export default function TransactionRow({ expense, onAction }) {
  const [showCatDropdown, setShowCatDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowCatDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [dropdownRef]);

  const handleDelete = async () => {
    if (window.confirm(`Delete "${expense.description}"?`)) {
      setLoading(true);
      try {
        await api.delete(`/expenses/${expense.id}`);
        onAction();
      } catch (err) {
        alert('Failed to delete');
        setLoading(false);
      }
    }
  };

  const handleUpdateCategory = async (newCat) => {
    setShowCatDropdown(false);
    if (newCat === expense.category) return;
    
    setLoading(true);
    try {
      await api.put(`/expenses/${expense.id}`, { category: newCat });
      onAction();
    } catch (err) {
      alert('Failed to update category');
      setLoading(false);
    }
  };

  const d = new Date(expense.date + 'T00:00:00');
  const month = d.toLocaleDateString('en-IN', { month: 'short' });
  const day = d.getDate();

  return (
    <div className={`tx-row ${loading ? 'fade-in' : ''}`} style={{opacity: loading ? 0.5 : 1}}>
      <div className="tx-date">
        <strong>{day < 10 ? '0'+day : day}</strong>
        {month}
      </div>
      
      <div className="tx-desc">
        {expense.description}
        {expense.split_count > 1 && (
          <span style={{fontSize:'0.75rem', color:'var(--ink-faint)', marginLeft:'0.5rem', fontWeight:'normal'}}>
            (split {expense.split_count} ways)
          </span>
        )}
      </div>
      
      <div className="tx-cat-wrap" ref={dropdownRef}>
        <button 
          type="button"
          className="badge tx-cat" 
          style={{background: 'var(--paper-warm)', color: 'var(--ink-muted)', border: '1px solid var(--mist)', font: 'inherit'}}
          onClick={() => setShowCatDropdown(!showCatDropdown)}
          title={expense.ai_confidence < 0.7 ? "AI is unsure about this category. Click to fix." : "Click to change category"}
          aria-expanded={showCatDropdown}
          aria-label={`Change category for ${expense.description}`}
        >
          {expense.category}
          {expense.ai_confidence < 0.7 && <span style={{color:'var(--amber)', marginLeft:'0.3rem'}}>?</span>}
        </button>
        
        {showCatDropdown && (
          <div className="cat-dropdown fade-in">
            {CATEGORIES.map(c => (
              <button key={c} onClick={() => handleUpdateCategory(c)} style={{fontWeight: c === expense.category ? 600 : 400}}>
                {c}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="tx-dots"></div>
      
      <div className={`tx-amount ${catClass(expense.category)}`}>
        {formatINR(expense.amount)}
      </div>

      <div className="tx-actions">
        <button className="btn-icon btn-ghost" onClick={handleDelete} title="Delete" style={{padding:'0.2rem', width:'1.5rem', height:'1.5rem', color:'var(--rust)'}}>
          ×
        </button>
      </div>
    </div>
  );
}
