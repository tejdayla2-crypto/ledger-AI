import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import './Dashboard.css';

import ChatPanel from '../components/chat/ChatPanel';
import AIFeatures from '../components/dashboard/AIFeatures';
import ExpenseDashboard from './ExpenseDashboard';

const DASHBOARD_VIEWS = [
  { id: 'dashboard', label: 'Overview', group: 'Finance' },
  { id: 'transactions', label: 'Transactions', group: 'Finance' },
  { id: 'income', label: 'Income', group: 'Finance' },
  { id: 'reports', label: 'Monthly Reports', group: 'Finance' },
  { id: 'assistant', label: 'AI Analysis', group: 'Finance' },
  { id: 'voice', label: 'Voice Assistance', group: 'AI Features' },
  { id: 'budget', label: 'Budget Management', group: 'AI Features' },
  { id: 'prediction', label: 'Expense Prediction', group: 'AI Features' }
];

const AI_VIEW_IDS = new Set(['voice', 'budget', 'prediction']);

export default function Dashboard() {
  const { logout } = useAuth();
  const [activeView, setActiveView] = useState('dashboard');
  const [refreshKey, setRefreshKey] = useState(0);
  const active = DASHBOARD_VIEWS.find(view => view.id === activeView) || DASHBOARD_VIEWS[0];
  const refresh = () => setRefreshKey(previous => previous + 1);

  return (
    <div className="dashboard-layout">
      <aside className="chat-sidebar" aria-label="Ledger AI assistant">
        <ChatPanel onAction={refresh} />
      </aside>

      <main className="dashboard-main fade-in">
        <header className="dashboard-header ledger-ai-header">
          <div>
            <h1>{active.label}</h1>
            <p className="ledger-ai-welcome">Your Ledger AI expense assistant</p>
          </div>
          <div className="dashboard-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm ledger-ai-mic"
              onClick={() => setActiveView('voice')}
              aria-label="Open Voice Assistance"
            >
              <span aria-hidden="true">🎙</span> Voice
            </button>
            <button className="btn btn-ghost btn-sm" onClick={logout}>Log out</button>
          </div>
        </header>

        <nav className="dashboard-view-nav ledger-ai-nav" aria-label="Ledger AI finance features">
          {DASHBOARD_VIEWS.map((view, index) => (
            <span className="ledger-ai-nav-item" key={view.id}>
              {index > 0 && view.group !== DASHBOARD_VIEWS[index - 1].group &&
                <span className="ledger-ai-nav-divider" aria-hidden="true" />}
              <button
                type="button"
                className={activeView === view.id ? 'active' : ''}
                aria-current={activeView === view.id ? 'page' : undefined}
                onClick={() => setActiveView(view.id)}
              >
                {view.label}
              </button>
            </span>
          ))}
        </nav>

        {AI_VIEW_IDS.has(activeView)
          ? <AIFeatures view={activeView} refreshKey={refreshKey} onAction={refresh} />
          : <ExpenseDashboard view={activeView} refreshKey={refreshKey} onAction={refresh} />}
      </main>
    </div>
  );
}
