const crypto = require('crypto');
const WecomBotBinding = require('../models/WecomBotBinding');
const WecomBotWorkerStatus = require('../models/WecomBotWorkerStatus');
const { readWecomBotConfig } = require('../config/wecomBot');
const { createWecomBotSecretService } = require('./wecomBotSecretService');
const { WecomAibotClient } = require('./wecomAibotClient');
const { WecomBotWorker } = require('./wecomBotWorker');
const defaultLogger = require('../utils/logger');

/**
 * 执行 Mongoose 查询或普通 Promise。
 * 输入: Mongoose Query、thenable 或普通值。
 * 输出: 查询解析后的文档对象。
 */
async function executeQuery(query) {
  if (query && typeof query.exec === 'function') {
    return query.exec();
  }

  return query;
}

/**
 * 生成 Worker 唯一 ID。
 * 输入: Bot ID。
 * 输出: 包含 Bot ID 和随机后缀的 Worker ID。
 */
function createWorkerId(botId) {
  return `${botId}:${crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(12).toString('hex')}`;
}

/**
 * 计算租约过期时间。
 * 输入: 当前时间和 TTL 秒数。
 * 输出: 当前时间加 TTL 后的 Date。
 */
function addSeconds(date, seconds) {
  return new Date(date.getTime() + seconds * 1000);
}

/**
 * 等待指定毫秒数后继续执行。
 * 输入: 等待毫秒数和定时器函数。
 * 输出: Promise；时间到达或无需等待时完成。
 */
function waitMs(delayMs, setTimer = setTimeout) {
  if (!Number.isFinite(delayMs) || delayMs <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timer = setTimer(resolve, delayMs);
    if (typeof timer?.unref === 'function') {
      timer.unref();
    }
  });
}

/**
 * 将租约状态压缩为日志可读对象。
 * 输入: Worker 状态记录。
 * 输出: 只包含诊断字段的普通对象。
 */
function serializeLeaseStatusForLog(status) {
  if (!status) {
    return null;
  }

  return {
    status: status.status || null,
    ownerInstanceId: status.ownerInstanceId || null,
    workerId: status.workerId || null,
    leaseExpiresAt: status.leaseExpiresAt ? new Date(status.leaseExpiresAt).toISOString() : null,
    lastHeartbeatAt: status.lastHeartbeatAt ? new Date(status.lastHeartbeatAt).toISOString() : null,
    lastConnectedAt: status.lastConnectedAt ? new Date(status.lastConnectedAt).toISOString() : null,
    lastError: status.lastError || ''
  };
}

/**
 * 判断现有租约是否可由请求者获取。
 * 输入: 状态记录、实例 ID、Worker ID 和当前时间。
 * 输出: true 表示可获取或接管。
 */
function canAcquireLease(status, ownerInstanceId, workerId, now) {
  if (!status) {
    return true;
  }

  const sameOwner = status.ownerInstanceId === ownerInstanceId && status.workerId === workerId;
  const expired = status.leaseExpiresAt && new Date(status.leaseExpiresAt) <= now;
  const stopped = status.status === 'stopped';
  return sameOwner || expired || stopped;
}

/**
 * 判断租约记录是否属于当前请求者。
 * 输入: 状态记录、实例 ID 和 Worker ID。
 * 输出: true 表示记录已经被当前 Worker 持有。
 */
function isLeaseOwnedByRequester(status, ownerInstanceId, workerId) {
  return Boolean(
    status &&
    status.ownerInstanceId === ownerInstanceId &&
    status.workerId === workerId
  );
}

/**
 * 创建企业微信 Bot Worker 调度器。
 * 输入: 状态模型、绑定模型、实例 ID、租约配置、Secret 服务和 Worker 工厂。
 * 输出: 可启动/停止 Worker 并维护租约的调度器对象。
 */
function createWecomBotWorkerScheduler({
  StatusModel = WecomBotWorkerStatus,
  BindingModel = WecomBotBinding,
  config = readWecomBotConfig(),
  ownerInstanceId = config.instanceId,
  leaseTtlSeconds = config.lease?.ttlSeconds || 60,
  renewIntervalSeconds = config.lease?.renewIntervalSeconds || 20,
  leaseRenewRetryAttempts = config.lease?.renewRetryAttempts || 3,
  leaseRenewRetryDelayMs = config.lease?.renewRetryDelayMs || 100,
  secretService = createWecomBotSecretService(),
  clientFactory = () => new WecomAibotClient(),
  workerFactory = (options) => new WecomBotWorker(options),
  logger = defaultLogger,
  setTimer = setTimeout,
  now = () => new Date()
} = {}) {
  const registry = new Map();
  const renewTimers = new Map();

  /**
   * 计算租约不可用后的下一次恢复等待时间。
   * 输入: Worker 状态记录和当前时间。
   * 输出: 剩余毫秒数；无有效未来租约时返回 0。
   */
  function calculateLeaseRetryAfterMs(status, currentTime) {
    if (!status?.leaseExpiresAt) {
      return 0;
    }

    const leaseExpiresAt = new Date(status.leaseExpiresAt).getTime();
    const currentTimestamp = currentTime.getTime();
    if (!Number.isFinite(leaseExpiresAt) || leaseExpiresAt <= currentTimestamp) {
      return 0;
    }

    return leaseExpiresAt - currentTimestamp;
  }

  /**
   * 查询 Bot 当前租约状态。
   * 输入: Bot ID。
   * 输出: Worker 状态记录或 null。
   */
  async function findStatusByBotId(botId) {
    return executeQuery(StatusModel.findOne({ botId }));
  }

  /**
   * 记录租约续约失败时的当前状态。
   * 输入: Bot ID、Worker ID、尝试次数、当前时间和可选错误。
   * 输出: 无返回值；日志失败不会影响主流程。
   */
  async function logRenewLeaseFailure({ botId, workerId, attemptCount, currentTime, error = null }) {
    let currentStatus = null;
    try {
      currentStatus = await findStatusByBotId(botId);
    } catch (statusError) {
      logger.warn('[WeComBotWorkerScheduler] lease renew status lookup failed', {
        botId,
        workerId,
        ownerInstanceId,
        attemptCount,
        now: currentTime.toISOString(),
        error: statusError?.message || String(statusError)
      });
      return;
    }

    logger.warn('[WeComBotWorkerScheduler] lease renew failed', {
      botId,
      workerId,
      ownerInstanceId,
      attemptCount,
      now: currentTime.toISOString(),
      error: error?.message || '',
      currentStatus: serializeLeaseStatusForLog(currentStatus)
    });
  }

  /**
   * 写入绑定展示状态快照。
   * 输入: 绑定 ID 和状态字段。
   * 输出: 无返回值；模型不支持更新时静默跳过。
   */
  async function updateBindingSnapshot(bindingId, fields) {
    if (!bindingId || typeof BindingModel.findByIdAndUpdate !== 'function') {
      return;
    }

    await executeQuery(BindingModel.findByIdAndUpdate(bindingId, {
      $set: {
        connectionStatusSnapshot: fields.status,
        lastConnectedAtSnapshot: fields.lastConnectedAt || null,
        lastErrorSnapshot: fields.lastError || ''
      }
    }));
  }

  /**
   * 获取或接管 Bot 租约。
   * 输入: bindingId、botId 和 workerId。
   * 输出: 租约状态记录；已有未过期租约时返回 null。
   */
  async function acquireLease({ bindingId, botId, workerId }) {
    const currentTime = now();
    const existing = await executeQuery(StatusModel.findOne({ botId }));

    const leaseExpiresAt = addSeconds(currentTime, leaseTtlSeconds);
    const leaseFields = {
      bindingId,
      botId,
      workerId,
      ownerInstanceId,
      status: 'starting',
      leaseExpiresAt,
      lastHeartbeatAt: currentTime,
      lastError: ''
    };

    if (existing) {
      if (!canAcquireLease(existing, ownerInstanceId, workerId, currentTime)) {
        return null;
      }

      const acquired = await executeQuery(StatusModel.findOneAndUpdate({
        botId,
        $or: [
          { ownerInstanceId, workerId },
          { leaseExpiresAt: { $lte: currentTime } },
          { status: 'stopped' }
        ]
      }, {
        $set: leaseFields
      }, {
        new: true
      }));

      return isLeaseOwnedByRequester(acquired, ownerInstanceId, workerId) ? acquired : null;
    }

    try {
      const inserted = await executeQuery(StatusModel.findOneAndUpdate({ botId }, {
        $setOnInsert: leaseFields
      }, {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true
      }));

      return isLeaseOwnedByRequester(inserted, ownerInstanceId, workerId) ? inserted : null;
    } catch (error) {
      if (error?.code === 11000) {
        return null;
      }

      throw error;
    }
  }

  /**
   * 接管当前实例遗留的旧 Worker 租约。
   * 输入: bindingId、botId 和新 workerId。
   * 输出: 成功接管后的租约状态；当前进程已有内存 Worker 或租约不属于本实例时返回 null。
   */
  async function recoverOwnLease({ bindingId, botId, workerId }) {
    if (registry.has(botId)) {
      return null;
    }

    const currentTime = now();
    const leaseFields = {
      bindingId,
      botId,
      workerId,
      ownerInstanceId,
      status: 'starting',
      leaseExpiresAt: addSeconds(currentTime, leaseTtlSeconds),
      lastHeartbeatAt: currentTime,
      lastError: ''
    };

    const recovered = await executeQuery(StatusModel.findOneAndUpdate({
      botId,
      ownerInstanceId
    }, {
      $set: leaseFields
    }, {
      new: true
    }));

    return isLeaseOwnedByRequester(recovered, ownerInstanceId, workerId) ? recovered : null;
  }

  /**
   * 续约当前 Worker 租约。
   * 输入: Bot ID 和 Worker ID。
   * 输出: true 表示续约成功，false 表示已经失租。
   */
  async function renewLease(botId, workerId) {
    const maxAttempts = Math.max(1, Number.parseInt(leaseRenewRetryAttempts, 10) || 1);
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const currentTime = now();
      try {
        const result = await executeQuery(StatusModel.updateOne({
          botId,
          ownerInstanceId,
          workerId,
          leaseExpiresAt: { $gt: currentTime }
        }, {
          $set: {
            leaseExpiresAt: addSeconds(currentTime, leaseTtlSeconds),
            lastHeartbeatAt: currentTime
          }
        }));

        if (result.modifiedCount === 1) {
          return true;
        }
      } catch (error) {
        lastError = error;
      }

      if (attempt < maxAttempts) {
        await waitMs(leaseRenewRetryDelayMs, setTimer);
      }
    }

    await logRenewLeaseFailure({
      botId,
      workerId,
      attemptCount: maxAttempts,
      currentTime: now(),
      error: lastError
    });
    return false;
  }

  /**
   * 释放当前 Worker 租约。
   * 输入: Bot ID 和 Worker ID。
   * 输出: true 表示释放成功，false 表示已经不是持有者。
   */
  async function releaseLease(botId, workerId) {
    const currentTime = now();
    const result = await executeQuery(StatusModel.updateOne({
      botId,
      ownerInstanceId,
      workerId
    }, {
      $set: {
        status: 'stopped',
        leaseExpiresAt: currentTime,
        lastHeartbeatAt: currentTime,
        lastError: ''
      }
    }));

    return result.modifiedCount === 1;
  }

  /**
   * 按 Bot ID 强制标记 Worker 为 stopped。
   * 输入: Bot ID。
   * 输出: true 表示状态记录被更新；用于停用配置时清理非本进程内存注册表的租约状态。
   */
  async function markStoppedByBotId(botId) {
    const currentTime = now();
    const result = await executeQuery(StatusModel.updateOne({
      botId
    }, {
      $set: {
        status: 'stopped',
        leaseExpiresAt: currentTime,
        lastHeartbeatAt: currentTime,
        lastError: ''
      }
    }));

    return result.modifiedCount === 1;
  }

  /**
   * 在持有租约时更新 Worker 状态。
   * 输入: Bot ID、Worker ID 和状态字段。
   * 输出: true 表示更新成功，false 表示失租。
   */
  async function updateStatusIfLeaseHeld(botId, workerId, fields) {
    const currentTime = now();
    const result = await executeQuery(StatusModel.updateOne({
      botId,
      ownerInstanceId,
      workerId,
      leaseExpiresAt: { $gt: currentTime }
    }, {
      $set: {
        ...fields,
        lastHeartbeatAt: currentTime
      }
    }));

    const updated = result.modifiedCount === 1;
    if (updated) {
      const status = await executeQuery(StatusModel.findOne({ botId }));
      await updateBindingSnapshot(status?.bindingId, fields);
    }

    return updated;
  }

  /**
   * 校验当前 Worker 是否仍持有租约。
   * 输入: Bot ID 和 Worker ID。
   * 输出: true 表示仍为有效持有者。
   */
  async function assertLeaseHeld(botId, workerId) {
    const currentTime = now();
    const status = await executeQuery(StatusModel.findOne({ botId }));
    return Boolean(
      status &&
      status.ownerInstanceId === ownerInstanceId &&
      status.workerId === workerId &&
      new Date(status.leaseExpiresAt) > currentTime
    );
  }

  /**
   * 启动指定绑定的 Worker。
   * 输入: 含密文 Secret 的绑定记录。
   * 输出: 启动结果；租约被占用时返回 skipped。
   */
  async function startBinding(binding, { recoverOwnLeases = false } = {}) {
    if (registry.has(binding.botId)) {
      return { started: false, skipped: true, reason: 'already_running' };
    }

    const workerId = createWorkerId(binding.botId);
    let lease = await acquireLease({
      bindingId: binding._id,
      botId: binding.botId,
      workerId
    });
    if (!lease && recoverOwnLeases) {
      lease = await recoverOwnLease({
        bindingId: binding._id,
        botId: binding.botId,
        workerId
      });
    }

    if (!lease) {
      const currentStatus = await findStatusByBotId(binding.botId);
      return {
        started: false,
        skipped: true,
        reason: 'lease_unavailable',
        retryAfterMs: calculateLeaseRetryAfterMs(currentStatus, now()),
        leaseExpiresAt: currentStatus?.leaseExpiresAt || null
      };
    }

    await updateBindingSnapshot(binding._id, { status: 'starting', lastError: '' });
    const worker = workerFactory({
      binding,
      secret: secretService.decryptSecret(binding),
      workerId,
      client: clientFactory(),
      scheduler: schedulerApi
    });

    registry.set(binding.botId, worker);
    const renewTimer = setInterval(async () => {
      const renewed = await renewLease(binding.botId, workerId);
      if (!renewed) {
        clearInterval(renewTimer);
        renewTimers.delete(binding.botId);
        await worker.stop();
      }
    }, renewIntervalSeconds * 1000);
    if (typeof renewTimer.unref === 'function') {
      renewTimer.unref();
    }
    renewTimers.set(binding.botId, renewTimer);

    try {
      await worker.start();
      if (typeof worker.state?.current === 'function' && worker.state.current() === 'stopped') {
        clearInterval(renewTimer);
        renewTimers.delete(binding.botId);
        registry.delete(binding.botId);
        await updateBindingSnapshot(binding._id, { status: 'stopped', lastError: '' });
        return { started: false, skipped: true, reason: 'lease_lost' };
      }
      return { started: true, workerId };
    } catch (error) {
      clearInterval(renewTimer);
      renewTimers.delete(binding.botId);
      registry.delete(binding.botId);
      await updateBindingSnapshot(binding._id, { status: 'failed', lastError: error.message });
      throw error;
    }
  }

  /**
   * 停止指定绑定的 Worker。
   * 输入: 绑定记录或含 botId/_id 的对象。
   * 输出: 停止结果。
   */
  async function stopBinding(binding) {
    const botId = binding.botId;
    const worker = registry.get(botId);
    const renewTimer = renewTimers.get(botId);

    if (renewTimer) {
      clearInterval(renewTimer);
      renewTimers.delete(botId);
    }

    if (worker) {
      await worker.stop();
      registry.delete(botId);
    } else if (binding.workerId) {
      await releaseLease(botId, binding.workerId);
    } else {
      await markStoppedByBotId(botId);
    }

    await updateBindingSnapshot(binding._id, { status: 'stopped', lastError: '' });
    return { stopped: true };
  }

  /**
   * 重启指定绑定的 Worker。
   * 输入: 新绑定记录和可选 previousBotId。
   * 输出: 启动结果。
   */
  async function restartBinding(binding, { previousBotId } = {}) {
    if (previousBotId && previousBotId !== binding.botId) {
      await stopBinding({ ...binding, botId: previousBotId });
    } else {
      await stopBinding(binding);
    }

    return startBinding(binding);
  }

  /**
   * 扫描并启动所有已启用绑定。
   * 输入: 无。
   * 输出: 启动数量和跳过数量。
   */
  async function startEnabledBindings(options = {}) {
    const query = BindingModel.find({ enabled: true });
    if (query && typeof query.select === 'function') {
      query.select('+secretCiphertext +fastgptApiKeyCiphertext');
    }
    if (query && typeof query.lean === 'function') {
      query.lean();
    }
    const bindings = await executeQuery(query);
    let started = 0;
    let skipped = 0;
    const skippedReasons = {};
    let retryAfterMs = null;

    for (const binding of bindings || []) {
      const result = await startBinding(binding, options);
      if (result.started) {
        started += 1;
      } else {
        skipped += 1;
        const reason = result.reason || 'unknown';
        skippedReasons[reason] = (skippedReasons[reason] || 0) + 1;
        if (reason === 'lease_unavailable' && Number.isFinite(result.retryAfterMs)) {
          retryAfterMs = retryAfterMs === null
            ? result.retryAfterMs
            : Math.min(retryAfterMs, result.retryAfterMs);
        }
      }
    }

    const summary = { started, skipped };
    if (Object.keys(skippedReasons).length > 0) {
      summary.skippedReasons = skippedReasons;
    }
    if (retryAfterMs !== null) {
      summary.retryAfterMs = retryAfterMs;
    }

    return summary;
  }

  const schedulerApi = {
    acquireLease,
    renewLease,
    releaseLease,
    markStoppedByBotId,
    updateStatusIfLeaseHeld,
    assertLeaseHeld,
    recoverOwnLease,
    startBinding,
    stopBinding,
    restartBinding,
    startEnabledBindings
  };

  return schedulerApi;
}

module.exports = {
  addSeconds,
  canAcquireLease,
  createWecomBotWorkerScheduler
};
