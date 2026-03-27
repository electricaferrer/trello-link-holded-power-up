export const TRELLO_APP_KEY = import.meta.env.VITE_TRELLO_APP_KEY;

const rawProxyUrl = import.meta.env.VITE_HOLDED_PROXY_URL || '';
export const HOLDED_PROXY_URL = rawProxyUrl.startsWith('http') ? rawProxyUrl : `https://${rawProxyUrl}`;
