<template>
  <el-drawer
    v-model="visible"
    :title="drawerTitle"
    :size="drawerSize"
    append-to-body
    destroy-on-close
  >
    <div class="wecom-bot-drawer">
      <el-skeleton v-if="loading" :rows="6" animated />

      <el-form
        v-else
        ref="formRef"
        :model="form"
        :rules="rules"
        label-position="top"
        class="wecom-bot-form"
      >
        <el-form-item label="启用状态" prop="enabled">
          <el-switch v-model="form.enabled" active-text="启用" inactive-text="停用" />
        </el-form-item>

        <el-form-item label="群聊 @ 回复" prop="groupChatMentionEnabled">
          <el-switch
            v-model="form.groupChatMentionEnabled"
            active-text="开启"
            inactive-text="关闭"
          />
        </el-form-item>

        <el-form-item label=" " class="wecom-auth-entry">
          <p class="wecom-auth-hint">
            点击按钮后会弹出企业微信二维码窗口，扫码确认后 Bot ID 与 Secret 将自动填入。
          </p>
          <el-button
            class="wecom-auth-button"
            type="primary"
            :icon="Connection"
            :loading="wecomAuthorizing"
            :disabled="loading || saving"
            native-type="button"
            @click="handleWecomAuth"
          >
            扫码创建企业微信机器人
          </el-button>
          <p class="wecom-auth-name-hint">
            建议机器人名称不要包含空格或 @ 符号，以免影响群聊 @ 消息识别。
          </p>
        </el-form-item>

        <el-form-item label="Bot ID" prop="botId">
          <el-input v-model.trim="form.botId" maxlength="128" show-word-limit />
        </el-form-item>

        <el-form-item label="Secret" prop="secret">
          <div class="secret-row">
            <el-input
              v-model="form.secret"
              :type="secretVisible ? 'text' : 'password'"
              :placeholder="hasExistingSecret ? '' : '请输入 Secret'"
            >
              <template #suffix>
                <button
                  class="secret-visibility-button"
                  type="button"
                  :disabled="revealingSecret"
                  :aria-label="secretVisible ? '隐藏 Secret' : '展示 Secret'"
                  @click.stop="handleSecretVisibilityToggle"
                >
                  <el-icon>
                    <Hide v-if="secretVisible" />
                    <View v-else />
                  </el-icon>
                </button>
              </template>
            </el-input>
          </div>
        </el-form-item>

        <el-form-item label="FastGPT API Base URL" prop="fastgptApiBaseUrl">
          <el-input v-model.trim="form.fastgptApiBaseUrl" maxlength="2048" show-word-limit />
        </el-form-item>

        <el-form-item label="FastGPT OpenAPI Key" prop="fastgptOpenApiKeyId">
          <div class="openapi-key-row">
            <el-select
              v-model="form.fastgptOpenApiKeyId"
              :loading="keyLoading"
              filterable
              placeholder="请选择 OpenAPI Key"
            >
              <el-option
                v-for="key in fastgptOpenApiKeys"
                :key="key.id"
                :label="formatOpenApiKeyLabel(key)"
                :value="key.id"
              />
            </el-select>
            <el-button
              type="primary"
              plain
              :loading="creatingKey"
              @click="handleCreateFastgptOpenApiKey"
            >
              新建
            </el-button>
          </div>
        </el-form-item>

        <div v-if="exists" class="status-block">
          <div class="status-line">
            <span>连接状态</span>
            <el-tag :type="statusTagType" effect="light">{{ statusText }}</el-tag>
          </div>
          <div v-if="lastConnectedAtText" class="status-line subtle">
            <span>最近连接</span>
            <span>{{ lastConnectedAtText }}</span>
          </div>
          <div v-if="lastError" class="status-line subtle error">
            <span>最近错误</span>
            <span>{{ lastError }}</span>
          </div>
        </div>
      </el-form>
    </div>

    <template #footer>
      <div class="drawer-footer">
        <el-tooltip
          :content="testConnectionTooltip"
          :disabled="!testConnectionTooltip"
          placement="top"
        >
          <span>
            <el-button
              :icon="Connection"
              :loading="testingConnection"
              :disabled="isTestConnectionDisabled"
              @click="handleTestConnection"
            >
              测试连接
            </el-button>
          </span>
        </el-tooltip>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
      </div>
    </template>
  </el-drawer>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import type { FormInstance, FormRules } from 'element-plus';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Connection, Hide, View } from '@element-plus/icons-vue';
import { wecomBotAdminApi, wecomBotApi } from '../api/wecomBot';
import type {
  FastgptOpenApiKeyOption,
  SaveWecomBotConfigPayload,
  TestWecomBotConnectionPayload,
  WecomBotConfig
} from '../types/wecomBot';

/**
 * 抽屉入参。
 * 输入: 父组件传入的显示状态、应用信息和可选管理员模式。
 * 输出: 组件按模式选择普通或管理员配置 API。
 */
interface Props {
  modelValue: boolean;
  appId: string;
  appName?: string;
  adminMode?: boolean;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  saved: [config: WecomBotConfig];
}>();

interface WecomBotForm {
  enabled: boolean;
  groupChatMentionEnabled: boolean;
  botId: string;
  secret: string;
  fastgptApiBaseUrl: string;
  fastgptOpenApiKeyId: string;
}

interface WecomAuthBotInfo {
  botid: string;
  secret: string;
}

interface WecomAuthError {
  code?: string;
  message?: string;
  details?: unknown;
}

interface WecomAibotSdk {
  openBotInfoAuthWindow: (options: {
    source: string;
    onCreated?: (bot: WecomAuthBotInfo) => void;
    onError?: (error: WecomAuthError) => void;
  }) => Promise<WecomAuthBotInfo> | void;
}

declare global {
  interface Window {
    WecomAIBotSDK?: WecomAibotSdk;
  }
}

const WECOM_SDK_URL = 'https://wwcdn.weixin.qq.com/node/wework/js/wecom-aibot-sdk@0.1.0.min.js';
const WECOM_AUTH_SOURCE = 'agentplaza';
let wecomSdkLoadingPromise: Promise<void> | null = null;
const MASKED_SECRET_PLACEHOLDER = '********';
const TEST_CONNECTION_BLOCKED_STATUS_MESSAGES: Partial<Record<WecomBotConfig['connectionStatus'], string>> = {
  connected: '当前正式连接已在线，无需测试',
  reconnecting: '正在重连中，暂不能测试'
};
const HIDDEN_REPLY_CONFIG = {
  botPrefix: '',
  showToolMessages: false,
  showReasoning: false,
  privateChatPolicy: 'reply_all'
} as const;

const formRef = ref<FormInstance>();
const loading = ref(false);
const saving = ref(false);
const testingConnection = ref(false);
const wecomAuthorizing = ref(false);
const wecomSdkLoaded = ref(false);
const exists = ref(false);
const hasExistingSecret = ref(false);
const existingSecretPlaceholder = ref(MASKED_SECRET_PLACEHOLDER);
const revealedSecret = ref('');
const secretVisible = ref(false);
const revealingSecret = ref(false);
const keyLoading = ref(false);
const creatingKey = ref(false);
const fastgptOpenApiKeys = ref<FastgptOpenApiKeyOption[]>([]);
const connectionStatus = ref<WecomBotConfig['connectionStatus']>('stopped');
const lastConnectedAt = ref<string | null>(null);
const lastError = ref('');
const savedBotId = ref('');

/**
 * 当前抽屉使用的企业微信 Bot 配置 API。
 * 输入: props.adminMode。
 * 输出: 管理员模式使用管理员 API，否则保持普通用户 API。
 */
const activeWecomBotApi = computed(() => props.adminMode ? wecomBotAdminApi : wecomBotApi);

const form = reactive<WecomBotForm>({
  enabled: false,
  groupChatMentionEnabled: true,
  botId: '',
  secret: '',
  fastgptApiBaseUrl: '',
  fastgptOpenApiKeyId: ''
});

const rules: FormRules<WecomBotForm> = {
  botId: [
    { required: true, message: '请输入 Bot ID', trigger: 'blur' },
    { max: 128, message: 'Bot ID 不能超过 128 个字符', trigger: 'blur' }
  ],
  secret: [
    {
      validator: (_rule, value, callback) => {
        const normalizedValue = String(value || '').trim();
        if (!hasExistingSecret.value && !normalizedValue) {
          callback(new Error('请输入 Secret'));
          return;
        }
        if (hasExistingSecret.value && !isKeepingExistingSecret() && !normalizedValue) {
          callback(new Error('请输入新的 Secret'));
          return;
        }
        callback();
      },
      trigger: 'blur'
    }
  ],
  fastgptApiBaseUrl: [
    {
      validator: (_rule, value, callback) => {
        if (String(value || '').length > 2048) {
          callback(new Error('FastGPT API Base URL 不能超过 2048 个字符'));
          return;
        }
        callback();
      },
      trigger: 'blur'
    }
  ],
  fastgptOpenApiKeyId: [
    {
      validator: (_rule, value, callback) => {
        if (!form.enabled) {
          callback();
          return;
        }
        if (!value) {
          callback(new Error('请选择 FastGPT OpenAPI Key'));
          return;
        }
        callback();
      },
      trigger: 'blur'
    }
  ]
};

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value)
});

const drawerTitle = computed(() => `${props.appName || '应用'} - 企业微信 Bot`);
const drawerSize = computed(() => 'min(460px, 100vw)');

const statusTextMap: Record<WecomBotConfig['connectionStatus'], string> = {
  stopped: '已停用',
  starting: '启动中',
  connected: '已连接',
  reconnecting: '重连中',
  disconnected: '已断开',
  failed: '连接失败'
};

const statusText = computed(() => statusTextMap[connectionStatus.value] || '未知');
const statusTagType = computed(() => {
  if (connectionStatus.value === 'connected') return 'success';
  if (connectionStatus.value === 'failed') return 'danger';
  if (
    connectionStatus.value === 'starting' ||
    connectionStatus.value === 'reconnecting' ||
    connectionStatus.value === 'disconnected'
  ) return 'warning';
  return 'info';
});

const lastConnectedAtText = computed(() => {
  if (!lastConnectedAt.value) return '';
  return new Date(lastConnectedAt.value).toLocaleString();
});

const isOfficialWorkerOnline = computed(() => connectionStatus.value === 'connected' || connectionStatus.value === 'reconnecting');
const currentWorkerCredentialChanged = computed(() => (
  isOfficialWorkerOnline.value &&
  (form.botId !== savedBotId.value || !isKeepingExistingSecret())
));
const testConnectionTooltip = computed(() => {
  if (currentWorkerCredentialChanged.value) return '先停用当前连接，再测试新凭证';
  return TEST_CONNECTION_BLOCKED_STATUS_MESSAGES[connectionStatus.value] || '';
});
const isTestConnectionDisabled = computed(() => loading.value || saving.value || isOfficialWorkerOnline.value);

/**
 * 重置抽屉表单到默认创建态。
 * 输入: 无。
 * 输出: 清空表单状态并恢复安全占位符。
 */
function resetForm() {
  exists.value = false;
  hasExistingSecret.value = false;
  existingSecretPlaceholder.value = MASKED_SECRET_PLACEHOLDER;
  revealedSecret.value = '';
  secretVisible.value = false;
  revealingSecret.value = false;
  wecomAuthorizing.value = false;
  fastgptOpenApiKeys.value = [];
  connectionStatus.value = 'stopped';
  lastConnectedAt.value = null;
  lastError.value = '';
  savedBotId.value = '';
  Object.assign(form, {
    enabled: false,
    groupChatMentionEnabled: true,
    botId: '',
    secret: '',
    fastgptApiBaseUrl: '',
    fastgptOpenApiKeyId: ''
  });
}

/**
 * 用已保存配置填充表单。
 * 输入: 后端返回的脱敏配置。
 * 输出: 表单进入编辑态，Secret 使用保留旧值语义。
 */
function fillExistingConfig(config: WecomBotConfig) {
  exists.value = true;
  hasExistingSecret.value = Boolean(config.secretMasked);
  existingSecretPlaceholder.value = config.secretPlaceholder || MASKED_SECRET_PLACEHOLDER;
  revealedSecret.value = '';
  secretVisible.value = false;
  revealingSecret.value = false;
  connectionStatus.value = config.connectionStatus || 'stopped';
  lastConnectedAt.value = config.lastConnectedAt || null;
  lastError.value = config.lastError || '';
  savedBotId.value = config.botId;
  Object.assign(form, {
    enabled: config.enabled,
    botId: config.botId,
    secret: hasExistingSecret.value ? existingSecretPlaceholder.value : '',
    fastgptApiBaseUrl: config.fastgptApiBaseUrl || '',
    fastgptOpenApiKeyId: config.fastgptOpenApiKeyId || ''
  });
  form.groupChatMentionEnabled = config.groupChatMentionEnabled !== false;
  ensureSnapshotKeyOption(config);
}

/**
 * 动态加载企业微信智能机器人扫码授权 SDK。
 * 输入: 无。
 * 输出: SDK 可用时 resolve；脚本加载失败时 reject。
 */
function loadWecomSDK(): Promise<void> {
  if (window.WecomAIBotSDK) {
    wecomSdkLoaded.value = true;
    return Promise.resolve();
  }

  wecomSdkLoaded.value = false;
  if (wecomSdkLoadingPromise) {
    return wecomSdkLoadingPromise;
  }

  const existingScript = document.querySelector<HTMLScriptElement>(`script[src="${WECOM_SDK_URL}"]`);
  if (existingScript) {
    existingScript.remove();
  }

  const script = document.createElement('script');
  wecomSdkLoadingPromise = new Promise((resolve, reject) => {
    script.src = WECOM_SDK_URL;
    script.async = true;

    script.addEventListener('load', () => {
      if (!window.WecomAIBotSDK) {
        wecomSdkLoaded.value = false;
        wecomSdkLoadingPromise = null;
        script.remove();
        reject(new Error('WeCom SDK not ready'));
        return;
      }

      wecomSdkLoaded.value = true;
      wecomSdkLoadingPromise = null;
      resolve();
    }, { once: true });
    script.addEventListener('error', () => {
      wecomSdkLoaded.value = false;
      wecomSdkLoadingPromise = null;
      script.remove();
      reject(new Error('WeCom SDK load failed'));
    }, { once: true });

    document.body.appendChild(script);
  });

  return wecomSdkLoadingPromise;
}

/**
 * 通过企业微信 SDK 打开扫码授权窗口并填充凭证。
 * 输入: 当前浏览器窗口和企业微信 SDK。
 * 输出: 扫码成功后将 Bot ID 与 Secret 写入表单。
 */
async function handleWecomAuth() {
  wecomAuthorizing.value = true;
  try {
    await loadWecomSDK();
    if (!window.WecomAIBotSDK) {
      throw new Error('WeCom SDK not ready');
    }

    const result = window.WecomAIBotSDK.openBotInfoAuthWindow({
      source: WECOM_AUTH_SOURCE
    });
    if (!result || typeof result.then !== 'function') {
      return;
    }

    const bot = await result;
    if (!bot?.botid || !bot?.secret) {
      throw new Error('企业微信未返回完整机器人凭证');
    }

    form.botId = bot.botid;
    form.secret = bot.secret;
    revealedSecret.value = '';
    secretVisible.value = false;
    ElMessage.success('企业微信机器人授权成功');
  } catch (error) {
    const authError = error as WecomAuthError;
    if (authError?.code === 'WINDOW_BLOCKED') {
      ElMessage.error('弹窗被浏览器拦截，请允许弹窗后重试');
    } else if (authError?.code === 'CANCELLED') {
      ElMessage.info('授权已取消');
    } else if (authError?.message === 'WeCom SDK load failed' || authError?.message === 'WeCom SDK not ready') {
      ElMessage.error('WeCom SDK 加载失败');
    } else {
      ElMessage.error(`授权失败：${authError?.message || authError?.code || '未知错误'}`);
    }
  } finally {
    wecomAuthorizing.value = false;
  }
}

/**
 * 确保已保存 key 快照可以在下拉框中回显。
 * 输入: 后端返回的脱敏配置。
 * 输出: 如果列表没有该 key，则追加一项快照选项。
 */
function ensureSnapshotKeyOption(config: WecomBotConfig) {
  if (!config.fastgptOpenApiKeyId) return;

  const existsInOptions = fastgptOpenApiKeys.value.some((key) => key.id === config.fastgptOpenApiKeyId);
  if (existsInOptions) return;

  fastgptOpenApiKeys.value.unshift({
    id: config.fastgptOpenApiKeyId,
    name: config.fastgptOpenApiKeyName || 'OpenAPI Key',
    apiKeyMasked: config.fastgptOpenApiKeyMasked || '',
    createTime: null
  });
}

/**
 * 格式化 OpenAPI Key 下拉展示文案。
 * 输入: OpenAPI Key 安全展示项。
 * 输出: 名称、脱敏 key 和创建时间组合后的标签。
 */
function formatOpenApiKeyLabel(key: FastgptOpenApiKeyOption) {
  const dateText = key.createTime ? new Date(key.createTime).toLocaleString() : '';
  return [key.name, key.apiKeyMasked, dateText].filter(Boolean).join(' · ');
}

/**
 * 加载当前应用的 FastGPT OpenAPI Key 列表。
 * 输入: 组件 props 中的 appId。
 * 输出: 更新下拉框选项。
 */
async function loadFastgptOpenApiKeys() {
  if (!props.appId) return;

  keyLoading.value = true;
  try {
    const response = await activeWecomBotApi.value.listFastgptOpenApiKeys(props.appId);
    fastgptOpenApiKeys.value = response.keys || [];
  } finally {
    keyLoading.value = false;
  }
}

/**
 * 加载当前应用的企业微信 Bot 配置。
 * 输入: 组件 props 中的 appId。
 * 输出: 更新表单为创建态或编辑态。
 */
async function loadConfig() {
  if (!props.appId) return;

  loading.value = true;
  try {
    resetForm();
    const [response] = await Promise.all([
      activeWecomBotApi.value.getConfig(props.appId),
      loadFastgptOpenApiKeys()
    ]);
    if (response.exists && response.config) {
      fillExistingConfig(response.config);
    } else if (response.defaults) {
      const defaults = response.defaults;
      form.enabled = defaults.enabled;
      form.groupChatMentionEnabled = defaults.groupChatMentionEnabled !== false;
      form.fastgptApiBaseUrl = defaults.fastgptApiBaseUrl || '';
    }
  } catch (error) {
    console.error('加载企业微信 Bot 配置失败:', error);
  } finally {
    loading.value = false;
  }
}

/**
 * 监听抽屉显示状态和应用 ID。
 * 输入: 父组件传入的 modelValue 与 appId。
 * 输出: 首次挂载即打开或切换应用时主动加载配置。
 */
watch(
  [() => props.modelValue, () => props.appId],
  ([isVisible, appId]) => {
    if (!isVisible || !appId) return;
    loadConfig();
  },
  { immediate: true }
);

/**
 * 显式加载已保存 Secret 的明文。
 * 输入: 当前应用 ID。
 * 输出: 将输入框值替换为解密后的 Secret，并记录原始值用于保存语义判断。
 */
async function revealExistingSecret() {
  if (!props.appId || !hasExistingSecret.value || !isKeepingExistingSecret()) return;

  revealingSecret.value = true;
  try {
    const response = await activeWecomBotApi.value.revealSecret(props.appId);
    form.secret = response.secret;
    revealedSecret.value = response.secret;
  } catch (error) {
    console.error('展示企业微信 Bot Secret 失败:', error);
    ElMessage.error('Secret 展示失败');
    throw error;
  } finally {
    revealingSecret.value = false;
  }
}

/**
 * 切换 Secret 显隐状态。
 * 输入: 当前输入框和 Secret 保存状态。
 * 输出: 如需展示已保存 Secret，会先请求后端解密，再切换为明文显示。
 */
async function handleSecretVisibilityToggle() {
  if (!secretVisible.value && hasExistingSecret.value && isKeepingExistingSecret()) {
    await revealExistingSecret();
  }

  secretVisible.value = !secretVisible.value;
}

/**
 * 新建 FastGPT OpenAPI Key 并自动选中。
 * 输入: 无。
 * 输出: 调用后端创建 key，刷新本地下拉列表并选中新 key。
 */
async function handleCreateFastgptOpenApiKey() {
  if (!props.appId) return;

  const defaultName = props.appName ? `企业微信 Bot - ${props.appName}` : '企业微信 Bot Key';
  const promptResult = await ElMessageBox.prompt('Key 名称', '新建 FastGPT OpenAPI Key', {
    confirmButtonText: '创建',
    cancelButtonText: '取消',
    inputValue: defaultName,
    inputValidator: (value) => String(value || '').trim().length <= 100 || '名称不能超过 100 个字符'
  }).catch(() => null);

  if (!promptResult) return;

  creatingKey.value = true;
  try {
    const response = await activeWecomBotApi.value.createFastgptOpenApiKey(props.appId, {
      name: String(promptResult.value || '').trim()
    });
    fastgptOpenApiKeys.value = [
      response.key,
      ...fastgptOpenApiKeys.value.filter((key) => key.id !== response.key.id)
    ];
    form.fastgptOpenApiKeyId = response.key.id;
    ElMessage.success('创建成功');
  } catch (error) {
    console.error('创建 FastGPT OpenAPI Key 失败:', error);
  } finally {
    creatingKey.value = false;
  }
}

/**
 * 判断当前 Secret 输入是否仍表示保留旧密文。
 * 输入: 当前 Secret 表单值和已保存占位符状态。
 * 输出: true 表示保存时不提交新 Secret。
 */
function isKeepingExistingSecret() {
  return hasExistingSecret.value && (
    form.secret === existingSecretPlaceholder.value ||
    (Boolean(revealedSecret.value) && form.secret === revealedSecret.value)
  );
}

/**
 * 构建保存请求体。
 * 输入: 当前表单状态。
 * 输出: 遵循 keepExistingSecret 语义的保存 payload。
 */
function buildSavePayload(): SaveWecomBotConfigPayload {
  const keepExistingSecret = isKeepingExistingSecret();
  return {
    enabled: form.enabled,
    botId: form.botId,
    secret: keepExistingSecret ? undefined : form.secret,
    keepExistingSecret,
    groupChatMentionEnabled: form.groupChatMentionEnabled,
    fastgptApiBaseUrl: form.fastgptApiBaseUrl,
    fastgptOpenApiKeyId: form.fastgptOpenApiKeyId || undefined,
    ...HIDDEN_REPLY_CONFIG
  };
}

/**
 * 构建测试连接请求体。
 * 输入: 当前表单状态。
 * 输出: 使用已保存 Secret 或草稿 Secret 的测试连接 payload。
 */
function buildTestConnectionPayload(): TestWecomBotConnectionPayload {
  const keepExistingSecret = isKeepingExistingSecret();
  return {
    botId: form.botId,
    secret: keepExistingSecret ? undefined : form.secret,
    keepExistingSecret
  };
}

/**
 * 测试企业微信 Bot 连接。
 * 输入: 当前表单中的 Bot ID 和 Secret 语义。
 * 输出: 后端验证成功时显示成功提示，失败时保持表单可继续编辑。
 */
async function handleTestConnection() {
  if (!formRef.value || !props.appId) return;
  if (isTestConnectionDisabled.value) {
    if (testConnectionTooltip.value) {
      ElMessage.warning(testConnectionTooltip.value);
    }
    return;
  }

  const valid = await formRef.value.validateField(['botId', 'secret']).then(() => true).catch(() => false);
  if (!valid) return;

  testingConnection.value = true;
  try {
    await activeWecomBotApi.value.testConnection(props.appId, buildTestConnectionPayload());
    ElMessage.success('订阅验证成功');
  } catch (_error) {
    console.error('测试企业微信 Bot 连接失败');
  } finally {
    testingConnection.value = false;
  }
}

/**
 * 保存企业微信 Bot 配置。
 * 输入: 当前表单数据。
 * 输出: 后端保存成功后关闭抽屉并向父组件通知最新配置。
 */
async function handleSave() {
  if (!formRef.value) return;

  const valid = await formRef.value.validate().catch(() => false);
  if (!valid) return;

  saving.value = true;
  try {
    const response = await activeWecomBotApi.value.saveConfig(props.appId, buildSavePayload());
    fillExistingConfig(response.config);
    emit('saved', response.config);
    ElMessage.success('保存成功');
    visible.value = false;
  } catch (error) {
    console.error('保存企业微信 Bot 配置失败:', error);
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped lang="scss">
.wecom-bot-drawer {
  min-height: 320px;
}

.secret-row {
  width: 100%;
  min-width: 0;
}

.wecom-auth-entry :deep(.el-form-item__label) {
  display: none;
}

.wecom-auth-hint {
  margin: 0 0 8px;
  color: #606266;
  font-size: 13px;
  line-height: 1.6;
}

.wecom-auth-button {
  width: 100%;
}

.wecom-auth-name-hint {
  margin: 6px 0 0;
  color: #909399;
  font-size: 12px;
  line-height: 1.5;
}

.secret-visibility-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  color: #909399;
  background: transparent;
  cursor: pointer;
}

.secret-visibility-button:disabled {
  cursor: wait;
  opacity: 0.55;
}

.secret-visibility-button:hover {
  color: #409eff;
}

.openapi-key-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  width: 100%;
  min-width: 0;
}

.openapi-key-row :deep(.el-select) {
  width: 100%;
}

.openapi-key-row :deep(.el-input) {
  min-width: 0;
}

.status-block {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 0;
  border-top: 1px solid #ebeef5;
}

.status-line {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  font-size: 13px;
  color: #303133;
  overflow-wrap: anywhere;
}

.subtle {
  color: #606266;
}

.error {
  color: #f56c6c;
}

.drawer-footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.drawer-footer :deep(.el-button + .el-button) {
  margin-left: 0;
}

@media (max-width: 480px) {
  .wecom-bot-drawer {
    min-height: 260px;
  }

  .wecom-bot-form :deep(.el-form-item) {
    margin-bottom: 18px;
  }

  .wecom-auth-button {
    white-space: normal;
    min-height: 40px;
    line-height: 1.35;
  }

  .openapi-key-row {
    grid-template-columns: 1fr;
  }

  .openapi-key-row :deep(.el-button) {
    width: 100%;
  }

  .status-line {
    flex-direction: column;
    gap: 4px;
  }

  .drawer-footer {
    justify-content: stretch;
  }

  .drawer-footer > span,
  .drawer-footer :deep(.el-button) {
    flex: 1 1 100%;
    width: 100%;
  }
}
</style>
