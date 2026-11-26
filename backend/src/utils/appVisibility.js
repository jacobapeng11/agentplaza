const UNAUTHORIZED_APP_NAME_KEYWORDS = ['test', 'demo'];

function hasNumericOrDecimalAppName(app) {
  const normalizedName = String(app?.name || '').trim();
  return /^(?=.*\d)[\d.]+$/.test(normalizedName);
}

function matchesUnauthorizedAppNameRule(app) {
  const originalName = String(app?.name || '').trim();
  const normalizedName = originalName.toLowerCase();
  const containsBlockedKeyword = UNAUTHORIZED_APP_NAME_KEYWORDS.some(
    keyword => normalizedName.includes(keyword)
  );
  const isChineseTestName = /^测试\d*$/.test(originalName);

  return containsBlockedKeyword || isChineseTestName || hasNumericOrDecimalAppName(app);
}

/**
 * 判断无权限应用是否命中广场名称过滤规则。
 * 有权限应用不受过滤影响；英文关键字忽略大小写。
 */
function shouldHideUnauthorizedApp(app) {
  if (!app || app.canAccess === true) {
    return false;
  }

  return matchesUnauthorizedAppNameRule(app);
}

function shouldHidePlazaApp(app) {
  return shouldHideUnauthorizedApp(app);
}

function filterVisiblePlazaApps(apps = []) {
  return (Array.isArray(apps) ? apps : []).filter(app => !shouldHidePlazaApp(app));
}

module.exports = {
  UNAUTHORIZED_APP_NAME_KEYWORDS,
  hasNumericOrDecimalAppName,
  matchesUnauthorizedAppNameRule,
  shouldHideUnauthorizedApp,
  shouldHidePlazaApp,
  filterVisiblePlazaApps
};
