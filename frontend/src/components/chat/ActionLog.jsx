// src/components/chat/ActionLog.jsx
import { useState } from 'react';
import api from '../../lib/api';

export default function ActionLog({ log, onUndo }) {
  const [undone, setUndone] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleUndo = async () => {
    if (loading || undone) return;
    setLoading(true);
    try {
      await api.post(`/expenses/undo/${log.id}`);
      setUndone(true);
      if (onUndo) onUndo(); // Trigger dashboard refresh
    } catch (err) {
      console.error('Failed to undo:', err);
      alert('Failed to undo action.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="chat-action-log fade-in" style={{ opacity: undone ? 0.6 : 1 }}>
      <span style={{marginRight:'0.5rem'}}>{undone ? '↩️ Undone' : '✓'}</span>
      <span style={{textDecoration: undone ? 'line-through' : 'none'}}>{log.description}</span>
      
      {!undone && (
        <button 
          onClick={handleUndo} 
          disabled={loading}
          style={{
            background: 'none', border: 'none', marginLeft: '0.75rem', 
            color: 'inherit', textDecoration: 'underline', cursor: 'pointer',
            fontSize: 'inherit', opacity: 0.8
          }}
        >
          {loading ? '...' : 'Undo'}
        </button>
      )}
    </div>
  );
}
