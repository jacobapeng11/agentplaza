const logger = require('../utils/logger');
const mongoose = require('mongoose');
const { readWecomBotConfig } = require('../config/wecomBot');
const { getWecomBotWorkerScheduler } = require('../services/wecomBotWorkerRuntime');

const DEFAULT_LEASE_RETRY_GRACE_MS = 1000;

/**
 * 判断启动扫描结果是否需要针对租约不可用安排恢复扫描。
 * 输入: startEnabledBindings 返回结果。
 * 输出: true 表示至少有一个 enabled Bot 因旧租约未过期而跳过。
 */
function shouldScheduleLeaseRetry(result) {
  return Boolean(result?.skippedReasons?.lease_unavailable);
}

/**
 * 解析启动恢复重试等待时间。
 * 输入: 扫描结果和 Worker 配置。
 * 输出: 等待毫秒数；优先使用租约剩余时间，缺失时退回租约 TTL。
 */
function resolveLeaseRetryDelayMs(result, config) {
  const configuredRetryAfterMs = Number.parseInt(result?.retryAfterMs, 10);
  if (Number.isFinite(configuredRetryAfterMs) && configuredRetryAfterMs >= 0) {
    return configuredRetryAfterMs + DEFAULT_LEASE_RETRY_GRACE_MS;
  }

  const ttlSeconds = Number.parseInt(config?.lease?.ttlSeconds, 10);
  return (Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? ttlSeconds * 1000 : 60000) +
    DEFAULT_LEASE_RETRY_GRACE_MS;
}

/**
 * 安排下一次企业微信 Bot 启动恢复扫描。
 * 输入: 配置、共享调度器、定时器函数和延迟毫秒数。
 * 输出: 定时器句柄；支持 unref 时不会阻止进程退出。
 */
function scheduleLeaseRetry({ config, scheduler, setTimer, delayMs }) {
  const timer = setTimer(() => {
    bootstrapEnabledWecomBots({
      config,
      scheduler,
      setTimer
    }).catch((error) => {
      logger.error('[wecomBotWorkerBootstrap] retry failed:', error);
    });
  }, delayMs);

  if (typeof timer?.unref === 'function') {
    timer.unref();
  }

  return timer;
}

/**
 * 启动时恢复已启用的企业微信 Bot Worker。
 * 输入: Worker 配置和可选调度器实例。
 * 输出: 启动结果、跳过原因或调度器错误摘要；测试环境和数据库未连接时不会启动真实连接。
 */
async function bootstrapEnabledWecomBots({
  config = readWecomBotConfig(),
  scheduler = null,
  setTimer = setTimeout,
  scheduleRetry = true
} = {}) {
  if (config.testMode) {
    return { skipped: true, reason: 'test_mode' };
  }

  if (mongoose.connection.readyState !== 1) {
    logger.warn('[wecomBotWorkerBootstrap] skipped because database is not connected');
    return { skipped: true, reason: 'database_not_connected' };
  }

  const activeScheduler = scheduler || getWecomBotWorkerScheduler({ config });
  if (typeof activeScheduler.startEnabledBindings !== 'function') {
    return { skipped: false, started: 0 };
  }

  try {
    const result = await activeScheduler.startEnabledBindings({ recoverOwnLeases: true });
    const response = { skipped: false, ...(result || {}) };
    if (scheduleRetry && shouldScheduleLeaseRetry(result)) {
      const retryAfterMs = resolveLeaseRetryDelayMs(result, config);
      scheduleLeaseRetry({
        config,
        scheduler: activeScheduler,
        setTimer,
        delayMs: retryAfterMs
      });
      return {
        ...response,
        scheduledRetry: true,
        retryAfterMs
      };
    }

    return response;
  } catch (error) {
    logger.error('[wecomBotWorkerBootstrap] scheduler error:', error);
    return { skipped: false, error: error.message };
  }
}

module.exports = {
  bootstrapEnabledWecomBots,
  resolveLeaseRetryDelayMs,
  shouldScheduleLeaseRetry
};
