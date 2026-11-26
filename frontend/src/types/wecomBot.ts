export type WecomBotConnectionStatus =
  | 'stopped'
  | 'starting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'failed';

export type WecomBotPrivateChatPolicy = 'reply_all' | 'disabled';

export interface WecomBotDefaults {
  enabled: boolean;
  fastgptApiBaseUrl: string;
  botPrefix: string;
  showToolMessages: boolean;
  showReasoning: boolean;
  privateChatPolicy: WecomBotPrivateChatPolicy;
  groupChatMentionEnabled: boolean;
}

export interface WecomBotConfig extends WecomBotDefaults {
  id: string;
  appId: string;
  appSource: 'fastgpt';
  botId: string;
  fastgptApiBaseUrl: string;
  fastgptOpenApiKeyId: string;
  fastgptOpenApiKeyName: string;
  fastgptOpenApiKeyMasked: string;
  secretMasked: boolean;
  secretPlaceholder?: string;
  connectionStatus: WecomBotConnectionStatus;
  lastConnectedAt?: string | null;
  lastError?: string;
}

export interface WecomBotConfigResponse {
  exists: boolean;
  config?: WecomBotConfig;
  defaults?: WecomBotDefaults;
}

export interface SaveWecomBotConfigPayload extends WecomBotDefaults {
  botId: string;
  secret?: string;
  keepExistingSecret?: boolean;
  fastgptOpenApiKeyId?: string;
}

export interface SaveWecomBotConfigResponse {
  config: WecomBotConfig;
}

export interface RevealWecomBotSecretResponse {
  secret: string;
}

export interface ToggleWecomBotPayload {
  enabled: boolean;
}

export interface ToggleWecomBotResponse {
  enabled: boolean;
  connectionStatus: WecomBotConnectionStatus;
}

export interface TestWecomBotConnectionPayload {
  botId?: string;
  secret?: string;
  keepExistingSecret?: boolean;
}

export interface TestWecomBotConnectionResponse {
  ok: boolean;
}

export interface FastgptOpenApiKeyOption {
  id: string;
  name: string;
  apiKeyMasked: string;
  createTime?: string | null;
}

export interface FastgptOpenApiKeyListResponse {
  keys: FastgptOpenApiKeyOption[];
}

export interface CreateFastgptOpenApiKeyPayload {
  name?: string;
}

export interface CreateFastgptOpenApiKeyResponse {
  key: FastgptOpenApiKeyOption & {
    apiKey: string;
  };
}

export interface BindWecomUserPayload {
  qwToken: string;
}

export interface BindWecomUserResponse {
  username: string;
  userName?: string;
  wecomUserIdMasked: string;
}

export type AdminWecomBotStatus =
  | 'online'
  | 'starting'
  | 'reconnecting'
  | 'offline'
  | 'failed'
  | 'disabled';

export type AdminWecomBotStatusFilter =
  | ''
  | WecomBotConnectionStatus
  | AdminWecomBotStatus;

export type AdminWecomBotConfiguredFilter = '' | 'true' | 'false';

export interface AdminWecomBotSummary {
  configured: boolean;
  bindingId: string;
  botId: string;
  enabled: boolean;
  connectionStatus: WecomBotConnectionStatus;
  adminStatus: AdminWecomBotStatus;
  lastConnectedAt?: string | null;
  lastError?: string;
}

export interface AdminWecomBotReactivateResult {
  appId: string;
  success: boolean;
  enabled?: boolean;
  connectionStatus?: WecomBotConnectionStatus;
  errorCode?: string;
  message?: string;
}

export interface AdminWecomBotReactivateManyResponse {
  requested: number;
  succeeded: number;
  failed: number;
  results: AdminWecomBotReactivateResult[];
}
