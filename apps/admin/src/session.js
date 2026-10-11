import { createApi } from './api.js';

const KEY = 'pick.admin.token';
export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

let token = null;
try { token = localStorage.getItem(KEY); } catch { /* storage blocked */ }

export const getToken = () => token;
export function saveToken(t) {
  token = t;
  try { localStorage.setItem(KEY, t); } catch { /* storage blocked */ }
}
export function clearToken() {
  token = null;
  try { localStorage.removeItem(KEY); } catch { /* storage blocked */ }
}

export const api = createApi({ baseUrl: API_URL, getToken });
