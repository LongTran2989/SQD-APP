import axios from 'axios';
import { useAuthStore } from '../store/authStore';

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  // Auth rides an httpOnly cookie set by the backend; send it on every request.
  // The token is never read by JS, so an XSS cannot exfiltrate it.
  withCredentials: true,
});

// Multi-tab identity guard. The JWT lives in a browser-wide httpOnly cookie
// (shared across every tab of this origin), but the displayed identity lives in
// per-tab sessionStorage. If a second user logs in from another tab, the cookie
// is overwritten while this tab still renders the original user — so its
// requests would silently execute with the other user's privileges. We stamp
// each request with the user id THIS tab believes it is acting as (read fresh
// from the store), so the backend can reject a cookie/identity mismatch. The id
// is not a credential, so exposing it in a header is safe.
apiClient.interceptors.request.use((config) => {
  const userId = useAuthStore.getState().user?.id;
  if (userId != null) {
    config.headers['X-Acting-User-Id'] = String(userId);
  }
  return config;
});

// Key under which a human-readable "why you were signed out" notice is stashed
// for the login page to render after the full-page redirect below (audit U8).
export const AUTH_NOTICE_KEY = 'auth_notice';

// Map the backend's session-invalidation 401 messages to a friendly explanation.
// Only the cases where an ACTIVE session was revoked produce a notice — a plain
// "no token" 401 (e.g. landing on a protected page while logged out) does not.
const signOutNotice = (serverMessage: string): string | null => {
  const m = serverMessage.toLowerCase();
  if (m.includes('another tab')) {
    return 'You were signed out because a different user signed in to this browser. Please log in again.';
  }
  if (m.includes('another location') || m.includes('session expired')) {
    return 'You were signed out because your account signed in on another device. Please log in again.';
  }
  if (m.includes('no longer active')) {
    return 'Your session has ended because the account is no longer active.';
  }
  return null;
};

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    // Handle 401s globally: explain the sign-out (audit U8) then redirect to login.
    if (error.response?.status === 401 && typeof window !== 'undefined') {
      const notice = signOutNotice(error.response?.data?.message || '');
      if (notice) {
        sessionStorage.setItem(AUTH_NOTICE_KEY, notice);
      }
      useAuthStore.getState().logout();
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);
