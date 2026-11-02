// src/hooks/useAuth.js
// React hook that manages authentication state throughout the app.
// "Hooks" are reusable pieces of logic in React — like a helper function that also knows about UI state.
//
// Usage in any component: const { user, loading, login, logout } = useAuth();

import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import api from '../lib/api';

// AuthContext: a "global store" for auth state, accessible from any component
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true); // true while we check if user is already logged in

  // On app start: check if there's an existing session (cookie)
  useEffect(() => {
    api.get('/auth/me')
      .then(res => setUser(res.data.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email, password) => {
    const res = await api.post('/auth/login', { email, password });
    setUser(res.data.user);
    return res.data;
  }, []);

  const signup = useCallback(async (email, password) => {
    const res = await api.post('/auth/signup', { email, password });
    setUser(res.data.user);
    return res.data;
  }, []);

  const logout = useCallback(async () => {
    await api.post('/auth/logout');
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
