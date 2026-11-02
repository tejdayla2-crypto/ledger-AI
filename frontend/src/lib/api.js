// src/lib/api.js
// Axios instance configured to talk to our Express backend.
// All API calls in the app go through this, so we only configure it once.

import axios from 'axios';

const api = axios.create({
  baseURL: '/api',          // Vite proxy forwards /api → localhost:3001/api
  withCredentials: true,    // IMPORTANT: sends cookies (JWT token) with every request
  timeout: 30000,           // 30 seconds timeout
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

export function formatError(error, fallback = 'Something went wrong. Please try again.') {
  if (!error) return fallback;
  if (typeof error === 'string') return error;

  const response = error.response;
  if (response) {
    if (response.status === 404) {
      return 'API endpoint not found. Make sure both the frontend and backend are running.';
    }

    const message = response.data?.error || response.data?.reply || response.data?.message;
    if (typeof message === 'string') return message;
    if (message && typeof message === 'object' && typeof message.message === 'string') {
      return message.message;
    }
    if ([502, 503, 504].includes(response.status)) {
      return 'The backend or AI service is temporarily unavailable. Please try again.';
    }
  }

  if (error.code === 'ERR_NETWORK' || error.message?.includes('Network Error')) {
    return 'Cannot reach the backend server. Run npm run dev from the project root.';
  }

  if (typeof error.message === 'string') return error.message;
  return fallback;
}

export default api;
