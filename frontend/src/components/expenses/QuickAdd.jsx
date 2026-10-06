// src/components/expenses/QuickAdd.jsx
import { useState } from 'react';
import api from '../../lib/api';
import { parseQuickAdd } from '../../lib/parse';

export default function QuickAdd({ onAdded }) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    setError(null);
    const parsed = parseQuickAdd(input);

    if (!parsed || parsed.confidence === 'low') {
      setError("Please include both what you bought and how much it cost (e.g. '350 lunch').");
      return;
    }

    setLoading(true);
    try {
      await api.post('/expenses', {
        description: parsed.description,
        amount: parsed.amount
      });
      setInput('');
      onAdded(); // Trigger dashboard refresh
    } catch (err) {
      setError("Couldn't add expense. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="quick-add-card">
      <h3>Quick Add</h3>
      <p>Just type what you spent, I'll categorise it.</p>
      
      <form onSubmit={handleSubmit}>
        <input 
          className="quick-add-input"
          value={input}
          onChange={e => {
            setInput(e.target.value);
            if (error) setError(null);
          }}
          placeholder="e.g. 180 Uber, 350 lunch..."
          disabled={loading}
        />
        {error && <div style={{color:'#FECACA', fontSize:'0.8rem', marginTop:'0.5rem'}}>{error}</div>}
      </form>
    </div>
  );
}
