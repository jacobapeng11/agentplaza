<template>
  <div class="agent-plaza-container">
    <!-- Header -->
    <PlazaHeader />

    <!-- Main Content -->
    <main class="main-content">
      <!-- 顶部区域：搜索和我的智能体（带背景图） -->
      <div class="top-section-with-bg">
        <!-- 新增：我的智能体双栏布局 -->
        <MyAgentsSection
          :loading="appsStore.loadingAppsNew"
          @view-more-created="() => router.push('/my-agents?tab=created')"
          @view-more-collected="() => router.push('/my-agents?tab=collected')"
          @app-click="handleAppClick"
        />
      </div>

      <!-- 新增：吸顶导航（标题 + 分类 + 排序 + 搜索） -->
      <StickyHeader
        title="智能体广场"
        v-model="searchKeyword"
        :categories="appsStore.categories"
        :current-category="appsStore.currentCategory"
        :current-sort="currentSort"
        :sort-loading="isSortLoading"
        @category-change="handleNewCategoryChange"
        @search="handleNewSearch"
        @sort-change="handleSortChange"
      />

      <!-- 新增：分类应用列表 -->
      <div v-if="appsStore.errorCategoryApps && !appsStore.loadingCategoryApps" role="alert">
        应用加载失败：{{ appsStore.errorCategoryApps }}
        <el-button @click="handleSortChange(currentSort)">重新加载</el-button>
      </div>
      <CategoryAppsList
        v-else
        :apps="categoryAppsDisplay"
        :loading="appsStore.loadingCategoryApps"
        :current-category="appsStore.currentCategory"
        :has-more="hasMoreCategoryApps"
        @app-click="handleAppClick"
        @load-more="handleLoadMoreCategoryApps"
      />
    </main>

    <!-- Collected Modal -->
    <CollectedModal
      :visible="showCollectedModal"
      :agents="allCollectedAgents"
      :loading="collectedLoading"
      :total="collectedPagination.total"
      :has-more="collectedPagination.page < collectedPagination.totalPages"
      @update:visible="showCollectedModal = $event"
      @agent-click="handleAgentClick"
      @load-more="loadMoreCollected"
    />

    <!-- Created Modal -->
    <CreatedModal
      :visible="showCreatedModal"
      :agents="allCreatedAgents"
      :loading="createdLoading"
      :total="createdPagination.total"
      :has-more="createdPagination.page < createdPagination.totalPages"
      @update:visible="showCreatedModal = $event"
      @agent-click="handleAgentClick"
      @load-more="loadMoreCreated"
    />

    <!-- Category Modal -->
    <CategoryModal
      :visible="showCategoryModal"
      :title="currentCategoryTitle"
      :category-icon="currentCategoryIcon"
      :apps="categoryModalApps"
      :loading="categoryModalLoading"
      :has-more="categoryModalHasMore"
      @update:visible="showCategoryModal = $event"
      @load-more="loadMoreCategoryApps"
      @app-click="handleAppClick"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * 智能体广场主页面
 * 整合了页面头部、我的智能体、搜索栏、热门智能体等功能模块
 */
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAppsStore } from '../stores/apps'
import type { Agent } from '../types/agent'
import { debounce } from 'lodash-es'
import { appsNewApi } from '../api/apps'
import PlazaHeader from '../components/plaza/PlazaHeader.vue'
import MyAgentsSection from '../components/plaza/MyAgentsSection.vue'
import CollectedModal from '../components/plaza/CollectedModal.vue'
import CreatedModal from '../components/plaza/CreatedModal.vue'
import StickyHeader from '../components/plaza/StickyHeader.vue'
import CategoryAppsList from '../components/plaza/CategoryAppsList.vue'
import CategoryModal from '../components/plaza/CategoryModal.vue'
import { buildFastgptChatUrl } from '../config/fastgptConfig'
import { ensureAppAccessBeforeOpen } from '../utils/appAccess'

// ========== 状态管理 ==========
const router = useRouter()
const activeTab = ref<'used' | 'created'>('used') // 当前激活的标签页（我创建的/我收藏的）
const hotAgentsSearchQuery = ref('') // 热门智能体搜索关键词
const activeCategory = ref('') // 当前激活的分类
const showCollectedModal = ref(false) // 是否显示收藏应用弹窗
const showCreatedModal = ref(false) // 是否显示创建应用弹窗
const searchKeyword = ref('') // 新设计搜索关键词
const showCategoryModal = ref(false) // 是否显示分类弹窗
const categoryModalApps = ref<any[]>([]) // 分类弹窗应用列表
const categoryModalLoading = ref(false) // 分类弹窗加载状态
const categoryModalPage = ref(1) // 分类弹窗当前页
const categoryModalHasMore = ref(true) // 是否还有更多
const CATEGORY_PAGE_SIZE = 20
// 从 localStorage 读取上次的排序设置，默认为 'latest'
const currentSort = ref(localStorage.getItem('plaza_sort_preference') || 'latest') // 当前排序方式: hot-热度优先, latest-最新优先
const isSortLoading = ref(false) // 最新/最热切换时的显式加载状态
const allCollectedAgents = ref<any[]>([]) // 全部收藏的应用列表
const allCreatedAgents = ref<any[]>([]) // 全部创建的应用列表
const collectedLoading = ref(false) // 收藏应用加载状态
const createdLoading = ref(false) // 创建应用加载状态
// 收藏应用分页信息
const collectedPagination = ref({
  page: 1,
  limit: 20,
  total: 0,
  totalPages: 0,
})

// 创建应用分页信息
const createdPagination = ref({
  page: 1,
  limit: 20,
  total: 0,
  totalPages: 0,
})

const appsStore = useAppsStore()

// ========== 计算属性 ==========
// 用户认证相关
const isLoggedIn = computed(() => appsStore.isLoggedIn)

// 智能体数据
const myCreatedAgents = computed(() => appsStore.myCreatedAgents)
const myCollectedAgents = computed(() => appsStore.myCollectedAgents)
const hotAgents = computed(() => appsStore.hotAgents)
const hotAgentsPage = computed(() => appsStore.hotAgentsPage)
const hotAgentsPageSize = computed(() => appsStore.hotAgentsPageSize)
const hotAgentsTotal = computed(() => appsStore.hotAgentsTotal)

/**
 * 根据当前标签页获取要显示的智能体列表
 * 最多显示6个
 */
const displayedAgents = computed(() => {
  if (activeTab.value === 'used') {
    return myCreatedAgents.value.slice(0, 6) // 显示前6个创建的智能体
  } else {
    return myCollectedAgents.value.slice(0, 6) // 显示前6个收藏的智能体
  }
})

// ========== 标签页切换相关 ==========
/**
 * 切换标签页（我创建的/我收藏的）
 * @param tab - 目标标签页
 */
const switchTab = async (tab: 'used' | 'created') => {
  activeTab.value = tab
  appsStore.updateActiveTab(tab)

  // 根据标签页加载不同的数据
  if (tab === 'used') {
    // 加载用户创建的智能体
    try {
      await appsStore.fetchUserCreatedAgents(6)
    } catch (error) {
      console.error('加载创建的智能体失败:', error)
    }
  } else if (tab === 'created') {
    // 加载用户收藏的智能体
    try {
      await appsStore.fetchMyCollectedAgents(6)
    } catch (error) {
      console.error('加载收藏智能体失败:', error)
    }
  }
}

// ========== 收藏相关 ==========
/**
 * 切换智能体收藏状态
 * @param agent - 智能体对象
 */
const toggleCollect = async (agent: any) => {
  try {
    console.log('切换收藏状态:', agent.name)
    await appsStore.toggleCollect(agent._id, agent)
  } catch (error) {
    console.error('切换收藏状态失败:', error)
  }
}

// ========== 搜索相关 ==========
/**
 * 防抖搜索热门智能体
 * 300ms 延迟执行，避免频繁请求
 */
const debouncedSearchHotAgents = debounce(
  async (searchQuery: string, category: string) => {
    try {
      console.log('搜索热门智能体:', searchQuery, '分类:', category)
      await appsStore.fetchHotAgents(15, searchQuery, 1, category) // 重置到第1页
    } catch (error) {
      console.error('搜索热门智能体失败:', error)
    }
  },
  300
)

/**
 * 处理热门智能体搜索
 */
const handleHotAgentsSearch = () => {
  debouncedSearchHotAgents(hotAgentsSearchQuery.value, activeCategory.value)
}

/**
 * 清除热门智能体搜索
 * 重新加载第一页数据
 */
const handleHotAgentsSearchClear = async () => {
  hotAgentsSearchQuery.value = ''
  try {
    console.log('清除搜索，重新加载热门智能体')
    await appsStore.fetchHotAgents(15, '', 1, activeCategory.value) // 重置到第1页
  } catch (error) {
    console.error('重置热门智能体失败:', error)
  }
}

// ========== 分类相关 ==========
/**
 * 处理分类切换
 * @param category - 选中的分类
 */
const handleCategoryChange = async (category: string) => {
  activeCategory.value = category
  try {
    console.log('切换分类:', category)
    await appsStore.fetchHotAgents(15, hotAgentsSearchQuery.value, 1, category) // 重置到第1页
  } catch (error) {
    console.error('切换分类失败:', error)
  }
}

// ========== 新设计分类和搜索相关 ==========
/**
 * 处理新设计的分类切换
 * @param categoryId - 分类ID
 */
const handleNewCategoryChange = async (categoryId: string) => {
  try {
    console.log('切换新分类:', categoryId)
    // 清空搜索结果
    searchKeyword.value = ''
    appsStore.setCurrentCategory(categoryId)
    // 根据排序方式加载数据
    await loadCategoryApps(categoryId, currentSort.value)
  } catch (error) {
    console.error('切换新分类失败:', error)
  }
}

/**
 * 处理排序切换
 * @param sortType - 排序类型
 */
const handleSortChange = async (sortType: string) => {
  if (isSortLoading.value || sortType === currentSort.value) return

  isSortLoading.value = true
  try {
    console.log('切换排序:', sortType)
    currentSort.value = sortType
    // 保存排序偏好到 localStorage
    localStorage.setItem('plaza_sort_preference', sortType)
    // 重新加载当前分类数据
    await loadCategoryApps(appsStore.currentCategory, sortType)
  } catch (error) {
    console.error('切换排序失败:', error)
  } finally {
    isSortLoading.value = false
  }
}

/**
 * 加载分类应用数据
 * @param categoryId - 分类ID
 * @param sortType - 排序类型
 */
const loadCategoryApps = async (categoryId: string, sortType: string, page: number = 1) => {
  const append = page > 1
  if (!append) {
    // 切换分类或排序时重置分页；滚动加载时保留现有卡片。
    appsStore.clearCategoryCache(categoryId)
  }
  
  // 加载数据并传递排序参数
  await appsStore.fetchCategoryApps(categoryId, { 
    page,
    limit: CATEGORY_PAGE_SIZE,
    sortBy: sortType === 'latest' ? 'createdAt' : 'hotScore',
    append
  })
}

/**
 * 处理新设计的搜索
 * @param keyword - 搜索关键词
 */
const handleNewSearch = async (keyword: string) => {
  try {
    console.log('搜索应用:', keyword)
    if (keyword.trim()) {
      // 搜索时也传递当前的排序参数
      const sortBy = currentSort.value === 'latest' ? 'createdAt' : 'hotScore'
      await appsStore.searchApps(keyword, sortBy)
    } else {
      // 如果搜索关键词为空，重新加载当前分类
      await loadCategoryApps(appsStore.currentCategory, currentSort.value, 1)
    }
  } catch (error) {
    console.error('搜索应用失败:', error)
  }
}

/**
 * 加载分类弹窗应用数据
 * @param categoryId - 分类ID
 */
const loadCategoryModalApps = async (categoryId: string) => {
  if (categoryModalLoading.value) return

  try {
    categoryModalLoading.value = true
    const response: any = await appsNewApi.getCategoryApps(categoryId, {
      page: categoryModalPage.value,
      limit: 20,
    })

    let apps = response.data || []

    // 根据当前排序方式对应用进行排序
    if (Array.isArray(apps) && apps.length > 0) {
      if (currentSort.value === 'latest') {
        // 最新优先：按更新时间（updateTime）倒序
        apps = [...apps].sort((a, b) => {
          const dateA = a.updateTime ? new Date(a.updateTime).getTime() : 0
          const dateB = b.updateTime ? new Date(b.updateTime).getTime() : 0
          return dateB - dateA
        })
      } else {
        // 热度优先：优先按用户使用人数（userCount）排序
        apps = [...apps].sort((a, b) => {
          const userCountA = a.userCount || 0
          const userCountB = b.userCount || 0

          if (userCountA !== userCountB) {
            return userCountB - userCountA
          }

          // 如果 userCount 相同，使用 hotScore
          return (b.hotScore || 0) - (a.hotScore || 0)
        })
      }
    }

    if (categoryModalPage.value === 1) {
      categoryModalApps.value = apps
    } else {
      categoryModalApps.value.push(...apps)
    }

    // 检查是否还有更多
    const pagination = response.pagination
    if (pagination) {
      categoryModalHasMore.value = pagination.page < pagination.totalPages
    } else {
      categoryModalHasMore.value = false
    }
  } catch (error) {
    console.error('加载分类应用失败:', error)
  } finally {
    categoryModalLoading.value = false
  }
}

/**
 * 加载分类弹窗更多数据
 */
const loadMoreCategoryApps = async () => {
  if (!categoryModalHasMore.value || categoryModalLoading.value) return

  categoryModalPage.value += 1
  await loadCategoryModalApps(appsStore.currentCategory)
}

/**
 * 显示的分类应用列表（搜索结果或分类应用）
 * 注意：排序已经在后端完成，前端只需要直接显示
 */
const categoryAppsDisplay = computed(() => {
  let apps = []

  if (searchKeyword.value.trim()) {
    // 如果有搜索关键词，显示搜索结果
    apps = appsStore.searchResults || []
  } else {
    // 否则显示当前分类的应用
    const currentCat = appsStore.currentCategory
    apps = appsStore.categoryApps?.[currentCat] || []
  }

  // 确保 apps 是数组
  if (!Array.isArray(apps)) {
    return []
  }

  // 过滤掉无效数据
  const validApps = apps.filter((app) => app && app._id)

  // 后端已经按照 sortBy 参数排序好了，前端直接返回
  // 置顶应用也已经在后端处理好了顺序
  return validApps
})

const selectedCategoryPagination = computed(() => {
  return appsStore.categoryPagination?.[appsStore.currentCategory] || {
    page: 1,
    limit: CATEGORY_PAGE_SIZE,
    total: categoryAppsDisplay.value.length,
    totalPages: 1
  }
})

const handleLoadMoreCategoryApps = async () => {
  if (
    searchKeyword.value.trim() ||
    appsStore.loadingCategoryApps ||
    !hasMoreCategoryApps.value
  ) {
    return
  }

  await loadCategoryApps(
    appsStore.currentCategory,
    currentSort.value,
    selectedCategoryPagination.value.page + 1
  )
}

/**
 * 是否有更多分类应用
 */
const hasMoreCategoryApps = computed(() => {
  if (searchKeyword.value.trim()) {
    return false
  }

  return selectedCategoryPagination.value.page < selectedCategoryPagination.value.totalPages
})

/**
 * 当前分类标题
 */
const currentCategoryTitle = computed(() => {
  const category = appsStore.categories.find(
    (c) => c.id === appsStore.currentCategory
  )
  return category ? category.name : '全部应用'
})

/**
 * 当前分类图标
 */
const currentCategoryIcon = computed(() => {
  const category = appsStore.categories.find(
    (c) => c.id === appsStore.currentCategory
  )
  return category ? category.icon : '📦'
})

// ========== 分页相关 ==========
/**
 * 处理热门智能体页码切换
 * @param page - 目标页码
 */
const handleHotAgentsPageChange = async (page: number) => {
  try {
    console.log('切换热门智能体页码:', page)
    await appsStore.fetchHotAgents(
      15,
      hotAgentsSearchQuery.value,
      page,
      activeCategory.value
    )
    // 平滑滚动到热门智能体区域
    const hotAgentsSection = document.querySelector('.hot-agents-section')
    if (hotAgentsSection) {
      hotAgentsSection.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  } catch (error) {
    console.error('加载热门智能体页面失败:', error)
  }
}

// ========== 导航相关 ==========
/**
 * 处理智能体卡片点击
 * 在新标签页打开智能体工作区
 * @param agentId - 智能体ID
 */
const handleAgentClick = (agentId: string) => {
  const url = buildFastgptChatUrl(agentId, 'ra')
  if (url) window.open(url, '_blank', 'noopener,noreferrer')
}

/**
 * 处理应用卡片点击（新设计）
 * @param appId - 应用ID
 */
const handleAppClick = async (appId: string) => {
  // 查找对应的应用对象
  let app = null;
  
  // 在我创建的应用中查找
  if (appsStore.myCreatedAppsNew && Array.isArray(appsStore.myCreatedAppsNew)) {
    app = appsStore.myCreatedAppsNew.find((a: any) => a._id === appId);
  }
  
  // 在我收藏的应用中查找
  if (!app && appsStore.myCollectedAppsNew && Array.isArray(appsStore.myCollectedAppsNew)) {
    app = appsStore.myCollectedAppsNew.find((a: any) => a._id === appId);
  }
  
  // 在分类应用中查找
  if (!app) {
    const currentCat = appsStore.currentCategory;
    const categoryAppsList = appsStore.categoryApps?.[currentCat];
    if (categoryAppsList && Array.isArray(categoryAppsList)) {
      app = categoryAppsList.find((a: any) => a._id === appId);
    }
  }
  
  // 在搜索结果中查找
  if (!app && appsStore.searchResults && Array.isArray(appsStore.searchResults)) {
    app = appsStore.searchResults.find((a: any) => a._id === appId);
  }
  
  // 在分类弹窗应用中查找
  if (!app && categoryModalApps.value && Array.isArray(categoryModalApps.value)) {
    app = categoryModalApps.value.find((a: any) => a._id === appId);
  }

  if (!(await ensureAppAccessBeforeOpen(app))) {
    return;
  }
  
  // 检查是否有 appUrl 字段（外链应用）
  const appUrl = app ? (app as any).appUrl : null;
  const isLinkApp = !!appUrl;
  
  // 如果是外链应用，先记录访问
  if (isLinkApp) {
    try {
      await appsStore.trackLinkAppVisit(appId);
    } catch (error) {
      console.error('记录外链应用访问失败:', error);
      // 即使记录失败，也继续打开应用
    }
  }
  
  let url: string;
  if (appUrl) {
    // 外链应用：直接跳转到 appUrl
    url = appUrl;
  } else {
    // 普通应用：跳转到应用详情页
    url = buildFastgptChatUrl(appId, 'ra');
  }
  
  if (url) window.open(url, '_blank', 'noopener,noreferrer');
}

// ========== 收藏应用弹窗相关 ==========
/**
 * 加载所有收藏的应用
 * @param page - 页码，默认为1
 */
const loadAllCollectedAgents = async (page: number = 1) => {
  try {
    collectedLoading.value = true
    const response = await appsStore.loadAllCollectedAgents(
      page,
      collectedPagination.value.limit
    )
    if (page === 1) {
      allCollectedAgents.value = response.apps
    } else {
      allCollectedAgents.value.push(...response.apps)
    }
    collectedPagination.value = response.pagination
  } catch (error) {
    console.error('加载全部收藏应用失败:', error)
  } finally {
    collectedLoading.value = false
  }
}

/**
 * 加载更多收藏应用
 */
const loadMoreCollected = () => {
  if (collectedPagination.value.page < collectedPagination.value.totalPages) {
    loadAllCollectedAgents(collectedPagination.value.page + 1)
  }
}

// ========== 创建应用弹窗相关 ==========
/**
 * 加载所有创建的应用
 * @param page - 页码，默认为1
 */
const loadAllCreatedAgents = async (page: number = 1) => {
  try {
    createdLoading.value = true
    const response = await appsStore.loadAllCreatedAgents(
      page,
      createdPagination.value.limit
    )
    if (page === 1) {
      allCreatedAgents.value = response.agents
    } else {
      allCreatedAgents.value.push(...response.agents)
    }
    createdPagination.value = response.pagination
  } catch (error) {
    console.error('加载全部创建应用失败:', error)
  } finally {
    createdLoading.value = false
  }
}

/**
 * 加载更多创建应用
 */
const loadMoreCreated = () => {
  if (createdPagination.value.page < createdPagination.value.totalPages) {
    loadAllCreatedAgents(createdPagination.value.page + 1)
  }
}

/**
 * 查看全部智能体
 * 根据当前激活的标签页决定显示收藏或创建的应用
 */
const viewAllAgents = () => {
  // 根据当前激活的标签页决定显示什么
  if (activeTab.value === 'created') {
    // 显示全部收藏的应用
    showCollectedModal.value = true
    loadAllCollectedAgents()
  } else {
    // 如果是"我创建的"标签，显示全部创建的应用
    showCreatedModal.value = true
    loadAllCreatedAgents()
  }
}

// ========== 初始化 ==========
/**
 * 组件挂载时初始化数据
 * 加载热门智能体、用户创建的智能体和收藏的智能体
 */
onMounted(async () => {
  try {
    // 读取保存的排序偏好
    const savedSort = localStorage.getItem('plaza_sort_preference') || 'latest'
    currentSort.value = savedSort

    // 四组数据互不依赖，并行加载；分类应用仍按20条首屏加载，后续由滚动分页追加。
    const tasks: Array<[string, Promise<unknown>]> = [
      ['分类列表', appsStore.fetchCategories()],
      ['分类应用', appsStore.fetchCategoryApps('all', {
        page: 1,
        limit: CATEGORY_PAGE_SIZE,
        sortBy: savedSort === 'latest' ? 'createdAt' : 'hotScore'
      })],
      ['我创建的', appsStore.fetchMyCreatedAppsNew()],
      // 拉取我收藏的应用，不传 limit 以在 store 保持完整收藏列表
      ['我收藏的', appsStore.fetchMyCollectedAppsNew()]
    ]
    const results = await Promise.allSettled(tasks.map(([, task]) => task))
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.error(`加载${tasks[index][0]}失败:`, result.reason)
      }
    })
  } catch (error) {
    console.error('加载智能体数据失败:', error)
  }
})
</script>

<style scoped>
.agent-plaza-container {
  overflow-x: clip; 
  min-height: 100%;
  display: flex;
  flex-direction: column;
  background-image: url('/bj.png');
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  background-attachment: fixed;
}

/* Main Content Styles */
.main-content {
  flex: 1;
  padding: 24px;
  max-width: 1680px;
  margin: 0 auto;
  width: 100%;
  box-sizing: border-box;
}

/* 顶部个人应用区：沿用页面底色，只做轻微聚合，避免与广场内容割裂。 */
.top-section-with-bg {
  position: relative;
  margin-bottom: 6px;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
}


.fade-images-enter-active,
.fade-images-leave-active {
  transition: opacity 0.35s cubic-bezier(0.4, 0, 0.2, 1),
    transform 0.35s cubic-bezier(0.4, 0, 0.2, 1);
}

.fade-images-enter-from,
.fade-images-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}


.plaza-title {
  font-size: 28px;
  font-weight: 600;
  color: #1a1a1a;
  margin: 0 0 24px 0;
  text-align: center;
}

.section-title {
  font-size: 22px;
  font-weight: 600;
  color: #1a1a1a;
  margin: 32px 0 20px 0;
}

@media (max-width: 768px) {
  .top-section-with-bg {
    background: none !important;
    margin-bottom: 0;
    padding-bottom: 0;
  }



  .main-content {
    padding: 16px;
  }

  .plaza-title {
    font-size: 24px;
    margin-bottom: 20px;
  }

  .section-title {
    font-size: 20px;
    margin: 24px 0 16px 0;
  }
}
</style>
