'use client';

import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import {
  onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail, EmailAuthProvider, reauthenticateWithCredential, updatePassword,
} from 'firebase/auth';
import { doc, onSnapshot, writeBatch, terminate, clearIndexedDbPersistence } from 'firebase/firestore';
import { auth, db, isFirebaseConfigured } from '@/lib/firebase';
import { COL } from '@/lib/constants';
import { userCan } from '@/lib/permissions';
import { writeAudit } from '@/services/db';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setLoading(false);
      return undefined;
    }
    let unsubProfile = null;
    const unsub = onAuthStateChanged(auth, (u) => {
      setFirebaseUser(u);
      if (unsubProfile) unsubProfile();
      if (!u) {
        setProfile(null);
        setError(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      unsubProfile = onSnapshot(
        doc(db, COL.users, u.uid),
        (s) => {
          if (!s.exists()) {
            setProfile(null);
            setError('Your login is not linked to a staff profile. Contact the Super Admin.');
          } else {
            const p = s.data();
            if (p.active === false) {
              setProfile(null);
              setError('Your account is disabled. Contact the Super Admin.');
            } else {
              setProfile({ uid: u.uid, email: u.email, ...p, name: p.name || u.displayName || u.email });
              setError(null);
            }
          }
          setLoading(false);
        },
        (e) => {
          setError(e.message);
          setLoading(false);
        },
      );
    });
    return () => {
      unsub();
      if (unsubProfile) unsubProfile();
    };
  }, []);

  const login = useCallback(async (email, password) => {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    try {
      const b = writeBatch(db);
      writeAudit(b, { uid: cred.user.uid, name: cred.user.displayName || email }, { collection: COL.users, docId: cred.user.uid, ref: email, action: 'login' });
      await b.commit();
    } catch {
      /* login audit is best-effort */
    }
    return cred;
  }, []);

  // sign out AND wipe the offline cache, so no financial data stays on a shared office PC
  const logout = useCallback(async () => {
    await signOut(auth);
    try {
      await terminate(db);
      await clearIndexedDbPersistence(db);
    } catch {
      /* another tab still open – cache is cleared when the last tab signs out */
    }
    window.location.replace('/login');
  }, []);
  const resetPassword = useCallback((email) => sendPasswordResetEmail(auth, email), []);

  /** Self-service password change (re-authenticates with the current password first) */
  const changePassword = useCallback(async (currentPassword, newPassword) => {
    const u = auth.currentUser;
    if (!u) throw new Error('Not signed in');
    try {
      await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, currentPassword));
    } catch {
      throw new Error('Current password is wrong');
    }
    await updatePassword(u, newPassword);
    try {
      const b = writeBatch(db);
      writeAudit(b, profile || { uid: u.uid, name: u.email }, { collection: COL.users, docId: u.uid, ref: u.email, action: 'change_password' });
      await b.commit();
    } catch { /* best-effort */ }
  }, [profile]);

  const value = useMemo(() => ({
    firebaseUser,
    user: profile,
    role: profile?.role || null,
    loading,
    error,
    login,
    logout,
    resetPassword,
    changePassword,
    can: (perm) => userCan(profile, perm),
  }), [firebaseUser, profile, loading, error, login, logout, resetPassword, changePassword]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
