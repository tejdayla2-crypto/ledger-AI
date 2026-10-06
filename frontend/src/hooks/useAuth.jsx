// src/hooks/useAuth.jsx
// React hook that manages authentication state throughout the app.
// Supports both existing password-based auth and Firebase Authentication (Google & Email/Password).

import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import api from '../lib/api';
import {
  isFirebaseConfigured,
  loginWithGoogle as firebaseLoginWithGoogle,
  loginWithFirebaseEmail,
  signupWithFirebaseEmail,
  logoutFirebase
} from '../lib/firebase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // On app start: check if there's an existing session
  useEffect(() => {
    api.get('/auth/me')
      .then(res => setUser(res.data.user))
      .catch(() => {
        localStorage.removeItem('ledger_token');
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email, password) => {
    const res = await api.post('/auth/login', { email, password });
    if (res.data.token) {
      localStorage.setItem('ledger_token', res.data.token);
    }
    setUser(res.data.user);
    return res.data;
  }, []);

  const signup = useCallback(async (email, password) => {
    const res = await api.post('/auth/signup', { email, password });
    if (res.data.token) {
      localStorage.setItem('ledger_token', res.data.token);
    }
    setUser(res.data.user);
    return res.data;
  }, []);

  // Firebase Google Sign-In
  const loginWithGoogle = useCallback(async () => {
    const { idToken } = await firebaseLoginWithGoogle();
    const res = await api.post('/auth/firebase-login', { idToken });
    if (res.data.token) {
      localStorage.setItem('ledger_token', res.data.token);
    }
    setUser(res.data.user);
    return res.data;
  }, []);

  // Firebase Email/Password Login
  const loginWithFirebase = useCallback(async (email, password) => {
    const { idToken } = await firebaseLoginWithEmail(email, password);
    const res = await api.post('/auth/firebase-login', { idToken });
    if (res.data.token) {
      localStorage.setItem('ledger_token', res.data.token);
    }
    setUser(res.data.user);
    return res.data;
  }, []);

  // Firebase Email/Password Signup
  const signupWithFirebase = useCallback(async (email, password) => {
    const { idToken } = await signupWithFirebaseEmail(email, password);
    const res = await api.post('/auth/firebase-login', { idToken });
    if (res.data.token) {
      localStorage.setItem('ledger_token', res.data.token);
    }
    setUser(res.data.user);
    return res.data;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch (err) {
      console.warn('Backend logout warning:', err);
    }
    try {
      await logoutFirebase();
    } catch (err) {
      console.warn('Firebase logout warning:', err);
    }
    localStorage.removeItem('ledger_token');
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        signup,
        loginWithGoogle,
        loginWithFirebase,
        signupWithFirebase,
        logout,
        isFirebaseConfigured: isFirebaseConfigured()
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
