import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// Keeps the sign-in token: in the phone's secure storage, or the browser's storage on web.
const KEY = 'pick.token';

const web = {
  get: async () => { try { return globalThis.localStorage?.getItem(KEY) ?? null; } catch { return null; } },
  set: async (v) => { try { globalThis.localStorage?.setItem(KEY, v); } catch { /* storage blocked */ } },
  clear: async () => { try { globalThis.localStorage?.removeItem(KEY); } catch { /* storage blocked */ } },
};

const native = {
  get: () => SecureStore.getItemAsync(KEY),
  set: (v) => SecureStore.setItemAsync(KEY, v),
  clear: () => SecureStore.deleteItemAsync(KEY),
};

const store = Platform.OS === 'web' ? web : native;

let cached;
export async function loadToken() {
  cached ??= await store.get();
  return cached;
}
export async function saveToken(token) {
  cached = token;
  await store.set(token);
}
export async function clearToken() {
  cached = null;
  await store.clear();
}
export const getToken = () => cached ?? loadToken();
