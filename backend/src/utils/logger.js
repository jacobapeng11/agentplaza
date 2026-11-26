const util = require('util');

const LEVEL_ORDER = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
});
const DEFAULT_LEVEL = 'info';

/**
 * 功能: 将外部传入的日志级别规范化为系统支持的四种级别之一。
 * 输入: level，可能来自环境变量或测试注入。
 * 输出: 合法日志级别字符串；非法或缺失时返回默认 info。
 */
function normalizeLevel(level) {
  const normalized = String(level || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(LEVEL_ORDER, normalized)
    ? normalized
    : DEFAULT_LEVEL;
}

/**
 * 功能: 判断当前日志级别是否允许输出目标日志级别。
 * 输入: messageLevel 为日志调用级别，configuredLevel 为当前配置级别。
 * 输出: 允许输出时返回 true，否则返回 false。
 */
function shouldLog(messageLevel, configuredLevel) {
  return LEVEL_ORDER[messageLevel] >= LEVEL_ORDER[normalizeLevel(configuredLevel)];
}

/**
 * 功能: 创建支持 LOG_LEVEL 过滤和异步输出的日志器实例。
 * 输入: options 可注入 level、stdout、stderr、scheduler，便于生产和测试使用。
 * 输出: 包含 debug、info、warn、error、log、flush 等方法的日志器对象。
 */
function createLogger(options = {}) {
  const stdout = options.stdout || process.stdout;
  const stderr = options.stderr || process.stderr;
  const scheduler = options.scheduler || setImmediate;
  const queue = [];
  const flushResolvers = [];
  let scheduled = false;
  let processing = false;
  let lastWriteError = null;

  /**
   * 功能: 获取当前有效日志级别。
   * 输入: 无，读取注入 level 或运行时环境变量 LOG_LEVEL。
   * 输出: 合法日志级别字符串。
   */
  function getCurrentLevel() {
    return normalizeLevel(
      options.level === undefined ? process.env.LOG_LEVEL : options.level
    );
  }

  /**
   * 功能: 根据日志级别选择输出流。
   * 输入: level 日志级别。
   * 输出: error 返回 stderr，其余级别返回 stdout。
   */
  function getStream(level) {
    return level === 'error' ? stderr : stdout;
  }

  /**
   * 功能: 确保日志队列会在当前调用栈之后异步刷出。
   * 输入: 无。
   * 输出: 无。
   */
  function scheduleFlush() {
    if (scheduled) {
      return;
    }

    scheduled = true;
    scheduler(() => {
      scheduled = false;
      processQueue();
    });
  }

  /**
   * 功能: 唤醒等待 flush 的调用方。
   * 输入: 可选写入错误。
   * 输出: 无；有错误时拒绝等待者，否则完成等待者。
   */
  function settleFlushResolvers(error = null) {
    while (flushResolvers.length > 0) {
      const { resolve, reject } = flushResolvers.shift();
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    }
  }

  /**
   * 功能: 将单条日志写入目标流并等待底层确认。
   * 输入: 队列中的日志条目。
   * 输出: Promise；写入完成时 resolve，写入失败或流错误时 reject。
   */
  function writeEntry(entry) {
    const stream = getStream(entry.level);
    const chunk = `${entry.message}\n`;

    return new Promise((resolve, reject) => {
      let settled = false;
      let drainHandler = null;
      let errorHandler = null;

      /**
       * 功能: 清理临时监听器。
       * 输入: 无。
       * 输出: 无。
       */
      function cleanup() {
        if (drainHandler && typeof stream.off === 'function') {
          stream.off('drain', drainHandler);
        }
        if (errorHandler && typeof stream.off === 'function') {
          stream.off('error', errorHandler);
        }
      }

      /**
       * 功能: 结束当前写入等待。
       * 输入: 可选写入错误。
       * 输出: 无；确保只完成一次。
       */
      function finish(error = null) {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      }

      if (typeof stream.once === 'function') {
        drainHandler = () => finish();
        errorHandler = (error) => finish(error);
        stream.once('error', errorHandler);
      }

      try {
        const acceptsMore = stream.write(chunk, (error) => finish(error));
        if (acceptsMore === false && !settled && typeof stream.once === 'function') {
          stream.once('drain', drainHandler);
        }
      } catch (error) {
        finish(error);
      }
    });
  }

  /**
   * 功能: 顺序消费日志队列，遵守输出流背压。
   * 输入: 无，消费内部队列。
   * 输出: Promise；队列刷出后完成，失败时记录错误并唤醒 flush 等待者。
   */
  async function processQueue() {
    if (processing) {
      return;
    }

    processing = true;
    lastWriteError = null;

    try {
      while (queue.length > 0) {
        const entry = queue.shift();
        await writeEntry(entry);
      }
      settleFlushResolvers();
    } catch (error) {
      lastWriteError = error;
      queue.length = 0;
      settleFlushResolvers(error);
    } finally {
      processing = false;
      if (queue.length > 0) {
        scheduleFlush();
      }
    }
  }

  /**
   * 功能: 将一条日志格式化并加入异步输出队列。
   * 输入: level 日志级别，args 为调用方传入的日志参数。
   * 输出: 日志被接受时返回 true，被级别过滤时返回 false。
   */
  function write(level, args) {
    if (!shouldLog(level, getCurrentLevel())) {
      return false;
    }

    lastWriteError = null;
    queue.push({
      level,
      message: util.format(...args)
    });
    scheduleFlush();
    return true;
  }

  /**
   * 功能: 等待当前队列中的日志完成异步写入。
   * 输入: 无。
   * 输出: Promise，在队列刷出后完成。
   */
  function flush() {
    if (lastWriteError && !scheduled && !processing && queue.length === 0) {
      const error = lastWriteError;
      lastWriteError = null;
      return Promise.reject(error);
    }

    if (!scheduled && !processing && queue.length === 0) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      flushResolvers.push({
        resolve,
        reject
      });
      if (!processing) {
        scheduleFlush();
      }
    });
  }

  return {
    debug: (...args) => write('debug', args),
    info: (...args) => write('info', args),
    log: (...args) => write('info', args),
    warn: (...args) => write('warn', args),
    error: (...args) => write('error', args),
    flush,
    getLevel: getCurrentLevel,
    shouldLog: (level) => shouldLog(level, getCurrentLevel())
  };
}

const logger = createLogger();

module.exports = logger;
module.exports.createLogger = createLogger;
module.exports.normalizeLevel = normalizeLevel;
module.exports.shouldLog = shouldLog;
