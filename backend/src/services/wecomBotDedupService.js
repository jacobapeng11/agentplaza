const { readWecomBotConfig } = require('../config/wecomBot');
const { client, ensureRedisConnected } = require('../utils/redis');

/**
 * 拼接企业微信消息幂等 Redis Key。
 * 输入: 绑定 ID 和企业微信 messageId。
 * 输出: 可用于 Redis 的幂等 Key。
 */
function buildDedupKey(bindingId, messageId) {
  return `wecom:bot:dedup:${String(bindingId)}:${String(messageId)}`;
}

/**
 * 净化幂等失败摘要。
 * 输入: 任意错误。
 * 输出: 不含明显 Secret/API Key 的短字符串。
 */
function sanitizeDedupError(error) {
  return String(error?.message || error || 'failed')
    .replace(/(api[_-]?key|secret|token)=\S+/gi, '$1=[REDACTED]')
    .slice(0, 300);
}

/**
 * 创建 Redis 消息幂等服务。
 * 输入: Redis 客户端、连接函数、配置和时间函数。
 * 输出: 可创建 processing 记录并标记 completed/failed 的服务对象。
 */
function createWecomBotDedupService({
  redisClient = client,
  ensureConnected = ensureRedisConnected,
  config = readWecomBotConfig(),
  now = () => new Date()
} = {}) {
  const ttlSeconds = config?.message?.dedupTtlSeconds || 48 * 60 * 60;

  /**
   * 写入 Redis 幂等状态。
   * 输入: Redis Key、状态和可选错误。
   * 输出: Redis 写入结果。
   */
  async function writeState(key, status, error = null, options = {}) {
    const value = JSON.stringify({
      status,
      createdAt: now().toISOString(),
      error: error ? sanitizeDedupError(error) : undefined
    });

    return redisClient.set(key, value, options);
  }

  /**
   * 为首次处理的消息创建 processing 记录。
   * 输入: 绑定 ID 和企业微信 messageId。
   * 输出: created=true 表示本进程应继续处理；false 表示重复消息。
   */
  async function createProcessingRecord(bindingId, messageId) {
    const key = buildDedupKey(bindingId, messageId);
    const connected = await ensureConnected();
    if (!connected) {
      return { created: true, key, degraded: true };
    }

    const result = await writeState(key, 'processing', null, { NX: true, EX: ttlSeconds });
    return { created: result === 'OK', key };
  }

  /**
   * 标记消息处理完成。
   * 输入: 绑定 ID 和企业微信 messageId。
   * 输出: Redis 写入结果；无连接时返回 false。
   */
  async function markCompleted(bindingId, messageId) {
    const key = buildDedupKey(bindingId, messageId);
    const connected = await ensureConnected();
    if (!connected) {
      return false;
    }

    return writeState(key, 'completed', null, { EX: ttlSeconds });
  }

  /**
   * 标记消息处理失败。
   * 输入: 绑定 ID、企业微信 messageId 和错误对象。
   * 输出: Redis 写入结果；无连接时返回 false。
   */
  async function markFailed(bindingId, messageId, error) {
    const key = buildDedupKey(bindingId, messageId);
    const connected = await ensureConnected();
    if (!connected) {
      return false;
    }

    return writeState(key, 'failed', error, { EX: ttlSeconds });
  }

  return {
    createProcessingRecord,
    markCompleted,
    markFailed
  };
}

module.exports = {
  buildDedupKey,
  createWecomBotDedupService
};
