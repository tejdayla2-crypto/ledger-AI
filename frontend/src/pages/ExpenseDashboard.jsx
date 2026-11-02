import { useCallback, useEffect, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis
} from 'recharts';
import api, { formatError } from '../lib/api';
import { CATEGORIES, formatDate, formatINR } from '../lib/parse';
import QuickAdd from '../components/expenses/QuickAdd';
import TransactionList from '../components/expenses/TransactionList';
import StatCard from '../components/dashboard/StatCard';
import CategoryChart from '../components/dashboard/CategoryChart';
import SpendChart from '../components/dashboard/SpendChart';
import BudgetPanel from '../components/dashboard/BudgetPanel';
import CSVUpload from '../components/upload/CSVUpload';
import ChatPanel from '../components/chat/ChatPanel';

const INCOME_CATEGORIES = ['Salary', 'Freelancing', 'Business', 'Investment Returns', 'Other'];
const today = () => new Date().toISOString().slice(0, 10);
const emptySummary = { total: 0, income_total: 0, balance: 0, transaction_count: 0, top_category: 'None', breakdown: [] };
const REPORT_CATEGORY_COLORS = {
  Food: '#D97706',
  Travel: '#2563EB',
  Shopping: '#7C3AED',
  Bills: '#059669',
  Entertainment: '#DB2777',
  Healthcare: '#0891B2',
  Other: '#64748B'
};
const expenseViews = {
  dashboard: ['Overview', 'Your monthly expense and income snapshot.'],
  transactions: ['Transaction history', 'Add, review, edit, or remove your expense records.'],
  income: ['Income tracking', 'Record and review income separately from expenses.'],
  reports: ['Monthly expense reports', 'Review spending categories and income for a selected month.'],
  budgets: ['Budget management', 'Create and manage monthly category spending limits.'],
  assistant: ['AI expense analysis', 'Ask Ledger AI about your actual expense and budget history.']
};

function ExpenseForm({ record, onClose, onSaved }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isEditing = Boolean(record);

  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = Object.fromEntries(new FormData(form));
    setBusy(true);
    setError('');
    try {
      if (isEditing) await api.put(`/expenses/${record.id}`, { ...fields, amount: Number(fields.amount) });
      else await api.post('/expenses', { ...fields, amount: Number(fields.amount) });
      onSaved();
      onClose();
    } catch (err) {
      setError(formatError(err, 'Expense could not be saved.'));
    } finally {
      setBusy(false);
    }
  }

  return <div className="expense-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="expense-modal" role="dialog" aria-modal="true" aria-labelledby="expense-form-title">
      <header><div><h3 id="expense-form-title">{isEditing ? 'Edit expense' : 'Add expense'}</h3><p>Expense records appear in your reports and category budgets.</p></div><button type="button" onClick={onClose} aria-label="Close dialog">×</button></header>
      {error && <div className="expense-alert error" role="alert">{error}</div>}
      <form onSubmit={submit}>
        <label>Description<input name="description" required maxLength="200" defaultValue={record?.description || ''} autoFocus /></label>
        <div className="expense-form-grid">
          <label>Amount (₹)<input name="amount" type="number" min="0.01" max="100000000" step="0.01" required defaultValue={record?.amount ?? ''} /></label>
          <label>Date<input name="date" type="date" required defaultValue={record?.date || today()} /></label>
        </div>
        <label>Category<select name="category" defaultValue={record?.category || 'Other'}>{CATEGORIES.map(category => <option key={category}>{category}</option>)}</select></label>
        <footer><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : isEditing ? 'Save changes' : 'Add expense'}</button></footer>
      </form>
    </section>
  </div>;
}

function IncomeForm({ record, onClose, onSaved }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [category, setCategory] = useState(
    INCOME_CATEGORIES.includes(record?.category) ? record.category : record?.category || 'Other'
  );

  async function submit(event) {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);
    setError('');
    try {
      const payload = { ...fields, category, amount: Number(fields.amount) };
      if (record) await api.put(`/income/${record.id}`, payload);
      else await api.post('/income', payload);
      onSaved();
      onClose();
    } catch (err) {
      setError(formatError(err, 'Income record could not be saved.'));
    } finally {
      setBusy(false);
    }
  }

  return <div className="expense-modal-backdrop income-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="expense-modal income-modal" role="dialog" aria-modal="true" aria-labelledby="income-form-title">
      <header className="income-modal-header">
        <div className="income-modal-heading">
          <span className="income-modal-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M4 17.5 9 12l3.5 3.5L20 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M15.5 7H20v4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div>
            <h3 id="income-form-title">{record ? 'Edit Income' : 'Add Income'}</h3>
            <p>{record ? 'Update your income details.' : 'Track your earnings and keep your finances complete.'}</p>
          </div>
        </div>
        <button className="income-modal-close" type="button" onClick={onClose} aria-label="Close dialog">×</button>
      </header>
      {error && <div className="expense-alert error" role="alert">{error}</div>}
      <form className="income-modal-form" onSubmit={submit}>
        <label className="income-modal-field">
          <span>Description <b aria-hidden="true">*</b></span>
          <input name="description" placeholder="e.g. Salary, Freelancing, Business..." required maxLength="200" defaultValue={record?.description || ''} autoFocus />
        </label>

        <div className="income-modal-fields">
          <label className="income-modal-field">
            <span>Amount <b aria-hidden="true">*</b></span>
            <span className="income-modal-input-wrap income-modal-amount">
              <span className="income-modal-input-icon" aria-hidden="true">₹</span>
              <input name="amount" type="number" min="0.01" max="100000000" step="0.01" required defaultValue={record?.amount ?? ''} placeholder="0.00" />
            </span>
          </label>
          <label className="income-modal-field">
            <span>Date <b aria-hidden="true">*</b></span>
            <span className="income-modal-input-wrap income-modal-date">
              <svg className="income-modal-input-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="3.5" y="5" width="17" height="15.5" rx="2" stroke="currentColor" strokeWidth="1.7" />
                <path d="M7.5 3.5v3M16.5 3.5v3M4 9.5h16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
              <input name="date" type="date" required defaultValue={record?.date || today()} />
            </span>
          </label>
        </div>

        <fieldset className="income-modal-sources">
          <legend>Income source <b aria-hidden="true">*</b></legend>
          <div className="income-modal-chips" role="group" aria-label="Choose an income source">
            {INCOME_CATEGORIES.map(source => (
              <button
                type="button"
                key={source}
                className={`income-modal-chip${category === source ? ' selected' : ''}`}
                aria-pressed={category === source}
                onClick={() => setCategory(source)}
              >
                {source}
              </button>
            ))}
            {record?.category && !INCOME_CATEGORIES.includes(record.category) && (
              <button
                type="button"
                className={`income-modal-chip${category === record.category ? ' selected' : ''}`}
                aria-pressed={category === record.category}
                onClick={() => setCategory(record.category)}
              >
                {record.category}
              </button>
            )}
          </div>
        </fieldset>

        <footer className="income-modal-actions">
          <button type="button" className="income-modal-cancel" onClick={onClose}>Cancel</button>
          <button className="income-modal-submit" disabled={busy}>
            {busy ? <span className="income-modal-spinner" aria-hidden="true" /> : <span aria-hidden="true">＋</span>}
            {busy ? 'Saving…' : record ? 'Save Changes' : 'Add Income'}
          </button>
        </footer>
      </form>
    </section>
  </div>;
}

export default function ExpenseDashboard({ view = 'dashboard', refreshKey = 0, onAction }) {
  const [summary, setSummary] = useState(emptySummary);
  const [expenses, setExpenses] = useState([]);
  const [income, setIncome] = useState([]);
  const [incomeCount, setIncomeCount] = useState(0);
  const [monthlyReport, setMonthlyReport] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportCategoryFilter, setReportCategoryFilter] = useState('');
  const [selectedReportTransaction, setSelectedReportTransaction] = useState(null);
  const [downloadingReport, setDownloadingReport] = useState(false);
  const [reportMonth, setReportMonth] = useState(today().slice(0, 7));
  const [prediction, setPrediction] = useState(null);
  const [expenseModal, setExpenseModal] = useState(null);
  const [incomeModal, setIncomeModal] = useState(null);
  const [showUpload, setShowUpload] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [summaryResponse, expenseResponse, incomeResponse] = await Promise.all([
        api.get('/summary?period=this_month&forecast=true'),
        api.get('/expenses?limit=1000'),
        api.get('/income?limit=1000')
      ]);
      setSummary(summaryResponse.data);
      setExpenses(expenseResponse.data.expenses);
      setIncome(incomeResponse.data.income);
      setIncomeCount(incomeResponse.data.total);
      setError('');
    } catch (err) {
      setError(formatError(err, 'Expense and income data could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const refresh = useCallback(() => {
    if (onAction) onAction();
    else load();
  }, [load, onAction]);

  useEffect(() => {
    if (view !== 'reports') return;
    let active = true;
    setReportLoading(true);
    setReportCategoryFilter('');
    api.get(`/reports/monthly?month=${encodeURIComponent(reportMonth)}`).then(({ data }) => {
      if (active) {
        setMonthlyReport(data);
        setError('');
      }
    }).catch(err => {
      if (active) setError(formatError(err, 'Monthly reports could not be loaded.'));
    }).finally(() => {
      if (active) setReportLoading(false);
    });
    return () => { active = false; };
  }, [view, reportMonth, refreshKey]);

  useEffect(() => {
    if (view !== 'dashboard') return;
    let active = true;
    api.get('/ai/prediction').then(({ data }) => {
      if (active) setPrediction(data);
    }).catch(err => {
      if (active) setError(formatError(err, 'Expense prediction could not be loaded.'));
    });
    return () => { active = false; };
  }, [view, refreshKey]);

  async function deleteIncome(record) {
    if (!window.confirm(`Delete income record "${record.description}"?`)) return;
    try {
      await api.delete(`/income/${record.id}`);
      refresh();
    } catch (err) {
      setError(formatError(err, 'Income record could not be deleted.'));
    }
  }

  const page = expenseViews[view] || expenseViews.dashboard;
  const reportTransactions = monthlyReport?.transactions || [];
  const visibleReportTransactions = reportCategoryFilter
    ? reportTransactions.filter(transaction =>
      transaction.type === 'Expense' && transaction.report_category === reportCategoryFilter)
    : reportTransactions;

  async function downloadMonthlyPdf() {
    setDownloadingReport(true);
    setError('');
    try {
      const { data } = await api.get(`/reports/monthly/${encodeURIComponent(reportMonth)}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `ledger-monthly-report-${reportMonth}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(formatError(err, 'Monthly PDF report could not be downloaded.'));
    } finally {
      setDownloadingReport(false);
    }
  }

  return <section className="expense-module" aria-label="Expense tracking">
    <header className="expense-module-heading">
      <div><span>LEDGER · EXPENSE TRACKING</span><h1>{page[0]}</h1><p>{page[1]}</p></div>
      {view === 'transactions' && <div className="expense-heading-actions">
        <button className="btn btn-secondary btn-sm" onClick={() => setShowUpload(true)}>Upload CSV</button>
        <button className="btn btn-primary btn-sm" onClick={() => setExpenseModal({ kind: 'new' })}>＋ Add expense</button>
      </div>}
      {(view === 'income' || view === 'dashboard') && <button className="btn btn-primary btn-sm" onClick={() => setIncomeModal({ kind: 'new' })}>＋ Add income</button>}
    </header>
    {error && <div className="expense-alert error" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
    {loading && <div className="expense-loading">Loading your financial records…</div>}

    {view === 'dashboard' && <>
      <div className="expense-dashboard-top">
        <QuickAdd onAdded={refresh} />
        <div className="expense-stats-grid">
          <StatCard label="Spent this month" value={summary.total} subtext={`${summary.transaction_count || 0} transactions`} />
          <StatCard label="Income this month" value={summary.income_total || 0} subtext={`${summary.income_transaction_count || 0} income entries`} />
          <StatCard label="Monthly balance" value={summary.balance || 0} subtext="Income minus expenses" />
          <StatCard label="Top category" value={summary.top_category === 'None' ? '—' : summary.top_category} subtext="Highest spending category" isTextValue />
        </div>
      </div>
      <div className="dashboard-charts">
        <CategoryChart data={summary.breakdown || []} />
        <SpendChart period="this_month" refreshTrigger={refreshKey} />
      </div>
      <section className="expense-income-preview ai-dashboard-insights">
        <div><span className="ai-eyebrow">LEDGER AI · ACTUAL DATA</span><h2>AI insights & forecast</h2></div>
        <p>{summary.breakdown?.length
          ? `${summary.top_category} is your highest spending category this month at ${formatINR(summary.breakdown[0].total)} across ${summary.breakdown[0].count} transactions.`
          : 'No expenses are recorded for this month yet, so there is no spending insight to show.'}</p>
        {prediction?.sufficient_history
          ? <p>Expected expenses for {prediction.forecast_month}: <strong>{formatINR(prediction.predicted_total)}</strong>{prediction.accuracy_pct === null ? ' · Accuracy estimate needs more history.' : ` · Historical back-test accuracy ${prediction.accuracy_pct}%.`}</p>
          : <p>{prediction?.message || 'Expense predictions appear after at least three months with recorded expenses.'}</p>}
      </section>
      <div className="dashboard-bottom">
        <TransactionList expenses={expenses.slice(0, 10)} onAction={refresh} onEdit={expense => setExpenseModal({ kind: 'edit', expense })} />
        <BudgetPanel refreshTrigger={refreshKey} onUpdated={refresh} />
      </div>
      <section className="expense-income-preview">
        <div><h2>Recent income</h2><p>Income is tracked separately from your expenses.</p></div>
        {income.slice(0, 5).map(record => <div className="expense-income-row" key={record.id}><span>{record.description}<small>{record.category} · {formatDate(record.date)}</small></span><strong>{formatINR(record.amount)}</strong></div>)}
        {!income.length && <p className="expense-empty">No income recorded yet. Use Add income to record your first entry.</p>}
      </section>
    </>}

    {view === 'transactions' && <div className="expense-transactions-layout">
      <section className="expense-add-panel">
        <h2>Quick add</h2><p>Enter a description and amount to categorize a new expense.</p>
        <QuickAdd onAdded={refresh} />
        <div className="expense-add-secondary"><button className="btn btn-secondary" onClick={() => setExpenseModal({ kind: 'new' })}>Add expense with details</button></div>
        <div className="expense-category-legend"><h3>Expense categories</h3><p>{CATEGORIES.join(' · ')}</p></div>
      </section>
      <TransactionList expenses={expenses} onAction={refresh} onEdit={expense => setExpenseModal({ kind: 'edit', expense })} />
    </div>}

    {view === 'income' && <section className="expense-income-panel">
      <div className="expense-income-summary"><span>Income records</span><strong>{incomeCount}</strong><span>Income this month</span><strong>{formatINR(summary.income_total || 0)}</strong></div>
      {income.length ? <div className="expense-table-wrap"><table className="expense-table">
      <thead><tr><th>Date</th><th>Description</th><th>Source</th><th>Amount</th><th>Actions</th></tr></thead>
        <tbody>{income.map(record => <tr key={record.id}><td>{formatDate(record.date)}</td><td>{record.description}</td><td>{record.category}</td><td className="expense-income-amount">{formatINR(record.amount)}</td><td><div className="expense-row-actions"><button onClick={() => setIncomeModal({ kind: 'edit', record })}>Edit</button><button onClick={() => deleteIncome(record)}>Delete</button></div></td></tr>)}</tbody>
    </table></div> : <div className="expense-empty">No income records yet. Add salary, freelancing, business, investment returns, or other income.</div>}
    </section>}

    {view === 'reports' && <section className="expense-reports">
      <div className="expense-report-controls">
        <label>Report month<input type="month" max={today().slice(0, 7)} value={reportMonth} onChange={event => setReportMonth(event.target.value || today().slice(0, 7))} /></label>
        <button className="btn btn-primary" onClick={downloadMonthlyPdf} disabled={downloadingReport || reportLoading || monthlyReport?.month !== reportMonth}>
          {downloadingReport ? 'Preparing PDF…' : 'Download PDF'}
        </button>
      </div>
      {monthlyReport?.generated_at && <p className="expense-report-prepared" role="status">Month-end report prepared {new Date(`${monthlyReport.generated_at.replace(' ', 'T')}Z`).toLocaleString()}.</p>}
      {reportLoading && <div className="expense-loading">Preparing your report from recorded transactions…</div>}
      {!reportLoading && monthlyReport?.month === reportMonth && <>
        <div className="expense-report-stats">
          <StatCard label="Monthly income" value={monthlyReport.summary.income} subtext={`${monthlyReport.summary.income_transaction_count} income records`} />
          <StatCard label="Monthly expenses" value={monthlyReport.summary.expenses} subtext={`${monthlyReport.summary.expense_transaction_count} expense records`} />
          <StatCard label="Remaining balance / savings" value={monthlyReport.summary.balance} subtext="Income minus expenses" />
          <StatCard label="All transactions" value={String(monthlyReport.summary.transaction_count)} subtext="Income and expenses" isTextValue />
        </div>

        <div className="expense-report-highlights">
          <article className="expense-income-panel">
            <span className="ai-eyebrow">HIGHEST SPENDING CATEGORY</span>
            <h2>{monthlyReport.highest_spending_category?.category || 'No spending recorded'}</h2>
            {monthlyReport.highest_spending_category && <p>{formatINR(monthlyReport.highest_spending_category.total)} · {monthlyReport.highest_spending_category.percentage}% of expenses</p>}
          </article>
          <article className="expense-income-panel">
            <span className="ai-eyebrow">MOST EXPENSIVE EXPENSE</span>
            {monthlyReport.most_expensive_transaction
              ? <><h2>{monthlyReport.most_expensive_transaction.description}</h2><p>{formatINR(monthlyReport.most_expensive_transaction.amount)} · {formatDate(monthlyReport.most_expensive_transaction.date)} · {monthlyReport.most_expensive_transaction.category}</p></>
              : <h2>No expense recorded</h2>}
          </article>
        </div>

        <section className="expense-income-panel expense-report-comparison">
          <div><span className="ai-eyebrow">MONTH-OVER-MONTH</span><h2>{reportMonth} compared with {monthlyReport.comparison.previous_month}</h2>
            <p className="expense-report-hint">Current month compares month-to-date; closed months compare full months.</p>
          </div>
          <div className="expense-report-comparison-grid">
            <p>Expenses <strong>{formatINR(monthlyReport.summary.expenses)}</strong><small>Previous: {formatINR(monthlyReport.comparison.previous_expenses)}{monthlyReport.comparison.expense_change === null ? ' · no previous baseline' : ` · ${monthlyReport.comparison.expense_change > 0 ? '+' : ''}${monthlyReport.comparison.expense_change}%`}</small></p>
            <p>Income <strong>{formatINR(monthlyReport.summary.income)}</strong><small>Previous: {formatINR(monthlyReport.comparison.previous_income)}{monthlyReport.comparison.income_change === null ? ' · no previous baseline' : ` · ${monthlyReport.comparison.income_change > 0 ? '+' : ''}${monthlyReport.comparison.income_change}%`}</small></p>
          </div>
        </section>

        <div className="expense-report-charts">
          <section className="expense-income-panel">
            <div className="expense-report-section-heading"><div><span className="ai-eyebrow">CATEGORY BREAKDOWN</span><h2>Where your money went</h2></div>
              {reportCategoryFilter && <button className="btn btn-ghost btn-sm" onClick={() => setReportCategoryFilter('')}>Clear filter</button>}
            </div>
            <p className="expense-report-hint">Select a chart category to filter expense transactions below.</p>
            <div className="expense-report-chart">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={monthlyReport.categories} dataKey="total" nameKey="category" innerRadius={55} outerRadius={90} paddingAngle={2}
                    onClick={item => setReportCategoryFilter(current => current === item.category ? '' : item.category)}>
                    {monthlyReport.categories.map(item => <Cell key={item.category} fill={REPORT_CATEGORY_COLORS[item.category]} cursor="pointer" />)}
                  </Pie>
                  <Tooltip formatter={value => formatINR(value)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="expense-report-category-list">
              {monthlyReport.categories.map(item => <button type="button" className={reportCategoryFilter === item.category ? 'selected' : ''} key={item.category}
                onClick={() => setReportCategoryFilter(current => current === item.category ? '' : item.category)}>
                <span><i style={{ backgroundColor: REPORT_CATEGORY_COLORS[item.category] }} />{item.category}</span>
                <strong>{formatINR(item.total)} <small>{item.percentage}%</small></strong>
              </button>)}
            </div>
          </section>
          <section className="expense-income-panel">
            <div className="expense-report-section-heading"><div><span className="ai-eyebrow">DAILY SPENDING</span><h2>Expenses by day</h2></div></div>
            {monthlyReport.daily_spending.length
              ? <div className="expense-report-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyReport.daily_spending}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tickFormatter={date => date.slice(8)} />
                    <YAxis />
                    <Tooltip labelFormatter={date => formatDate(date)} formatter={value => formatINR(value)} />
                    <Bar dataKey="total" name="Daily expenses" fill="#4a7c66" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              : <p className="expense-empty">No daily expenses recorded for this month.</p>}
          </section>
        </div>

        {monthlyReport.suggestions.length > 0 && <section className="expense-income-panel expense-report-suggestions">
          <span className="ai-eyebrow">SPENDING REVIEW</span><h2>Where you could reduce expenses</h2>
          {monthlyReport.suggestions.map(suggestion => <p key={suggestion}>{suggestion}</p>)}
        </section>}

        <section className="expense-income-panel expense-report-transactions">
          <div className="expense-report-section-heading"><div><span className="ai-eyebrow">COMPLETE HISTORY · {monthlyReport.summary.transaction_count} RECORDS</span><h2>{reportCategoryFilter ? `${reportCategoryFilter} transactions` : `Transactions in ${reportMonth}`}</h2></div></div>
          {visibleReportTransactions.length
            ? <div className="expense-table-wrap"><table className="expense-table">
              <thead><tr><th>Date</th><th>Type</th><th>Description</th><th>Category / source</th><th>Amount</th><th>Details</th></tr></thead>
              <tbody>{visibleReportTransactions.map(record => <tr key={`${record.type}-${record.id}`}>
                <td>{formatDate(record.date)}</td><td>{record.type}</td><td>{record.description}</td><td>{record.category}</td>
                <td className={record.type === 'Income' ? 'expense-income-amount' : ''}>{formatINR(record.amount)}</td>
                <td><button className="btn btn-ghost btn-sm" onClick={() => setSelectedReportTransaction(record)}>View</button></td>
              </tr>)}</tbody>
            </table></div>
            : <div className="expense-empty">No transactions match this report.</div>}
        </section>
      </>}
    </section>}

    {view === 'budgets' && <BudgetPanel refreshTrigger={refreshKey} onUpdated={refresh} />}

    {view === 'assistant' && <section className="expense-ai-panel">
      <div><h2>Ask Ledger AI about your expenses</h2><p>Gemini can summarize your actual spending, categories, monthly totals, forecasts, and budget status.</p></div>
      <ChatPanel onAction={refresh} />
    </section>}

    {expenseModal && <ExpenseForm
      record={expenseModal.expense}
      onClose={() => setExpenseModal(null)}
      onSaved={refresh}
    />}
    {incomeModal && <IncomeForm
      record={incomeModal.record}
      onClose={() => setIncomeModal(null)}
      onSaved={refresh}
    />}
    {showUpload && <CSVUpload onClose={() => setShowUpload(false)} onImported={() => { setShowUpload(false); refresh(); }} />}
    {selectedReportTransaction && <div className="expense-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setSelectedReportTransaction(null); }}>
      <section className="expense-modal" role="dialog" aria-modal="true" aria-labelledby="report-transaction-title">
        <header><div><h3 id="report-transaction-title">{selectedReportTransaction.type} details</h3><p>Recorded transaction from {reportMonth}</p></div><button type="button" onClick={() => setSelectedReportTransaction(null)} aria-label="Close dialog">×</button></header>
        <dl className="expense-report-detail-list">
          <div><dt>Date</dt><dd>{formatDate(selectedReportTransaction.date)}</dd></div>
          <div><dt>Description</dt><dd>{selectedReportTransaction.description}</dd></div>
          <div><dt>Category / source</dt><dd>{selectedReportTransaction.category}</dd></div>
          <div><dt>Amount</dt><dd>{formatINR(selectedReportTransaction.amount)}</dd></div>
          <div><dt>Transaction type</dt><dd>{selectedReportTransaction.type}</dd></div>
          <div><dt>Record ID</dt><dd>{selectedReportTransaction.id}</dd></div>
        </dl>
        <footer><button type="button" className="btn btn-primary" onClick={() => setSelectedReportTransaction(null)}>Close</button></footer>
      </section>
    </div>}
  </section>;
}
