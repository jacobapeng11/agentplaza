const logger = require('./utils/logger');
const app = require('./app');
const connectDB = require('./config/database');
const { bootstrapEnabledWecomBots } = require('./jobs/wecomBotWorkerBootstrap');
const { getWecomBotWorkerScheduler } = require('./services/wecomBotWorkerRuntime');
const { getFrontendUrl } = require('./config/frontendUrl');
const { getRedisUrl, ensureRedisConnected } = require('./utils/redis');
const { readWecomBotConfig } = require('./config/wecomBot');

/**
 * 等待 HTTP server 停止接收新连接。
 * 输入: Node HTTP server 或空值。
 * 输出: Promise；server 关闭或无需关闭时完成。
 */
function closeServer(server) {
  if (!server || typeof server.close !== 'function') {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

/**
 * 创建带超时的等待 Promise。
 * 输入: 原始 Promise、超时毫秒数和定时器函数。
 * 输出: 原始 Promise 完成或超时后完成。
 */
function withTimeout(promise, timeoutMs, setTimer = setTimeout) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }

  let timer = null;
  const timeoutPromise = new Promise((resolve) => {
    timer = setTimer(resolve, timeoutMs);
    if (typeof timer?.unref === 'function') {
      timer.unref();
    }
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer && typeof clearTimeout === 'function') {
      clearTimeout(timer);
    }
  });
}

/**
 * 安装进程生命周期日志处理器。
 * 输入: process、server、logger、退出函数和超时配置。
 * 输出: 清理函数，用于测试或热重载时移除监听器。
 */
function installProcessLifecycleHandlers({
  processRef = process,
  server = null,
  logger: lifecycleLogger = logger,
  exit = (code) => processRef.exit(code),
  timeoutMs = 5000,
  setTimer = setTimeout
} = {}) {
  let shuttingDown = false;

  /**
   * 完成一次关闭流程。
   * 输入: 退出码、日志级别、日志消息和可选错误对象。
   * 输出: Promise；日志 flush 后调用退出函数。
   */
  async function shutdown({ code, level, message, error = null }) {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    if (error) {
      lifecycleLogger[level](message, error);
    } else {
      lifecycleLogger[level](message);
    }

    await withTimeout(
      closeServer(server)
        .catch((closeError) => {
          lifecycleLogger.error('[process] server close failed:', closeError);
        })
        .then(() => lifecycleLogger.flush())
        .catch((flushError) => {
          lifecycleLogger.error('[process] logger flush failed:', flushError);
        }),
      timeoutMs,
      setTimer
    );

    exit(code);
  }

  const handlers = {
    SIGTERM: () => shutdown({
      code: 0,
      level: 'info',
      message: '[process] received SIGTERM, shutting down'
    }),
    SIGINT: () => shutdown({
      code: 0,
      level: 'info',
      message: '[process] received SIGINT, shutting down'
    }),
    unhandledRejection: (reason) => shutdown({
      code: 1,
      level: 'error',
      message: '[process] unhandledRejection:',
      error: reason
    }),
    uncaughtException: (error) => shutdown({
      code: 1,
      level: 'error',
      message: '[process] uncaughtException:',
      error
    })
  };

  Object.entries(handlers).forEach(([eventName, handler]) => {
    processRef.on(eventName, handler);
  });

  return () => {
    Object.entries(handlers).forEach(([eventName, handler]) => {
      processRef.removeListener(eventName, handler);
    });
  };
}

async function startServer() {
  if (!getFrontendUrl()) throw new Error('FRONTEND_URL is required');
  if (!getRedisUrl()) throw new Error('REDIS_URL is required');
  await connectDB();
  const { startAppChatStats } = require('./services/appChatStatsService');
  const stopAppChatStats = await startAppChatStats();

  const PORT = process.env.PORT || 3000;
  const server = app.listen(PORT, () => {
    logger.info(`Server is running on port ${PORT}`);
  });
  installProcessLifecycleHandlers({ server });
  server.on('close', stopAppChatStats);
  const { startHotScoreJob } = require('./jobs/hotScoreJob');
  startHotScoreJob();

  void ensureRedisConnected().then(connected => {
    if (!connected || !readWecomBotConfig().enabled) return;
    return bootstrapEnabledWecomBots({ scheduler: getWecomBotWorkerScheduler() });
  }).catch(error => {
    logger.error('[wecomBotWorkerBootstrap] bootstrap failed:', error.name);
  });

  return server;
}

if (require.main === module) {
  startServer().catch(error => { logger.error('[startup] failed:', error); process.exit(1); });
}

module.exports = {
  startServer,
  installProcessLifecycleHandlers
};
