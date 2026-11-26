function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function getFastgptFrontendBaseUrl(env = process.env) {
  return normalizeBaseUrl(env.FASTGPT_FRONTEND_BASE_URL);
}

function getDefaultFastgptApiBaseUrl(env = process.env) {
  return normalizeBaseUrl(env.FASTGPT_DEFAULT_API_BASE_URL || env.FASTGPT_API_BASE_URL);
}

module.exports = { getDefaultFastgptApiBaseUrl, getFastgptFrontendBaseUrl, normalizeBaseUrl };
