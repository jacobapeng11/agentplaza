import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const componentSource = readFileSync(new URL('../src/components/WecomBotConfigDrawer.vue', import.meta.url), 'utf8');

/**
 * 提取指定函数源码块。
 * 输入: 组件源码和函数名。
 * 输出: 函数体文本；未找到时返回空字符串。
 */
function extractFunctionBlock(source, functionName) {
  const start = source.indexOf(`function ${functionName}`);
  if (start === -1) return '';

  const nextFunction = source.indexOf('\nfunction ', start + 1);
  return source.slice(start, nextFunction === -1 ? source.length : nextFunction);
}

test('WecomBotConfigDrawer renders runtime status fields and test connection action', () => {
  assert.match(componentSource, /connectionStatus/);
  assert.match(componentSource, /lastConnectedAtText/);
  assert.match(componentSource, /lastError/);
  assert.match(componentSource, /handleTestConnection/);
  assert.match(componentSource, /activeWecomBotApi\.value\.testConnection/);
  assert.match(componentSource, /测试连接/);
});

test('saving an existing connected config refills status from backend response', () => {
  const fillExistingConfig = extractFunctionBlock(componentSource, 'fillExistingConfig');
  const handleSave = extractFunctionBlock(componentSource, 'handleSave');

  assert.match(fillExistingConfig, /connectionStatus\.value = config\.connectionStatus \|\| 'stopped'/);
  assert.match(fillExistingConfig, /lastConnectedAt\.value = config\.lastConnectedAt \|\| null/);
  assert.match(fillExistingConfig, /lastError\.value = config\.lastError \|\| ''/);
  assert.match(handleSave, /fillExistingConfig\(response\.config\)/);
});

test('connected and reconnecting states disable test connection with clear tooltip text', () => {
  assert.match(componentSource, /<el-tooltip[\s\S]*:content="testConnectionTooltip"[\s\S]*<el-button[\s\S]*:disabled="isTestConnectionDisabled"/);
  assert.match(componentSource, /connected:\s*'当前正式连接已在线，无需测试'/);
  assert.match(componentSource, /reconnecting:\s*'正在重连中，暂不能测试'/);
  assert.match(componentSource, /const isTestConnectionDisabled = computed/);
});

test('enabled bots without active leases render as disconnected instead of connected', () => {
  assert.match(componentSource, /disconnected:\s*'已断开'/);
  assert.match(componentSource, /connectionStatus\.value === 'disconnected'/);
});

test('changed credentials while worker is online prompt user to stop current connection first', () => {
  const handleTestConnection = extractFunctionBlock(componentSource, 'handleTestConnection');

  assert.match(componentSource, /savedBotId/);
  assert.match(componentSource, /currentWorkerCredentialChanged/);
  assert.match(componentSource, /先停用当前连接，再测试新凭证/);
  assert.match(handleTestConnection, /if \(isTestConnectionDisabled\.value\)[\s\S]*ElMessage\.warning\(testConnectionTooltip\.value\)/);
});

test('WecomBotConfigDrawer uses WeCom SDK auth window with agentplaza source', () => {
  const handleWecomAuth = extractFunctionBlock(componentSource, 'handleWecomAuth');
  const authEntry = componentSource.match(/<el-form-item label=" " class="wecom-auth-entry">[\s\S]*?<\/el-form-item>/)?.[0] || '';

  assert.match(componentSource, /wecom-aibot-sdk@0\.1\.0\.min\.js/);
  assert.match(componentSource, /const WECOM_AUTH_SOURCE = 'agentplaza'/);
  assert.match(componentSource, /扫码创建企业微信机器人/);
  assert.match(authEntry, /扫码创建企业微信机器人[\s\S]*建议机器人名称不要包含空格或 @ 符号/);
  assert.match(authEntry, /class="wecom-auth-name-hint"/);
  assert.match(handleWecomAuth, /openBotInfoAuthWindow\(\{\s*source: WECOM_AUTH_SOURCE\s*\}\)/);
  assert.match(handleWecomAuth, /form\.botId = bot\.botid/);
  assert.match(handleWecomAuth, /form\.secret = bot\.secret/);
  assert.doesNotMatch(componentSource, /getAuthorizationQrCode/);
});

test('WecomBotConfigDrawer clears failed WeCom SDK script so authorization can retry', () => {
  const loadWecomSDK = extractFunctionBlock(componentSource, 'loadWecomSDK');

  assert.match(componentSource, /let wecomSdkLoadingPromise: Promise<void> \| null = null/);
  assert.match(loadWecomSDK, /wecomSdkLoadingPromise = new Promise/);
  assert.match(loadWecomSDK, /script\.remove\(\)/);
  assert.match(loadWecomSDK, /wecomSdkLoaded\.value = false/);
  assert.match(loadWecomSDK, /wecomSdkLoadingPromise = null/);
});

test('WecomBotConfigDrawer constrains drawer and actions for narrow mobile screens', () => {
  assert.match(componentSource, /:size="drawerSize"/);
  assert.doesNotMatch(componentSource, /size="460px"/);
  assert.match(componentSource, /const drawerSize = computed/);
  assert.match(componentSource, /@media \(max-width: 480px\)/);
  assert.match(componentSource, /\.drawer-footer[\s\S]*flex-wrap: wrap/);
  assert.match(componentSource, /\.openapi-key-row[\s\S]*grid-template-columns: 1fr/);
});

test('contains default-on group chat mention reply switch', () => {
  assert.match(componentSource, /群聊\s*@\s*回复/);
  assert.match(componentSource, /groupChatMentionEnabled:\s*true/);
  assert.match(componentSource, /form\.groupChatMentionEnabled\s*=\s*config\.groupChatMentionEnabled\s*!==\s*false/);
  assert.match(componentSource, /groupChatMentionEnabled:\s*form\.groupChatMentionEnabled/);
});

test('WecomBotConfigDrawer can switch to admin API mode without changing normal entry', () => {
  assert.match(componentSource, /adminMode\?: boolean/);
  assert.match(componentSource, /wecomBotAdminApi/);
  assert.match(componentSource, /const activeWecomBotApi = computed/);
  assert.match(componentSource, /props\.adminMode \? wecomBotAdminApi : wecomBotApi/);
  assert.match(componentSource, /activeWecomBotApi\.value\.getConfig/);
  assert.match(componentSource, /activeWecomBotApi\.value\.revealSecret/);
  assert.match(componentSource, /activeWecomBotApi\.value\.listFastgptOpenApiKeys/);
  assert.match(componentSource, /activeWecomBotApi\.value\.createFastgptOpenApiKey/);
  assert.match(componentSource, /activeWecomBotApi\.value\.saveConfig/);
  assert.match(componentSource, /activeWecomBotApi\.value\.testConnection/);
});

test('WecomBotConfigDrawer loads config when mounted already visible', () => {
  assert.match(componentSource, /import \{ computed, reactive, ref, watch \} from 'vue';/);
  assert.match(componentSource, /watch\(\s*\[\s*\(\) => props\.modelValue,\s*\(\) => props\.appId\s*\]/);
  assert.match(componentSource, /immediate:\s*true/);
  assert.match(componentSource, /if \(!isVisible \|\| !appId\) return/);
  assert.match(componentSource, /loadConfig\(\)/);
  assert.doesNotMatch(componentSource, /@open="loadConfig"/);
});
