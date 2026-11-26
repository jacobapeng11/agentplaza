function getFrontendUrl() {
  const value = process.env.FRONTEND_URL?.trim();
  if (!value) return null;

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('FRONTEND_URL must be a valid origin');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('FRONTEND_URL must be an HTTPS origin or an HTTP loopback origin');
  }
  return url.origin;
}

module.exports = { getFrontendUrl };
