const axios = require('axios');
const crypto = require('crypto');
const { createAuthTokenAndStore } = require('../utils/auth');
const { resolveAdminBadges } = require('../config/adminBadges');
const { readIntegrationConfig } = require('../config/integrations');
const UsersDetail = require('../models/UsersDetail');

const providerRequest = axios.create({ timeout: 10000, maxRedirects: 0, maxContentLength: 1024 * 1024 });

async function completeLogin(code, config) {
  // The IdTrust-compatible token and profile endpoints use query parameters.
  // Keep TLS validation enabled and never log their request or response.
  const { data: token } = await providerRequest.get(config.host + '/oauth2/token', {
    params: {
      grant_type: 'authorization_code',
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri
    }
  });
  if (typeof token?.access_token !== 'string' || !token.access_token) {
    throw new Error('Identity provider did not issue an access token');
  }

  const { data: profile } = await providerRequest.get(config.host + '/oauth2/get_user_info', {
    params: { access_token: token.access_token }
  });
  const badge = ['string', 'number'].includes(typeof profile?.name) ? String(profile.name).trim() : '';
  if (!badge || badge.length > 128) throw new Error('Identity provider did not return an account identifier');

  const identifiers = [badge];
  const numericBadge = Number(badge);
  if (Number.isSafeInteger(numericBadge) && String(numericBadge) === badge) identifiers.push(numericBadge);
  const detail = await UsersDetail.findOne({ Badge: { $in: identifiers } })
    .select('Name DepartmentCode depiddesc teamId')
    .lean();
  const userInfo = {
    Badge: badge,
    Name: detail?.Name || badge,
    DepartmentCode: detail?.DepartmentCode || detail?.depiddesc || '',
    teamId: detail?.teamId || 'default'
  };
  const authToken = crypto.randomBytes(32).toString('hex');
  const stored = await createAuthTokenAndStore({ name: badge, accessToken: authToken, userInfo });
  if (!stored) throw new Error('Failed to create session');

  return {
    success: true,
    user: { name: badge },
    userInfo: { ...userInfo, IsAdmin: resolveAdminBadges().includes(badge), ...readIntegrationConfig() },
    authToken,
    message: 'Login successful'
  };
}

module.exports = { completeLogin };
