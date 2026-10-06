// src/lib/api.js
// Axios instance configured to talk to our Express backend.
// All API calls in the app go through this, so we only configure it once.

import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  withCredentials: true,    // Sends cookies (JWT token) with every request
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' }
});

// Response interceptor: if the server returns 401 (unauthorized), redirect to login
api.interceptors.response.use(
  response => response,
  error => {
    if (error.response?.status === 401) {
      // Don't redirect if we're already on auth pages
      if (!window.location.pathname.includes('/login') && !window.location.pathname.includes('/signup')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

/**
 * Safely extracts a user-readable error message from any error
 * Prevents React Minified Error #31 (attempting to render error objects {code, message} in JSX).
 */
export function formatError(err, fallback = 'Something went wrong. Please try again.') {
  if (!err) return fallback;
  if (typeof err === 'string') return err;

  // Server HTTP response
  if (err.response) {
    if (err.response.status === 404) {
      return 'API endpoint not found (404). Please ensure the backend server is running with "cd backend && npm start" on port 3001.';
    }
    const dataErr = err.response.data?.error;
    if (dataErr) {
      if (typeof dataErr === 'string') return dataErr;
      if (typeof dataErr === 'object') return dataErr.message || JSON.stringify(dataErr);
    }
    if (err.response.data?.reply && typeof err.response.data.reply === 'string') {
      return err.response.data.reply;
    }
    if (err.response.status === 502 || err.response.status === 503 || err.response.status === 504) {
      return 'Cannot reach backend service. Please verify the backend is running on port 3001.';
    }
  }

  // Network error (e.g. backend server is stopped)
  if (err.code === 'ERR_NETWORK' || err.message?.includes('Network Error')) {
    return 'Cannot reach the backend server. Start it by running "cd backend && npm start".';
  }

  // Firebase auth specific codes
  if (err.code && typeof err.code === 'string') {
    if (err.code === 'auth/popup-closed-by-user') {
      return 'Sign-in popup was closed before completing.';
    }
    if (err.code === 'auth/operation-not-allowed') {
      return 'Google Sign-In is not enabled yet in Firebase Console. Go to Authentication -> Sign-in method and enable Google.';
    }
    if (err.code === 'auth/unauthorized-domain') {
      return 'This domain is not authorized in Firebase Console. Add your domain to Authentication -> Settings -> Authorized domains.';
    }
    if (err.code === 'auth/invalid-api-key') {
      return 'Invalid Firebase API key in frontend/.env.';
    }
  }

  if (err.message && typeof err.message === 'string') {
    return err.message;
  }

  return fallback;
}

export default api;
