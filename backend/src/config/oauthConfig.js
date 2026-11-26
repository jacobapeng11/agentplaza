const { getFrontendUrl } = require('./frontendUrl');

function parseHttpUrl(value) {
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
      || url.username || url.password || url.search || url.hash) {
    throw new Error('Invalid authentication URL');
  }
  return url;
}

function getIdTrustConfig() {
  const clientId = process.env.OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.OAUTH_CLIENT_SECRET;
  const host = process.env.OAUTH_HOST?.trim();
  const redirect = process.env.OAUTH_REDIRECT_URI?.trim();
  if (!host || !clientId || !clientSecret || !redirect) {
    throw new Error('IdTrust authentication is not configured');
  }

  const provider = parseHttpUrl(host);
  const redirectUri = parseHttpUrl(redirect);
  if (redirectUri.origin !== getFrontendUrl() || redirectUri.pathname !== '/') {
    throw new Error('OAuth redirect URI must be the frontend root');
  }

  return {
    host: provider.href.replace(/\/+$/, ''),
    clientId,
    clientSecret,
    redirectUri: redirectUri.href,
    useSecureCookie: redirectUri.protocol === 'https:'
  };
}

module.exports = { getIdTrustConfig };
