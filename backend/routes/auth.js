// routes/auth.js
// Handles: Sign up, Log in, Log out, Get current user

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/schema');
const { requireAuth } = require('../middleware/auth');
const { verifyFirebaseIdToken, isFirebaseAdminConfigured } = require('../lib/firebaseAdmin');

const router = express.Router();

// Helper: create and send a JWT cookie
function sendAuthToken(res, user) {
  const token = jwt.sign(
    { userId: user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: '7d' } // token lasts 7 days
  );

  const isProduction = process.env.NODE_ENV === 'production';
  // httpOnly = JavaScript in the browser CANNOT read this cookie directly
  // In production (cross-domain Vercel frontend -> Render backend), sameSite: 'none' and secure: true are required
  res.cookie('ledger_token', token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days in milliseconds
  });

  return token;
}

// POST /api/auth/signup
// Creates a new user account
router.post('/signup', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    const db = getDb();

    // Check if email already registered
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    // Hash the password — NEVER store plain text passwords
    // bcrypt adds a random "salt" so two identical passwords have different hashes
    const hash = await bcrypt.hash(password, 12);
    const userId = uuidv4();

    db.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)').run(
      userId, email.toLowerCase(), hash
    );

    const user = { id: userId, email: email.toLowerCase() };
    const token = sendAuthToken(res, user);

    res.json({ user: { id: userId, email: email.toLowerCase() }, token, isNewUser: true });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Compare entered password with stored hash
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = sendAuthToken(res, user);
    res.json({ user: { id: user.id, email: user.email }, token });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  const isProduction = process.env.NODE_ENV === 'production';
  res.clearCookie('ledger_token', {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax'
  });
  res.json({ message: 'Logged out successfully.' });
});

// GET /api/auth/firebase-status — returns whether Firebase Admin is configured on the backend
router.get('/firebase-status', (req, res) => {
  res.json({
    configured: isFirebaseAdminConfigured(),
    projectId: process.env.FIREBASE_PROJECT_ID || null
  });
});

// POST /api/auth/firebase-login — validates Firebase ID token and logs the user in
router.post('/firebase-login', async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) {
      return res.status(400).json({ error: 'Firebase ID token is required.' });
    }

    if (!isFirebaseAdminConfigured()) {
      return res.status(503).json({
        error: 'Firebase Admin is not configured on the server. Please add your Firebase credentials to backend/.env.'
      });
    }

    const decoded = await verifyFirebaseIdToken(idToken);
    const email = (decoded.email || `${decoded.uid}@firebase.ledger.local`).toLowerCase();
    const firebaseUid = decoded.uid;

    const db = getDb();

    // Check if user already exists by firebase_uid or by email
    let user = db.prepare('SELECT * FROM users WHERE firebase_uid = ?').get(firebaseUid);
    let isNewUser = false;

    if (!user) {
      user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      if (user) {
        // Link existing user to firebase_uid
        db.prepare('UPDATE users SET firebase_uid = ? WHERE id = ?').run(firebaseUid, user.id);
      } else {
        // Create brand new user
        const userId = uuidv4();
        const placeholderHash = `FIREBASE_AUTH_${firebaseUid}`;
        db.prepare(
          'INSERT INTO users (id, email, password_hash, firebase_uid) VALUES (?, ?, ?, ?)'
        ).run(userId, email, placeholderHash, firebaseUid);

        user = { id: userId, email, currency: 'INR' };
        isNewUser = true;
      }
    }

    const token = sendAuthToken(res, user);
    res.json({
      user: { id: user.id, email: user.email, currency: user.currency || 'INR' },
      token,
      isNewUser
    });
  } catch (err) {
    console.error('Firebase login error:', err);
    res.status(401).json({ error: 'Failed to verify Firebase token: ' + (err.message || 'Unauthorized') });
  }
});

// GET /api/auth/me — returns current user (used on page refresh to restore session)
router.get('/me', requireAuth, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, email, currency, firebase_uid FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json({ user });
});

module.exports = router;
