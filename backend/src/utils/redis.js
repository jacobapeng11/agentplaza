const logger = require('./logger');
const { createClient } = require('redis');

function getRedisUrl(env = process.env) {
  const address = env.REDIS_URL || env.REDIS_URI;
  if (!address) return null;
  try {
    const url = new URL(address);
    if (!['redis:', 'rediss:'].includes(url.protocol) || !url.hostname) throw new Error();
    return url.href;
  } catch {
    throw new Error('REDIS_URL must use a valid redis:// or rediss:// URL');
  }
}

const redisUrl = getRedisUrl();
const connectionDisabled = process.env.NODE_ENV === 'test' || process.env.REDIS_DISABLE_CONNECT === 'true';
const client = createClient({
  url: redisUrl || undefined,
  disableOfflineQueue: true
});
client.on('error', error => logger.warn('Redis connection unavailable:', error.code || error.name));

async function ensureRedisConnected() {
  if (connectionDisabled || !redisUrl) return false;
  if (client.isOpen) return client.isReady;
  try {
    await client.connect();
    logger.info('Connected to Redis');
    return true;
  } catch (error) {
    logger.warn('Redis connection failed:', error.code || error.name);
    return false;
  }
}

async function storeUserSession(sessionId, userInfo, expirationSeconds = 86400) {
  try {
    if (!await ensureRedisConnected()) return false;
    await client.setEx('agentplaza:session:' + sessionId, expirationSeconds, JSON.stringify(userInfo));
    return true;
  } catch (error) {
    logger.warn('Unable to store session:', error.code || error.name);
    return false;
  }
}

async function getUserSession(sessionId) {
  try {
    if (!await ensureRedisConnected()) return null;
    const session = await client.get('agentplaza:session:' + sessionId);
    return session ? JSON.parse(session) : null;
  } catch (error) {
    logger.warn('Unable to load session:', error.code || error.name);
    return null;
  }
}

module.exports = { client, ensureRedisConnected, getRedisUrl, getUserSession, storeUserSession };
