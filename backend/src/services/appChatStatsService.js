const AppChatLogs = require('../models/AppChatLogs');
const logger = require('../utils/logger');

// Only aggregate counts are shared. User identity, permissions and lists are never cached here.
function createAppChatStatsService({ load, now = Date.now, maxAgeMs = 300000 } = {}) {
  const pipeline = [
    { $project: { _id: 0, appId: 1, userId: 1 } },
    { $group: { _id: { appId: '$appId', userId: '$userId' }, chats: { $sum: 1 } } },
    { $group: { _id: '$_id.appId', chatCount: { $sum: '$chats' }, userCount: { $sum: 1 } } }
  ];
  const loadStats = load || (async () => {
    try {
      return await AppChatLogs.aggregate(pipeline).hint({ appId: 1, userId: 1 })
        .allowDiskUse(true).option({ maxTimeMS: 120000 });
    } catch (error) {
      if (error.code !== 27 && !(error.code === 2 && /hint|index/i.test(error.message))) throw error;
      logger.warn('[appChatStats] covering index unavailable; using database query planner');
      return AppChatLogs.aggregate(pipeline).allowDiskUse(true).option({ maxTimeMS: 120000 });
    }
  });
  let snapshot = null;
  let updatedAt = null;
  let pending = null;

  function refresh() {
    if (pending) return pending;
    pending = Promise.resolve().then(loadStats).then(rows => {
      // Publish atomically: a failed refresh must never replace valid counts with zeros.
      snapshot = new Map(rows.filter(row => row._id).map(row => [String(row._id), row]));
      updatedAt = now();
    }).finally(() => { pending = null; });
    return pending;
  }

  function getStats(appIds) {
    if (!snapshot) {
      const error = new Error('应用统计正在预热，请稍后重试');
      error.statusCode = 503;
      throw error;
    }
    return [...new Set(appIds.map(String))].map(id => snapshot.get(id)).filter(Boolean);
  }

  return { refresh, getStats, status: () => ({ ready: snapshot !== null, stale: snapshot !== null && now() - updatedAt > maxAgeMs, updatedAt, apps: snapshot?.size || 0 }) };
}

const appChatStats = createAppChatStatsService();

async function startAppChatStats() {
  const startedAt = Date.now();
  await appChatStats.refresh();
  logger.info(`[appChatStats] warmup completed in ${Date.now() - startedAt}ms`);
  const timer = setInterval(() => {
    appChatStats.refresh().catch(error => logger.error('[appChatStats] refresh failed; retaining snapshot', error));
  }, 60000);
  timer.unref();
  return () => clearInterval(timer);
}

module.exports = { createAppChatStatsService, appChatStats, startAppChatStats };
