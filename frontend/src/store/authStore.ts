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
        // Clear any transient forced-password-change token so an abandoned
        // first-login flow can't leave a usable credential behind in the tab
        // (the persisted auth-storage is overwritten by the set() below).
        if (typeof window !== 'undefined') {
          sessionStorage.removeItem('temp-auth-token');
        }
        set({ user, token, isAuthenticated: true });
      },
      logout: () => {
        if (typeof window !== 'undefined') {
          sessionStorage.removeItem('temp-auth-token');
        }
        set({ user: null, token: null, isAuthenticated: false });
      },
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
