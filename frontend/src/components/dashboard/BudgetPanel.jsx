// src/components/dashboard/BudgetPanel.jsx
import { useState, useEffect } from 'react';
import api from '../../lib/api';
import { formatINR } from '../../lib/parse';

export default function BudgetPanel({ refreshTrigger }) {
  const [budgets, setBudgets] = useState([]);

  useEffect(() => {
    api.get('/summary/budgets').then(res => setBudgets(res.data.budgets));
  }, [refreshTrigger]);

  if (budgets.length === 0) {
    return (
      <div className="budget-panel">
        <h3>Budgets</h3>
        <p style={{color:'var(--ink-muted)', fontSize:'0.9rem'}}>
          No budgets set yet. Tell the agent "Set my food budget to 5000" to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="budget-panel">
      <h3>Monthly Budgets</h3>
      <div className="budget-list">
        {budgets.map(b => (
          <div key={b.category} className="budget-item">
            <div className="budget-info leader-line">
              <span className="budget-cat">{b.category}</span>
              <span className="budget-amounts">
                <strong style={{color:'var(--ink)'}}>{formatINR(b.spent)}</strong> 
                {' '}of {formatINR(b.monthly_limit)}
              </span>
            </div>
            <div className="budget-track">
              <div 
                className={`budget-fill ${b.status}`} 
                style={{width: `${Math.min(b.percentage, 100)}%`}}
                title={`${b.percentage}% spent`}
              ></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
