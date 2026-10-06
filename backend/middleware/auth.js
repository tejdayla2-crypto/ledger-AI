// middleware/auth.js
// Guards API routes by verifying either the session cookie (JWT) or Authorization Bearer header (JWT / Firebase ID Token).

const jwt = require('jsonwebtoken');
const { verifyFirebaseIdToken, isFirebaseAdminConfigured } = require('../lib/firebaseAdmin');
const { getDb } = require('../db/schema');

async function requireAuth(req, res, next) {
  // 1. Get the token from cookie (standard web session)
  const cookieToken = req.cookies?.ledger_token;
  if (cookieToken) {
    try {
      const decoded = jwt.verify(cookieToken, process.env.JWT_SECRET);
      req.user = { id: decoded.userId, email: decoded.email };
      return next();
    } catch (err) {
      // Proceed to check header if cookie expired
    }
  }

  // 2. Check Authorization header: Bearer <token>
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const bearerToken = authHeader.substring(7).trim();
    if (bearerToken) {
      // Try local JWT first
      try {
        const decoded = jwt.verify(bearerToken, process.env.JWT_SECRET);
        req.user = { id: decoded.userId, email: decoded.email };
        return next();
      } catch (_) {}

      // Try Firebase ID token if configured
      if (isFirebaseAdminConfigured()) {
        try {
          const decoded = await verifyFirebaseIdToken(bearerToken);
          const db = getDb();
          let user = db.prepare('SELECT id, email FROM users WHERE firebase_uid = ?').get(decoded.uid);
          if (!user && decoded.email) {
            user = db.prepare('SELECT id, email FROM users WHERE email = ?').get(decoded.email.toLowerCase());
          }
          if (user) {
            req.user = { id: user.id, email: user.email };
            return next();
          }
        } catch (_) {}
      }
    }
  }

  return res.status(401).json({ error: 'Not logged in. Please sign in first.' });
}

module.exports = { requireAuth };
