const logger = require('../utils/logger');
const cron = require('node-cron');
const Apps = require('../models/Apps');
const { appChatStats } = require('../services/appChatStatsService');

// Chat counts across the whole database are below this value. Keeping user
// count in the high digits preserves the plaza rule: users first, chats next.
const USER_COUNT_WEIGHT = 10_000_000;
const HOT_SCORE_SCHEDULE = '*/30 * * * *';

let scheduledTask = null;
let refreshPromise = null;

function buildHotScore(userCount = 0, chatCount = 0) {
  return (Number(userCount) * USER_COUNT_WEIGHT) + Math.min(Number(chatCount), USER_COUNT_WEIGHT - 1);
}

async function updateHotScore() {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    const startedAt = Date.now();
    logger.info('[hotScore] refreshing materialized usage ranking');

    const appIds = await Apps.find({}).select('_id').lean();
    const usageStats = appChatStats.getStats(appIds.map(app => app._id));

    const statsByAppId = new Map(
      usageStats
        .filter((stat) => stat?._id)
        .map((stat) => [stat._id.toString(), stat])
    );
    const updates = appIds.map((app) => {
      const stats = statsByAppId.get(app._id.toString()) || {};
      const chatCount = Number(stats.chatCount || 0);
      const userCount = Number(stats.userCount || 0);

      return {
        updateOne: {
          filter: { _id: app._id },
          update: {
            $set: {
              chatCount,
              userCount,
              hotScore: buildHotScore(userCount, chatCount)
            }
          }
        }
      };
    });

    if (updates.length > 0) {
      await Apps.bulkWrite(updates, { ordered: false });
    }

    logger.info(`[hotScore] refreshed ${updates.length} apps in ${Date.now() - startedAt}ms`);
    return updates.length;
  })()
    .catch((error) => {
      logger.error('[hotScore] refresh failed:', error);
      throw error;
    })
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
}

function startHotScoreJob() {
  if (process.env.NODE_ENV === 'test') {
    return null;
  }

  if (scheduledTask) {
    return scheduledTask;
  }

  scheduledTask = cron.schedule(HOT_SCORE_SCHEDULE, () => {
    updateHotScore().catch(() => {});
  });
  updateHotScore().catch(() => {});
  return scheduledTask;
}

module.exports = {
  USER_COUNT_WEIGHT,
  buildHotScore,
  startHotScoreJob,
  updateHotScore
};
