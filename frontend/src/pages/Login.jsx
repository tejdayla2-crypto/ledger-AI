// src/pages/Login.jsx
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { formatError } from '../lib/api';
import './Auth.css';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/dashboard');
    } catch (err) {
      setError(err.response?.status === 502 || err.response?.status === 503 || err.response?.status === 504
        ? 'Sign-in service is temporarily unavailable. Start the backend and try again; signing in does not require the AI service.'
        : formatError(err, 'Sign-in failed. Check your email and password, then try again.'));
    } finally {
      setLoading(false);
    }
  }

  function fillDemo() {
    setEmail('demo@ledger.app');
    setPassword('demo1234');
  }

  return (
    <div className="auth-page">
      <div className="auth-form-side fade-in">
        <Link to="/" className="auth-logo">Ledger</Link>
        <h2 className="auth-title">Welcome back</h2>
        <p className="auth-subtitle">Sign in to your account to continue</p>

        {error && <div className="form-global-error">{error}</div>}

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input
              className="input"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              id="login-email"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Password</label>
            <div className="auth-password-field">
              <input
                className="input"
                type={showPassword ? 'text' : 'password'}
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                id="login-password"
              />
              <button type="button" className="auth-password-toggle" onClick={() => setShowPassword(value => !value)}
                aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}>
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>
          <button type="submit" className="btn btn-primary auth-submit" disabled={loading} id="login-submit">
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="auth-demo">
          <strong>Try the demo account</strong>
          demo@ledger.app · demo1234 ·
          <button onClick={fillDemo} className="btn btn-ghost btn-sm" style={{display:'inline',padding:'0 0.3rem',height:'auto',fontWeight:'500',color:'var(--ledger)'}}>
            Fill in
          </button>
        </div>

        <p className="auth-switch">
          Don't have an account? <Link to="/signup">Sign up free</Link>
        </p>
      </div>

      <div className="auth-visual">
        <p className="auth-visual-quote">
          "I asked it how much I spent on food last month. It told me ₹12,400. <em>Instantly. Correctly.</em>"
        </p>
        <div className="auth-stats">
          <div className="auth-stat">
            <span className="auth-stat-value">₹0</span>
            <span className="auth-stat-label">setup cost · always free</span>
          </div>
          <div className="auth-stat">
            <span className="auth-stat-value">10+</span>
            <span className="auth-stat-label">tools the agent can use</span>
          </div>
          <div className="auth-stat">
            <span className="auth-stat-value">100%</span>
            <span className="auth-stat-label">deterministic — no hallucinated numbers</span>
          </div>
        </div>
      </div>
    </div>
  );
}
