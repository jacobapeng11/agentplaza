const Skill = require('../models/Skill');
const SkillViewer = require('../models/SkillViewer');
const { client, ensureRedisConnected } = require('../utils/redis');
const logger = require('../utils/logger');

const DOWNLOAD_COUNTER_KEY = 'agent-plaza:skill-stats:downloads';
const VIEW_COUNTER_KEY = 'agent-plaza:skill-stats:views';
const VIEW_DEDUPE_PREFIX = 'agent-plaza:skill-view-window';
const VIEW_DEDUPE_SECONDS = Math.max(60, Number(process.env.SKILL_VIEW_DEDUPE_SECONDS || 1800));
const FLUSH_INTERVAL_MS = Number(process.env.SKILL_STATS_FLUSH_MS || 60000);

let lastFlushedAt = null;
let flushPromise = null;

async function recordSkillDownload(skillId) {
  const id = String(skillId);
  try {
    if (await ensureRedisConnected()) {
      await client.hIncrBy(DOWNLOAD_COUNTER_KEY, id, 1);
      return;
    }
  } catch (error) {
    logger.warn(`[skillStats] Redis download counter failed, using MongoDB fallback: ${error.message}`);
  }
  await Skill.updateOne({ _id: skillId }, {
    $inc: { 'stats.downloadCount': 1, hotScore: 5 },
    $set: { derivedStatsUpdatedAt: new Date() }
  }, { timestamps: false });
}

function userBadge(user) {
  return String(user?.Badge || user?.badge || user?.userId || '').trim().toLowerCase();
}

async function upsertSkillViewer(skillId, user, now) {
  const badge = userBadge(user);
  if (!badge) return { badge: '', isNew: false };

  let result;
  try {
    result = await SkillViewer.updateOne(
      { skillId, userBadge: badge },
      {
        $set: { lastViewedAt: now, userName: String(user?.Name || user?.name || '') },
        $setOnInsert: { firstViewedAt: now }
      },
      { upsert: true }
    );
  } catch (error) {
    if (error?.code !== 11000) throw error;
    await SkillViewer.updateOne(
      { skillId, userBadge: badge },
      { $set: { lastViewedAt: now, userName: String(user?.Name || user?.name || '') } }
    );
    return { badge, isNew: false };
  }

  const isNew = Number(result.upsertedCount || 0) > 0;
  if (isNew) {
    await Skill.updateOne(
      { _id: skillId, status: { $ne: 'deleted' } },
      { $inc: { 'stats.viewerCount': 1 }, $set: { derivedStatsUpdatedAt: now } },
      { timestamps: false }
    );
  }
  return { badge, isNew };
}

function claimViewWindow(skillId, badge, now) {
  const cutoff = new Date(now.getTime() - VIEW_DEDUPE_SECONDS * 1000);
  return SkillViewer.updateOne(
    {
      skillId,
      userBadge: badge,
      $or: [{ lastCountedAt: null }, { lastCountedAt: { $lt: cutoff } }]
    },
    { $set: { lastCountedAt: now } }
  );
}

function incrementViewCountDirect(skillId, now) {
  return Skill.updateOne(
    { _id: skillId, status: { $ne: 'deleted' } },
    { $inc: { 'stats.viewCount': 1 }, $set: { derivedStatsUpdatedAt: now } },
    { timestamps: false }
  );
}

async function recordSkillView(skillId, user) {
  const id = String(skillId);
  const now = new Date();
  const { badge, isNew } = await upsertSkillViewer(skillId, user, now);
  if (!badge) return { counted: false, isNewViewer: false };

  try {
    if (await ensureRedisConnected()) {
      const dedupeKey = `${VIEW_DEDUPE_PREFIX}:${id}:${badge}`;
      const acquired = await client.set(dedupeKey, '1', { NX: true, EX: VIEW_DEDUPE_SECONDS });
      if (acquired !== 'OK') return { counted: false, isNewViewer: isNew };
      const windowResult = await claimViewWindow(skillId, badge, now);
      if (Number(windowResult.modifiedCount || 0) === 0) {
        await client.del(dedupeKey).catch(() => {});
        return { counted: false, isNewViewer: isNew };
      }
      try {
        await client.hIncrBy(VIEW_COUNTER_KEY, id, 1);
      } catch (error) {
        logger.warn(`[skillStats] Redis view increment failed, using MongoDB fallback: ${error.message}`);
        await incrementViewCountDirect(skillId, now);
      }
      return { counted: true, isNewViewer: isNew };
    }
  } catch (error) {
    logger.warn(`[skillStats] Redis view counter failed, using MongoDB fallback: ${error.message}`);
  }

  const windowResult = await claimViewWindow(skillId, badge, now);
  if (Number(windowResult.modifiedCount || 0) === 0) return { counted: false, isNewViewer: isNew };

  await incrementViewCountDirect(skillId, now);
  return { counted: true, isNewViewer: isNew };
}

async function restoreBatch(counterKey, counters) {
  if (!(await ensureRedisConnected())) return;
  await Promise.all(Object.entries(counters).map(([skillId, count]) => client.hIncrBy(counterKey, skillId, Number(count))));
}

async function flushCounter(counterKey, label, buildIncrement) {
  if (!(await ensureRedisConnected())) return 0;
  if (!(await client.exists(counterKey))) return 0;

  const batchKey = `${counterKey}:flush:${Date.now()}:${process.pid}`;
  try {
    await client.rename(counterKey, batchKey);
  } catch (error) {
    if (/no such key/i.test(error.message)) return 0;
    throw error;
  }

  const counters = await client.hGetAll(batchKey);
  const now = new Date();
  const writes = Object.entries(counters)
    .map(([skillId, value]) => ({ skillId, count: Number(value) }))
    .filter((entry) => entry.count > 0)
    .map(({ skillId, count }) => ({
      updateOne: {
        filter: { _id: skillId, status: { $ne: 'deleted' } },
        update: {
          $inc: buildIncrement(count),
          $set: { derivedStatsUpdatedAt: now }
        }
      }
    }));

  try {
    if (writes.length) await Skill.bulkWrite(writes, { ordered: false, timestamps: false });
    await client.del(batchKey);
    lastFlushedAt = now;
    logger.info(`[skillStats] flushed ${writes.length} derived ${label} counters`);
    return writes.length;
  } catch (error) {
    await restoreBatch(counterKey, counters).catch((restoreError) => logger.error('[skillStats] counter restore failed:', restoreError));
    await client.del(batchKey).catch(() => {});
    throw error;
  }
}

function flushSkillDownloadCounters() {
  return flushCounter(DOWNLOAD_COUNTER_KEY, 'download', (count) => ({ 'stats.downloadCount': count, hotScore: count * 5 }));
}

function flushSkillViewCounters() {
  return flushCounter(VIEW_COUNTER_KEY, 'view', (count) => ({ 'stats.viewCount': count }));
}

async function flushSkillStatsCounters() {
  if (flushPromise) return flushPromise;
  flushPromise = Promise.all([flushSkillDownloadCounters(), flushSkillViewCounters()])
    .then((counts) => counts.reduce((sum, count) => sum + count, 0))
    .finally(() => { flushPromise = null; });
  return flushPromise;
}

function startSkillStatsJob() {
  if (process.env.NODE_ENV === 'test') return () => {};
  const timer = setInterval(() => {
    flushSkillStatsCounters().catch((error) => logger.error('[skillStats] flush failed; counters retained', error));
  }, FLUSH_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}

function skillStatsStatus() {
  return { lastFlushedAt, pending: Boolean(flushPromise), flushIntervalMs: FLUSH_INTERVAL_MS };
}

module.exports = {
  DOWNLOAD_COUNTER_KEY,
  VIEW_COUNTER_KEY,
  VIEW_DEDUPE_SECONDS,
  flushSkillDownloadCounters,
  flushSkillStatsCounters,
  flushSkillViewCounters,
  recordSkillDownload,
  recordSkillView,
  skillStatsStatus,
  startSkillStatsJob
};
