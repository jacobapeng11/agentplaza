const { readWecomBotConfig } = require('../config/wecomBot');

const DEFAULT_DEBOUNCE_MS = 500;
const DEFAULT_IDLE_TTL_MS = 60 * 1000;
const DEFAULT_MAX_QUEUE_LENGTH = 50;
const DEFAULT_MAX_BATCH_MESSAGES = 10;
const DEFAULT_MAX_BATCH_MEDIA = 5;

/**
 * 创建队列错误。
 * 输入: 错误码和错误消息。
 * 输出: 带 code 字段的 Error 对象。
 */
function createQueueError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/**
 * 将任意配置值解析为正整数。
 * 输入: 用户配置值和兜底值。
 * 输出: 大于 0 的整数。
 */
function toPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * 创建可手动完成的 Promise 容器。
 * 输入: 无。
 * 输出: promise 以及 resolve/reject 控制函数。
 */
function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

/**
 * 计算队列项包含的媒体数量。
 * 输入: 单个入站队列项。
 * 输出: 可用于批次媒体上限判断的数量。
 */
function getItemMediaCount(item = {}) {
  if (Number.isFinite(item.mediaCount)) {
    return Math.max(0, Number(item.mediaCount));
  }

  if (Array.isArray(item.media)) {
    return item.media.length;
  }

  if (Array.isArray(item.decision?.attachments)) {
    return item.decision.attachments.length;
  }

  if (Array.isArray(item.message?.attachments)) {
    return item.message.attachments.length;
  }

  return 0;
}

/**
 * 解析入站队列配置。
 * 输入: 显式 options 和运行时配置对象。
 * 输出: 队列服务使用的完整配置。
 */
function resolveQueueOptions(options = {}) {
  const config = options.config || readWecomBotConfig();
  const messageConfig = config?.message || {};

  return {
    debounceMs: toPositiveInteger(
      options.debounceMs ?? messageConfig.inboundAggregationWindowMs,
      DEFAULT_DEBOUNCE_MS
    ),
    idleTtlMs: toPositiveInteger(
      options.idleTtlMs ?? messageConfig.inboundQueueIdleTtlMs,
      DEFAULT_IDLE_TTL_MS
    ),
    maxQueueLength: toPositiveInteger(
      options.maxQueueLength ?? messageConfig.inboundMaxQueueLength,
      DEFAULT_MAX_QUEUE_LENGTH
    ),
    maxBatchMessages: toPositiveInteger(
      options.maxBatchMessages ?? messageConfig.inboundMaxBatchMessages,
      DEFAULT_MAX_BATCH_MESSAGES
    ),
    maxBatchMedia: toPositiveInteger(
      options.maxBatchMedia ?? messageConfig.inboundMaxBatchMedia,
      DEFAULT_MAX_BATCH_MEDIA
    ),
    setTimer: options.setTimeout || setTimeout,
    clearTimer: options.clearTimeout || clearTimeout,
    now: options.now || (() => Date.now())
  };
}

/**
 * 创建企业微信入站消息聚合和串行队列。
 * 输入: 聚合窗口、清理时间、容量限制和可测试时间函数。
 * 输出: 支持按 conversationKey 入队、聚合和顺序执行的服务对象。
 */
function createWecomInboundQueueService(options = {}) {
  const settings = resolveQueueOptions(options);
  const states = new Map();

  /**
   * 创建单个会话 Key 的队列状态。
   * 输入: conversationKey。
   * 输出: 保存 pending、tail 和清理 timer 的状态对象。
   */
  function createState(conversationKey) {
    return {
      conversationKey,
      pending: [],
      timer: null,
      cleanupTimer: null,
      tail: Promise.resolve(),
      queuedCount: 0,
      lastActiveAt: settings.now()
    };
  }

  /**
   * 获取或创建会话队列状态。
   * 输入: conversationKey。
   * 输出: 可追加任务的状态对象。
   */
  function ensureState(conversationKey) {
    if (!states.has(conversationKey)) {
      states.set(conversationKey, createState(conversationKey));
    }

    const state = states.get(conversationKey);
    if (state.cleanupTimer) {
      settings.clearTimer(state.cleanupTimer);
      state.cleanupTimer = null;
    }
    state.lastActiveAt = settings.now();
    return state;
  }

  /**
   * 在状态空闲后安排清理。
   * 输入: 会话队列状态。
   * 输出: 无返回值；到期后删除空闲状态。
   */
  function scheduleCleanup(state) {
    if (state.pending.length || state.queuedCount > 0 || state.timer || state.cleanupTimer) {
      return;
    }

    state.cleanupTimer = settings.setTimer(() => {
      if (!state.pending.length && state.queuedCount === 0 && !state.timer) {
        states.delete(state.conversationKey);
      }
    }, settings.idleTtlMs);
    if (typeof state.cleanupTimer.unref === 'function') {
      state.cleanupTimer.unref();
    }
  }

  /**
   * 根据 handler 返回值完成批次内每个入队 Promise。
   * 输入: 批次项和 handler 结果。
   * 输出: 无返回值。
   */
  function resolveItems(items, result) {
    if (Array.isArray(result?.itemResults)) {
      items.forEach((item, index) => {
        item.deferred.resolve(result.itemResults[index] || result);
      });
      return;
    }

    items.forEach((item) => {
      item.deferred.resolve(result);
    });
  }

  /**
   * 将一个批次接到同一会话 Key 的串行尾部。
   * 输入: 会话状态、批次类型和批次项。
   * 输出: 无返回值；批次按 tail 顺序异步执行。
   */
  function scheduleTask(state, kind, items) {
    const safeTail = state.tail.catch(() => undefined);
    state.tail = safeTail.then(async () => {
      state.lastActiveAt = settings.now();
      const handler = items[0]?.handler;
      try {
        const result = await handler({
          conversationKey: state.conversationKey,
          kind,
          items: items.map((item) => item.payload)
        });
        resolveItems(items, result);
      } catch (error) {
        items.forEach((item) => item.deferred.reject(error));
      } finally {
        state.queuedCount = Math.max(0, state.queuedCount - items.length);
        state.lastActiveAt = settings.now();
        scheduleCleanup(state);
      }
    });
    state.tail.catch(() => undefined);
  }

  /**
   * 立即刷新当前 pending 的普通消息批次。
   * 输入: 会话队列状态。
   * 输出: 无返回值。
   */
  function flushPending(state) {
    if (state.timer) {
      settings.clearTimer(state.timer);
      state.timer = null;
    }

    if (!state.pending.length) {
      scheduleCleanup(state);
      return;
    }

    const items = state.pending;
    state.pending = [];
    scheduleTask(state, 'normal', items);
  }

  /**
   * 重置普通消息聚合计时器。
   * 输入: 会话队列状态。
   * 输出: 无返回值。
   */
  function resetDebounceTimer(state) {
    if (state.timer) {
      settings.clearTimer(state.timer);
    }

    state.timer = settings.setTimer(() => {
      flushPending(state);
    }, settings.debounceMs);
  }

  /**
   * 入队单条消息或屏障任务。
   * 输入: 队列项和批次处理函数。
   * 输出: 该项处理完成后的 Promise。
   */
  function enqueue(item = {}, handler) {
    if (typeof handler !== 'function') {
      return Promise.reject(createQueueError(
        'WECOM_INBOUND_QUEUE_HANDLER_REQUIRED',
        'Inbound queue handler is required'
      ));
    }

    const conversationKey = String(item.conversationKey || '').trim();
    if (!conversationKey) {
      return Promise.reject(createQueueError(
        'WECOM_INBOUND_QUEUE_KEY_REQUIRED',
        'conversationKey is required'
      ));
    }

    const state = ensureState(conversationKey);
    if (state.queuedCount >= settings.maxQueueLength) {
      return Promise.reject(createQueueError(
        'WECOM_INBOUND_QUEUE_FULL',
        'Inbound queue length limit exceeded'
      ));
    }

    const kind = item.kind === 'barrier' ? 'barrier' : 'normal';
    const mediaCount = getItemMediaCount(item);
    if (kind === 'normal') {
      const pendingMediaCount = state.pending.reduce((total, pendingItem) => (
        total + pendingItem.mediaCount
      ), 0);

      if (state.pending.length >= settings.maxBatchMessages) {
        return Promise.reject(createQueueError(
          'WECOM_INBOUND_BATCH_MESSAGE_LIMIT_EXCEEDED',
          'Inbound aggregate message limit exceeded'
        ));
      }

      if (pendingMediaCount + mediaCount > settings.maxBatchMedia) {
        return Promise.reject(createQueueError(
          'WECOM_INBOUND_BATCH_MEDIA_LIMIT_EXCEEDED',
          'Inbound aggregate media limit exceeded'
        ));
      }
    }

    const deferred = createDeferred();
    const queuedItem = {
      payload: { ...item, kind, mediaCount },
      handler,
      mediaCount,
      deferred
    };
    state.queuedCount += 1;

    if (kind === 'barrier') {
      flushPending(state);
      scheduleTask(state, 'barrier', [queuedItem]);
      return deferred.promise;
    }

    state.pending.push(queuedItem);
    resetDebounceTimer(state);
    return deferred.promise;
  }

  /**
   * 读取队列轻量状态快照。
   * 输入: 无。
   * 输出: 当前会话 Key 和 pending/queued 计数。
   */
  function getStateSnapshot() {
    return {
      keys: Array.from(states.keys()).sort(),
      states: Array.from(states.values()).map((state) => ({
        conversationKey: state.conversationKey,
        pendingCount: state.pending.length,
        queuedCount: state.queuedCount,
        lastActiveAt: state.lastActiveAt
      }))
    };
  }

  /**
   * 清空队列并拒绝尚未处理的 pending 项。
   * 输入: 可选错误对象。
   * 输出: 无返回值。
   */
  function clear(error = createQueueError('WECOM_INBOUND_QUEUE_CLEARED', 'Inbound queue cleared')) {
    states.forEach((state) => {
      if (state.timer) {
        settings.clearTimer(state.timer);
      }
      if (state.cleanupTimer) {
        settings.clearTimer(state.cleanupTimer);
      }
      state.pending.forEach((item) => item.deferred.reject(error));
    });
    states.clear();
  }

  return {
    enqueue,
    getStateSnapshot,
    clear
  };
}

module.exports = {
  createWecomInboundQueueService
};
