// src/pages/Signup.jsx
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { formatError } from '../lib/api';
import './Auth.css';

export default function Signup() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { signup, loginWithGoogle, isFirebaseConfigured } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    setLoading(true);
    try {
      await signup(email, password);
      navigate('/dashboard');
    } catch (err) {
      setError(formatError(err, 'Signup failed. Please try again.'));
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleLogin() {
    setError('');
    setLoading(true);
    try {
      await loginWithGoogle();
      navigate('/dashboard');
    } catch (err) {
      console.error('Google sign-up error:', err);
      setError(formatError(err, 'Google sign-in failed. Please try again.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-form-side fade-in">
        <Link to="/" className="auth-logo">Ledger</Link>
        <h2 className="auth-title">Create your account</h2>
        <p className="auth-subtitle">Free forever. No credit card needed.</p>

        {error && <div className="form-global-error">{error}</div>}

        {/* Google Sign-in with Firebase */}
        <button
          type="button"
          className="auth-google-btn"
          onClick={handleGoogleLogin}
          disabled={loading || !isFirebaseConfigured}
          title={isFirebaseConfigured ? 'Sign in with Google' : 'Configure Firebase in frontend/.env to enable Google Sign-In'}
        >
          <svg className="auth-google-icon" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.66v3.05h3.87c2.27-2.09 3.67-5.17 3.67-9.15z"
            />
            <path
              fill="#34A853"
              d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.87-3.05c-1.08.72-2.45 1.16-4.06 1.16-3.13 0-5.78-2.11-6.73-4.96H1.25v3.15C3.25 21.36 7.34 24 12 24z"
            />
            <path
              fill="#FBBC05"
              d="M5.27 14.24c-.25-.72-.38-1.49-.38-2.24s.13-1.52.38-2.24V6.61H1.25C.45 8.22 0 10.06 0 12s.45 3.78 1.25 5.39l4.02-3.15z"
            />
            <path
              fill="#EA4335"
              d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.94 1.19 15.23 0 12 0 7.34 0 3.25 2.64 1.25 6.61l4.02 3.15c.95-2.85 3.6-4.96 6.73-4.96z"
            />
          </svg>
          {loading ? 'Connecting…' : 'Sign up with Google'}
        </button>

        {!isFirebaseConfigured && (
          <div className="auth-firebase-hint">
            ⚡ <strong>Firebase Ready:</strong> Add your Firebase Web App keys in <code>frontend/.env</code> to activate 1-click Google Sign-In.
          </div>
        )}

        <div className="auth-divider">
          <span>or sign up with email</span>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="signup-email">Email</label>
            <input className="input" type="email" placeholder="you@example.com"
              value={email} onChange={e => setEmail(e.target.value)} required id="signup-email" />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="signup-password">Password</label>
            <input className="input" type="password" placeholder="Min 6 characters"
              value={password} onChange={e => setPassword(e.target.value)} required id="signup-password" />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="signup-confirm">Confirm Password</label>
            <input className="input" type="password" placeholder="Repeat password"
              value={confirm} onChange={e => setConfirm(e.target.value)} required id="signup-confirm" />
          </div>
          <button type="submit" className="btn btn-primary auth-submit" disabled={loading} id="signup-submit">
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="auth-switch">Already have an account? <Link to="/login">Sign in</Link></p>
      </div>

      <div className="auth-visual">
        <p className="auth-visual-quote">
          An AI that <em>acts on your behalf</em> — logs, categorises, answers — backed by real database operations, not chat.
        </p>
        <div className="auth-stats">
          <div className="auth-stat">
            <span className="auth-stat-value">10</span>
            <span className="auth-stat-label">built-in agent tools</span>
          </div>
          <div className="auth-stat">
            <span className="auth-stat-value">∞</span>
            <span className="auth-stat-label">expenses you can track</span>
          </div>
          <div className="auth-stat">
            <span className="auth-stat-value">1</span>
            <span className="auth-stat-label">source of truth — chat = dashboard</span>
          </div>
        </div>
      </div>
    </div>
  );
}
