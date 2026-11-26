<template>
  <div class="mcp-detail-page">
    <PlazaHeader />

    <main class="detail-main">
      <Breadcrumb :items="breadcrumbItems" />

      <section class="detail-hero" v-loading="loading">
        <div class="hero-left">
          <div class="server-mark">
            <img v-if="avatarUrl" :src="avatarUrl" :alt="detail?.displayName || 'MCP avatar'" />
            <span v-else>{{ serverInitial }}</span>
          </div>

          <div class="hero-copy">
            <p class="eyebrow">MCP 服务详情</p>
            <h1>{{ detail?.displayName || 'MCP 服务详情' }}</h1>
            <p v-if="heroSummary" class="summary">{{ heroSummary }}</p>

            <div class="hero-meta-pills">
              <span class="meta-pill meta-pill--accent">{{ categoryText }}</span>
              <span class="meta-pill">{{ sourceTypeText }}</span>
              <span v-for="tag in visibleTags" :key="tag" class="meta-pill">{{ tag }}</span>
            </div>

          </div>
        </div>

        <div v-if="detail" class="hero-actions" :class="{ 'hero-actions--single': !canManage }">
          <template v-if="canManage">
            <el-button class="hero-action-btn" :icon="RefreshRight" @click="resyncService">
              {{ syncActionLabel }}
            </el-button>
          </template>
          <el-button
            class="hero-action-btn"
            :type="detail.isCollected ? 'warning' : 'primary'"
            plain
            :icon="detail.isCollected ? StarFilled : Star"
            @click="toggleFavorite"
          >
            {{ favoriteActionLabel }}
          </el-button>
          <template v-if="canManage">
            <el-button class="hero-action-btn" type="primary" plain :icon="Edit" @click="editService">
              {{ editActionLabel }}
            </el-button>
            <el-button class="hero-action-btn" type="danger" plain :icon="Delete" @click="deleteService">
              {{ deleteActionLabel }}
            </el-button>
          </template>
        </div>
      </section>

      <section v-if="detail" class="detail-shell">
        <section class="detail-primary card-panel">
          <el-alert
            v-if="hasSyncFailure"
            title="Higress 同步失败"
            type="error"
            :description="syncFailureMessage"
            show-icon
            :closable="false"
            class="sync-alert"
          />

          <el-tabs v-model="activeTab" class="detail-tabs">
            <el-tab-pane label="概览" name="overview">
              <div class="content-stack">
                <section class="section-block">
                  <div class="section-head">
                    <div>
                      <p class="eyebrow">服务概览</p>
                      <h2>这项 MCP 服务能做什么</h2>
                    </div>
                  </div>
                  <div class="description-text markdown-content" v-html="renderedOverviewDescription" />
                </section>
              </div>
            </el-tab-pane>

            <el-tab-pane label="工具能力" name="tools">
              <div class="content-stack">
                <section v-if="hasToolSnapshot" class="section-block">
                  <div class="section-head">
                    <div>
                      <p class="eyebrow">工具探测</p>
                      <h2>最近一次探测发现的工具能力</h2>
                    </div>
                  </div>
                  <div class="snapshot-meta">
                    <div class="snapshot-meta__item">
                      <span class="snapshot-meta__label">{{ snapshotDiscoveryLabel }}</span>
                      <strong class="snapshot-meta__value">{{ snapshotDiscoveryTime }}</strong>
                    </div>
                    <div class="snapshot-meta__item">
                      <span class="snapshot-meta__label">{{ snapshotToolCountLabel }}</span>
                      <strong class="snapshot-meta__value">{{ snapshotToolCount }}</strong>
                    </div>
                    <div v-if="snapshotProbeSourceText" class="snapshot-meta__item">
                      <span class="snapshot-meta__label">{{ snapshotProbeSourceLabel }}</span>
                      <strong class="snapshot-meta__value">{{ snapshotProbeSourceText }}</strong>
                    </div>
                    <div v-if="snapshotProbeProtocolText" class="snapshot-meta__item">
                      <span class="snapshot-meta__label">{{ snapshotProbeProtocolLabel }}</span>
                      <strong class="snapshot-meta__value">{{ snapshotProbeProtocolText }}</strong>
                    </div>
                  </div>
                  <p class="description-text tool-probe-note">若最近一次探测失败，系统仍会保留并展示最近一次成功探测到的工具快照。</p>
                </section>

                <section v-else class="section-block">
                  <div class="section-head">
                    <div>
                      <p class="eyebrow">工具能力</p>
                      <h2>暂未获取到工具快照</h2>
                    </div>
                  </div>
                  <p class="description-text">请点击“网关同步”探测来源 URL 的真实工具列表。</p>
                </section>

                <section v-if="hasDiscoveryFailure" class="section-block section-block--warning">
                  <div class="section-head">
                    <div>
                      <p class="eyebrow">探测提示</p>
                      <h2>最近一次工具探测失败</h2>
                    </div>
                  </div>
                  <p v-if="discoveryFailureTime" class="description-text discovery-failure-time">
                    最近失败探测时间：{{ discoveryFailureTime }}
                  </p>
                  <p class="description-text">{{ detail?.lastToolDiscoveryError }}</p>
                </section>

                <div v-if="hasToolSnapshot" class="tool-grid">
                  <article v-for="tool in toolCards" :key="tool.name" class="tool-card">
                    <div class="tool-card__top">
                      <h3>{{ tool.title || tool.name }}</h3>
                      <span class="tool-badge">{{ tool.inputSchemaSummary.length }} 个参数</span>
                    </div>
                    <p>{{ tool.description || '暂无工具说明' }}</p>
                    <ul class="tool-schema-list">
                      <li v-for="item in tool.inputSchemaSummary" :key="item">{{ item }}</li>
                    </ul>
                  </article>
                </div>
              </div>
            </el-tab-pane>
          </el-tabs>
        </section>

        <aside class="detail-sidebar">
          <section class="sidebar-card">
            <section class="config-snippet">
              <div class="section-head section-head--compact">
                <div>
                  <p class="eyebrow">配置示例</p>
                  <h3>{{ clientConfigSectionTitle }}</h3>
                </div>
                <div class="config-head-actions">
                  <span class="config-protocol">{{ configProtocolPrefix }}{{ currentTransportLabel }}</span>
                </div>
              </div>

              <div v-if="isDirectRouteSource && hasSourceConfigAccess" class="config-mode-switch">
                <button
                  type="button"
                  class="config-mode-btn"
                  :class="{ active: clientConfigMode === 'gateway' }"
                  @click="clientConfigMode = 'gateway'"
                >
                  网关路由 URL
                </button>
                <button
                  type="button"
                  class="config-mode-btn"
                  :class="{ active: clientConfigMode === 'upstream' }"
                  @click="clientConfigMode = 'upstream'"
                >
                  来源 URL
                </button>
              </div>
              <p v-if="isOpenApiSource || hasSourceConfigAccess" class="config-mode-hint">
                {{ isOpenApiSource ? openApiConfigModeHint : configModeHint }}
              </p>

              <div v-if="!hasClientAccess" class="config-permission-note">
                <strong>{{ currentConfigTitle }}暂无权限</strong>
                <p>{{ clientAccessMessage }}</p>
              </div>
              <template v-else-if="isOpenApiSource">
                <div class="config-example-group">
                  <div class="config-example-head">
                    <strong>Streamable HTTP（可流式 HTTP）</strong>
                    <span>推荐优先使用</span>
                  </div>
                  <div class="code-block-wrap">
                    <el-button
                      class="code-copy-button"
                      text
                      :icon="CopyDocument"
                      aria-label="复制 Streamable HTTP 配置示例"
                      @click="copyClientConfig(openApiHttpClientConfigText)"
                    >
                      复制
                    </el-button>
                    <pre class="code-block code-block--compact">{{ openApiHttpClientConfigText }}</pre>
                  </div>
                </div>
                <div class="config-example-group">
                  <div class="config-example-head">
                    <strong>SSE（服务端事件流）</strong>
                    <span>兼容只支持 SSE 的客户端</span>
                  </div>
                  <div class="code-block-wrap">
                    <el-button
                      class="code-copy-button"
                      text
                      :icon="CopyDocument"
                      aria-label="复制 SSE 配置示例"
                      @click="copyClientConfig(openApiSseClientConfigText)"
                    >
                      复制
                    </el-button>
                    <pre class="code-block code-block--compact">{{ openApiSseClientConfigText }}</pre>
                  </div>
                </div>
              </template>
              <div v-else class="code-block-wrap">
                <el-button
                  class="code-copy-button"
                  text
                  :icon="CopyDocument"
                  aria-label="复制当前配置示例"
                  @click="copyClientConfig(clientConfigText)"
                >
                  复制
                </el-button>
                <pre class="code-block code-block--compact">{{ clientConfigText }}</pre>
              </div>

              <div v-if="isOpenApiSource && hasSourceConfigAccess" class="source-info-panel">
                <p class="eyebrow">来源信息</p>
                <h4>OpenAPI 文档来源</h4>
                <p v-if="isOpenApiUrlMode">{{ openApiDocumentSourceText }}</p>
                <el-button v-else plain size="small" :icon="CopyDocument" @click="copyOpenApiContent">
                  复制 OpenAPI 文档内容
                </el-button>
                <span>OpenAPI 文档只用于生成工具。</span>
              </div>
            </section>

            <div v-if="staticInstallClients.length" class="install-list">
              <article v-for="client in staticInstallClients" :key="client.key" class="install-item">
                <div class="install-copy">
                  <h4>{{ client.name }}</h4>
                </div>
                <div class="install-actions">
                  <el-button type="primary" plain @click="openInstallClient(client)">{{ client.actionLabel }}</el-button>
                  <el-button @click="openTutorialDialog(client)">{{ client.secondaryLabel }}</el-button>
                </div>
              </article>
            </div>
          </section>
        </aside>
      </section>

            <el-dialog
        v-model="tutorialDialogVisible"
        :title="tutorialDialogTitle"
        class="tutorial-dialog"
        destroy-on-close
      >
        <p class="tutorial-dialog__intro">{{ tutorialIntro }}</p>
        <div class="tutorial-steps">
          <article v-for="step in tutorialSteps" :key="step.id" class="tutorial-step">
            <span class="tutorial-step__index">{{ tutorialStepPrefix }} {{ step.id }}</span>
            <div class="tutorial-step__copy">
              <h4>{{ step.title }}</h4>
              <p>{{ step.description }}</p>
            </div>
          </article>
        </div>

        <template #footer>
          <div class="tutorial-dialog__footer">
            <p v-if="tutorialHint" class="tutorial-dialog__hint">{{ tutorialHint }}</p>
            <div class="tutorial-dialog__actions">
              <el-button @click="tutorialDialogVisible = false">{{ tutorialCloseLabel }}</el-button>
              <el-button type="primary" @click="openTutorialPrimaryAction">{{ tutorialPrimaryActionLabel }}</el-button>
            </div>
          </div>
        </template>
      </el-dialog>

      <el-empty v-if="!loading && !detail" description="未找到对应的 MCP 服务" />
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  CopyDocument,
  Delete,
  Edit,
  RefreshRight,
  Star,
  StarFilled
} from '@element-plus/icons-vue'
import PlazaHeader from '../components/plaza/PlazaHeader.vue'
import Breadcrumb from '../components/common/Breadcrumb.vue'
import { mcpApi } from '../api/mcp'
import type { McpDetailItem } from '../types/mcp'
import type { StaticInstallClient } from '../utils/mcpPresentation'
import { isAppAdmin } from '../config/adminConfig'
import {
  buildMcpClientConfig,
  getMcpAvatarUrl,
  getMcpSourceTypeLabel,
  getOwnerText,
  getStaticInstallClients,
  getTransportLabel,
  getVisibilityLabel
} from '../utils/mcpPresentation'
import { renderMarkdown } from '../utils/markdown'

const route = useRoute()
const router = useRouter()
const loading = ref(false)
const detail = ref<McpDetailItem | null>(null)
const activeTab = ref('overview')
const clientConfigMode = ref<'upstream' | 'gateway'>('gateway')
const tutorialDialogVisible = ref(false)
const activeTutorialClient = ref<StaticInstallClient | null>(null)
const configProtocolPrefix = '\u63a5\u5165\u534f\u8bae\uff1a'
const snapshotDiscoveryLabel = '最近成功探测时间'
const snapshotToolCountLabel = '\u5de5\u5177\u603b\u6570'
const snapshotProbeSourceLabel = '探测位置'
const snapshotProbeProtocolLabel = '探测协议'
const snapshotUnknownText = '\u672a\u77e5'
const syncActionLabel = '\u7f51\u5173\u540c\u6b65'
const editActionLabel = '\u7f16\u8f91 MCP'
const deleteActionLabel = '\u5220\u9664 MCP'
const configModeHint = '\u7f51\u5173\u8def\u7531\u5904\u4e8e\u6d4b\u8bd5\u9636\u6bb5\uff0c\u82e5\u4e0d\u53ef\u7528\u53ef\u4f7f\u7528\u6765\u6e90 URL\u3002'
const openApiConfigModeHint = 'OpenAPI 来源的网关 MCP 同时支持 Streamable HTTP 和 SSE，可按客户端能力选择接入方式。'

const favoriteActionLabel = computed(() => detail.value?.isCollected ? '\u53d6\u6d88\u6536\u85cf' : '\u6536\u85cf MCP' )

const breadcrumbItems = computed(() => [
  { label: '智能体广场', path: '/' },
  { label: 'MCP 市场', path: '/mcp' },
  { label: detail.value?.displayName || 'MCP 服务详情' }
])

const currentUserIsAdmin = computed(() => isAppAdmin())
const canManage = computed(() => Boolean(detail.value) && currentUserIsAdmin.value)
const serverInitial = computed(() => (detail.value?.displayName?.trim()?.slice(0, 1) || 'M').toUpperCase())
const avatarUrl = computed(() => getMcpAvatarUrl(detail.value))
const categoryText = computed(() => detail.value?.category || detail.value?.newType || '综合类')
const sourceTypeText = computed(() => getMcpSourceTypeLabel(detail.value?.higressMcpType))
const visibleTags = computed(() => {
  const protocolTags = detail.value?.higressMcpType === 'OPEN_API' ? ['Streamable HTTP', 'SSE'] : []
  return Array.from(new Set([...protocolTags, ...(detail.value?.tags || [])])).slice(0, 3)
})
const ownerText = computed(() => (detail.value ? getOwnerText(detail.value) : '未知发布者'))
const visibilityText = computed(() => getVisibilityLabel(detail.value?.visibilityMode))
const currentTransportLabel = computed(() => (
  isOpenApiSource.value ? 'Streamable HTTP / SSE' : getTransportLabel(detail.value?.transport || 'streamable')
))
const isOpenApiSource = computed(() => detail.value?.higressMcpType === 'OPEN_API')
const isDirectRouteSource = computed(() => !isOpenApiSource.value)
const hasSourceConfigAccess = computed(() => detail.value?.hasSourceConfigAccess === true)
const upstreamClientUrl = computed(() => detail.value?.upstreamUrl || '')
const gatewayClientUrl = computed(() => detail.value?.debugGatewayAccessUrl || '')
const currentConfigUrl = computed(() => (
  isDirectRouteSource.value && hasSourceConfigAccess.value && clientConfigMode.value === 'upstream'
    ? upstreamClientUrl.value
    : gatewayClientUrl.value
))
const hasClientAccess = computed(() => detail.value?.hasClientAccess !== false)
const clientAccessMessage = computed(() => detail.value?.clientAccessMessage || '暂无权限，请联系创建者授权。')
const clientConfigSectionTitle = computed(() => (isOpenApiSource.value ? '网关代理 MCP' : '可直接参考的客户端配置'))
const currentConfigTitle = computed(() => (
  isDirectRouteSource.value && hasSourceConfigAccess.value && clientConfigMode.value === 'upstream'
    ? '来源 URL：'
    : '网关代理 MCP：'
))
const openApiDocumentSourceText = computed(() => {
  if (!detail.value) return '未配置'
  if (detail.value.openApiInputMode === 'content') return '已保存 OpenAPI 文档内容'
  return detail.value.openApiUrl || '未配置'
})
const isOpenApiUrlMode = computed(() => detail.value?.openApiInputMode === 'url')
const hasSyncFailure = computed(() => detail.value?.syncStatus === 'failed')
const syncFailureMessage = computed(() => detail.value?.syncMessage || detail.value?.lastErrorCode || '请检查 Higress 服务来源、路由和插件配置。')
const heroSummary = computed(() => {
  if (!detail.value) return ''
  const summary = String(detail.value.summary || '').trim()
  const description = String(detail.value.description || '').trim()
  if (!summary) return ''
  return summary === description ? '' : summary
})
const overviewDescription = computed(() => {
  if (!detail.value) return '当前服务尚未补充更详细的功能说明。'
  return detail.value.description || detail.value.summary || '当前服务尚未补充更详细的功能说明。'
})
const renderedOverviewDescription = computed(() => renderMarkdown(overviewDescription.value))
const toolSnapshot = computed(() => detail.value?.toolSnapshot || null)
const hasToolSnapshot = computed(() => Boolean(toolSnapshot.value?.tools?.length))
const hasDiscoveryFailure = computed(() => Boolean(detail.value?.lastToolDiscoveryError))
const toolCards = computed(() => toolSnapshot.value?.tools || [])
const snapshotDiscoveryTime = computed(() => formatSnapshotDateTime(detail.value?.lastToolDiscoveryAt))
const discoveryFailureTime = computed(() => formatSnapshotDateTime(detail.value?.lastToolDiscoveryFailedAt))
const snapshotToolCount = computed(() => String(detail.value?.toolCount || toolCards.value.length || 0))
const snapshotProbeSourceText = computed(() => {
  const sourceUrl = String(detail.value?.toolSnapshot?.sourceUrl || '').trim()
  if (!sourceUrl) return ''

  const gatewayUrl = String(detail.value?.gatewayAccessUrl || detail.value?.debugGatewayAccessUrl || '').trim()
  if (gatewayUrl && stripSseSuffix(sourceUrl) === stripSseSuffix(gatewayUrl)) return '网关路由 URL'
  return '来源 URL'
})
const snapshotProbeProtocolText = computed(() => {
  const transport = String(detail.value?.toolSnapshot?.transport || '').trim()
  if (transport === 'sse') return 'SSE'
  if (transport === 'streamable') return 'Streamable HTTP'
  return transport || ''
})
const clientConfigText = computed(() => (
  detail.value
    ? buildMcpClientConfig({
      serviceKey: detail.value.serviceKey,
      displayName: detail.value.displayName,
      gatewayAccessUrl: currentConfigUrl.value
    })
    : ''
))
function stripSseSuffix(url: string) {
  return String(url || '').replace(/\/sse\/?$/i, '')
}

function ensureSseSuffix(url: string) {
  const normalized = stripSseSuffix(url)
  return normalized ? `${normalized}/sse` : ''
}

const openApiHttpClientUrl = computed(() => stripSseSuffix(gatewayClientUrl.value))
const openApiSseClientUrl = computed(() => ensureSseSuffix(gatewayClientUrl.value))
const openApiHttpClientConfigText = computed(() => (
  detail.value
    ? buildMcpClientConfig({
      serviceKey: detail.value.serviceKey,
      displayName: `${detail.value.displayName || detail.value.serviceKey || 'OpenAPI MCP'} HTTP`,
      gatewayAccessUrl: openApiHttpClientUrl.value
    })
    : ''
))
const openApiSseClientConfigText = computed(() => (
  detail.value
    ? buildMcpClientConfig({
      serviceKey: detail.value.serviceKey,
      displayName: `${detail.value.displayName || detail.value.serviceKey || 'OpenAPI MCP'} SSE`,
      gatewayAccessUrl: openApiSseClientUrl.value
    })
    : ''
))
const staticInstallClients = getStaticInstallClients()
const tutorialStepPrefix = '步骤'
const tutorialCloseLabel = '关闭'
const tutorialDialogTitle = computed(() => activeTutorialClient.value?.tutorial.title || '接入教程')
const tutorialPrimaryActionLabel = computed(() => activeTutorialClient.value?.actionLabel || '')
const tutorialIntro = computed(() => activeTutorialClient.value?.tutorial.intro || '')
const tutorialHint = computed(() => activeTutorialClient.value?.tutorial.hint || '')
const tutorialSteps = computed(() => activeTutorialClient.value?.tutorial.steps || [])

function formatSnapshotDateTime(value?: string | null) {
  if (!value) return snapshotUnknownText
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

function editService() {
  if (!detail.value) return
  router.push(`/mcp/publish/${detail.value.id}`)
}

function copyTextWithExecCommand(value: string) {
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  textarea.style.pointerEvents = 'none'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()

  try {
    if (!document.execCommand('copy')) {
      throw new Error('copy command failed')
    }
  } finally {
    document.body.removeChild(textarea)
  }
}

async function copyText(value: string, successMessage: string) {
  const text = String(value || '')
  if (!text) return

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
    } else {
      copyTextWithExecCommand(text)
    }
    ElMessage.success(successMessage)
  } catch {
    try {
      copyTextWithExecCommand(text)
      ElMessage.success(successMessage)
    } catch {
      ElMessage.error('\u590d\u5236\u5931\u8d25\uff0c\u8bf7\u624b\u52a8\u590d\u5236')
    }
  }
}

async function copyClientConfig(configText: string) {
  await copyText(configText, '当前配置示例已复制')
}

async function copyOpenApiContent() {
  await copyText(detail.value?.openApiContent || '', 'OpenAPI 文档内容已复制')
}

function openInstallClient(client: StaticInstallClient) {
  if (!client.actionHref) return
  window.open(client.actionHref, '_blank', 'noopener,noreferrer')
}

function openTutorialDialog(client: StaticInstallClient) {
  activeTutorialClient.value = client
  tutorialDialogVisible.value = true
}

function openTutorialPrimaryAction() {
  if (!activeTutorialClient.value) return
  openInstallClient(activeTutorialClient.value)
}

async function toggleFavorite() {
  if (!detail.value) return
  const response: any = await mcpApi.toggleFavorite(detail.value.id)
  detail.value.isCollected = response.data.isCollected
  detail.value.favoriteCount = response.data.favoriteCount
  detail.value.collectCount = response.data.collectCount
  ElMessage.success(detail.value.isCollected ? '已加入收藏' : '已取消收藏')
}

async function resyncService() {
  if (!detail.value) return
  await mcpApi.resyncMyService(detail.value.id)
  ElMessage.success('已提交网关同步，请稍后查看状态')
  await loadDetail()
}

async function deleteService() {
  if (!detail.value) return
  await ElMessageBox.confirm(
    `确定删除 MCP「${detail.value.displayName}」吗？删除后会同步移除 Higress 中的相关路由和服务来源。`,
    '删除 MCP',
    {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消'
    }
  )

  await mcpApi.deleteMyService(detail.value.id)
  ElMessage.success('MCP 已删除')
  router.push('/mcp')
}

async function loadDetail() {
  loading.value = true
  try {
    const response: any = await mcpApi.getCatalogDetail(String(route.params.id))
    detail.value = response.data
  } finally {
    loading.value = false
  }
}

onMounted(loadDetail)

watch(
  () => route.params.id,
  async (nextId, previousId) => {
    if (!nextId || nextId === previousId) return
    activeTab.value = 'overview'
    await loadDetail()
  }
)
</script>

<style scoped lang="scss">
.mcp-detail-page {
  min-height: 100vh;
  background:
    radial-gradient(circle at top left, rgba(226, 237, 255, 0.92), transparent 32%),
    linear-gradient(180deg, #f5f9ff 0%, #eef4ff 100%);
}

.detail-main {
  max-width: 1480px;
  margin: 0 auto;
  padding: 24px;
}

.detail-hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 28px;
  padding: 28px 0 30px;
}

.hero-left {
  display: flex;
  gap: 18px;
  min-width: 0;
}

.server-mark {
  width: 72px;
  height: 72px;
  overflow: hidden;
  flex-shrink: 0;
  border-radius: 22px;
  background: linear-gradient(145deg, #ffffff 0%, #dfeaff 100%);
  box-shadow:
    inset 0 0 0 1px rgba(79, 122, 255, 0.12),
    0 18px 36px rgba(79, 122, 255, 0.12);
  color: #315fe0;
  font-size: 30px;
  font-weight: 800;
}

.server-mark img,
.server-mark span {
  width: 100%;
  height: 100%;
}

.server-mark img {
  display: block;
  object-fit: cover;
}

.server-mark span {
  display: grid;
  place-items: center;
}

.hero-copy {
  display: grid;
  gap: 14px;
}

.eyebrow {
  margin: 0;
  color: #3968df;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

h1 {
  margin: 0;
  color: #1b2b46;
  font-size: 34px;
  line-height: 1.16;
}

.summary {
  max-width: 820px;
  margin: 0;
  color: #61728e;
  font-size: 15px;
  line-height: 1.8;
}

.hero-meta-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.meta-pill {
  padding: 8px 14px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.82);
  border: 1px solid rgba(150, 176, 235, 0.45);
  color: #577197;
  font-size: 13px;
  line-height: 1;
}

.meta-pill--accent {
  background: linear-gradient(135deg, #eef4ff 0%, #dfe9ff 100%);
  color: #315fe0;
  border-color: rgba(79, 122, 255, 0.2);
  font-weight: 700;
}






.hero-actions {
  display: grid;
  grid-template-columns: repeat(2, 126px);
  gap: 10px;
  justify-content: end;
}

.hero-actions--single {
  grid-template-columns: 126px;
}

.hero-action-btn {
  width: 126px;
  margin: 0;
}

.detail-shell {
  display: grid;
  grid-template-columns: minmax(0, 1fr) clamp(420px, 32vw, 480px);
  gap: 22px;
  align-items: start;
  min-width: 0;
}

.card-panel,
.sidebar-card {
  min-width: 0;
  border: 1px solid rgba(210, 223, 244, 0.95);
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 18px 40px rgba(32, 68, 145, 0.08);
}

.card-panel {
  padding: 8px 22px 26px;
}

.detail-primary {
  min-width: 0;
}

.detail-tabs :deep(.el-tabs__item) {
  height: 46px;
  font-size: 16px;
  font-weight: 600;
}

.content-stack {
  display: grid;
  gap: 20px;
  padding-top: 8px;
  min-width: 0;
}

.section-block {
  min-width: 0;
  padding: 20px 22px;
  border-radius: 20px;
  background: linear-gradient(180deg, #fbfdff 0%, #f6f9ff 100%);
}

.section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}

.section-head h2 {
  margin: 4px 0 0;
  color: #172742;
  font-size: 24px;
  line-height: 1.24;
}

.description-text {
  margin: 0;
  color: #5f708b;
  line-height: 1.9;
  white-space: pre-wrap;
}

.snapshot-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.tool-probe-note {
  margin-top: 12px;
  font-size: 13px;
}

.snapshot-meta__item {
  display: grid;
  gap: 4px;
  min-width: 180px;
  padding: 12px 14px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.76);
  border: 1px solid rgba(210, 223, 244, 0.8);
}

.snapshot-meta__label {
  color: #6b7c98;
  font-size: 12px;
  line-height: 1.4;
}

.snapshot-meta__value {
  color: #1f3152;
  font-size: 15px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.markdown-content {
  white-space: normal;
}

.section-block--warning {
  border: 1px solid #f7d7a8;
  background: linear-gradient(180deg, #fffaf0 0%, #fff5df 100%);
}

.markdown-content :deep(p),
.markdown-content :deep(ul),
.markdown-content :deep(ol),
.markdown-content :deep(blockquote),
.markdown-content :deep(pre) {
  margin: 0 0 14px;
}

.markdown-content :deep(*:last-child) {
  margin-bottom: 0;
}

.markdown-content :deep(h1),
.markdown-content :deep(h2),
.markdown-content :deep(h3),
.markdown-content :deep(h4),
.markdown-content :deep(h5),
.markdown-content :deep(h6) {
  margin: 0 0 12px;
  color: #172742;
  line-height: 1.35;
}

.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  padding-left: 20px;
}

.markdown-content :deep(li + li) {
  margin-top: 6px;
}

.markdown-content :deep(a) {
  color: #315fe0;
  text-decoration: none;
}

.markdown-content :deep(a:hover) {
  text-decoration: underline;
}

.markdown-content :deep(code) {
  padding: 2px 6px;
  border-radius: 6px;
  background: #eef4ff;
  color: #2446a8;
  font-family: Consolas, Monaco, monospace;
  font-size: 0.92em;
}

.markdown-content :deep(pre) {
  padding: 14px 16px;
  border-radius: 14px;
  background: #0f172a;
  overflow-x: auto;
}

.markdown-content :deep(pre code) {
  padding: 0;
  background: transparent;
  color: #d9ecff;
}

.markdown-content :deep(blockquote) {
  padding-left: 14px;
  border-left: 3px solid #cddbf4;
  color: #62728c;
}

.card-description,
.install-copy p,
.tool-card p {
  margin: 10px 0 0;
  color: #62728c;
  line-height: 1.75;
}

.tool-schema-list {
  margin: 12px 0 0;
  padding-left: 18px;
  color: #62728c;
}

.tool-schema-list li + li {
  margin-top: 6px;
}

.install-copy h4,
.tool-card h3,
.section-head--compact h3 {
  margin: 0;
  color: #172742;
}

.code-block-wrap {
  position: relative;
  min-width: 0;
}

.code-block-wrap .code-block {
  padding-top: 54px;
}

.code-copy-button {
  position: absolute;
  z-index: 1;
  top: 24px;
  right: 14px;
  min-height: 28px;
  padding: 4px 9px;
  border: 1px solid rgba(198, 219, 255, 0.36);
  border-radius: 8px;
  background: rgba(31, 48, 80, 0.78);
  color: #d9ecff;
  font-size: 12px;
  line-height: 18px;
}

.code-copy-button:hover,
.code-copy-button:focus-visible {
  border-color: rgba(198, 219, 255, 0.8);
  background: rgba(57, 93, 156, 0.86);
  color: #ffffff;
}

.code-block {
  display: block;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
  margin: 0;
  padding: 18px;
  border-radius: 18px;
  background: #0f172a;
  color: #d9ecff;
  font-family: Consolas, Monaco, monospace;
  font-size: 13px;
  line-height: 1.8;
  white-space: pre;
  overflow-x: auto;
}

.code-block--compact {
  margin-top: 12px;
}

.config-example-group {
  display: grid;
  gap: 10px;
  min-width: 0;
  margin-top: 14px;
}

.config-example-group + .config-example-group {
  margin-top: 16px;
}

.config-example-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.config-example-head strong {
  color: #172742;
  font-size: 14px;
}

.config-example-head span {
  color: #7a8ca8;
  font-size: 12px;
  white-space: nowrap;
}

.config-permission-note {
  display: grid;
  gap: 8px;
  margin-top: 12px;
  padding: 18px;
  border-radius: 18px;
  border: 1px solid #d8e4fb;
  background: linear-gradient(180deg, #f8fbff 0%, #eef4ff 100%);
}

.config-permission-note strong {
  color: #172742;
  font-size: 15px;
}

.config-permission-note p {
  margin: 0;
  color: #62728c;
  line-height: 1.7;
}

.tool-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.tool-card {
  padding: 18px;
  border-radius: 18px;
  background: #ffffff;
  border: 1px solid #e6eef9;
}

.tool-card__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.tool-card__top h3 {
  min-width: 0;
  line-height: 1.35;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.tool-badge {
  flex-shrink: 0;
  padding: 6px 10px;
  border-radius: 999px;
  background: #eef4ff;
  color: #315fe0;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.detail-sidebar {
  position: sticky;
  top: 20px;
  min-width: 0;
}

.sidebar-card {
  padding: 22px;
}


.config-snippet {
  margin: 18px 0;
  min-width: 0;
}

.config-mode-switch {
  display: inline-grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: 14px;
}

.config-mode-hint {
  margin: 12px 0 0;
  color: #62728c;
  font-size: 13px;
  line-height: 1.7;
}

.source-info-panel {
  display: grid;
  gap: 8px;
  margin-top: 16px;
  padding: 14px;
  border-radius: 16px;
  border: 1px solid #dbe7f7;
  background: #f7fbff;
  color: #526784;
}

.source-info-panel h4,
.source-info-panel p {
  margin: 0;
}

.source-info-panel h4 {
  color: #172742;
  font-size: 14px;
}

.source-info-panel p {
  overflow-wrap: anywhere;
  line-height: 1.7;
}

.source-info-panel span {
  color: #7a8ca8;
  font-size: 12px;
  line-height: 1.6;
}

.config-mode-btn {
  min-width: 132px;
  height: 38px;
  border: 1px solid #d8e4fb;
  border-radius: 12px;
  padding: 0 14px;
  background: #fff;
  color: #5f708b;
  font: inherit;
  cursor: pointer;
  transition: all 0.2s ease;
}

.config-mode-btn.active {
  background: #172742;
  border-color: #172742;
  color: #fff;
}

.section-head--compact {
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
  margin-bottom: 0;
}

.section-head--compact > div:first-child {
  min-width: 0;
}

.section-head--compact h3 {
  line-height: 1.45;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.config-head-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  width: 100%;
  min-width: 0;
}

.config-protocol {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  max-width: 100%;
  padding: 0 12px;
  border-radius: 999px;
  background: #eef4ff;
  color: #315fe0;
  font-size: 13px;
  font-weight: 600;
  white-space: normal;
  overflow-wrap: anywhere;
}


.install-list {
  display: grid;
  gap: 12px;
  min-width: 0;
  margin-top: 18px;
}

.install-item {
  display: grid;
  gap: 14px;
  min-width: 0;
  padding: 18px;
  border-radius: 18px;
  background: linear-gradient(180deg, #fbfdff 0%, #f4f8ff 100%);
  border: 1px solid #e6eef9;
}

.install-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.tutorial-dialog :deep(.el-dialog) {
  width: min(960px, calc(100vw - 32px));
  max-width: calc(100vw - 32px);
}

.tutorial-dialog__intro {
  margin: 0 0 18px;
  color: #5f708b;
  line-height: 1.75;
}

.tutorial-steps {
  display: grid;
  gap: 18px;
  max-height: min(72vh, 960px);
  padding-right: 4px;
  overflow: auto;
}

.tutorial-step {
  display: grid;
  gap: 14px;
  padding: 18px;
  border: 1px solid #e6eef9;
  border-radius: 18px;
  background: linear-gradient(180deg, #fbfdff 0%, #f5f9ff 100%);
}

.tutorial-step__index {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  padding: 4px 10px;
  border-radius: 999px;
  background: #eef4ff;
  color: #315fe0;
  font-size: 12px;
  font-weight: 700;
}

.tutorial-step__copy h4 {
  margin: 10px 0 0;
  color: #172742;
  font-size: 18px;
}

.tutorial-step__copy p {
  margin: 10px 0 0;
  color: #5f708b;
  line-height: 1.8;
  white-space: pre-line;
}

.tutorial-image {
  width: 100%;
  display: block;
  border-radius: 16px;
  border: 1px solid #dfe8f8;
  background: #fff;
  box-shadow: 0 12px 32px rgba(32, 68, 145, 0.08);
}

.tutorial-dialog__footer {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
}

.tutorial-dialog__hint {
  margin: 0;
  color: #62728c;
  font-size: 13px;
  line-height: 1.7;
  text-align: left;
}

.tutorial-dialog__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  flex-shrink: 0;
}

@media (max-width: 1180px) {
  .detail-shell {
    grid-template-columns: 1fr;
  }

  .detail-sidebar {
    position: static;
  }
}

@media (max-width: 900px) {
  .detail-hero,
  .hero-left {
    flex-direction: column;
  }

  .detail-main {
    padding: 18px;
  }



  .hero-actions {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    width: 100%;
    justify-content: stretch;
  }

  .hero-actions--single {
    grid-template-columns: minmax(0, 1fr);
    justify-self: stretch;
  }

  .hero-action-btn {
    width: 100%;
  }

  .tool-grid {
    grid-template-columns: 1fr;
  }

  .snapshot-meta__item {
    min-width: 100%;
  }

  .section-head,
  .install-actions,
  .config-head-actions {
    flex-direction: column;
    align-items: flex-start;
  }

  .config-mode-switch {
    width: 100%;
  }

  .tutorial-dialog__footer {
    flex-direction: column;
    align-items: flex-start;
  }

  .tutorial-dialog__actions {
    width: 100%;
  }
}

@media (max-width: 640px) {
  .detail-main {
    padding: 12px;
  }

  .detail-hero {
    gap: 18px;
    padding: 18px 0 20px;
  }

  .server-mark {
    width: 60px;
    height: 60px;
    border-radius: 18px;
  }

  h1 {
    font-size: 26px;
  }

  .summary {
    font-size: 14px;
  }

  .card-panel,
  .sidebar-card {
    border-radius: 16px;
  }

  .card-panel,
  .sidebar-card,
  .section-block,
  .install-item,
  .tutorial-step {
    padding: 16px;
  }

  .detail-tabs :deep(.el-tabs__item) {
    padding: 0 12px;
    font-size: 14px;
  }

  .section-head h2 {
    font-size: 20px;
  }

  .snapshot-meta__item {
    padding: 10px 12px;
  }

  .config-mode-switch {
    grid-template-columns: 1fr;
    width: 100%;
  }

  .config-mode-btn,
  .install-actions :deep(.el-button),
  .tutorial-dialog__actions :deep(.el-button) {
    width: 100%;
  }

  .code-block {
    max-width: 100%;
    padding: 14px;
    font-size: 12px;
    box-sizing: border-box;
  }

  .code-block-wrap .code-block {
    padding-top: 62px;
  }

  .code-copy-button {
    top: 20px;
    right: 10px;
    min-height: 36px;
    padding: 7px 10px;
    font-size: 13px;
  }

  .tutorial-dialog :deep(.el-dialog) {
    width: calc(100vw - 24px);
    max-width: calc(100vw - 24px);
  }
}
</style>
