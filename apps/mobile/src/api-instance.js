import { createApi } from './api.js';
import { API_URL } from './config.js';
import { getToken } from './session.js';

export const api = createApi({ baseUrl: API_URL, getToken });
