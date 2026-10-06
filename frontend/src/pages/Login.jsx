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
  const { login, loginWithGoogle, isFirebaseConfigured } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/dashboard');
    } catch (err) {
      setError(formatError(err, 'Login failed. Please try again.'));
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
      console.error('Google login error:', err);
      setError(formatError(err, 'Google sign-in failed. Please try again.'));
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
          {loading ? 'Connecting…' : 'Continue with Google'}
        </button>

        {!isFirebaseConfigured && (
          <div className="auth-firebase-hint">
            ⚡ <strong>Firebase Ready:</strong> Add your Firebase Web App keys in <code>frontend/.env</code> to activate 1-click Google Sign-In.
          </div>
        )}

        <div className="auth-divider">
          <span>or continue with email</span>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="login-email">Email</label>
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
            <label className="form-label" htmlFor="login-password">Password</label>
            <div className="password-input-wrap">
              <input
                className="input"
                type={showPassword ? 'text' : 'password'}
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                id="login-password"
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword(value => !value)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
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
