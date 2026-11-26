const crypto = require('crypto');
const express = require('express');
const { getIdTrustConfig } = require('../config/oauthConfig');
const { completeLogin } = require('../services/loginService');
const logger = require('../utils/logger');

const router = express.Router();
const stateTtlMs = 10 * 60 * 1000;

function getCookieConfig(config) {
  return {
    name: config.useSecureCookie ? '__Host-agentplaza-login' : 'agentplaza-login',
    options: { httpOnly: true, secure: config.useSecureCookie, sameSite: 'lax', path: '/' }
  };
}

function safeReturnPath(value) {
  if (typeof value !== 'string' || value.length > 1024 || !value.startsWith('/') || value.startsWith('//')) {
    return '/';
  }
  if (value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) return '/';
  const target = new URL(value, 'https://local.invalid');
  if (target.origin !== 'https://local.invalid') return '/';
  if ((target.pathname === '/api') || target.pathname.startsWith('/api/')) return '/';
  return target.pathname + target.search + target.hash;
}

function readState(req, cookieName) {
  const cookie = (req.headers.cookie || '').split(';').map(part => part.trim())
    .find(part => part.startsWith(cookieName + '='));
  if (!cookie) return null;
  try {
    return JSON.parse(decodeURIComponent(cookie.slice(cookieName.length + 1)));
  } catch {
    return null;
  }
}

router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  try {
    res.locals.identityProvider = getIdTrustConfig();
  } catch {
    return res.status(503).json({ code: 503, success: false, message: 'Identity provider is not configured' });
  }
  next();
});

router.get('/start', (req, res) => {
  const config = res.locals.identityProvider;
  const cookie = getCookieConfig(config);
  const state = crypto.randomBytes(32).toString('hex');
  const returnTo = safeReturnPath(req.query.returnTo);
  res.cookie(
    cookie.name,
    JSON.stringify({ state, returnTo, expiresAt: Date.now() + stateTtlMs }),
    { ...cookie.options, maxAge: stateTtlMs }
  );

  const authorize = new URL(config.host + '/oauth2/authorize');
  authorize.search = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    state
  });
  res.redirect(authorize.toString());
});

router.post('/', async (req, res) => {
  const config = res.locals.identityProvider;
  const { code, state } = req.body || {};
  if (typeof code !== 'string' || !code || code.length > 4096 || typeof state !== 'string') {
    return res.status(400).json({ code: 400, success: false, message: 'Authorization code and state are required' });
  }

  const cookie = getCookieConfig(config);
  const transaction = readState(req, cookie.name);
  if (!transaction || transaction.state !== state || !(transaction.expiresAt > Date.now())) {
    return res.status(401).json({ code: 401, success: false, message: 'Login state is invalid or expired' });
  }
  res.clearCookie(cookie.name, cookie.options);

  try {
    const result = await completeLogin(code, config);
    return res.json({ code: 200, ...result, returnTo: safeReturnPath(transaction.returnTo) });
  } catch {
    logger.warn('Identity provider login did not complete');
    return res.status(401).json({ code: 401, success: false, message: 'Login failed' });
  }
});

module.exports = router;
