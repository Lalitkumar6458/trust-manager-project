'use client';

import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { userCan } from '@/lib/permissions';
import { authApi } from '@/lib/api';
import { changeOwnPassword } from '@/services/users';

const AuthContext = createContext(null);

/**
 * Signed-in staff member. The session lives in an httpOnly cookie set by the server
 * (/api/auth/login); the browser only asks /api/auth/me who is signed in.
 */
export function AuthProvider({ children }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const r = await authApi.me();
      setProfile(r.user || null);
      setError(r.error || null);
    } catch {
      setError('Could not reach the server. Check your internet connection.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    // session expired on the server (any API call answered 401) → back to the login screen
    const onOut = () => { setProfile(null); if (!/^\/(login|setup|r\/|donate|portal)/.test(window.location.pathname)) window.location.replace('/login'); };
    window.addEventListener('tm:signedout', onOut);
    return () => window.removeEventListener('tm:signedout', onOut);
  }, [refresh]);

  const login = useCallback(async (email, password) => {
    const r = await authApi.login(email, password);
    if (r.needs2fa) return { needs2fa: true };
    setProfile(r.user);
    setError(null);
    return r.user;
  }, []);
  const verify2fa = useCallback(async (code) => {
    const r = await authApi.verify2fa(code);
    setProfile(r.user);
    setError(null);
    return r.user;
  }, []);

  const logout = useCallback(async () => {
    try { await authApi.logout(); } catch { /* signed out anyway */ }
    setProfile(null);
    window.location.replace('/login');
  }, []);

  /** There is no e-mail service: the Super Admin resets forgotten passwords (Users → Reset password) */
  const resetPassword = useCallback(async () => {
    throw new Error('Ask the Super Admin to reset your password (Users & Roles → Reset password).');
  }, []);

  /** Self-service password change (the server checks the current password first) */
  const changePassword = useCallback(async (currentPassword, newPassword) => {
    await changeOwnPassword(currentPassword, newPassword);
    setProfile((p) => (p ? { ...p, mustChangePassword: false } : p));
  }, []);

  const value = useMemo(() => ({
    user: profile,
    role: profile?.role || null,
    loading,
    error,
    login,
    verify2fa,
    logout,
    refresh,
    resetPassword,
    changePassword,
    can: (perm) => userCan(profile, perm),
  }), [profile, loading, error, login, verify2fa, logout, refresh, resetPassword, changePassword]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
