import { useState, useEffect } from 'react';
import { 
  onAuthStateChanged, 
  GoogleAuthProvider, signOut,
  signInWithRedirect, getRedirectResult,
  signInWithPopup
} from 'firebase/auth';
import { auth } from '../firebase';

export const useSolarAuth = () => {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  useEffect(() => {
    let isMounted = true;

    const init = async () => {
      try {
        const result = await getRedirectResult(auth);
        if (result?.user && isMounted) {
          setUser(result.user);
        }
      } catch (err) {
        console.error("Redirect Auth Error:", err);
        setAuthError(`Authentication failed: ${err.message || "Custom domain not authorized"}. Please check Firebase/Google Console settings.`);
        setAuthLoading(false);
      }
    };

    init();

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (!isMounted) return;
      setUser(currentUser);
      setAuthLoading(false);
      if (currentUser) setAuthError(null);
    });

    const timer = setTimeout(() => {
      if (isMounted) setAuthLoading(false);
    }, 4000);

    return () => {
      isMounted = false;
      unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  const login = async () => {
    const provider = new GoogleAuthProvider();
    setAuthLoading(true);
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      if (err.code === 'auth/popup-blocked' || err.code === 'auth/popup-closed-by-user' || err.code === 'auth/unauthorized-domain') {
         try {
           await signInWithRedirect(auth, provider);
         } catch (redirectErr) {
           setAuthError(redirectErr.message);
           setAuthLoading(false);
         }
      } else {
         setAuthError(err.message);
         setAuthLoading(false);
      }
    }
  };

  const logout = async () => {
    try {
      const { clearSensitiveData } = await import('../firebase');
      await clearSensitiveData();
      await signOut(auth);
      window.location.reload(); // Force a clean slate
    } catch (e) {
      console.error("Logout failed:", e);
    }
  };

  return { user, authLoading, authError, login, logout };
};
