export function normalizeLoginReturnPath(path?: string): string {
  if (!path?.startsWith('/') || path.startsWith('//') || /[\\\r\n]/.test(path)) return '/';
  const url = new URL(path, window.location.origin);
  if (url.origin !== window.location.origin || url.pathname === '/login') return '/';
  for (const key of ['code', 'state', 'error', 'error_description', 'qw_token']) {
    url.searchParams.delete(key);
  }
  return url.pathname + url.search + url.hash;
}

export function getCurrentLocationForLogin(): string {
  return normalizeLoginReturnPath(window.location.pathname + window.location.search + window.location.hash);
}

export function buildLoginUrl(targetUrl: string = getCurrentLocationForLogin()): string {
  return '/api/login/start?' + new URLSearchParams({ returnTo: normalizeLoginReturnPath(targetUrl) });
}

export function clearAuthSession() {
  for (const key of ['token', 'user', 'userInfo', 'userId', 'userBadge']) {
    localStorage.removeItem(key);
  }
}
