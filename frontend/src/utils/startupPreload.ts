import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';

declare global {
  interface Window {
    __PLAZA_STARTUP__?: Map<string, {
      token: string;
      startedAt: number;
      promise: Promise<Response | null>;
    }>;
  }
}

// Reuse the raw response through Axios, preserving JSON transforms and all response/error interceptors.
export function reuseStartupPreload(config: InternalAxiosRequestConfig) {
  if (config.method !== 'get' || !window.__PLAZA_STARTUP__) return;
  const url = new URL(`${config.baseURL || ''}${config.url || ''}`, window.location.origin);
  Object.entries(config.params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  });
  url.searchParams.sort();
  const entry = window.__PLAZA_STARTUP__.get(url.href);
  if (!entry) return;
  window.__PLAZA_STARTUP__.delete(url.href);
  if (Date.now() - entry.startedAt > 10000 || config.headers.Authorization !== `Bearer ${entry.token}`) return;
  const fallback = axios.getAdapter(config.adapter);
  config.adapter = async adapterConfig => {
    const response = await entry.promise;
    if (adapterConfig.signal?.aborted) throw new axios.CanceledError();
    if (!response) return fallback(adapterConfig);
    const result = {
      data: await response.text(), status: response.status, statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()), config: adapterConfig
    };
    if (!adapterConfig.validateStatus || adapterConfig.validateStatus(response.status)) return result;
    throw new AxiosError(`Request failed with status code ${response.status}`,
      response.status >= 500 ? 'ERR_BAD_RESPONSE' : 'ERR_BAD_REQUEST', adapterConfig, undefined, result);
  };
}
