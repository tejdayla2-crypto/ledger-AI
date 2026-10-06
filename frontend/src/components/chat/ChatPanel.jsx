// src/components/chat/ChatPanel.jsx
import { useState, useEffect, useRef } from 'react';
import api from '../../lib/api';
import ChatMessage from './ChatMessage';

export default function ChatPanel({ onAction }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  // Load history on mount
  useEffect(() => {
    api.get('/chat/history').then(res => {
      // Format DB history to match UI state
      const history = res.data.messages.map(m => ({
        id: m.id,
        role: m.role,
        text: m.content
      }));
      setMessages(history);
      scrollToBottom();
    });
  }, []);

  // Scroll to bottom whenever messages change
  const scrollToBottom = () => {
    setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };
  useEffect(scrollToBottom, [messages]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userText = input.trim();
    setInput('');
    const tempId = Date.now().toString();
    
    // Optimistic UI update for user message
    setMessages(prev => [...prev, { id: tempId, role: 'user', text: userText }]);
    setLoading(true);

    try {
      const res = await api.post('/chat', { message: userText });
      
      // Add agent response
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'agent',
        text: res.data.reply,
        actionLog: res.data.action_log // Attach action logs to the message
      }]);

      // If tools were called, trigger dashboard refresh
      if (res.data.tool_calls?.length > 0) {
        onAction();
      }
    } catch (err) {
      const errorData = err.response?.data;
      const errorText = errorData?.reply || errorData?.error || errorData?.message;
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'agent',
        text: errorText || (err.code === 'ERR_NETWORK'
          ? 'Unable to connect to the Ledger server. Please make sure the backend is running.'
          : 'Sorry, I ran into an error processing that.'),
        isError: true
      }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="chat-header">
        <div className="chat-header-title">
          <div className="chat-preview-dot active" style={{width:'8px',height:'8px',background:'#4ADE80'}}></div>
          Ledger <span>Agent</span>
        </div>
      </div>
      
      <div className="chat-messages">
        {messages.length === 0 && !loading && (
          <div style={{textAlign:'center', color:'var(--ink-faint)', marginTop:'2rem', fontSize:'0.9rem'}}>
            <p>No messages yet.</p>
            <p style={{marginTop:'0.5rem'}}>Try saying: "I spent 350 on lunch"</p>
          </div>
        )}

        {messages.map((msg, i) => (
          <ChatMessage key={msg.id || i} message={msg} onUndo={onAction} />
        ))}
        
        {loading && (
          <div className="chat-bubble agent thinking">thinking</div>
        )}
        <div ref={bottomRef} />
      </div>

      <form className="chat-input-area" onSubmit={handleSubmit}>
        <div className="chat-input-wrapper">
          <input
            className="chat-input"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Type an expense or ask a question..."
            disabled={loading}
          />
          <button type="submit" className="chat-submit" disabled={!input.trim() || loading} aria-label="Send">
            ↑
          </button>
        </div>
      </form>
    </>
  );
}
