import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis
} from 'recharts';
import api, { formatError } from '../../lib/api';
import { CATEGORIES, formatINR } from '../../lib/parse';
import BudgetPanel from './BudgetPanel';
import './AIFeatures.css';

const VOICE_LANGUAGES = [
  { value: 'en-IN', label: 'English' },
  { value: 'hi-IN', label: 'Hindi' }
];

function ErrorMessage({ children }) {
  return children ? <div className="ai-feature-error" role="alert">{children}</div> : null;
}

function VoiceAssistant({ onAction }) {
  const [language, setLanguage] = useState('en-IN');
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [expense, setExpense] = useState(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const recognitionRef = useRef(null);

  function speakReply(text) {
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
      setNotice('Voice playback is not supported in this browser. The answer is shown below.');
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language;
    window.speechSynthesis.speak(utterance);
  }

  function startListening() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      setError('Speech recognition is not available in this browser. Type your request below instead.');
      return;
    }
    const recognition = new Recognition();
    recognitionRef.current = recognition;
    recognition.lang = language;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = event => {
      setTranscript(event.results[0][0].transcript);
      setExpense(null);
      setReply('');
      setError('');
    };
    recognition.onerror = event => {
      setError(event.error === 'not-allowed'
        ? 'Microphone access was denied. Allow microphone access or type your request.'
        : 'Speech recognition failed. Please try again or type your request.');
      setListening(false);
    };
    recognition.onend = () => setListening(false);
    setError('');
    setListening(true);
    try {
      recognition.start();
    } catch {
      setListening(false);
      setError('Microphone could not be started. Check browser permissions and try again.');
    }
  }

  async function analyze(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    setExpense(null);
    setReply('');
    try {
      const { data } = await api.post('/ai/voice', { transcript, language });
      if (data.intent === 'expense') setExpense(data.expense);
      else {
        setReply(data.reply);
        speakReply(data.reply);
      }
    } catch (err) {
      setError(formatError(err, 'The voice request could not be processed.'));
    } finally {
      setBusy(false);
    }
  }

  async function confirmExpense(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/expenses', { ...expense, amount: Number(expense.amount) });
      setExpense(null);
      setNotice('Confirmed expense saved to your transactions.');
      onAction();
    } catch (err) {
      setError(formatError(err, 'Expense could not be saved.'));
    } finally {
      setBusy(false);
    }
  }

  return <section className="ai-feature-card">
    <div className="ai-feature-intro">
      <span className="ai-eyebrow">VOICE · ENGLISH · हिंदी</span>
      <h2>Speak naturally. Confirm before saving.</h2>
      <p>Voice recognition runs in your browser. The transcript is analyzed by Ledger AI; no transaction is added until you confirm.</p>
    </div>
    <div className="ai-voice-controls">
      <label>Recognition language<select value={language} onChange={event => setLanguage(event.target.value)}>{VOICE_LANGUAGES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <button className={`btn ${listening ? 'btn-secondary' : 'btn-primary'}`} type="button" onClick={listening ? undefined : startListening} disabled={listening}>
        {listening ? 'Listening…' : '🎙 Start speaking'}
      </button>
        {listening && <button className="btn btn-secondary" type="button" onClick={() => recognitionRef.current?.stop()}>Stop</button>}
    </div>
    <form className="ai-feature-form" onSubmit={analyze}>
      <label>Your transcript<textarea value={transcript} onChange={event => setTranscript(event.target.value)} maxLength={1000} rows={3} placeholder="For example: I spent 500 rupees on petrol today." required /></label>
      <button className="btn btn-primary" disabled={busy || !transcript.trim()}>{busy ? 'Analyzing…' : 'Analyze request'}</button>
    </form>
    <ErrorMessage>{error}</ErrorMessage>
    {notice && <div className="ai-feature-success" role="status">{notice}</div>}
    {reply && <div className="ai-answer"><strong>Ledger AI</strong><p>{reply}</p></div>}
    {expense && <form className="ai-confirm-card" onSubmit={confirmExpense}>
      <div><span className="ai-eyebrow">REVIEW BEFORE SAVING</span><h3>Confirm this expense</h3></div>
      <label>Description<input value={expense.description} maxLength={200} required onChange={event => setExpense({ ...expense, description: event.target.value })} /></label>
      <div className="ai-inline-fields">
        <label>Amount (₹)<input type="number" min="0.01" step="0.01" required value={expense.amount} onChange={event => setExpense({ ...expense, amount: event.target.value })} /></label>
        <label>Date<input type="date" required value={expense.date || ''} onChange={event => setExpense({ ...expense, date: event.target.value })} /></label>
        <label>Category<select value={expense.category} onChange={event => setExpense({ ...expense, category: event.target.value })}>{CATEGORIES.map(category => <option key={category}>{category}</option>)}</select></label>
      </div>
      <div className="ai-form-actions"><button type="button" className="btn btn-secondary" onClick={() => setExpense(null)}>Cancel</button><button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Confirm and save'}</button></div>
    </form>}
  </section>;
}

function SmartBudget({ refreshKey, onAction }) {
  return <div className="ai-feature-stack">
    <section className="ai-feature-card">
      <div className="ai-feature-intro"><span className="ai-eyebrow">SMART BUDGET</span><h2>Stay ahead of your limits</h2><p>Alerts are recorded once per budget, month, and threshold. Overall and category budgets use your actual expenses.</p></div>
      <div className="ai-budget-thresholds">{[50, 75, 90, 100].map(value => <span key={value}>{value}% alert</span>)}</div>
      <BudgetPanel refreshTrigger={refreshKey} onUpdated={onAction} />
    </section>
  </div>;
}

function ExpensePrediction() {
  const [prediction, setPrediction] = useState(null);
  const [error, setError] = useState('');
  const [chart, setChart] = useState('categories');
  useEffect(() => {
    let active = true;
    api.get('/ai/prediction').then(({ data }) => {
      if (active) {
        setPrediction(data);
        setError('');
      }
    }).catch(err => {
      if (active) setError(formatError(err, 'Expense forecast could not be loaded.'));
    });
    return () => { active = false; };
  }, []);

  const monthlyData = useMemo(() => (prediction?.monthly_history || []).map(row => ({
    ...row, label: row.month.slice(5)
  })), [prediction]);

  if (error) return <ErrorMessage>{error}</ErrorMessage>;
  if (!prediction) return <div className="ai-feature-card ai-loading">Calculating a forecast from your actual expense history…</div>;
  if (!prediction.sufficient_history) return <section className="ai-feature-card"><span className="ai-eyebrow">EXPENSE PREDICTION</span><h2>More history is needed</h2><p>{prediction.message} Predictions are not generated from random or sample data.</p></section>;

  return <div className="ai-feature-stack">
    <section className="ai-feature-card">
      <div className="ai-feature-intro"><span className="ai-eyebrow">EXPENSE PREDICTION · {prediction.method}</span><h2>Next month’s expected spending</h2><p>Forecast uses your completed historical months; the current partial month is excluded.</p></div>
      <div className="ai-prediction-metrics">
        <div><span>Expected · {prediction.forecast_month}</span><strong>{formatINR(prediction.predicted_total)}</strong></div>
        <div><span>Current month so far</span><strong>{formatINR(prediction.current_month_total)}</strong></div>
        <div><span>Previous month</span><strong>{formatINR(prediction.previous_month_total)}</strong></div>
        <div><span>Predicted savings</span><strong>{prediction.predicted_savings === null ? 'Income history needed' : formatINR(prediction.predicted_savings)}</strong></div>
      </div>
      {prediction.overspending_warning && <div className="ai-feature-warning" role="status">{prediction.overspending_warning}</div>}
      {prediction.accuracy_pct === null
        ? <p className="ai-source-note">Forecast accuracy will be shown after at least six historical months are available.</p>
        : <p className="ai-source-note">Historical back-test accuracy: {prediction.accuracy_pct}% (rolling one-month forecast error, not a guarantee).</p>}
      {prediction.predicted_savings === null && <p className="ai-source-note">Savings prediction requires at least three months of recorded income. No income amount has been assumed.</p>}
    </section>
    <section className="ai-feature-card">
      <div className="ai-chart-header"><div><span className="ai-eyebrow">HISTORICAL TRENDS</span><h3>Actuals and forecast by category</h3></div><div className="ai-chart-toggle"><button className={chart === 'categories' ? 'active' : ''} onClick={() => setChart('categories')}>Categories</button><button className={chart === 'history' ? 'active' : ''} onClick={() => setChart('history')}>Monthly trend</button></div></div>
      <div className="ai-chart-container">
        <ResponsiveContainer width="100%" height="100%">
          {chart === 'categories'
            ? <BarChart data={prediction.categories}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="category" /><YAxis /><Tooltip formatter={value => formatINR(value)} /><Bar dataKey="predicted" name="Predicted" fill="#4a7c66" radius={[4, 4, 0, 0]} /></BarChart>
            : <LineChart data={monthlyData}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis /><Tooltip formatter={value => formatINR(value)} /><Line type="monotone" dataKey="total" name="Recorded expenses" stroke="#2d4a3e" strokeWidth={3} dot /></LineChart>}
        </ResponsiveContainer>
      </div>
      <p className="ai-source-note">The forecast is a three-month weighted moving average over recorded expense categories. Trend chart values are actual database totals.</p>
    </section>
  </div>;
}

export default function AIFeatures({ view, refreshKey, onAction }) {
  if (view === 'voice') return <VoiceAssistant onAction={onAction} />;
  if (view === 'budget') return <SmartBudget refreshKey={refreshKey} onAction={onAction} />;
  return <ExpensePrediction />;
}
