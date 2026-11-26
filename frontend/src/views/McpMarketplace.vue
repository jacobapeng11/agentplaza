<template>
  <div class="mcp-market-page">
    <PlazaHeader @create="goPublish" />

    <main class="market-main">
      <div class="market-top-row">
        <Breadcrumb :items="breadcrumbItems" />
        <el-button v-if="currentUserIsAdmin" type="primary" :icon="Plus" class="publish-btn" @click="goPublish">发布MCP</el-button>
      </div>

      <div class="mcp-top-section">
        <McpMySection
          :created="myCreatedItems"
          :collected="myCollectedItems"
          :loading="mySectionLoading"
          :sort-type="currentSort as 'hot' | 'latest'"
          @service-click="openDetail"
          @view-created="showMyCreated"
          @view-collected="showMyCollected"
          @favorite="toggleFavorite"
        />
      </div>

      <StickyHeader
        :title="scopeTitle"
        v-model="searchKeyword"
        :categories="marketCategories"
        :current-category="currentCategory"
        :current-sort="currentSort"
        :search-placeholder="mcpSearchPlaceholder"
        @category-change="handleCategoryChange"
        @search="handleSearch"
        @sort-change="handleSortChange"
      />

      <section class="mcp-list" v-loading="loading">
        <div v-if="groupedSections.length > 0" class="categories-wrapper">
          <div v-for="section in groupedSections" :key="section.id" class="category-section">
            <div class="section-header">
              <h3 class="section-title"><span class="title-text">{{ section.name }}</span></h3>
              <span class="section-count">{{ section.items.length }} &#20010; MCP</span>
            </div>

            <div class="apps-grid">
              <article
                v-for="item in section.items"
                :key="item.id"
                class="mcp-card"
                role="button"
                tabindex="0"
                :aria-label="`打开 ${item.displayName}`"
                @click="openDetail(item.id)"
                @keydown.enter="openDetail(item.id)"
                @keydown.space.prevent="openDetail(item.id)"
              >
                <div class="card-summary">
                  <div class="card-avatar">
                    <img class="mcp-icon" :src="getMcpAvatarUrl(item)" alt="MCP" />
                  </div>
                  <div class="card-copy">
                    <div class="card-title-row">
                      <h3 class="card-app-name" :title="item.displayName">{{ item.displayName }}</h3>
                      <div v-if="currentUserIsAdmin || item.isPinned" class="status-badges">
                        <el-tooltip v-if="currentUserIsAdmin" :content="item.isPinned ? unpinText : pinText" placement="top">
                          <button
                            class="pin-button"
                            :class="{ 'is-pinned': item.isPinned }"
                            type="button"
                            @click.stop="togglePinned(item)"
                          >
                            {{ item.isPinned ? unpinText : pinText }}
                          </button>
                        </el-tooltip>
                        <span v-else-if="item.isPinned" class="pin-badge">{{ pinText }}</span>
                      </div>
                    </div>
                    <p class="creator-line" :title="ownerText(item)">{{ ownerText(item) }}</p>
                    <p class="card-description" :title="item.summary || item.description">
                      {{ item.summary || item.description || emptyDescriptionText }}
                    </p>
                  </div>
                </div>

                <div class="card-tags" aria-label="MCP 标签">
                  <span class="tag-item tag-0">{{ categoryName(item.category) }}</span>
                  <span
                    v-for="(tag, index) in displayTags(item)"
                    :key="tag"
                    class="tag-item"
                    :class="'tag-' + ((index + 1) % 4)"
                  >{{ tag }}</span>
                </div>

                <div class="card-footer">
                  <div class="stats-left">
                    <div class="stat-item">
                      <img class="stat-icon" src="/appIcon1.png" alt="visibility" />
                      <span>{{ getVisibilityLabel(item.visibilityMode) }}</span>
                    </div>

                  </div>
                    <span class="view-count" :title="hotText">
                      <el-icon><View /></el-icon>
                      <span>{{ item.viewCount || 0 }}</span>
                    </span>
                  <div class="card-actions">
                    <el-tooltip :content="favoriteText" placement="top">
                      <button class="collect-button" type="button" @click.stop="toggleFavorite(item.id)">
                        <img class="collect-icon" :src="item.isCollected ? '/appIcon3_active.png' : '/appIcon3.png'" alt="favorite" />
                        <span class="collect-count">{{ item.favoriteCount || item.collectCount || 0 }}</span>
                      </button>
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

              </article>
            </div>
          </div>
        </div>

        <el-empty v-else :description="emptyMarketText" />
      </section>
    </main>

  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, Edit, Plus, View } from '@element-plus/icons-vue'
import PlazaHeader from '../components/plaza/PlazaHeader.vue'
import Breadcrumb from '../components/common/Breadcrumb.vue'
import StickyHeader from '../components/plaza/StickyHeader.vue'
import McpMySection from '../components/mcp/McpMySection.vue'
import { useAppsStore } from '../stores/apps'
import { mcpApi } from '../api/mcp'
import { getMcpAvatarUrl, getMcpSourceTypeLabel, getOwnerText, getVisibilityLabel } from '../utils/mcpPresentation'
import { isAppAdmin } from '../config/adminConfig'
import type { Category } from '../types/agent'
import type { McpListItem, McpSyncStatus, McpTransport } from '../types/mcp'

const router = useRouter()
const appsStore = useAppsStore()
const loading = ref(false)
const catalogItems = ref<McpListItem[]>([])
const myCreatedItems = ref<McpListItem[]>([])
const myCollectedItems = ref<McpListItem[]>([])
const mySectionLoading = ref(false)
const listScope = ref<'market' | 'created' | 'collected'>('market')
const searchKeyword = ref('')
const currentCategory = ref('all')
const currentSort = ref(localStorage.getItem('mcp_market_sort') || 'latest')
const HOT_RECOMMEND_LIMIT = 4

const text = {
  plaza: '\u667a\u80fd\u4f53\u5e7f\u573a',
  market: 'MCP \u5e02\u573a',
  myCreated: '\u6211\u521b\u5efa\u7684 MCP',
  myCollected: '\u6211\u6536\u85cf\u7684 MCP',
  recommend: '\u63a8\u8350',
  marketplace: '\u5927\u5e02\u573a',
  finance: '\u8d22\u7ecf\u7c7b',
  office: '\u529e\u516c\u7c7b',
  admin: '\u884c\u653f\u7c7b',
  dev: '\u7814\u53d1\u7c7b',
  general: '\u7efc\u5408\u7c7b',
  unknownPublisher: '\u672a\u77e5\u53d1\u5e03\u8005',
  creating: '\u521b\u5efa\u4e2d',
  public: '\u516c\u5f00',
  private: '\u79c1\u6709',
  never: '\u5c1a\u672a',
  updated: '\u66f4\u65b0',
  detail: '\u8be6\u60c5',
  edit: '\u7f16\u8f91',
  delete: '\u5220\u9664',
  favorite: '\u6536\u85cf',
  pin: '置顶',
  unpin: '取消置顶',
  pinned: 'MCP 已置顶',
  unpinned: 'MCP 已取消置顶',
  emptyDescription: '\u6682\u65e0\u670d\u52a1\u8bf4\u660e',
  emptyMarket: '\u6682\u65e0\u53ef\u89c1 MCP \u670d\u52a1',
  confirmTitle: '\u5220\u9664 MCP',
  confirmPrefix: '\u786e\u5b9a\u5220\u9664 MCP\u300c',
  confirmSuffix: '\u300d\u5417\uff1f\u5220\u9664\u540e\u4f1a\u540c\u6b65\u79fb\u9664 Higress \u4e2d\u7684 MCP Server \u548c\u670d\u52a1\u6765\u6e90\u3002',
  cancel: '\u53d6\u6d88',
  deleted: 'MCP \u5df2\u5220\u9664'
}

const emptyDescriptionText = text.emptyDescription
const emptyMarketText = text.emptyMarket
const editText = text.edit
const deleteText = text.delete
const favoriteText = text.favorite
const pinText = text.pin
const unpinText = text.unpin
const hotText = '使用次数'
const mcpSearchPlaceholder = '\u641c\u7d22 MCP 名称、摘要、说明或服务标识'

const fallbackCategories: Category[] = [
  { id: 'all', name: text.recommend, icon: '' },
  { id: text.marketplace, name: text.marketplace, icon: '' },
  { id: text.finance, name: text.finance, icon: '' },
  { id: text.office, name: text.office, icon: '' },
  { id: text.admin, name: text.admin, icon: '' },
  { id: text.dev, name: text.dev, icon: '' },
  { id: text.general, name: text.general, icon: '' }
]

const breadcrumbItems = [{ label: text.plaza, path: '/' }, { label: text.market }]
const scopeTitle = computed(() => listScope.value === 'created' ? text.myCreated : listScope.value === 'collected' ? text.myCollected : text.market)

const marketCategories = computed<Category[]>(() => {
  const loaded = appsStore.categories.length ? appsStore.categories : fallbackCategories
  const hasAll = loaded.some(category => category.id === 'all')
  return hasAll ? loaded : [{ id: 'all', name: text.recommend, icon: '' }, ...loaded]
})

const visibleItems = computed(() => {
  const items = [...catalogItems.value]
  if (currentSort.value === 'latest') {
    return items.sort((a, b) => comparePinned(a, b) || new Date(b.createdAt || b.updatedAt).getTime() - new Date(a.createdAt || a.updatedAt).getTime())
  }
  return items.sort(compareHotItems)
})

const groupedSections = computed(() => {
  if (currentCategory.value !== 'all') {
    return [{ id: currentCategory.value, name: categoryName(currentCategory.value), items: visibleItems.value }].filter(section => section.items.length > 0)
  }

  const hotItems = hotRecommendItems.value
  const hotItemIds = new Set(hotItems.map(item => item.id))
  const groups = new Map<string, McpListItem[]>()
  visibleItems.value.forEach(item => {
    if (hotItemIds.has(item.id)) return
    const key = item.category || item.newType || text.general
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)?.push({ ...item, isPinned: false, pinnedAt: null })
  })

  const categorySections = marketCategories.value
    .filter(category => category.id !== 'all')
    .map(category => ({ id: category.id, name: category.name, items: groups.get(category.id) || [] }))
    .filter(section => section.items.length > 0)

  return hotItems.length
    ? [{ id: 'hot', name: '\u70ed\u95e8\u63a8\u8350', items: hotItems }, ...categorySections]
    : categorySections
})

function statusWeight(status: McpSyncStatus) {
  const weights: Record<McpSyncStatus, number> = { active: 5, updating: 4, creating: 3, failed: 2, deleting: 1 }
  return weights[status] || 0
}

const currentUserIsAdmin = computed(() => isAppAdmin())

function canManage() { return currentUserIsAdmin.value }
function ownerText(item: McpListItem) { return getOwnerText(item) }
function comparePinned(a: McpListItem, b: McpListItem) {
  const pinnedDelta = Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned))
  if (pinnedDelta) return pinnedDelta
  if (a.isPinned && b.isPinned) {
    return new Date(b.pinnedAt || 0).getTime() - new Date(a.pinnedAt || 0).getTime()
  }
  return 0
}
function compareHotItems(a: McpListItem, b: McpListItem) {
  const pinnedDelta = comparePinned(a, b)
  if (pinnedDelta) return pinnedDelta

  const favoriteDelta = (b.favoriteCount || b.collectCount || 0) - (a.favoriteCount || a.collectCount || 0)
  if (favoriteDelta) return favoriteDelta

  const viewDelta = (b.viewCount || 0) - (a.viewCount || 0)
  if (viewDelta) return viewDelta

  return statusWeight(b.syncStatus) - statusWeight(a.syncStatus)
}

const hotRecommendItems = computed(() => {
  if (currentCategory.value !== 'all') return []

  const pinnedItems = catalogItems.value
    .filter(item => item.isPinned)
    .sort(comparePinned)
  const regularItems = catalogItems.value
    .filter(item => !item.isPinned)
    .sort(compareHotItems)
  const fillCount = Math.max(0, HOT_RECOMMEND_LIMIT - pinnedItems.length)

  return [...pinnedItems, ...regularItems.slice(0, fillCount)]
})

function transportText(value: McpTransport) { return value === 'sse' ? 'SSE' : 'Streamable HTTP' }
function displayTags(item: McpListItem) {
  const transportTags = item.higressMcpType === 'OPEN_API' ? ['Streamable HTTP', 'SSE'] : [transportText(item.transport)]
  return Array.from(new Set([...transportTags, getMcpSourceTypeLabel(item.higressMcpType), ...(item.tags || [])])).slice(0, 2)
}
function categoryName(categoryId?: string) { return marketCategories.value.find(item => item.id === categoryId)?.name || categoryId || text.general }
function formatDate(value?: string | null) { return value ? new Date(value).toLocaleDateString() : text.never }

function buildListParams() {
  return {
    search: searchKeyword.value.trim(),
    category: currentCategory.value,
    sortBy: currentSort.value === 'latest' ? 'createdAt' : 'hot'
  }
}

async function loadScopedList(scope = listScope.value) {
  loading.value = true
  try {
    const params = buildListParams()
    const response: any = scope === 'created'
      ? await mcpApi.getMyCreated(params)
      : scope === 'collected'
        ? await mcpApi.getMyCollected(params)
        : await mcpApi.getCatalog(params)
    catalogItems.value = response.data.items || []
  } finally {
    loading.value = false
  }
}

async function loadCatalog() {
  listScope.value = 'market'
  await loadScopedList('market')
}

async function loadMySection() {
  mySectionLoading.value = true
  try {
    const [createdResponse, collectedResponse]: any[] = await Promise.all([
      mcpApi.getMyCreated(),
      mcpApi.getMyCollected()
    ])
    myCreatedItems.value = createdResponse.data.items || []
    myCollectedItems.value = collectedResponse.data.items || []
  } finally {
    mySectionLoading.value = false
  }
}

async function showMyCreated() {
  router.push('/my-mcps?tab=created')
}

async function showMyCollected() {
  router.push('/my-mcps?tab=collected')
}

function patchFavoriteState(result: { id: string; isCollected: boolean; favoriteCount: number; collectCount: number }) {
  const patch = (item: McpListItem) => item.id === result.id
    ? { ...item, isCollected: result.isCollected, favoriteCount: result.favoriteCount, collectCount: result.collectCount }
    : item
  catalogItems.value = catalogItems.value.map(patch)
  myCreatedItems.value = myCreatedItems.value.map(patch)
  myCollectedItems.value = result.isCollected
    ? myCollectedItems.value.map(patch)
    : myCollectedItems.value.filter(item => item.id !== result.id)
}

async function toggleFavorite(id: string) {
  const response: any = await mcpApi.toggleFavorite(id)
  patchFavoriteState(response.data)
  await loadMySection()
}

function patchPinnedState(result: { id: string; isPinned: boolean; pinnedAt: string | null }) {
  const patch = (item: McpListItem) => item.id === result.id
    ? { ...item, isPinned: result.isPinned, pinnedAt: result.pinnedAt }
    : item
  catalogItems.value = catalogItems.value.map(patch)
  myCreatedItems.value = myCreatedItems.value.map(patch)
  myCollectedItems.value = myCollectedItems.value.map(patch)
}

async function togglePinned(item: McpListItem) {
  const response: any = await mcpApi.togglePinned(item.id, !item.isPinned)
  patchPinnedState(response.data)
  ElMessage.success(response.data.isPinned ? text.pinned : text.unpinned)
}

async function handleCategoryChange(categoryId: string) { currentCategory.value = categoryId; await loadScopedList() }
async function handleSearch(keyword: string) { searchKeyword.value = keyword; await loadScopedList() }
async function handleSortChange(sortType: string) { currentSort.value = sortType; localStorage.setItem('mcp_market_sort', sortType); await loadScopedList() }
function openDetail(id: string) { router.push('/mcp/server/' + id) }
function editService(id: string) { router.push('/mcp/publish/' + id) }

async function deleteService(item: McpListItem) {
  await ElMessageBox.confirm(text.confirmPrefix + item.displayName + text.confirmSuffix, text.confirmTitle, { type: 'warning', confirmButtonText: text.delete, cancelButtonText: text.cancel })
  await mcpApi.deleteMyService(item.id)
  ElMessage.success(text.deleted)
  await loadCatalog()
  await loadMySection()
}

function goPublish() { router.push('/mcp/publish') }

onMounted(async () => {
  if (!appsStore.categories.length) await appsStore.fetchCategories()
  await Promise.all([loadCatalog(), loadMySection()])
})
</script>

<style scoped lang="scss">
.mcp-market-page { min-height: 100vh; background-image: url('/bj.png'); background-size: cover; background-position: center; background-attachment: fixed; }
.market-main { max-width: 1680px; margin: 0 auto; padding: 24px; width: 100%; box-sizing: border-box; }
.market-top-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 8px; }
.mcp-top-section { position: relative; margin-bottom: 6px; padding: 0; border: 0; border-radius: 0; background: transparent; }
.publish-btn { border: none; border-radius: 10px; height: 38px; min-width: 114px; padding: 0 16px; font-weight: 600; background: linear-gradient(135deg, #3B82F6 0%, #2563EB 100%); box-shadow: 0 2px 8px rgba(59, 130, 246, 0.2); }
.mcp-list { margin-top: 12px; min-height: 300px; }
.categories-wrapper { display: flex; flex-direction: column; gap: 40px; }
.category-section .section-header { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
.section-title { font-size: 20px; font-weight: bold; margin: 0; display: flex; align-items: baseline; gap: 8px; font-family: var(--font-alimama); position: relative; z-index: 1; }
.title-text { display: inline-block; position: relative; z-index: 1; padding: 0 6px; background: linear-gradient(180deg, #33AAFF 3%, #3366FF 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
.title-text::before { content: ''; position: absolute; left: 0; right: 0; height: 22px; top: 15px; background: #08FFDE; filter: blur(12px); opacity: 0.7; z-index: 0; border-radius: 50%; pointer-events: none; }
.section-count { color: #909399; font-size: 13px; }
.apps-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 20px; }
.mcp-card { position: relative; min-height: 240px; background: #fff; border-radius: 12px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08); overflow: hidden; cursor: pointer; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); display: flex; flex-direction: column; }
.mcp-card:hover { transform: translateY(-4px); box-shadow: 0 8px 20px rgba(0, 0, 0, 0.12); }
.pin-button { position: absolute; top: 18px; right: 18px; z-index: 4; height: 26px; padding: 4px 12px; border: 1px solid rgba(37, 99, 235, 0.28); border-radius: 4px; background: rgba(255, 255, 255, 0.92); color: #2563eb; font-size: 12px; font-weight: 600; line-height: 16px; cursor: pointer; box-shadow: 0 2px 6px rgba(37, 99, 235, 0.16); }
.pin-button:hover { border-color: #2563eb; background: #eff6ff; }
.pin-button.is-pinned { border: none; background: linear-gradient(135deg, #ff6b35 0%, #ff8c42 100%); color: #fff; box-shadow: 0 2px 6px rgba(255, 107, 53, 0.3); }
.card-header { position: relative; height: 120px; display: flex; justify-content: space-between; align-items: center; padding: 16px 30px; }
.header-background { position: absolute; top: 8px; bottom: 8px; left: 10px; right: 10px; width: calc(100% - 20px); height: calc(100% - 16px); background-size: cover; background-position: center; border-radius: 8px 8px 0 0; z-index: 0; }
.header-background.bg-variant-0 { background-image: url('/app_bj1.png'); }
.header-background.bg-variant-1 { background-image: url('/app_bj2.png'); }
.header-background.bg-variant-2 { background-image: url('/app_bj3.png'); }
.header-background.bg-variant-3 { background-image: url('/app_bj4.png'); }
.app-name-wrapper { position: relative; z-index: 1; display: inline-flex; max-width: calc(100% - 120px); margin-right: 12px; border-radius: 8px; padding: 6px 0; backdrop-filter: blur(10px); flex-direction: column; }
.app-name { font-family: var(--font-alimama); font-size: 24px; font-weight: bold; color: #fff; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.4; }
.creator-badge { font-family: PingFang SC; font-size: 14px; font-weight: 600; background: #fff; border-radius: 8px; width: max-content; max-width: 100%; padding: 2px 8px; margin-top: 8px; color: #3B66D6; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card-avatar { position: relative; z-index: 1; height: 90px; flex-shrink: 0; }
.mcp-icon { width: 90px; height: 90px; object-fit: cover; border-radius: 8px; background: rgba(255, 255, 255, 0.3); }
.card-body { flex: 1; padding: 0 16px; display: flex; flex-direction: column; gap: 8px; background-color: #fff; }
.card-app-name { font-family: PingFang SC; font-size: 16px; font-weight: 600; color: #303133; margin: 0 0 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.4; }
.card-tags { display: flex; flex-wrap: wrap; gap: 8px; min-height: 28px; }
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
.card-description { font-size: 13px; color: #888F99; line-height: 16px; margin: 0; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; text-overflow: ellipsis; word-break: break-all; }
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
.stat-item { display: flex; align-items: flex-start; gap: 4px; font-size: 12px; color: #999; white-space: normal; line-height: 1.4; min-width: 0; }
.stat-item span { overflow-wrap: anywhere; word-break: break-word; }
.stat-icon { width: 13px; height: 13px; }
.card-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  flex-wrap: nowrap;
}
.view-count { display: inline-flex; align-items: center; gap: 4px; color: #999; font-size: 12px; line-height: 1; }
.action-button { width: 28px; height: 28px; display: inline-grid; place-items: center; border: 0; border-radius: 8px; color: #8b97aa; background: transparent; cursor: pointer; }
.action-button:hover { color: #3366FF; background: #eef4ff; }
.action-button.danger:hover { color: #e34d59; background: #fff1f0; }
.collect-button { display: flex; align-items: center; gap: 4px; height: 28px; border: 0; background: transparent; color: #999; cursor: pointer; padding: 0 2px; font-size: 12px; }
.collect-icon { width: 13px; height: 13px; transition: all 0.3s; }
.collect-button:hover .collect-icon { content: url('/appIcon3_hover.png'); }
.collect-count { font-weight: 400; line-height: 1; }
.card-hover-overlay { position: absolute; inset: 0; background: linear-gradient(135deg, rgba(102, 126, 234, 0.05), rgba(118, 75, 162, 0.05)); opacity: 0; transition: opacity 0.3s; pointer-events: none; z-index: 1; }
.mcp-card:hover .card-hover-overlay { opacity: 1; }
@media (max-width: 1200px) {
  .apps-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .apps-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 768px) {
  .market-main {
    padding: 16px;
  }

  .market-top-row {
    align-items: flex-start;
    flex-direction: column;
  }

  .publish-btn {
    width: 100%;
  }

  .mcp-top-section {
    background: none !important;
    padding: 0;
  }

  .categories-wrapper {
    gap: 32px;
  }

  .category-section .section-header {
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
  }

  .section-title {
    font-size: 18px;
  }

  .apps-grid {
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
  .market-main {
    padding: 12px;
  }

  .apps-grid {
    grid-template-columns: 1fr;
  }

  .mcp-card {
    min-height: 220px;
  }

  .pin-button {
    top: 14px;
    right: 14px;
  }

  .card-header {
    padding: 12px 22px;
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

/* MCP 市场卡片与智能体广场统一为紧凑信息卡片。 */
.apps-grid {
  grid-template-columns: repeat(auto-fill, minmax(270px, 1fr));
  gap: 16px;
}

.mcp-card {
  min-width: 0;
  min-height: 168px;
  padding: 18px 20px;
  overflow: hidden;
  border: 1px solid #cfe8f1;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 8px 24px rgba(47, 104, 126, 0.06);
  box-sizing: border-box;
  transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
}

.mcp-card:hover,
.mcp-card:focus-visible {
  transform: translateY(-2px);
  border-color: #72c9e8;
  box-shadow: 0 12px 28px rgba(37, 120, 151, 0.12);
  outline: none;
}

.card-summary {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}

.card-avatar {
  position: static;
  z-index: auto;
  width: 56px;
  height: 56px;
  flex: 0 0 56px;
}

.mcp-icon {
  width: 56px;
  height: 56px;
  object-fit: cover;
  border: 1px solid #d9edf4;
  border-radius: 14px;
  background: #f5fbfd;
  box-sizing: border-box;
}

.card-copy {
  min-width: 0;
  flex: 1;
}

.card-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.card-app-name {
  min-width: 0;
  flex: 1;
  margin: 0;
  overflow: hidden;
  color: #15384a;
  font-family: PingFang SC, sans-serif;
  font-size: 16px;
  font-weight: 600;
  line-height: 22px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-badges {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
}

.pin-button,
.pin-badge {
  position: static;
  inset: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  box-shadow: none;
  box-sizing: border-box;
}

.pin-button {
  border: 1px solid #b8d4ff;
  background: #eef5ff;
  color: #3976e8;
}

.pin-button:hover {
  border-color: #6da1f5;
  background: #e4efff;
}

.pin-button.is-pinned,
.pin-badge {
  border: 0;
  background: #fff0e8;
  color: #f06a2f;
}

.creator-line {
  margin: 2px 0 0;
  overflow: hidden;
  color: #77909b;
  font-size: 12px;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-description {
  display: block;
  margin: 2px 0 0;
  overflow: hidden;
  color: #71818a;
  font-size: 13px;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-tags {
  display: flex;
  flex-wrap: nowrap;
  gap: 8px;
  min-height: 24px;
  margin-top: 13px;
  overflow: hidden;
}

.tag-item {
  flex: 0 0 auto;
  max-width: 46%;
  min-height: 0;
  height: 24px;
  padding: 0 10px;
  overflow: hidden;
  line-height: 24px;
  text-overflow: ellipsis;
}

.card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-direction: row;
  gap: 8px;
  min-height: 28px;
  margin-top: auto;
  padding: 10px 0 0;
}

.stats-left {
  display: flex;
  grid-template-columns: none;
  align-items: center;
  gap: 0;
  min-width: 0;
  flex: 1 1 auto;
}

.stat-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  color: #8fa0a8;
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
}

.stat-item span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stat-icon {
  width: 14px;
  height: 14px;
  flex: 0 0 14px;
}

.view-count {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #8fa0a8;
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
}

.view-count .el-icon {
  color: #8fb0bd;
  font-size: 15px;
}

.card-actions {
  width: auto;
  justify-content: flex-start;
  gap: 4px;
}

.collect-button {
  padding: 0 6px;
  border-radius: 8px;
  color: #8fa0a8;
}

.collect-button:hover {
  color: #3976e8;
  background: #eef4ff;
}

.collect-icon {
  width: 14px;
  height: 14px;
}

@media (max-width: 768px) {
  .apps-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .mcp-card {
    min-height: 154px;
    padding: 16px;
  }

  .card-avatar,
  .mcp-icon {
    width: 50px;
    height: 50px;
  }

  .card-avatar {
    flex-basis: 50px;
  }
}

@media (max-width: 480px) {
  .apps-grid {
    grid-template-columns: 1fr;
  }
}
</style>
