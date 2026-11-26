import { http } from '../utils/request';
import type {
  AdminWecomBotReactivateManyResponse,
  AdminWecomBotReactivateResult,
  BindWecomUserPayload,
  BindWecomUserResponse,
  CreateFastgptOpenApiKeyPayload,
  CreateFastgptOpenApiKeyResponse,
  FastgptOpenApiKeyListResponse,
  RevealWecomBotSecretResponse,
  SaveWecomBotConfigPayload,
  SaveWecomBotConfigResponse,
  TestWecomBotConnectionPayload,
  TestWecomBotConnectionResponse,
  ToggleWecomBotPayload,
  ToggleWecomBotResponse,
  WecomBotConfigResponse
} from '../types/wecomBot';

interface ApiEnvelope<T> {
  code: number;
  success: boolean;
  message: string;
  data: T;
}

/**
 * 提取统一响应中的 data 字段。
 * 输入: 后端统一响应对象。
 * 输出: 业务 data；调用方无需关心 code/success 外壳。
 */
function unwrapData<T>(response: unknown): T {
  return (response as ApiEnvelope<T>).data;
}

export const wecomBotApi = {
  /**
   * 查询应用的企业微信 Bot 配置。
   * 输入: FastGPT 应用 ID。
   * 输出: 已配置 config 或未配置 defaults。
   */
  async getConfig(appId: string): Promise<WecomBotConfigResponse> {
    const response = await http.get<ApiEnvelope<WecomBotConfigResponse>>(`/apps/${appId}/wecom-bot`);
    return unwrapData<WecomBotConfigResponse>(response);
  },

  /**
   * 保存应用的企业微信 Bot 配置。
   * 输入: FastGPT 应用 ID 和表单配置。
   * 输出: 保存后的脱敏配置。
   */
  async saveConfig(appId: string, payload: SaveWecomBotConfigPayload): Promise<SaveWecomBotConfigResponse> {
    const response = await http.put<ApiEnvelope<SaveWecomBotConfigResponse>>(`/apps/${appId}/wecom-bot`, payload);
    return unwrapData<SaveWecomBotConfigResponse>(response);
  },

  /**
   * 显式展示已保存的企业微信 Bot Secret。
   * 输入: FastGPT 应用 ID。
   * 输出: 后端按需解密后的 Secret 明文。
   */
  async revealSecret(appId: string): Promise<RevealWecomBotSecretResponse> {
    const response = await http.post<ApiEnvelope<RevealWecomBotSecretResponse>>(
      `/apps/${appId}/wecom-bot/secret/reveal`
    );
    return unwrapData<RevealWecomBotSecretResponse>(response);
  },

  /**
   * 查询应用级 FastGPT OpenAPI Key 列表。
   * 输入: FastGPT 应用 ID。
   * 输出: 只含名称、脱敏 key 和创建时间的列表。
   */
  async listFastgptOpenApiKeys(appId: string): Promise<FastgptOpenApiKeyListResponse> {
    const response = await http.get<ApiEnvelope<FastgptOpenApiKeyListResponse>>(
      `/apps/${appId}/wecom-bot/fastgpt-openapi-keys`
    );
    return unwrapData<FastgptOpenApiKeyListResponse>(response);
  },

  /**
   * 为当前应用创建 FastGPT OpenAPI Key。
   * 输入: FastGPT 应用 ID 和可选名称。
   * 输出: 新 key 的脱敏展示字段和仅创建时返回的完整 key。
   */
  async createFastgptOpenApiKey(
    appId: string,
    payload: CreateFastgptOpenApiKeyPayload
  ): Promise<CreateFastgptOpenApiKeyResponse> {
    const response = await http.post<ApiEnvelope<CreateFastgptOpenApiKeyResponse>>(
      `/apps/${appId}/wecom-bot/fastgpt-openapi-keys`,
      payload
    );
    return unwrapData<CreateFastgptOpenApiKeyResponse>(response);
  },

  /**
   * 独立启用或停用企业微信 Bot。
   * 输入: FastGPT 应用 ID 和启停状态。
   * 输出: 最新启停状态和连接状态。
   */
  async toggleEnabled(appId: string, payload: ToggleWecomBotPayload): Promise<ToggleWecomBotResponse> {
    const response = await http.put<ApiEnvelope<ToggleWecomBotResponse>>(`/apps/${appId}/wecom-bot/enabled`, payload);
    return unwrapData<ToggleWecomBotResponse>(response);
  },

  /**
   * 测试企业微信 Bot 连接。
   * 输入: FastGPT 应用 ID 和草稿或已保存凭证语义。
   * 输出: 测试连接结果。
   */
  async testConnection(
    appId: string,
    payload: TestWecomBotConnectionPayload
  ): Promise<TestWecomBotConnectionResponse> {
    const response = await http.post<ApiEnvelope<TestWecomBotConnectionResponse>>(
      `/apps/${appId}/wecom-bot/test-connection`,
      payload
    );
    return unwrapData<TestWecomBotConnectionResponse>(response);
  },

  /**
   * 绑定当前登录用户与企业微信用户 ID。
   * 输入: 认证链接携带的 qw_token。
   * 输出: 当前工号和脱敏后的企业微信用户 ID。
   */
  async bindWecomUser(payload: BindWecomUserPayload): Promise<BindWecomUserResponse> {
    const response = await http.post<ApiEnvelope<BindWecomUserResponse>>('/wecom-bot/user-binding/bind', payload);
    return unwrapData<BindWecomUserResponse>(response);
  }
};

export const wecomBotAdminApi = {
  /**
   * 管理员查询任意 FastGPT 应用的企业微信 Bot 配置。
   * 输入: FastGPT 应用 ID。
   * 输出: 已配置 config 或未配置 defaults。
   */
  async getConfig(appId: string): Promise<WecomBotConfigResponse> {
    const response = await http.get<ApiEnvelope<WecomBotConfigResponse>>(
      `/apps-new/admin/apps/${appId}/wecom-bot`
    );
    return unwrapData<WecomBotConfigResponse>(response);
  },

  /**
   * 管理员保存任意 FastGPT 应用的企业微信 Bot 配置。
   * 输入: FastGPT 应用 ID 和表单配置。
   * 输出: 保存后的脱敏配置。
   */
  async saveConfig(appId: string, payload: SaveWecomBotConfigPayload): Promise<SaveWecomBotConfigResponse> {
    const response = await http.put<ApiEnvelope<SaveWecomBotConfigResponse>>(
      `/apps-new/admin/apps/${appId}/wecom-bot`,
      payload
    );
    return unwrapData<SaveWecomBotConfigResponse>(response);
  },

  /**
   * 管理员显式展示已保存的企业微信 Bot Secret。
   * 输入: FastGPT 应用 ID。
   * 输出: Secret 明文。
   */
  async revealSecret(appId: string): Promise<RevealWecomBotSecretResponse> {
    const response = await http.post<ApiEnvelope<RevealWecomBotSecretResponse>>(
      `/apps-new/admin/apps/${appId}/wecom-bot/secret/reveal`
    );
    return unwrapData<RevealWecomBotSecretResponse>(response);
  },

  /**
   * 管理员查询应用级 FastGPT OpenAPI Key 列表。
   * 输入: FastGPT 应用 ID。
   * 输出: 可选 key 列表。
   */
  async listFastgptOpenApiKeys(appId: string): Promise<FastgptOpenApiKeyListResponse> {
    const response = await http.get<ApiEnvelope<FastgptOpenApiKeyListResponse>>(
      `/apps-new/admin/apps/${appId}/wecom-bot/fastgpt-openapi-keys`
    );
    return unwrapData<FastgptOpenApiKeyListResponse>(response);
  },

  /**
   * 管理员为应用创建 FastGPT OpenAPI Key。
   * 输入: FastGPT 应用 ID 和可选名称。
   * 输出: 新 key。
   */
  async createFastgptOpenApiKey(
    appId: string,
    payload: CreateFastgptOpenApiKeyPayload
  ): Promise<CreateFastgptOpenApiKeyResponse> {
    const response = await http.post<ApiEnvelope<CreateFastgptOpenApiKeyResponse>>(
      `/apps-new/admin/apps/${appId}/wecom-bot/fastgpt-openapi-keys`,
      payload
    );
    return unwrapData<CreateFastgptOpenApiKeyResponse>(response);
  },

  /**
   * 管理员测试企业微信 Bot 连接。
   * 输入: FastGPT 应用 ID 和测试凭证语义。
   * 输出: 测试连接结果。
   */
  async testConnection(
    appId: string,
    payload: TestWecomBotConnectionPayload
  ): Promise<TestWecomBotConnectionResponse> {
    const response = await http.post<ApiEnvelope<TestWecomBotConnectionResponse>>(
      `/apps-new/admin/apps/${appId}/wecom-bot/test-connection`,
      payload
    );
    return unwrapData<TestWecomBotConnectionResponse>(response);
  },

  /**
   * 管理员重新激活单个企业微信 Bot。
   * 输入: FastGPT 应用 ID。
   * 输出: 单个处理结果。
   */
  async reactivate(appId: string): Promise<AdminWecomBotReactivateResult> {
    const response = await http.put<ApiEnvelope<AdminWecomBotReactivateResult>>(
      `/apps-new/admin/apps/${appId}/wecom-bot/reactivate`,
      {}
    );
    return unwrapData<AdminWecomBotReactivateResult>(response);
  },

  /**
   * 管理员批量重新激活选中的企业微信 Bot。
   * 输入: 选中的 FastGPT 应用 ID。
   * 输出: 逐应用处理结果和计数。
   */
  async reactivateMany(appIds: string[]): Promise<AdminWecomBotReactivateManyResponse> {
    const response = await http.put<ApiEnvelope<AdminWecomBotReactivateManyResponse>>(
      '/apps-new/admin/wecom-bots/reactivate',
      { appIds }
    );
    return unwrapData<AdminWecomBotReactivateManyResponse>(response);
  }
};

export default wecomBotApi;
