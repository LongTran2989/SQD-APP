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

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    // Optionally handle 401s globally (e.g. redirect to login)
    if (error.response?.status === 401) {
      if (typeof window !== 'undefined') {
        useAuthStore.getState().logout();
        if (window.location.pathname !== '/login') {
          window.location.href = '/login';
        }
      }
    }
    return Promise.reject(error);
  }
);
