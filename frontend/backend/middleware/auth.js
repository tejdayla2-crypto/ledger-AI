// middleware/auth.js
// This file "guards" our API routes.
// It checks if the user has a valid login token (JWT) before allowing access.
//
// How it works:
// 1. User logs in → server creates a "token" (like a signed badge)
// 2. Browser stores that token in a cookie
// 3. Every request to the API sends the cookie automatically
// 4. This middleware reads the cookie, verifies it's real, and adds user info to req.user

const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  // Get the token from the cookie (set during login)
  const token = req.cookies?.ledger_token;

  if (!token) {
    return res.status(401).json({ error: 'Not logged in. Please sign in first.' });
  }

  try {
    // Verify the token using the secret key from .env
    // If the token was tampered with or expired, this throws an error
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Attach user info to the request so route handlers can use it
    req.user = { id: decoded.userId, email: decoded.email };

    // Call next() to continue to the actual route handler
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Session expired. Please log in again.' });
  }
}

module.exports = { requireAuth };
