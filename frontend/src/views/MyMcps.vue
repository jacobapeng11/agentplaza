<template>
  <div class="my-mcps-page">
    <PlazaHeader />

    <main class="my-mcps-main">
      <div class="page-top-row">
        <Breadcrumb :items="breadcrumbItems" />
      </div>

      <section id="created-section" class="section-container">
        <div class="section-header">
          <h2 class="section-title">我创建的 MCP<span class="count">({{ myCreatedItems.length }})</span></h2>
          <button type="button" class="sort-btn" :class="{ active: createdSort === 'latest' }" @click="createdSort = 'latest'">最新</button>
          <button type="button" class="sort-btn" :class="{ active: createdSort === 'hot' }" @click="createdSort = 'hot'">最热</button>
        </div>

        <div v-if="loadingCreated" class="loading-state">
          <el-skeleton :rows="2" animated />
        </div>

        <div v-else-if="sortedCreatedItems.length > 0" class="apps-grid">
          <article v-for="item in sortedCreatedItems" :key="item.id" class="mcp-card" @click="openDetail(item.id)">
            <div class="card-header">
              <div :class="['header-background', bgClass(item)]"></div>
              <div class="app-name-wrapper">
                <h3 class="app-name" :title="item.displayName">{{ item.displayName }}</h3>
                <div class="creator-badge" :title="ownerText(item)">{{ ownerText(item) }}</div>
              </div>
              <div class="card-avatar"><img class="mcp-icon" :src="getMcpAvatarUrl(item)" alt="MCP" /></div>
            </div>

            <div class="card-body">
              <h4 class="card-app-name" :title="item.displayName">{{ item.displayName }}</h4>
              <div class="card-tags">
                <span class="tag-item tag-0">{{ categoryName(item.category) }}</span>
                <span
                  v-for="(tag, index) in displayTags(item)"
                  :key="tag"
                  class="tag-item"
                  :class="'tag-' + ((index + 1) % 4)"
                >{{ tag }}</span>
              </div>
              <p class="card-description" :title="item.summary || item.description">
                {{ item.summary || item.description || emptyDescriptionText }}
              </p>
            </div>

            <div class="card-footer">
              <div class="stats-left">
                <div class="stat-item">
                  <img class="stat-icon" src="/appIcon1.png" alt="visibility" />
                  <span>{{ getVisibilityLabel(item.visibilityMode) }}</span>
                </div>

              </div>
                <div class="card-actions">
                <span class="view-count" title="使用次数">
                  <el-icon><View /></el-icon>
                  <span>{{ item.viewCount || 0 }}</span>
                </span>
                <el-tooltip :content="favoriteText" placement="top">
                  <button class="collect-button" type="button" @click.stop="toggleFavorite(item.id)">
                    <img class="collect-icon" :src="item.isCollected ? '/appIcon3_active.png' : '/appIcon3.png'" alt="favorite" />
                    <span class="collect-count">{{ item.favoriteCount || item.collectCount || 0 }}</span>
                  </button>
                </el-tooltip>
                <el-tooltip :content="detailText" placement="top">
                  <button class="action-button" type="button" @click.stop="openDetail(item.id)"><el-icon><View /></el-icon></button>
                </el-tooltip>
                <template v-if="canManage()">
                  <el-tooltip :content="editText" placement="top">
                    <button class="action-button" type="button" @click.stop="editService(item.id)"><el-icon><Edit /></el-icon></button>
                  </el-tooltip>
                  <el-tooltip :content="deleteText" placement="top">
                    <button class="action-button danger" type="button" @click.stop="deleteService(item)"><el-icon><Delete /></el-icon></button>
                  </el-tooltip>
                </template>
              </div>
            </div>

            <div class="card-hover-overlay" />
          </article>
        </div>

        <div v-else class="empty-state">
          <el-empty description="暂无创建的 MCP 服务" />
        </div>
      </section>

      <section id="collected-section" class="section-container">
        <div class="section-header">
          <h2 class="section-title">我收藏的 MCP<span class="count">({{ myCollectedItems.length }})</span></h2>
          <button type="button" class="sort-btn" :class="{ active: collectedSort === 'latest' }" @click="collectedSort = 'latest'">最新</button>
          <button type="button" class="sort-btn" :class="{ active: collectedSort === 'hot' }" @click="collectedSort = 'hot'">最热</button>
        </div>

        <div v-if="loadingCollected" class="loading-state">
          <el-skeleton :rows="2" animated />
        </div>

        <div v-else-if="sortedCollectedItems.length > 0" class="apps-grid">
          <article v-for="item in sortedCollectedItems" :key="item.id" class="mcp-card" @click="openDetail(item.id)">
            <div class="card-header">
              <div :class="['header-background', bgClass(item)]"></div>
              <div class="app-name-wrapper">
                <h3 class="app-name" :title="item.displayName">{{ item.displayName }}</h3>
                <div class="creator-badge" :title="ownerText(item)">{{ ownerText(item) }}</div>
              </div>
              <div class="card-avatar"><img class="mcp-icon" :src="getMcpAvatarUrl(item)" alt="MCP" /></div>
            </div>

            <div class="card-body">
              <h4 class="card-app-name" :title="item.displayName">{{ item.displayName }}</h4>
              <div class="card-tags">
                <span class="tag-item tag-0">{{ categoryName(item.category) }}</span>
                <span
                  v-for="(tag, index) in displayTags(item)"
                  :key="tag"
                  class="tag-item"
                  :class="'tag-' + ((index + 1) % 4)"
                >{{ tag }}</span>
              </div>
              <p class="card-description" :title="item.summary || item.description">
                {{ item.summary || item.description || emptyDescriptionText }}
              </p>
            </div>

            <div class="card-footer">
              <div class="stats-left">
                <div class="stat-item">
                  <img class="stat-icon" src="/appIcon1.png" alt="visibility" />
                  <span>{{ getVisibilityLabel(item.visibilityMode) }}</span>
                </div>

              </div>
                <div class="card-actions">
                <span class="view-count" title="使用次数">
                  <el-icon><View /></el-icon>
                  <span>{{ item.viewCount || 0 }}</span>
                </span>
                <el-tooltip :content="favoriteText" placement="top">
                  <button class="collect-button" type="button" @click.stop="toggleFavorite(item.id)">
                    <img class="collect-icon" :src="item.isCollected ? '/appIcon3_active.png' : '/appIcon3.png'" alt="favorite" />
                    <span class="collect-count">{{ item.favoriteCount || item.collectCount || 0 }}</span>
                  </button>
                </el-tooltip>
                <el-tooltip :content="detailText" placement="top">
                  <button class="action-button" type="button" @click.stop="openDetail(item.id)"><el-icon><View /></el-icon></button>
                </el-tooltip>
                <template v-if="canManage()">
                  <el-tooltip :content="editText" placement="top">
                    <button class="action-button" type="button" @click.stop="editService(item.id)"><el-icon><Edit /></el-icon></button>
                  </el-tooltip>
                  <el-tooltip :content="deleteText" placement="top">
                    <button class="action-button danger" type="button" @click.stop="deleteService(item)"><el-icon><Delete /></el-icon></button>
                  </el-tooltip>
                </template>
              </div>
            </div>

            <div class="card-hover-overlay" />
          </article>
        </div>

        <div v-else class="empty-state">
          <el-empty description="暂无收藏的 MCP 服务" />
        </div>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, Edit, View } from '@element-plus/icons-vue'
import { isAppAdmin } from '../config/adminConfig'
import PlazaHeader from '../components/plaza/PlazaHeader.vue'
import Breadcrumb from '../components/common/Breadcrumb.vue'
import { mcpApi } from '../api/mcp'
import { useAppsStore } from '../stores/apps'
import { getMcpAvatarUrl, getMcpSourceTypeLabel, getOwnerText, getVisibilityLabel } from '../utils/mcpPresentation'
import type { Category } from '../types/agent'
import type { McpListItem, McpSyncStatus, McpTransport } from '../types/mcp'

const route = useRoute()
const router = useRouter()
const appsStore = useAppsStore()

const loadingCreated = ref(false)
const loadingCollected = ref(false)
const createdSort = ref<'hot' | 'latest'>('latest')
const collectedSort = ref<'hot' | 'latest'>('latest')
const myCreatedItems = ref<McpListItem[]>([])
const myCollectedItems = ref<McpListItem[]>([])

const text = {
  plaza: '智能体广场',
  market: 'MCP 市场',
  mine: '我的 MCP',
  recommend: '推荐',
  marketplace: '大市场',
  finance: '财经类',
  office: '办公类',
  admin: '行政类',
  dev: '研发类',
  general: '综合类',
  unknownPublisher: '未知发布者',
  creating: '创建中',
  public: '公开',
  private: '私有',
  never: '尚未',
  updated: '更新',
  detail: '详情',
  edit: '编辑',
  delete: '删除',
  favorite: '收藏',
  emptyDescription: '暂无服务说明',
  confirmTitle: '删除 MCP',
  confirmPrefix: '确定删除 MCP「',
  confirmSuffix: '」吗？删除后会同步移除 Higress 中的 MCP Server 和服务来源。',
  cancel: '取消',
  deleted: 'MCP 已删除'
}

const fallbackCategories: Category[] = [
  { id: 'all', name: text.recommend, icon: '' },
  { id: text.marketplace, name: text.marketplace, icon: '' },
  { id: text.finance, name: text.finance, icon: '' },
  { id: text.office, name: text.office, icon: '' },
  { id: text.admin, name: text.admin, icon: '' },
  { id: text.dev, name: text.dev, icon: '' },
  { id: text.general, name: text.general, icon: '' }
]

const breadcrumbItems = [
  { label: text.plaza, path: '/' },
  { label: text.market, path: '/mcp' },
  { label: text.mine }
]

const emptyDescriptionText = text.emptyDescription
const detailText = text.detail
const editText = text.edit
const deleteText = text.delete
const favoriteText = text.favorite

const marketCategories = computed<Category[]>(() => {
  const loaded = appsStore.categories.length ? appsStore.categories : fallbackCategories
  const hasAll = loaded.some(category => category.id === 'all')
  return hasAll ? loaded : [{ id: 'all', name: text.recommend, icon: '' }, ...loaded]
})

const sortedCreatedItems = computed(() => sortItems(myCreatedItems.value, createdSort.value))
const sortedCollectedItems = computed(() => sortItems(myCollectedItems.value, collectedSort.value))

function sortItems(items: McpListItem[], sortType: 'hot' | 'latest') {
  const source = [...items]
  if (sortType === 'latest') {
    return source.sort((a, b) => new Date(b.createdAt || b.updatedAt).getTime() - new Date(a.createdAt || a.updatedAt).getTime())
  }

  return source.sort((a, b) => {
    const countGap = (b.viewCount || 0) - (a.viewCount || 0)
    if (countGap !== 0) return countGap
    return statusWeight(b.syncStatus) - statusWeight(a.syncStatus)
  })
}

function statusWeight(status: McpSyncStatus) {
  const weights: Record<McpSyncStatus, number> = { active: 5, updating: 4, creating: 3, failed: 2, deleting: 1 }
  return weights[status] || 0
}

function canManage() {
  return isAppAdmin()
}

function ownerText(item: McpListItem) {
  return getOwnerText(item)
}

function hashText(value: string) {
  return Array.from(value || 'mcp').reduce((sum, char) => sum + char.charCodeAt(0), 0)
}

function bgClass(item: McpListItem) {
  return 'bg-variant-' + (hashText(item.id) % 4)
}

function transportText(value: McpTransport) {
  return value === 'sse' ? 'SSE' : 'Streamable HTTP'
}

function displayTags(item: McpListItem) {
  const transportTags = item.higressMcpType === 'OPEN_API' ? ['Streamable HTTP', 'SSE'] : [transportText(item.transport)]
  return Array.from(new Set([getMcpSourceTypeLabel(item.higressMcpType), ...transportTags, ...(item.tags || [])])).slice(0, 3)
}

function categoryName(categoryId?: string) {
  return marketCategories.value.find(item => item.id === categoryId)?.name || categoryId || text.general
}

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleDateString() : text.never
}

function openDetail(id: string) {
  router.push('/mcp/server/' + id)
}

function editService(id: string) {
  router.push('/mcp/publish/' + id)
}


async function loadCreated() {
  loadingCreated.value = true
  try {
    const response: any = await mcpApi.getMyCreated()
    myCreatedItems.value = response.data.items || []
  } finally {
    loadingCreated.value = false
  }
}

async function loadCollected() {
  loadingCollected.value = true
  try {
    const response: any = await mcpApi.getMyCollected()
    myCollectedItems.value = response.data.items || []
  } finally {
    loadingCollected.value = false
  }
}

async function loadAll() {
  await Promise.all([loadCreated(), loadCollected()])
}

function patchFavoriteState(result: { id: string; isCollected: boolean; favoriteCount: number; collectCount: number }) {
  const patch = (item: McpListItem) => item.id === result.id
    ? { ...item, isCollected: result.isCollected, favoriteCount: result.favoriteCount, collectCount: result.collectCount }
    : item

  myCreatedItems.value = myCreatedItems.value.map(patch)
  myCollectedItems.value = result.isCollected
    ? myCollectedItems.value.some(item => item.id === result.id)
      ? myCollectedItems.value.map(patch)
      : myCollectedItems.value
    : myCollectedItems.value.filter(item => item.id !== result.id)
}

async function toggleFavorite(id: string) {
  const response: any = await mcpApi.toggleFavorite(id)
  patchFavoriteState(response.data)
  await loadCollected()
}

async function deleteService(item: McpListItem) {
  await ElMessageBox.confirm(text.confirmPrefix + item.displayName + text.confirmSuffix, text.confirmTitle, {
    type: 'warning',
    confirmButtonText: text.delete,
    cancelButtonText: text.cancel
  })

  await mcpApi.deleteMyService(item.id)
  ElMessage.success(text.deleted)
  await loadAll()
}

async function scrollToRequestedSection() {
  await nextTick()
  const tab = String(route.query.tab || '')
  const targetId = tab === 'collected' ? 'collected-section' : tab === 'created' ? 'created-section' : ''
  if (!targetId) return

  const section = document.getElementById(targetId)
  if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

onMounted(async () => {
  if (!appsStore.categories.length) await appsStore.fetchCategories()
  await loadAll()
  await scrollToRequestedSection()
})
</script>

<style scoped lang="scss">
.my-mcps-page {
  min-height: 100vh;
  background-image: url('/bj.png');
  background-size: cover;
  background-position: center;
  background-attachment: fixed;
}

.my-mcps-main {
  max-width: 1680px;
  margin: 0 auto;
  padding: 24px;
  width: 100%;
  box-sizing: border-box;
}

.page-top-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.section-container {
  margin-bottom: 32px;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 24px;
  margin-bottom: 18px;
  flex-wrap: wrap;
}

.section-title {
  margin: 0;
  font-size: 28px;
  font-weight: 700;
  color: #1f2a44;
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.count {
  color: #409eff;
  font-size: 18px;
  font-weight: 500;
}

.sort-btn {
  min-width: 72px;
  height: 38px;
  border: 0;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.82);
  color: #6d7b94;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.sort-btn.active,
.sort-btn:hover {
  background: linear-gradient(135deg, #3b82f6 0%, #335eea 100%);
  color: #fff;
  box-shadow: 0 10px 18px rgba(51, 94, 234, 0.18);
}

.loading-state {
  padding: 12px 0 8px;
}

.empty-state {
  padding: 24px 0;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.72);
}

.apps-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 20px;
}

.mcp-card {
  position: relative;
  min-height: 240px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  overflow: hidden;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  flex-direction: column;
}

.mcp-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.12);
}

.card-header {
  position: relative;
  height: 120px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 30px;
}

.header-background {
  position: absolute;
  top: 8px;
  bottom: 8px;
  left: 10px;
  right: 10px;
  width: calc(100% - 20px);
  height: calc(100% - 16px);
  background-size: cover;
  background-position: center;
  border-radius: 8px 8px 0 0;
  z-index: 0;
}

.header-background.bg-variant-0 { background-image: url('/app_bj1.png'); }
.header-background.bg-variant-1 { background-image: url('/app_bj2.png'); }
.header-background.bg-variant-2 { background-image: url('/app_bj3.png'); }
.header-background.bg-variant-3 { background-image: url('/app_bj4.png'); }

.app-name-wrapper {
  position: relative;
  z-index: 1;
  display: inline-flex;
  max-width: calc(100% - 120px);
  margin-right: 12px;
  border-radius: 8px;
  padding: 6px 0;
  backdrop-filter: blur(10px);
  flex-direction: column;
}

.app-name {
  font-family: var(--font-alimama);
  font-size: 24px;
  font-weight: bold;
  color: #fff;
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.4;
}

.creator-badge {
  font-family: PingFang SC;
  font-size: 14px;
  font-weight: 600;
  background: #fff;
  border-radius: 8px;
  width: max-content;
  max-width: 100%;
  padding: 2px 8px;
  margin-top: 8px;
  color: #3B66D6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-avatar {
  position: relative;
  z-index: 1;
  height: 90px;
  flex-shrink: 0;
}

.mcp-icon {
  width: 90px;
  height: 90px;
  object-fit: cover;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.3);
}

.card-body {
  flex: 1;
  padding: 0 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background-color: #fff;
}

.card-app-name {
  font-family: PingFang SC;
  font-size: 16px;
  font-weight: 600;
  color: #303133;
  margin: 0 0 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.4;
}

.card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  min-height: 28px;
}

.tag-item {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
  padding: 4px 12px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.2;
  white-space: nowrap;
  vertical-align: middle;
  box-sizing: border-box;
}

.tag-0 { background-color: #E6F0FF; color: #3B66D6; }
.tag-1 { background-color: #E8FFF2; color: #17B76A; }
.tag-2 { background-color: #FFF4E6; color: #FF9B3B; }
.tag-3 { background-color: #F7F8FC; color: #909399; }

.card-description {
  font-size: 13px;
  color: #888F99;
  line-height: 16px;
  margin: 0;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  text-overflow: ellipsis;
  word-break: break-all;
}

.card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 16px;
  background-color: transparent;
  position: relative;
  flex-wrap: nowrap;
}

.stats-left {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: center;
  gap: 8px 12px;
  min-width: 0;
  flex: 1 1 auto;
}

.stat-item {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  font-size: 12px;
  color: #999;
  white-space: normal;
  line-height: 1.4;
  min-width: 0;
}

.stat-item span {
  overflow-wrap: anywhere;
  word-break: break-word;
}

.stat-item :deep(.el-icon) {
  font-size: 13px;
}

.stat-icon {
  width: 13px;
  height: 13px;
}

.card-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  flex-wrap: nowrap;
}

.view-count {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #999;
  font-size: 12px;
  line-height: 1;
}

.action-button {
  width: 28px;
  height: 28px;
  display: inline-grid;
  place-items: center;
  border: 0;
  border-radius: 8px;
  color: #8b97aa;
  background: transparent;
  cursor: pointer;
}

.action-button:hover {
  color: #3366FF;
  background: #eef4ff;
}

.action-button.danger:hover {
  color: #e34d59;
  background: #fff1f0;
}

.collect-button {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  border: 0;
  background: transparent;
  color: #999;
  cursor: pointer;
  padding: 0 2px;
  font-size: 12px;
}

.collect-icon {
  width: 13px;
  height: 13px;
  transition: all 0.3s;
}

.collect-button:hover .collect-icon {
  content: url('/appIcon3_hover.png');
}

.collect-count {
  font-weight: 400;
  line-height: 1;
}

.card-hover-overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, rgba(102, 126, 234, 0.05), rgba(118, 75, 162, 0.05));
  opacity: 0;
  transition: opacity 0.3s;
  pointer-events: none;
  z-index: 1;
}

.mcp-card:hover .card-hover-overlay {
  opacity: 1;
}

@media (max-width: 1200px) {
  .apps-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 768px) {
  .my-mcps-main {
    padding: 16px;
  }

  .page-top-row,
  .section-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .section-header {
    gap: 12px;
    margin-bottom: 16px;
  }

  .apps-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
  }

  .card-header {
    height: 120px;
    padding: 12px 25px;
  }

  .app-name {
    font-size: 18px;
  }
}

@media (max-width: 600px) {
  .my-mcps-main {
    padding: 12px;
  }

  .section-container {
    margin-bottom: 28px;
  }

  .section-title {
    width: 100%;
    font-size: 22px;
  }

  .sort-btn {
    flex: 1 1 0;
  }

  .apps-grid {
    grid-template-columns: 1fr;
  }

  .mcp-card {
    min-height: 220px;
  }

  .card-footer {
    align-items: stretch;
    flex-direction: column;
    gap: 8px;
  }

  .stats-left {
    grid-template-columns: 1fr;
    width: 100%;
  }

  .card-actions {
    justify-content: flex-end;
    width: 100%;
  }
}
</style>
