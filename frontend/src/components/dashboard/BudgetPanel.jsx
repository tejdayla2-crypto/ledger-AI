import { useCallback, useEffect, useState } from 'react';
import api, { formatError } from '../../lib/api';
import { CATEGORIES, formatINR } from '../../lib/parse';

export default function BudgetPanel({ refreshTrigger, onUpdated }) {
  const [budgets, setBudgets] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [category, setCategory] = useState('Overall');
  const [monthlyLimit, setMonthlyLimit] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const applyBudgetStatus = useCallback(data => {
    setBudgets(data.budgets);
    setAlerts(previous => {
      const knownIds = new Set(previous.map(alert => alert.id));
      return [
        ...previous.filter(alert => data.budgets.some(budget => budget.category === alert.category)),
        ...(data.new_alerts || []).filter(alert => !knownIds.has(alert.id))
      ];
    });
    setError('');
  }, []);

  const requestBudgetStatus = useCallback(() => api.get('/budgets'), []);

  const loadBudgets = useCallback(async () => {
    try {
      const { data } = await requestBudgetStatus();
      applyBudgetStatus(data);
    } catch (err) {
      setError(formatError(err, 'Budgets could not be loaded.'));
    }
  }, [applyBudgetStatus, requestBudgetStatus]);

  useEffect(() => {
    let active = true;
    requestBudgetStatus()
      .then(({ data }) => {
        if (active) applyBudgetStatus(data);
      })
      .catch(err => {
        if (active) setError(formatError(err, 'Budgets could not be loaded.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [applyBudgetStatus, refreshTrigger, requestBudgetStatus]);

  async function saveBudget(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.post('/budgets', { category, monthly_limit: Number(monthlyLimit) });
      setMonthlyLimit('');
      await loadBudgets();
      onUpdated?.();
    } catch (err) {
      setError(formatError(err, 'Budget could not be saved.'));
    } finally {
      setSaving(false);
    }
  }

  async function deleteBudget(budgetCategory) {
    setError('');
    try {
      await api.delete(`/budgets/${encodeURIComponent(budgetCategory)}`);
      await loadBudgets();
      onUpdated?.();
    } catch (err) {
      setError(formatError(err, 'Budget could not be removed.'));
    }
  }

  return (
    <section className="budget-panel" aria-label="Monthly budget management">
      <h3>Monthly Budgets</h3>
      <form className="budget-form" onSubmit={saveBudget}>
        <label>
          Budget type
          <select value={category} onChange={event => setCategory(event.target.value)}>
            <option value="Overall">Overall monthly budget</option>
            {CATEGORIES.map(item => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label>
          Monthly limit (₹)
          <input
            type="number"
            min="0.01"
            max="100000000"
            step="0.01"
            required
            value={monthlyLimit}
            onChange={event => setMonthlyLimit(event.target.value)}
            placeholder="e.g. 10000"
          />
        </label>
        <button className="btn btn-primary" type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Set budget'}
        </button>
      </form>

      {error && <div className="budget-error" role="alert">{error}<button type="button" onClick={loadBudgets}>Retry</button></div>}
      {alerts.map(alert => (
        <div className="ai-feature-warning" role="status" key={alert.id}>
          {alert.category === 'Overall' ? 'Monthly' : alert.category} budget alert: you have used {alert.percentage}% of {formatINR(alert.monthly_limit)}.
        </div>
      ))}

      {loading
        ? <p className="budget-empty">Loading your budgets…</p>
        : budgets.length === 0
          ? <p className="budget-empty">No budgets set yet. Set an overall limit or a category budget above to start tracking.</p>
          : <div className="budget-list">
            {budgets.map(budget => (
              <article key={budget.category} className="budget-item">
                <div className="budget-info">
                  <span className="budget-cat">{budget.category === 'Overall' ? 'Overall monthly' : budget.category}</span>
                  <span className="budget-amounts">
                    <strong>{formatINR(budget.spent)}</strong> of {formatINR(budget.monthly_limit)}
                  </span>
                </div>
                <div
                  className="budget-track"
                  role="progressbar"
                  aria-label={`${budget.category} budget used`}
                  aria-valuemin="0"
                  aria-valuemax="100"
                  aria-valuenow={Math.min(budget.percentage, 100)}
                  aria-valuetext={`${budget.percentage}% used`}
                >
                  <div
                    className={`budget-fill ${budget.status}`}
                    style={{ width: `${Math.min(budget.percentage, 100)}%` }}
                    title={`${budget.percentage}% spent`}
                  />
                </div>
                <div className="budget-summary">
                  <span>{budget.percentage}% used</span>
                  <strong className={budget.remaining < 0 ? 'budget-over-limit' : ''}>
                    {budget.remaining < 0
                      ? `${formatINR(Math.abs(budget.remaining))} over budget`
                      : `${formatINR(budget.remaining)} remaining`}
                  </strong>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => deleteBudget(budget.category)}>
                    Remove
                  </button>
                </div>
                {budget.percentage >= 100 && <p className="budget-warning" role="status">This budget limit has been exceeded.</p>}
                {budget.percentage >= 50 && budget.percentage < 100 && <p className="budget-warning" role="status">You have used over half of this budget. Review remaining spending this month.</p>}
              </article>
            ))}
          </div>}
    </section>
  );
}
