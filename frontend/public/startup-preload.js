// Start independent home data while the application bundle downloads and initializes.
(() => {
  try {
    if (location.pathname !== '/' || location.search) return;
    const token = localStorage.getItem('token');
    if (!token || !localStorage.getItem('user')) return;
    const sortBy = (localStorage.getItem('plaza_sort_preference') || 'latest') === 'latest' ? 'createdAt' : 'hotScore';
    const paths = [
      '/api/categories',
      `/api/categories/all/apps?page=1&limit=20&sortBy=${sortBy}`,
      '/api/apps-new/my-created?limit=4',
      '/api/apps-new/my-collected?limit=1000'
    ];
    const entries = new Map();
    window.__PLAZA_STARTUP__ = entries;
    for (const path of paths) {
      const url = new URL(path, location.origin);
      url.searchParams.sort();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const promise = fetch(url.href, {
        headers: { Authorization: `Bearer ${token}`, AuthToken: token },
        credentials: 'same-origin', cache: 'no-store', signal: controller.signal
      }).catch(() => null).finally(() => clearTimeout(timer));
      entries.set(url.href, { token, startedAt: Date.now(), promise });
    }
    setTimeout(() => entries.clear(), 10000);
  } catch {
    // Storage restrictions must not prevent normal application startup.
  }
})();
