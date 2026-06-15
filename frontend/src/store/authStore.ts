import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { User, UserPreferences } from '../types';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  login: (user: User) => void;
  logout: () => void;
  setPreferences: (preferences: UserPreferences) => void;
  updateProfile: (updates: { email?: string | null; phone?: string | null }) => void;
}

// The JWT lives only in an httpOnly cookie (set by the backend) and is never
// stored in JS-readable storage. This store keeps just the non-sensitive user
// profile + auth flag for rendering; auth transport is handled by the cookie.
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      login: (user) => set({ user, isAuthenticated: true }),
      logout: () => set({ user: null, isAuthenticated: false }),
      setPreferences: (preferences) =>
        set((state) => (state.user ? { user: { ...state.user, preferences } } : {})),
      updateProfile: (updates) =>
        set((state) => (state.user ? { user: { ...state.user, ...updates } } : {})),
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
