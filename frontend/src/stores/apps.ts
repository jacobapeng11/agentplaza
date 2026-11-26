import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Agent, AppNew, Category } from '../types/agent';
import { agentsApi, appsNewApi } from '../api/apps';
import { loginApi } from '../api/login';
import { wecomBotApi } from '../api/wecomBot';
import type { BindWecomUserResponse } from '../types/wecomBot';
import { buildLoginUrl, clearAuthSession, normalizeLoginReturnPath } from '../utils/loginRedirect.ts';
import { logger } from '../utils/logger';
import { createPersonalAppsLoader } from '../utils/personalAppsLoader';

const WECOM_QW_TOKEN_STORAGE_KEY = 'agentplaza_wecom_qw_token';

export const useAppsStore = defineStore('apps', () => {
  // State
  const agents = ref<Agent[]>([]);
  const myFrequentAgents = ref<Agent[]>([]);
  const myCreatedAgents = ref<Agent[]>([]);
  const myCollectedAgents = ref<Agent[]>([]);
  const hotAgents = ref<Agent[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const currentPage = ref(1);
  const pageSize = ref(12);
  const total = ref(0);
  const keyword = ref('');
  const selectedType = ref('');
  const sortBy = ref('hotScore');
  const activeTab = ref<'used' | 'created'>('used');
  
  // Hot agents pagination
  const hotAgentsPage = ref(1);
  const hotAgentsPageSize = ref(15);
  const hotAgentsTotal = ref(0);

  // Computed
  const paginatedAgents = computed(() => {
    const start = (currentPage.value - 1) * pageSize.value;
    return agents.value.slice(start, start + pageSize.value);
  });

  // State for user authentication
  const user = ref<any>(null);
  const isAuthenticated = ref(false);
  const pendingWecomQwToken = ref<string | null>(sessionStorage.getItem(WECOM_QW_TOKEN_STORAGE_KEY));
  const wecomBindingResult = ref<{
    status: 'success' | 'failed';
    data?: BindWecomUserResponse;
    message?: string;
  } | null>(null);

  // Computed properties for authentication
  const isLoggedIn = computed(() => isAuthenticated.value);
  
  // Actions
  const fetchAgents = async (params: {
    page?: number;
    limit?: number;
    keyword?: string;
    type?: string;
    sortBy?: string;
  } = {}) => {
    loading.value = true;
    error.value = null;

    try {
      const queryParams = {
        page: params.page ?? currentPage.value,
        limit: params.limit ?? pageSize.value,
        keyword: params.keyword ?? keyword.value,
        type: params.type ?? selectedType.value,
        sortBy: params.sortBy ?? sortBy.value,
      };

      const response = await agentsApi.getAgents(queryParams);
      agents.value = response.data.agents;
      total.value = response.data.pagination.total;
      currentPage.value = response.data.pagination.page;
      pageSize.value = response.data.pagination.limit;
    } catch (err) {
      error.value = err instanceof Error ? err.message : '获取智能体列表失败';
      logger.error('Error fetching agents:', err);
    } finally {
      loading.value = false;
    }
  };

  const checkAuthStatus = () => {
    const token = localStorage.getItem('token');
    try {
      const userData = JSON.parse(localStorage.getItem('user') || 'null');
      user.value = token ? userData : null;
    } catch {
      clearAuthSession();
      user.value = null;
    }
    isAuthenticated.value = Boolean(user.value);
    return isAuthenticated.value;
  };

  const redirectToLogin = (intendedPath?: string) => {
    window.location.assign(buildLoginUrl(intendedPath));
  };

  /**
   * 暂存企业微信认证链接中的 qw_token。
   * 输入: URL 查询参数中的 qw_token。
   * 输出: 无返回值；sessionStorage 中保留登录前后的绑定上下文。
   */
  const rememberWecomQwToken = (qwToken: string | null | undefined) => {
    const normalized = String(qwToken || '').trim();
    if (!normalized) {
      return;
    }

    pendingWecomQwToken.value = normalized;
    sessionStorage.setItem(WECOM_QW_TOKEN_STORAGE_KEY, normalized);
  };

  /**
   * 绑定暂存的企业微信用户 ID 到当前登录用户。
   * 输入: 无。
   * 输出: 绑定结果；没有待绑定 token 时返回 null。
   */
  const bindPendingWecomQwToken = async () => {
    const qwToken = pendingWecomQwToken.value || sessionStorage.getItem(WECOM_QW_TOKEN_STORAGE_KEY);
    if (!qwToken) {
      return null;
    }

    try {
      const data = await wecomBotApi.bindWecomUser({ qwToken });
      sessionStorage.removeItem(WECOM_QW_TOKEN_STORAGE_KEY);
      pendingWecomQwToken.value = null;
      wecomBindingResult.value = {
        status: 'success',
        data,
        message: '企业微信身份认证成功'
      };
      return wecomBindingResult.value;
    } catch (error) {
      sessionStorage.removeItem(WECOM_QW_TOKEN_STORAGE_KEY);
      pendingWecomQwToken.value = null;
      wecomBindingResult.value = {
        status: 'failed',
        message: error instanceof Error ? error.message : '企业微信身份认证失败'
      };
      return wecomBindingResult.value;
    }
  };

  const completeLoginWithCode = async (code: string, state: string) => {
    const response = await loginApi.completeLogin(code, state);
    if (!response.success || response.code !== 200 || !response.authToken || !response.user) {
      throw new Error('登录响应无效');
    }

    clearAuthSession();
    localStorage.setItem('token', response.authToken);
    localStorage.setItem('userInfo', JSON.stringify(response.userInfo || {}));
    localStorage.setItem('user', JSON.stringify(response.user));
    if (response.userInfo?.Badge) {
      localStorage.setItem('userBadge', String(response.userInfo.Badge));
    }
    user.value = response.user;
    isAuthenticated.value = true;
    return normalizeLoginReturnPath(response.returnTo);
  };

  const logout = () => {
    user.value = null;
    isAuthenticated.value = false;
    clearAuthSession();
    redirectToLogin('/');
  };

  const fetchUserCreatedAgents = async (limit: number = 3) => {
    try {
      const response = await agentsApi.getUserAgents('created', { limit });
      myCreatedAgents.value = response.data.agents;
    } catch (err) {
      error.value = err instanceof Error ? err.message : '获取我创建的智能体失败';
      console.error('Error fetching user created agents:', err);
    }
  };

  const fetchUserFrequentAgents = async (userId: string, limit: number = 3) => {
    try {
      const response = await agentsApi.getFrequentAgents(userId, { limit });
      myFrequentAgents.value = response.data.agents;
    } catch (err) {
      error.value = err instanceof Error ? err.message : '获取我常用的智能体失败';
      console.error('Error fetching user frequent agents:', err);
    }
  };

  const loadAllCollectedAgents = async (page: number = 1, limit: number = 20) => {
    try {
      const response = await agentsApi.getCollectedApps({ page, limit });
      return response.data;
    } catch (err) {
      error.value = err instanceof Error ? err.message : '获取全部收藏智能体失败';
      console.error('Error loading all collected agents:', err);
      throw err;
    }
  };

  const loadAllCreatedAgents = async (page: number = 1, limit: number = 20) => {
    try {
      const response = await agentsApi.getUserAgents('created', { page, limit });
      return response.data;
    } catch (err) {
      error.value = err instanceof Error ? err.message : '获取全部创建智能体失败';
      console.error('Error loading all created agents:', err);
      throw err;
    }
  };

  const fetchMyCollectedAgents = async (limit: number = 6) => {
    try {
      const response = await agentsApi.getCollectedApps({ limit });
      myCollectedAgents.value = response.data.apps;
    } catch (err) {
      error.value = err instanceof Error ? err.message : '获取我收藏的智能体失败';
      console.error('Error fetching my collected agents:', err);
    }
  };

  const fetchHotAgents = async (limit: number = 15, keyword?: string, page: number = 1, category?: string) => {
    try {
      const response = await agentsApi.getHotAgents({ limit, keyword, page, category });
      hotAgents.value = response.data.agents;
      hotAgentsTotal.value = response.data.pagination?.total || response.data.agents.length;
      hotAgentsPage.value = page;
    } catch (err) {
      error.value = err instanceof Error ? err.message : '获取热门智能体失败';
      console.error('Error fetching hot agents:', err);
    }
  };

  const toggleCollect = async (agentId: string, appData: any) => {
    try {
      // 判断是外链应用还是普通应用
      const isLinkApp = appData?.isLinkApp || false;
      
      let response;
      if (isLinkApp) {
        // 外链应用调用外链应用的收藏接口
        console.log(`[toggleCollect] 外链应用收藏: ${agentId}`);
        const { linkAppsApi } = await import('@/api/appsLink');
        response = await linkAppsApi.toggleFavorite(agentId);
      } else {
        // 普通应用调用原有的收藏接口
        console.log(`[toggleCollect] 普通应用收藏: ${agentId}`);
        response = await agentsApi.toggleCollect(agentId, appData);
      }
      
      const isCollected = response.data.isCollected || response.data.isFavorited || false;
      const newCount = response.data.collectCount || response.data.favoriteCount || 0;
      
      console.log(`[toggleCollect] appId: ${agentId}, isLinkApp: ${isLinkApp}, isCollected: ${isCollected}, newCount: ${newCount}`);
      
      // 创建更新函数，用于更新应用的收藏状态
      const updateAppCollectStatus = (app: any) => {
        if (app && app._id === agentId) {
          app.isCollected = isCollected;
          app.collectCount = newCount;
          app.favoriteCount = newCount;
          console.log(`[toggleCollect] Updated app: ${app.name || app._id}`);
          return true;
        }
        return false;
      };
      
      // 1. 更新 hotAgents
      const hotAgentIndex = hotAgents.value.findIndex(agent => agent._id === agentId);
      if (hotAgentIndex !== -1) {
        updateAppCollectStatus(hotAgents.value[hotAgentIndex]);
      }
      
      // 2. 更新 categoryApps 中的所有分类（确保触发响应式更新）
      Object.keys(categoryApps.value).forEach(categoryId => {
        const apps = categoryApps.value[categoryId];
        if (Array.isArray(apps)) {
          let hasUpdate = false;
          apps.forEach(app => {
            if (updateAppCollectStatus(app)) {
              hasUpdate = true;
            }
          });
          // 如果有更新，重新赋值数组以触发响应式
          if (hasUpdate) {
            categoryApps.value[categoryId] = [...apps];
          }
        }
      });
      
      // 3. 更新我创建的应用列表
      if (Array.isArray(myCreatedAppsNew.value)) {
        const updated = myCreatedAppsNew.value.some(app => updateAppCollectStatus(app));
        if (updated) {
          // 触发响应式更新
          myCreatedAppsNew.value = [...myCreatedAppsNew.value];
        }
      }
      
      // 4. 更新搜索结果
      if (Array.isArray(searchResults.value)) {
        const updated = searchResults.value.some(app => updateAppCollectStatus(app));
        if (updated) {
          // 触发响应式更新
          searchResults.value = [...searchResults.value];
        }
      }
      
      // 5. 静默刷新我收藏的列表
      if (typeof fetchMyCollectedAppsNewSilent === 'function') {
        fetchMyCollectedAppsNewSilent().catch(err => {
          console.warn('静默刷新收藏列表失败:', err);
        });
      }
      
      console.log('[toggleCollect] All updates completed');
      return response;
    } catch (err) {
      console.error('Error toggling collect:', err);
      throw err;
    }
  };

  const toggleFavorite = async (agentId: string) => {
    try {
      const response = await agentsApi.toggleFavorite(agentId);
      
      // Update the agent's favorite status and count in the store
      const agentIndex = agents.value.findIndex(agent => agent._id === agentId);
      if (agentIndex !== -1) {
        agents.value[agentIndex].isFavorited = response.data.isFavorite;
        agents.value[agentIndex].favoriteCount = response.data.favoriteCount;
      }
      
      // Also update in hot agents if present
      const hotAgentIndex = hotAgents.value.findIndex(agent => agent._id === agentId);
      if (hotAgentIndex !== -1) {
        hotAgents.value[hotAgentIndex].isFavorited = response.data.isFavorite;
        hotAgents.value[hotAgentIndex].favoriteCount = response.data.favoriteCount;
      }
      
      return response;
    } catch (err) {
      console.error('Error toggling favorite:', err);
      throw err;
    }
  };

  const updateSearchKeyword = (newKeyword: string) => {
    keyword.value = newKeyword;
  };

  const updateSelectedType = (newType: string) => {
    selectedType.value = newType;
  };

  const updateSortBy = (newSortBy: string) => {
    sortBy.value = newSortBy;
  };

  const updateActiveTab = (newTab: 'used' | 'created') => {
    activeTab.value = newTab;
  };

  const resetFilters = () => {
    keyword.value = '';
    selectedType.value = '';
    sortBy.value = 'hotScore';
  };

  // ========== 新增：AppsNew 相关状态和方法 ==========
  
  // AppsNew State
  const myCreatedAppsNew = ref<AppNew[]>([]);
  const myCreatedAppsNewTotal = ref<number>(0); // 新增：我创建的应用总数
  const myCollectedAppsNew = ref<AppNew[]>([]);
  const categoryApps = ref<Record<string, AppNew[]>>({});
  const categoryPagination = ref<Record<string, {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  }>>({});
  const categories = ref<Category[]>([]);
  const searchResults = ref<AppNew[]>([]);
  const currentCategory = ref<string>('all');
  const loadingAppsNew = ref(false);
  const loadingCategoryApps = ref(false); // 独立的分类应用加载状态
  const errorCategoryApps = ref<string | null>(null);
  const errorAppsNew = ref<string | null>(null);

  // 缓存时间戳（5分钟缓存）
  const cacheTimestamps = ref<Record<string, number>>({});
  const CACHE_DURATION = 5 * 60 * 1000; // 5分钟

  // 检查缓存是否有效
  const isCacheValid = (key: string): boolean => {
    const timestamp = cacheTimestamps.value[key];
    if (!timestamp) return false;
    return Date.now() - timestamp < CACHE_DURATION;
  };

  // limit 是请求身份的一部分，成功的空列表也属于已加载状态。
  const loadCreatedApps = createPersonalAppsLoader(
    (limit: number) => appsNewApi.getMyCreatedApps(limit),
    (response: any) => {
      myCreatedAppsNew.value = (response.data || []).filter((app: any) => app && app.name !== 'defaultApp');
      myCreatedAppsNewTotal.value = response.total || 0;
    }
  );
  const loadCollectedApps = createPersonalAppsLoader(
    (limit: number) => appsNewApi.getMyCollectedApps(limit),
    (response: any) => {
      myCollectedAppsNew.value = (response.data || []).filter((app: any) => app && app.name !== 'defaultApp');
    }
  );
  let personalAppsPending = 0;
  const loadPersonalApps = async (load: () => Promise<void>, fallback: string) => {
    personalAppsPending++;
    loadingAppsNew.value = true;
    errorAppsNew.value = null;
    try {
      await load();
    } catch (err) {
      errorAppsNew.value = err instanceof Error ? err.message : fallback;
      console.error(fallback, err);
      throw err;
    } finally {
      loadingAppsNew.value = --personalAppsPending > 0;
    }
  };

  // 普通调用主动刷新；组件挂载只在未加载/缓存过期时请求，失败后冷却 30 秒。
  const fetchMyCreatedAppsNew = (limit?: number, onlyIfNeeded = false) =>
    loadPersonalApps(() => loadCreatedApps(limit || 4, onlyIfNeeded), '获取创建的应用失败');
  const fetchMyCollectedAppsNew = (limit?: number, onlyIfNeeded = false) =>
    loadPersonalApps(() => loadCollectedApps(typeof limit === 'number' ? limit : 1000, onlyIfNeeded), '获取收藏的应用失败');

  // 静默刷新：不改变 loadingAppsNew 等 UI loading 状态，用于后台悄悄更新收藏列表，避免界面闪烁
  const fetchMyCollectedAppsNewSilent = async (limit?: number) => {
    try {
      const response: any = await appsNewApi.getMyCollectedApps(limit);
      // 过滤掉名称为 'defaultApp' 的应用
      const filteredApps = (response.data || []).filter((app: any) => app && app.name !== 'defaultApp');
      myCollectedAppsNew.value = filteredApps;
    } catch (err) {
      console.warn('Silent fetch my collected apps failed', err);
    }
  };

  // 获取分类列表
  const fetchCategories = async () => {
    try {
      const response: any = await appsNewApi.getCategories();
      categories.value = response.data || [];
    } catch (err) {
      errorAppsNew.value = err instanceof Error ? err.message : '获取分类列表失败';
      console.error('Error fetching categories:', err);
    }
  };

  // 获取指定分类的应用。第一页替换数据，后续页去重后追加，用于滚动分页。
  const fetchCategoryApps = async (categoryId: string, params?: { page?: number; limit?: number; sortBy?: string; append?: boolean }) => {
    errorCategoryApps.value = null;
    loadingCategoryApps.value = true;
    errorAppsNew.value = null;
    try {
      const sortBy = params?.sortBy || 'hotScore';
      const requestedPage = params?.page || 1;
      const requestedLimit = params?.limit || 20;
      const shouldAppend = params?.append === true && requestedPage > 1;
      const response: any = await appsNewApi.getCategoryApps(categoryId, {
        page: requestedPage,
        limit: requestedLimit,
        sortBy: sortBy as 'hotScore' | 'createdAt'
      });
      const allApps = response.data || [];

      categoryPagination.value[categoryId] = {
        page: Number(response.pagination?.page || requestedPage),
        limit: Number(response.pagination?.limit || requestedLimit),
        total: Number(response.pagination?.total || 0),
        totalPages: Number(response.pagination?.totalPages || 0)
      };
      
      console.log('fetchCategoryApps response for', categoryId, ':', allApps.length, 'apps');
      
      // 过滤掉名称为 'defaultApp' 的应用
      const filteredApps = allApps.filter((app: any) => app && app.name !== 'defaultApp');
      console.log('After filtering defaultApp:', filteredApps.length, 'apps');
      
      if (shouldAppend) {
        const existingApps = categoryApps.value[categoryId] || [];
        const existingIds = new Set(existingApps.map(app => String(app._id || app.tmbId || '')));
        const nextApps = filteredApps.filter((app: AppNew) => !existingIds.has(String(app._id || app.tmbId || '')));
        categoryApps.value[categoryId] = [...existingApps, ...nextApps];
      } else {
        categoryApps.value[categoryId] = filteredApps;
      }
      return categoryApps.value[categoryId];
    } catch (err) {
      errorAppsNew.value = err instanceof Error ? err.message : '获取分类应用失败';
      errorCategoryApps.value = errorAppsNew.value;
      console.error('Error fetching category apps:', err);
      throw err;
    } finally {
      loadingCategoryApps.value = false;
    }
  };

  // 搜索应用
  const searchApps = async (searchKeyword: string, sortBy?: string) => {
    loadingCategoryApps.value = true;
    errorAppsNew.value = null;
    try {
      // 如果关键词为空，则清空搜索结果
      if (!searchKeyword || !searchKeyword.trim()) {
        searchResults.value = [];
        return [];
      }

      // 直接使用广场全量搜索接口；每条结果由后端通过 canAccess 标记当前用户是否有权使用
      const response: any = await appsNewApi.getAppsByCategory({
        search: searchKeyword,
        category: currentCategory.value,
        limit: 50,
        sortBy: (sortBy || 'hotScore') as 'hotScore' | 'createdAt'
      });
      
      // 过滤掉名称为 'defaultApp' 的应用
      const filteredResults = (response.data || []).filter((app: any) => app && app.name !== 'defaultApp');
      searchResults.value = filteredResults;
      return searchResults.value;
    } catch (err) {
      errorAppsNew.value = err instanceof Error ? err.message : '搜索应用失败';
      console.error('Error searching apps:', err);
      return [];
    } finally {
      loadingCategoryApps.value = false;
    }
  };

  // 设置当前分类
  const setCurrentCategory = (categoryId: string) => {
    currentCategory.value = categoryId;
  };

  // 重置分类分页；第一页成功返回后会替换旧列表。
  const clearCategoryCache = (categoryId: string) => {
    delete categoryPagination.value[categoryId];
  };

  // 记录外链应用访问
  const trackLinkAppVisit = async (appId: string) => {
    try {
      const { linkAppsApi } = await import('@/api/appsLink');
      await linkAppsApi.trackVisit(appId);
      console.log(`[trackLinkAppVisit] 记录外链应用访问成功: ${appId}`);
    } catch (error) {
      console.error('[trackLinkAppVisit] 记录访问失败:', error);
      throw error;
    }
  };

  // incrementAppView removed — view endpoint deprecated.

  return {
    // State
    agents,
    myFrequentAgents,
    myCreatedAgents,
    myCollectedAgents,
    hotAgents,
    loading,
    error,
    currentPage,
    pageSize,
    total,
    keyword,
    selectedType,
    sortBy,
    activeTab,
    user,
    isAuthenticated,
    pendingWecomQwToken,
    wecomBindingResult,
    hotAgentsPage,
    hotAgentsPageSize,
    hotAgentsTotal,
    
    // Computed
    paginatedAgents,
    isLoggedIn,
    
    // Actions
    fetchAgents,
    fetchUserCreatedAgents,
    fetchUserFrequentAgents,
    fetchMyCollectedAgents,
    loadAllCollectedAgents,
    loadAllCreatedAgents,
    fetchHotAgents,
    toggleCollect,
    toggleFavorite,
    updateSearchKeyword,
    updateSelectedType,
    updateSortBy,
    updateActiveTab,
    resetFilters,
    checkAuthStatus,
    redirectToLogin,
    rememberWecomQwToken,
    bindPendingWecomQwToken,
    completeLoginWithCode,
    logout,
    
    // AppsNew State
    myCreatedAppsNew,
    myCreatedAppsNewTotal,
    myCollectedAppsNew,
    categoryApps,
    categoryPagination,
    categories,
    searchResults,
    currentCategory,
    loadingAppsNew,
    loadingCategoryApps,
    errorCategoryApps,
    errorAppsNew,
    
    // AppsNew Actions
    fetchMyCreatedAppsNew,
    fetchMyCollectedAppsNew,
  fetchMyCollectedAppsNewSilent,
    fetchCategories,
    fetchCategoryApps,
    searchApps,
    setCurrentCategory,
    clearCategoryCache,
    trackLinkAppVisit,
    // incrementAppView (removed)
  };
});
