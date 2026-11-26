const Skill = require('../models/Skill');
const logger = require('../utils/logger');

function createSkillOverviewService({ load, now = Date.now, maxAgeMs = 300000 } = {}) {
  const loadOverview = load || (async () => {
    const rows = await Skill.aggregate([
      { $match: { status: 'published', visibility: 'organization' } },
      {
        $facet: {
          totals: [{ $group: { _id: null, total: { $sum: 1 }, downloads: { $sum: '$stats.downloadCount' }, favorites: { $sum: '$stats.favoriteCount' } } }],
          tracks: [{ $group: { _id: '$track', count: { $sum: 1 } } }],
          categories: [{ $group: { _id: '$category', count: { $sum: 1 } } }]
        }
      }
    ]).option({ maxTimeMS: 30000 });
    const row = rows[0] || {};
    const total = row.totals?.[0] || {};
    return {
      total: Number(total.total || 0),
      downloads: Number(total.downloads || 0),
      favorites: Number(total.favorites || 0),
      official: Number(row.tracks?.find((item) => item._id === 'official')?.count || 0),
      community: Number(row.tracks?.find((item) => item._id === 'community')?.count || 0),
      categories: Object.fromEntries((row.categories || []).map((item) => [item._id, item.count]))
    };
  });
  let snapshot = null;
  let updatedAt = null;
  let pending = null;

  function refresh() {
    if (pending) return pending;
    pending = Promise.resolve().then(loadOverview).then((value) => {
      snapshot = value;
      updatedAt = now();
      return value;
    }).finally(() => { pending = null; });
    return pending;
  }

  function get() {
    if (!snapshot) {
      const error = new Error('Skill 统计正在预热，请稍后重试');
      error.statusCode = 503;
      throw error;
    }
    return snapshot;
  }

  function status() {
    return { ready: snapshot !== null, stale: snapshot !== null && now() - updatedAt > maxAgeMs, updatedAt };
  }

  return { get, refresh, status };
}

const skillOverview = createSkillOverviewService();

async function startSkillOverview() {
  await skillOverview.refresh();
  const timer = setInterval(() => {
    skillOverview.refresh().catch((error) => logger.error('[skillOverview] refresh failed; retaining snapshot', error));
  }, 60000);
  timer.unref();
  return () => clearInterval(timer);
}

module.exports = { createSkillOverviewService, skillOverview, startSkillOverview };
