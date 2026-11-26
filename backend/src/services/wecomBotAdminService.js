const WecomBotBinding = require('../models/WecomBotBinding');
const WecomBotWorkerStatus = require('../models/WecomBotWorkerStatus');
const { sanitizeSensitiveSummary } = require('./wecomBotConfigService');

const KNOWN_CONNECTION_STATUSES = new Set([
  'stopped',
  'starting',
  'connected',
  'reconnecting',
  'failed',
  'disconnected'
]);

/**
 * 提供默认当前时间。
 * 输入: 无。
 * 输出: 当前 Date 实例。
 */
function defaultNow() {
  return new Date();
}

/**
 * 执行 Mongoose 查询、thenable 或普通值。
 * 输入: 查询对象、Promise 或普通值。
 * 输出: 查询解析后的结果。
 */
async function executeQuery(query) {
  if (query && typeof query.exec === 'function') {
    return query.exec();
  }

  return query;
}

/**
 * 转换 Mongoose 文档为普通对象。
 * 输入: Mongoose 文档或普通对象。
 * 输出: 普通对象或 null。
 */
function toPlainDocument(document) {
  if (!document) {
    return null;
  }

  if (typeof document.toObject === 'function') {
    return document.toObject();
  }

  return document;
}

/**
 * 将 Mongo ID 或任意值转成稳定字符串。
 * 输入: ObjectId、字符串或空值。
 * 输出: 字符串 ID；空值返回空字符串。
 */
function stringifyId(value) {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value.toString === 'function') {
    return value.toString();
  }

  return String(value);
}

/**
 * 解析调用方传入的当前时间。
 * 输入: Date、时间函数或空值。
 * 输出: 可比较的 Date 实例。
 */
function resolveNow(now) {
  const value = typeof now === 'function' ? now() : now;
  if (value instanceof Date) {
    return value;
  }

  if (value) {
    return new Date(value);
  }

  return defaultNow();
}

/**
 * 判断应用是否来自外链源。
 * 输入: 应用列表项。
 * 输出: true 表示外链应用，不应附加企业微信 Bot 摘要。
 */
function isLinkSourceApp(app) {
  return app?.source === 'link' || app?.appSource === 'link' || app?.isLinkApp === true;
}

/**
 * 读取应用列表项的应用 ID。
 * 输入: 应用列表项。
 * 输出: 字符串应用 ID。
 */
function getAppId(app) {
  return stringifyId(app?._id || app?.id || app?.appId);
}

/**
 * 去重并规范化可查询绑定的应用 ID。
 * 输入: 应用列表。
 * 输出: 非外链应用的唯一字符串 ID 列表。
 */
function normalizeAppIds(apps) {
  const ids = [];
  const seen = new Set();

  for (const app of apps || []) {
    if (isLinkSourceApp(app)) {
      continue;
    }

    const appId = getAppId(app);
    if (!appId || seen.has(appId)) {
      continue;
    }

    seen.add(appId);
    ids.push(appId);
  }

  return ids;
}

/**
 * 规范化连接状态，避免未知快照直接外泄。
 * 输入: 原始状态和兜底状态。
 * 输出: 已知连接状态。
 */
function normalizeConnectionStatus(status, fallback = 'stopped') {
  if (KNOWN_CONNECTION_STATUSES.has(status)) {
    return status;
  }

  return fallback;
}

/**
 * 判断 Worker 状态是否仍持有有效租约。
 * 输入: Worker 状态记录和参考时间。
 * 输出: true 表示可优先使用该 Worker 状态。
 */
function isActiveWorkerStatus(workerStatus, referenceNow) {
  if (!workerStatus?.leaseExpiresAt) {
    return false;
  }

  return new Date(workerStatus.leaseExpiresAt).getTime() > referenceNow.getTime();
}

/**
 * 将连接状态映射为管理员视角状态。
 * 输入: 绑定启用状态和有效连接状态。
 * 输出: online/offline/disabled/starting/reconnecting/failed 之一。
 */
function mapAdminStatus(enabled, connectionStatus) {
  if (!enabled) {
    return 'disabled';
  }

  if (connectionStatus === 'connected') {
    return 'online';
  }

  if (connectionStatus === 'starting') {
    return 'starting';
  }

  if (connectionStatus === 'reconnecting') {
    return 'reconnecting';
  }

  if (connectionStatus === 'failed') {
    return 'failed';
  }

  return 'offline';
}

/**
 * 从绑定快照生成摘要状态字段。
 * 输入: Bot 绑定普通对象。
 * 输出: 快照连接状态、最近连接时间和脱敏错误摘要。
 */
function createSnapshotFields(binding) {
  return {
    connectionStatus: normalizeConnectionStatus(binding?.connectionStatusSnapshot, 'stopped'),
    lastConnectedAt: binding?.lastConnectedAtSnapshot || null,
    lastError: sanitizeSensitiveSummary(binding?.lastErrorSnapshot || '')
  };
}

/**
 * 从有效 Worker 生成摘要状态字段。
 * 输入: Worker 状态普通对象。
 * 输出: Worker 连接状态、最近连接时间和脱敏错误摘要。
 */
function createWorkerFields(workerStatus) {
  return {
    connectionStatus: normalizeConnectionStatus(workerStatus?.status, 'stopped'),
    lastConnectedAt: workerStatus?.lastConnectedAt || null,
    lastError: sanitizeSensitiveSummary(workerStatus?.lastError || '')
  };
}

/**
 * 从绑定与 Worker 状态生成管理员摘要。
 * 输入: Bot 绑定、可选 Worker 状态和当前时间。
 * 输出: 管理员应用列表可展示的企业微信 Bot 摘要。
 */
function mapBindingToAdminSummary(binding, workerStatus = null, now = defaultNow) {
  const plainBinding = toPlainDocument(binding);
  if (!plainBinding) {
    return {
      configured: false,
      enabled: false,
      botId: '',
      connectionStatus: 'disconnected',
      adminStatus: 'offline',
      lastConnectedAt: null,
      lastError: ''
    };
  }

  const enabled = Boolean(plainBinding.enabled);
  const referenceNow = resolveNow(now);
  let statusFields = createSnapshotFields(plainBinding);

  if (enabled && isActiveWorkerStatus(workerStatus, referenceNow)) {
    statusFields = createWorkerFields(workerStatus);
  } else if (enabled) {
    statusFields = {
      ...statusFields,
      connectionStatus: 'disconnected'
    };
  }

  return {
    configured: true,
    bindingId: stringifyId(plainBinding._id),
    appId: stringifyId(plainBinding.appId),
    botId: plainBinding.botId || '',
    enabled,
    connectionStatus: statusFields.connectionStatus,
    adminStatus: mapAdminStatus(enabled, statusFields.connectionStatus),
    lastConnectedAt: statusFields.lastConnectedAt,
    lastError: statusFields.lastError
  };
}

/**
 * 建立绑定的应用 ID 索引。
 * 输入: 绑定记录数组。
 * 输出: appId 到绑定记录的 Map。
 */
function createBindingByAppId(bindings) {
  const bindingByAppId = new Map();

  for (const binding of bindings || []) {
    const plainBinding = toPlainDocument(binding);
    const appId = stringifyId(plainBinding?.appId);
    if (appId) {
      bindingByAppId.set(appId, plainBinding);
    }
  }

  return bindingByAppId;
}

/**
 * 建立有效 Worker 状态的 Bot ID 索引。
 * 输入: Worker 状态数组和参考时间。
 * 输出: botId 到有效 Worker 状态的 Map。
 */
function createActiveStatusByBotId(statuses, referenceNow) {
  const statusByBotId = new Map();

  for (const status of statuses || []) {
    const plainStatus = toPlainDocument(status);
    const botId = plainStatus?.botId || '';
    if (!botId || !isActiveWorkerStatus(plainStatus, referenceNow)) {
      continue;
    }

    const existing = statusByBotId.get(botId);
    if (!existing || new Date(plainStatus.leaseExpiresAt) > new Date(existing.leaseExpiresAt)) {
      statusByBotId.set(botId, plainStatus);
    }
  }

  return statusByBotId;
}

/**
 * 提取绑定中的唯一 Bot ID。
 * 输入: 绑定记录数组。
 * 输出: 唯一 Bot ID 字符串数组。
 */
function extractBotIds(bindings) {
  const botIds = [];
  const seen = new Set();

  for (const binding of bindings || []) {
    const plainBinding = toPlainDocument(binding);
    const botId = plainBinding?.botId || '';
    if (!botId || seen.has(botId)) {
      continue;
    }

    seen.add(botId);
    botIds.push(botId);
  }

  return botIds;
}

/**
 * 读取查询参数中的第一个有效值。
 * 输入: Express 查询值、数组或空值。
 * 输出: 单个查询值或 undefined。
 */
function readQueryValue(value) {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

/**
 * 规范化布尔查询参数。
 * 输入: true/false 布尔值或字符串。
 * 输出: true、false 或 null。
 */
function normalizeBooleanQuery(value) {
  const firstValue = readQueryValue(value);
  if (firstValue === true || firstValue === 'true') {
    return true;
  }

  if (firstValue === false || firstValue === 'false') {
    return false;
  }

  return null;
}

/**
 * 规范化 Bot 状态查询参数。
 * 输入: 查询中的状态字符串或空值。
 * 输出: 小写状态字符串或空字符串。
 */
function normalizeStatusQuery(value) {
  const firstValue = readQueryValue(value);
  return String(firstValue || '').trim().toLowerCase();
}

/**
 * 判断应用是否满足配置状态过滤。
 * 输入: 应用列表项和配置过滤值。
 * 输出: true 表示该应用应保留。
 */
function matchesConfiguredFilter(app, configuredFilter) {
  if (configuredFilter === null) {
    return true;
  }

  const configured = app?.wecomBot?.configured === true;
  return configured === configuredFilter;
}

/**
 * 判断应用是否满足 Bot 管理状态过滤。
 * 输入: 应用列表项和状态过滤值。
 * 输出: true 表示该应用应保留。
 */
function matchesStatusFilter(app, statusFilter) {
  if (!statusFilter) {
    return true;
  }

  const adminStatus = String(app?.wecomBot?.adminStatus || '').toLowerCase();
  const connectionStatus = String(app?.wecomBot?.connectionStatus || '').toLowerCase();
  return adminStatus === statusFilter || connectionStatus === statusFilter;
}

/**
 * 规范化批量重启请求中的应用 ID。
 * 输入: 单个应用 ID 或应用 ID 数组。
 * 输出: 去空并去重后的字符串应用 ID 数组，保留首次出现顺序。
 */
function normalizeRequestedAppIds(appIds) {
  const requested = Array.isArray(appIds) ? appIds : [appIds];
  const normalized = [];
  const seen = new Set();

  for (const appId of requested) {
    const normalizedAppId = stringifyId(appId).trim();
    if (!normalizedAppId || seen.has(normalizedAppId)) {
      continue;
    }

    seen.add(normalizedAppId);
    normalized.push(normalizedAppId);
  }

  return normalized;
}

/**
 * 创建管理员企业微信 Bot 摘要服务。
 * 输入: 可注入的绑定模型、状态模型、配置服务和当前时间函数。
 * 输出: 包含摘要附加、过滤和重启编排方法的服务对象。
 */
function createWecomBotAdminService({
  BindingModel = WecomBotBinding,
  StatusModel = WecomBotWorkerStatus,
  configService = null,
  now = defaultNow
} = {}) {
  /**
   * 创建重启能力缺失错误。
   * 输入: 无。
   * 输出: 带业务错误码和 HTTP 状态码的 Error 实例。
   */
  function createReactivateUnavailableError() {
    const error = new Error('WeCom Bot reactivation requires injected configService.reactivate');
    error.code = 'WECOM_BOT_REACTIVATE_UNAVAILABLE';
    error.statusCode = 500;
    return error;
  }

  /**
   * 读取已注入的重启服务。
   * 输入: 无。
   * 输出: 暴露 reactivate 方法的配置服务；缺失时抛出明确业务错误。
   */
  function getReactivateService() {
    if (!configService || typeof configService.reactivate !== 'function') {
      throw createReactivateUnavailableError();
    }

    return configService;
  }

  /**
   * 查询指定应用的 Bot 绑定。
   * 输入: 应用 ID 数组。
   * 输出: 绑定普通对象数组。
   */
  async function findBindingsByAppIds(appIds) {
    if (appIds.length === 0) {
      return [];
    }

    const query = BindingModel.find({ appId: { $in: appIds } });
    if (query && typeof query.select === 'function') {
      query.select('appId botId enabled connectionStatusSnapshot lastConnectedAtSnapshot lastErrorSnapshot');
    }
    if (query && typeof query.lean === 'function') {
      query.lean();
    }

    return await executeQuery(query) || [];
  }

  /**
   * 查询仍在租约内的 Worker 状态。
   * 输入: Bot ID 数组和参考时间。
   * 输出: Worker 状态普通对象数组。
   */
  async function findActiveStatusesByBotIds(botIds, referenceNow) {
    if (botIds.length === 0 || !StatusModel || typeof StatusModel.find !== 'function') {
      return [];
    }

    const query = StatusModel.find({
      botId: { $in: botIds },
      leaseExpiresAt: { $gt: referenceNow }
    });
    if (query && typeof query.lean === 'function') {
      query.lean();
    }

    return await executeQuery(query) || [];
  }

  /**
   * 将 Bot 摘要附加到管理员应用列表。
   * 输入: 管理员应用列表数组。
   * 输出: 同一个应用列表数组，已就地附加 wecomBot 字段。
   */
  async function attachBotSummaries(apps = []) {
    const appIds = normalizeAppIds(apps);
    const referenceNow = resolveNow(now);
    const bindings = await findBindingsByAppIds(appIds);
    const bindingByAppId = createBindingByAppId(bindings);
    const botIds = extractBotIds(bindings);
    const statuses = await findActiveStatusesByBotIds(botIds, referenceNow);
    const statusByBotId = createActiveStatusByBotId(statuses, referenceNow);

    for (const app of apps || []) {
      if (isLinkSourceApp(app)) {
        continue;
      }

      const binding = bindingByAppId.get(getAppId(app));
      if (!binding) {
        continue;
      }

      app.wecomBot = mapBindingToAdminSummary(
        binding,
        statusByBotId.get(binding.botId),
        referenceNow
      );
    }

    return apps;
  }

  /**
   * 按企业微信 Bot 查询参数过滤应用列表。
   * 输入: 已附加摘要的应用列表和查询参数。
   * 输出: 过滤后的新应用列表数组。
   */
  function filterByBotQuery(apps = [], query = {}) {
    const configuredFilter = normalizeBooleanQuery(query.wecomBotConfigured);
    const statusFilter = normalizeStatusQuery(query.wecomBotStatus);
    const filteredApps = [];

    for (const app of apps || []) {
      if (!matchesConfiguredFilter(app, configuredFilter)) {
        continue;
      }

      if (!matchesStatusFilter(app, statusFilter)) {
        continue;
      }

      filteredApps.push(app);
    }

    return filteredApps;
  }

  /**
   * 重启单个应用的企业微信 Bot 配置。
   * 输入: 应用 ID 和管理员上下文。
   * 输出: 单应用成功结果对象；失败时保留原错误向调用方抛出。
   */
  async function reactivateOne(appId, context = {}) {
    const service = getReactivateService();
    const normalizedAppId = stringifyId(appId).trim();
    const result = await service.reactivate(normalizedAppId, context);
    const connectionStatus = normalizeConnectionStatus(result?.connectionStatus, 'starting');

    return {
      appId: normalizedAppId,
      success: true,
      enabled: result?.enabled !== false,
      connectionStatus
    };
  }

  /**
   * 批量重启应用的企业微信 Bot 配置。
   * 输入: 应用 ID 数组和管理员上下文。
   * 输出: 依赖可用时返回保留部分失败的批量结果对象；依赖缺失时直接抛出配置错误。
   */
  async function reactivateMany(appIds, context = {}) {
    getReactivateService();

    const requestedAppIds = normalizeRequestedAppIds(appIds);
    const results = [];
    let succeeded = 0;

    for (const appId of requestedAppIds) {
      let result;
      try {
        result = await reactivateOne(appId, context);
      } catch (error) {
        result = {
          appId,
          success: false,
          errorCode: error?.code || 'WECOM_BOT_REACTIVATE_FAILED',
          message: sanitizeSensitiveSummary(error),
          statusCode: error?.statusCode || 400
        };
      }

      if (result.success) {
        succeeded += 1;
      }

      results.push(result);
    }

    return {
      requested: requestedAppIds.length,
      succeeded,
      failed: requestedAppIds.length - succeeded,
      results
    };
  }

  return {
    attachBotSummaries,
    filterByBotQuery,
    reactivateOne,
    reactivateMany
  };
}

module.exports = {
  createWecomBotAdminService,
  mapBindingToAdminSummary,
  normalizeAppIds
};
