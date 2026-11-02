// src/pages/Signup.jsx
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import './Auth.css';

export default function Signup() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { signup } = useAuth();
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
      setError(err.response?.data?.error || 'Signup failed. Please try again.');
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

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input className="input" type="email" placeholder="you@example.com"
              value={email} onChange={e => setEmail(e.target.value)} required id="signup-email" />
          </div>
          <div className="form-group">
            <label className="form-label">Password</label>
            <div className="auth-password-field">
              <input className="input" type={showPassword ? 'text' : 'password'} placeholder="Min 6 characters"
                value={password} onChange={e => setPassword(e.target.value)} required id="signup-password" />
              <button type="button" className="auth-password-toggle" onClick={() => setShowPassword(value => !value)}
                aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}>
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Confirm Password</label>
            <div className="auth-password-field">
              <input className="input" type={showConfirm ? 'text' : 'password'} placeholder="Repeat password"
                value={confirm} onChange={e => setConfirm(e.target.value)} required id="signup-confirm" />
              <button type="button" className="auth-password-toggle" onClick={() => setShowConfirm(value => !value)}
                aria-label={showConfirm ? 'Hide confirm password' : 'Show confirm password'} aria-pressed={showConfirm}>
                {showConfirm ? 'Hide' : 'Show'}
              </button>
            </div>
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
