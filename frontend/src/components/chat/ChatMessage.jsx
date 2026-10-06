// src/components/chat/ChatMessage.jsx
import ReactMarkdown from 'react-markdown';
import ActionLog from './ActionLog';

export default function ChatMessage({ message, onUndo }) {
  const isUser = message.role === 'user';
  
  return (
    <>
      <div className={`chat-bubble fade-in ${isUser ? 'user' : 'agent'}`} style={message.isError ? {background: 'var(--rust-lt)', borderColor: 'var(--rust)', color: 'var(--rust)'} : {}}>
        <ReactMarkdown
          components={{
            p: ({node, ...props}) => <p style={{margin: 0}} {...props} />,
            strong: ({node, ...props}) => <strong style={{fontWeight: 600}} {...props} />,
          }}
        >
          {message.text}
        </ReactMarkdown>
      </div>

      {/* If this message resulted in actions (adds/edits/deletes), show the audit trail below it */}
      {!isUser && message.actionLog?.length > 0 && (
        <div style={{display:'flex', flexDirection:'column', gap:'0.25rem', marginTop:'-0.5rem', marginBottom:'0.5rem'}}>
          {message.actionLog.map(log => (
            <ActionLog key={log.id} log={log} onUndo={onUndo} />
          ))}
        </div>
      )}
    </>
  );
}
