const Users = require('../models/Users');
const WecomBotConversation = require('../models/WecomBotConversation');
const { getFrontendUrl } = require('../config/frontendUrl');

/**
 * 企业微信用户绑定服务错误。
 * 输入: 业务错误码、错误消息和 HTTP 状态码。
 * 输出: 携带 code/statusCode 的错误对象。
 */
class WecomUserBindingServiceError extends Error {
  constructor(code, message, statusCode = 400, options = {}) {
    super(message);
    this.name = 'WecomUserBindingServiceError';
    this.code = code;
    this.statusCode = statusCode;
    this.cause = options.cause;
  }
}

/**
 * 归一化企业微信用户 ID。
 * 输入: 原始企业微信 ID 或 wecom_user: 前缀形式。
 * 输出: 去掉前缀和空白后的原始 ID；无效输入返回空字符串。
 */
function normalizeWecomUserId(value) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return '';
  }

  return normalized.replace(/^wecom_user:/i, '').trim();
}

/**
 * 归一化当前登录用户工号。
 * 输入: 登录态用户对象中的 employeeNumber、Badge 或 name。
 * 输出: 去空白后的工号字符串；无法解析时返回空字符串。
 */
function normalizeEmployeeNumber(currentUser = {}) {
  const user = currentUser || {};
  return String(user.employeeNumber || user.username || user.Badge || user.name || '').trim();
}

/**
 * 脱敏企业微信用户 ID。
 * 输入: 企业微信用户 ID。
 * 输出: 可展示的短 ID，避免完整长 ID 暴露给前端或日志。
 */
function maskWecomUserId(value) {
  const normalized = normalizeWecomUserId(value);
  if (!normalized) {
    return '';
  }

  if (normalized.length <= 12) {
    return `${normalized.slice(0, 6)}...${normalized.slice(-6)}`;
  }

  return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`;
}

/**
 * 构造企业微信身份认证链接。
 * 输入: 前端根地址和归一化企业微信用户 ID。
 * 输出: 携带 qw_token 查询参数的认证 URL。
 */
function buildAuthUrl(authBaseUrl, wecomUserId) {
  // 走 config/frontendUrl 统一兜底，避免漏注入 FRONTEND_URL 时回退到 localhost
  const fallbackBaseUrl = getFrontendUrl();
  const rawBaseUrl = authBaseUrl || fallbackBaseUrl;

  try {
    const url = new URL(rawBaseUrl);
    url.searchParams.set('qw_token', wecomUserId);
    return url.toString();
  } catch (error) {
    const separator = String(rawBaseUrl).includes('?') ? '&' : '?';
    return `${rawBaseUrl}${separator}qw_token=${encodeURIComponent(wecomUserId)}`;
  }
}

/**
 * 创建未绑定用户的认证回复。
 * 输入: 前端根地址和企业微信用户 ID。
 * 输出: 认证链接、脱敏 ID 和可发送给企业微信的文案。
 */
function createAuthRequiredResult(authBaseUrl, wecomUserId) {
  const authUrl = buildAuthUrl(authBaseUrl, wecomUserId);
  return {
    bound: false,
    wecomUserId,
    wecomUserIdMasked: maskWecomUserId(wecomUserId),
    authUrl,
    replyText: `因企业微信安全信息管控，首次使用企业微信智能机器人需要进行身份绑定认证，请前往认证界面完成认证，认证链接：${authUrl}`
  };
}

/**
 * 执行 Mongoose 查询或普通 Promise。
 * 输入: Mongoose Query、thenable 或普通值。
 * 输出: 解析后的结果。
 */
async function executeQuery(query) {
  if (query && typeof query.exec === 'function') {
    return query.exec();
  }

  if (query && typeof query.then === 'function') {
    return query;
  }

  return query;
}

/**
 * 企业微信用户绑定服务。
 * 输入: Users 模型、会话模型和认证链接根地址。
 * 输出: 查询绑定、写入绑定和生成认证链接的方法。
 */
class WecomUserBindingService {
  constructor({
    UsersModel = Users,
    ConversationModel = WecomBotConversation,
    authBaseUrl = process.env.WECOM_BOT_AUTH_BASE_URL || getFrontendUrl()
  } = {}) {
    this.UsersModel = UsersModel;
    this.ConversationModel = ConversationModel;
    this.authBaseUrl = authBaseUrl;
  }

  /**
   * 按企业微信用户 ID 查询已绑定平台用户。
   * 输入: 原始或带 wecom_user: 前缀的企业微信用户 ID。
   * 输出: bound=true 的用户工号信息；未命中时返回认证链接数据。
   */
  async findBoundUserByWecomId(wecomUserId) {
    const normalizedWecomUserId = normalizeWecomUserId(wecomUserId);
    if (!normalizedWecomUserId) {
      return createAuthRequiredResult(this.authBaseUrl, '');
    }

    let query = this.UsersModel.findOne({ qw_token: normalizedWecomUserId });
    if (query && typeof query.lean === 'function') {
      query = query.lean();
    }

    let user = await executeQuery(query);
    if (!user) {
      query = this.UsersModel.findOne({ username: normalizedWecomUserId });
      if (query && typeof query.lean === 'function') {
        query = query.lean();
      }
      user = await executeQuery(query);
    }

    const username = normalizeEmployeeNumber(user);
    if (!user || !username) {
      return createAuthRequiredResult(this.authBaseUrl, normalizedWecomUserId);
    }

    await executeQuery(this.UsersModel.findOneAndUpdate(
      { username },
      { $set: { qwLastUsedAt: new Date() } },
      { new: false }
    ));

    return {
      bound: true,
      wecomUserId: normalizedWecomUserId,
      wecomUserIdMasked: maskWecomUserId(normalizedWecomUserId),
      username,
      userName: user.userName || user.Name || ''
    };
  }

  /**
   * 将企业微信用户 ID 绑定到当前登录用户工号。
   * 输入: qwToken 和当前登录用户信息。
   * 输出: 绑定后的工号与脱敏企业微信用户 ID。
   */
  async bindCurrentUser({ qwToken, currentUser } = {}) {
    const normalizedWecomUserId = normalizeWecomUserId(qwToken);
    if (!normalizedWecomUserId) {
      throw new WecomUserBindingServiceError('WECOM_USER_ID_REQUIRED', '企业微信用户 ID 不能为空');
    }

    const username = normalizeEmployeeNumber(currentUser);
    if (!username) {
      throw new WecomUserBindingServiceError('EMPLOYEE_BADGE_REQUIRED', '当前登录用户缺少工号');
    }

    const now = new Date();
    try {
      const isEmployeeBadgeToken = normalizedWecomUserId === username;
      if (!isEmployeeBadgeToken) {
        await executeQuery(this.UsersModel.updateMany(
          { qw_token: normalizedWecomUserId, username: { $ne: username } },
          {
            $unset: {
              qw_token: '',
              qwBoundAt: '',
              qwLastUsedAt: ''
            }
          }
        ));
      }

      const userUpdates = {
        username,
        userName: currentUser?.Name || currentUser?.userName || currentUser?.name || username,
        qwBoundAt: now
      };
      if (!isEmployeeBadgeToken) {
        userUpdates.qw_token = normalizedWecomUserId;
      }

      const boundUser = await executeQuery(this.UsersModel.findOneAndUpdate(
        { username },
        {
          $set: userUpdates
        },
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true
        }
      ));

      await this.resetConversationsForWecomUser(normalizedWecomUserId, username, now);

      return {
        username,
        userName: boundUser?.userName || currentUser?.Name || '',
        wecomUserIdMasked: maskWecomUserId(normalizedWecomUserId)
      };
    } catch (error) {
      if (error?.code === 11000) {
        throw new WecomUserBindingServiceError(
          'WECOM_USER_BIND_CONFLICT',
          '企业微信用户绑定冲突，请稍后重试',
          409,
          { cause: error }
        );
      }

      throw new WecomUserBindingServiceError('BIND_WECOM_USER_FAILED', '企业微信用户绑定失败', 500, {
        cause: error
      });
    }
  }

  /**
   * 重置企业微信用户相关 FastGPT 会话。
   * 输入: 归一化企业微信用户 ID、新工号和当前时间。
   * 输出: MongoDB 更新结果；确保旧 appConversationId 不再复用。
   */
  async resetConversationsForWecomUser(wecomUserId, username, now = new Date()) {
    if (!this.ConversationModel || typeof this.ConversationModel.updateMany !== 'function') {
      return { modifiedCount: 0 };
    }

    return executeQuery(this.ConversationModel.updateMany(
      { externalUserId: wecomUserId },
      {
        $set: {
          fastgptUserId: username,
          appConversationId: '',
          lastMessageAt: now
        }
      }
    ));
  }
}

/**
 * 创建企业微信用户绑定服务实例。
 * 输入: 可选依赖覆盖。
 * 输出: WecomUserBindingService 实例。
 */
function createWecomUserBindingService(options = {}) {
  return new WecomUserBindingService(options);
}

module.exports = {
  WecomUserBindingService,
  WecomUserBindingServiceError,
  buildAuthUrl,
  createAuthRequiredResult,
  createWecomUserBindingService,
  maskWecomUserId,
  normalizeWecomUserId
};
