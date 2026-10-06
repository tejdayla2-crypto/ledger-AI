// src/pages/Dashboard.jsx
import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import api from '../lib/api';
import './Dashboard.css';

import ChatPanel from '../components/chat/ChatPanel';
import QuickAdd from '../components/expenses/QuickAdd';
import TransactionList from '../components/expenses/TransactionList';
import StatCard from '../components/dashboard/StatCard';
import CategoryChart from '../components/dashboard/CategoryChart';
import SpendChart from '../components/dashboard/SpendChart';
import BudgetPanel from '../components/dashboard/BudgetPanel';
import CSVUpload from '../components/upload/CSVUpload';

export default function Dashboard() {
  const { user, logout } = useAuth();
  const [summary, setSummary] = useState(null);
  const [expenses, setExpenses] = useState([]);
  const [showUpload, setShowUpload] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [dashboardError, setDashboardError] = useState('');
  const [dashboardLoading, setDashboardLoading] = useState(true);

  // Function to force refresh of all dashboard data (called by Chat or QuickAdd after an action)
  const triggerRefresh = () => setRefreshTrigger(prev => prev + 1);

  useEffect(() => {
    let active = true;
    setDashboardLoading(true);
    setDashboardError('');
    Promise.all([
      api.get('/summary?period=this_month&forecast=true'),
      api.get('/expenses?limit=10')
    ]).then(([summaryResponse, expensesResponse]) => {
      if (!active) return;
      setSummary(summaryResponse.data);
      setExpenses(expensesResponse.data.expenses);
    }).catch(() => {
      if (active) setDashboardError('Dashboard data could not be loaded. Check your connection and try again.');
    }).finally(() => {
      if (active) setDashboardLoading(false);
    });
    return () => { active = false; };
  }, [refreshTrigger]);

  return (
    <div className="dashboard-layout">
      {/* Left Sidebar: Chat Agent */}
      <div className="chat-sidebar">
        <ChatPanel onAction={triggerRefresh} />
      </div>

      {/* Right Main Area: Traditional Dashboard */}
      <div className="dashboard-main fade-in">
        {dashboardError && (
          <div className="dashboard-error" role="alert">
            <span>{dashboardError}</span>
            <button className="btn btn-secondary btn-sm" onClick={triggerRefresh}>Retry</button>
          </div>
        )}
        <header className="dashboard-header">
          <div>
            <h1>Overview</h1>
            <p style={{marginTop:'0.25rem'}}>Welcome back, {user?.email}</p>
          </div>
          <div className="dashboard-actions">
            <button className="btn btn-secondary btn-sm" onClick={() => setShowUpload(true)}>Upload CSV</button>
            <button className="btn btn-ghost btn-sm" onClick={logout}>Log out</button>
          </div>
        </header>

        <div className="dashboard-top-widgets">
          <QuickAdd onAdded={triggerRefresh} />
          
          <div className="stats-grid">
            <StatCard 
              label="Spent this month" 
              value={dashboardLoading ? '...' : summary?.total} 
              subtext={`${summary?.transaction_count || 0} transactions`} 
            />
            <StatCard 
              label="Top Category" 
              value={summary?.top_category === 'None' ? '—' : summary?.top_category} 
              subtext={summary?.top_category !== 'None' ? `₹${summary?.breakdown?.[0]?.total.toLocaleString('en-IN')}` : ''}
              isTextValue 
            />
            <StatCard 
              label="Forecast (Month End)" 
              value={summary?.forecast?.projected_monthly} 
              subtext={summary?.forecast ? `₹${summary.forecast.daily_rate}/day avg` : 'Not enough data'} 
            />
          </div>
        </div>

        <div className="dashboard-charts">
          <CategoryChart data={summary?.breakdown || []} />
          <SpendChart period="this_month" refreshTrigger={refreshTrigger} />
        </div>

        <div className="dashboard-bottom">
          <TransactionList expenses={expenses} onAction={triggerRefresh} />
          <BudgetPanel refreshTrigger={refreshTrigger} />
        </div>
      </div>

      {showUpload && (
        <CSVUpload 
          onClose={() => setShowUpload(false)} 
          onImported={() => {
            setShowUpload(false);
            triggerRefresh();
          }} 
        />
      )}
    </div>
  );
}
