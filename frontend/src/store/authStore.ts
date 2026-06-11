import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { User, UserPreferences } from '../types';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (user: User, token: string) => void;
  logout: () => void;
  setPreferences: (preferences: UserPreferences) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      login: (user, token) => {
        // Drop any leftover session first so a stale token from a previous
        // account (same tab, no logout) can never coexist with the new user.
        if (typeof window !== 'undefined') {
          sessionStorage.removeItem('auth-storage');
        }
        set({ user, token, isAuthenticated: true });
      },
      logout: () => set({ user: null, token: null, isAuthenticated: false }),
      setPreferences: (preferences) =>
        set((state) => (state.user ? { user: { ...state.user, preferences } } : {})),
    }),
    {
      name: 'auth-storage', // key in sessionStorage
      storage: {
        getItem: (name) => {
          const str = sessionStorage.getItem(name);
          return str ? JSON.parse(str) : null;
        },
        setItem: (name, value) => sessionStorage.setItem(name, JSON.stringify(value)),
        removeItem: (name) => sessionStorage.removeItem(name),
      },
    }
  )
);
