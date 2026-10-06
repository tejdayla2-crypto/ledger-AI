// src/pages/Home.jsx
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { formatINR } from '../lib/parse';
import './Home.css';

export default function Home() {
  const { user } = useAuth();

  return (
    <div className="home">
      {/* ── Navbar ── */}
      <nav className="home-nav">
        <div className="home-nav-logo">
          Ledger <span>AI Expense Agent</span>
        </div>
        <div className="home-nav-actions">
          {user ? (
            <Link to="/dashboard" className="btn btn-primary btn-sm">Open Dashboard</Link>
          ) : (
            <>
              <Link to="/login" className="btn btn-secondary btn-sm">Log in</Link>
              <Link to="/signup" className="btn btn-primary btn-sm">Sign up free</Link>
            </>
          )}
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="hero">
        <div className="hero-content fade-in">
          <div className="hero-eyebrow">
            <span>●</span> Personal finance, with a capable assistant
          </div>
          <h1>
            A clearer view<br />
            of your <em>money.</em>
          </h1>
          <p className="hero-sub">
            Ledger brings expenses, budgets, and spending insights into one focused workspace.
            Log transactions naturally, ask questions in plain English, and stay close to the numbers.
          </p>
          <div className="hero-cta">
            <Link to="/signup" className="btn btn-primary btn-lg">Start for free</Link>
            <Link to="/login" className="btn btn-secondary btn-lg" style={{background:'transparent',border:'1.5px solid var(--mist-dark)'}}>
              Demo: demo@ledger.app / demo1234
            </Link>
          </div>
          <div className="hero-trust">
            <span><strong>01</strong> Real-time expense tracking</span>
            <span><strong>02</strong> Private account data</span>
          </div>
        </div>

        <div className="hero-visual fade-in">
          <div className="chat-preview">
            <div className="chat-preview-header">
              <div className="chat-preview-dot active"></div>
              <div className="chat-preview-dot"></div>
              <div className="chat-preview-dot"></div>
              <span style={{marginLeft:'0.25rem'}}>Ledger Agent</span>
            </div>
            <div className="chat-preview-body">
              <div className="chat-bubble user">I spent 350 on lunch today</div>
              <div className="chat-bubble agent">
                Got it — logged ₹350 for <strong>Lunch</strong> under Food.
                Your food spending this month is ₹3,770.
              </div>
              <div className="chat-action-log">✓ Added: Lunch — ₹350 · Food</div>
              <div className="chat-bubble user">How much on transport last month?</div>
              <div className="chat-bubble agent">
                You spent <strong>₹4,840</strong> on Transport last month across 16 transactions.
                Ola cabs were your biggest expense at ₹1,890.
              </div>
              <div className="chat-bubble user">Set my food budget to 8000</div>
              <div className="chat-bubble agent">
                Done — Food budget set to <strong>₹8,000/month</strong>.
                You're at 47% (₹3,770 of ₹8,000) with 18 days remaining.
              </div>
            </div>
            <div className="mini-ledger">
              {[
                { desc: 'Lunch', cat: 'Food', amount: 350 },
                { desc: 'Ola cab home', cat: 'Transport', amount: 220 },
                { desc: 'Netflix', cat: 'Entertainment', amount: 649 },
              ].map((row, i) => (
                <div key={i} className="mini-ledger-row">
                  <span className="mini-ledger-desc">{row.desc}</span>
                  <span className={`badge ${row.cat.toLowerCase() === 'food' ? 'cat-food' : row.cat.toLowerCase() === 'transport' ? 'cat-transport' : 'cat-entertainment'}`} style={{fontSize:'0.68rem'}}>
                    {row.cat}
                  </span>
                  <div className="mini-ledger-dots"></div>
                  <span className={`mini-ledger-amount ${row.cat.toLowerCase() === 'food' ? 'cat-food' : row.cat.toLowerCase() === 'transport' ? 'cat-transport' : 'cat-entertainment'}`}>
                    {formatINR(row.amount)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── How It Works ── */}
      <section className="how-it-works">
        <div className="section-header">
          <span className="section-eyebrow">How it works</span>
          <h2>Four steps to financial clarity</h2>
          <p>From first message to full picture — no forms, no faff.</p>
        </div>
        <div className="steps-grid">
          {[
            { n:'01', title:'Tell it what you spent', desc:'Type naturally: "350 lunch" or "Uber ₹180". The agent understands, logs, and categorises instantly.' },
            { n:'02', title:'It acts, not just talks', desc:'Every message triggers a real database action. The agent calls tools with strict schemas — no hallucinated numbers.' },
            { n:'03', title:'Ask anything about your money', desc:'"How much on food last month?" Returns real totals from your data, not AI estimates.' },
            { n:'04', title:'See it all on your dashboard', desc:'Charts, budgets, and transactions always reflect exactly what the agent did. One source of truth.' },
          ].map(s => (
            <div key={s.n} className="step-card">
              <div className="step-number">{s.n}</div>
              <h4>{s.title}</h4>
              <p>{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ── */}
      <section className="features">
        <div className="section-header">
          <span className="section-eyebrow">Features</span>
          <h2>Built for trust, not just demos</h2>
        </div>
        <div className="features-grid">
          {[
            { icon:'🔧', title:'Real tool-calling architecture', desc:'Gemini function calling — the AI calls your backend code, not free text. Deterministic, auditable.' },
            { icon:'↩️', title:'Undo anything', desc:'Every agent action is logged with enough detail to reverse it. One click on any action log entry.' },
            { icon:'🧠', title:'Learns your corrections', desc:'Re-tag "Swiggy" once. It remembers that Swiggy → Food forever, before even asking the AI.' },
            { icon:'📊', title:'Budgets with real alerts', desc:'Set a monthly limit. Get amber warnings at 80%, not red panic. Reserve red for real errors.' },
            { icon:'📈', title:'Spending forecast', desc:'"At this rate you\'ll spend ₹8,200 this month." Pure math from your real data, surfaced in chat and dashboard.' },
            { icon:'📂', title:'CSV import', desc:'Bulk-import past expenses with a preview step, per-row categorisation, and clear error reporting.' },
            { icon:'🔁', title:'Recurring detection', desc:'Netflix every month? The agent notices and offers to auto-log it — no manual setup.' },
            { icon:'📋', title:'Action log', desc:'A visible trail of everything the agent did. No black box — every add, edit, and delete is auditable.' },
          ].map(f => (
            <div key={f.title} className="feature-item">
              <div className="feature-icon">{f.icon}</div>
              <h4>{f.title}</h4>
              <p>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="home-cta">
        <h2>Start managing your money with an agent that actually acts.</h2>
        <p>Free to use. No credit card. Your data, your account.</p>
        <Link to="/signup" className="btn btn-white btn-lg">Create your account</Link>
      </section>

      <footer className="home-footer">
        © 2024 Ledger · Built with Gemini AI · All data is private to your account
      </footer>
    </div>
  );
}
