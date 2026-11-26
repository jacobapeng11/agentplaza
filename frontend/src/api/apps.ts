import { http } from '../utils/request';

// Define API methods
export const agentsApi = {
  // Get agents with pagination, search, and filtering
  getAgents: (params: {
    page?: number;
    limit?: number;
    keyword?: string;
    type?: string;
    sortBy?: string;
    order?: 'asc' | 'desc';
  }) => {
    return http.get('/apps', params);
  },

  // Get user-specific agents
  getUserAgents: (type: 'created' | 'frequent', params: {
    page?: number;
    limit?: number;
    keyword?: string;
  }) => {
    return http.get(`/apps/user/${type}`, params);
  },

  // Get frequently used agents for a user
  getFrequentAgents: (userId: string, params: {
    limit?: number;
  }) => {
    return http.get(`/apps/frequent/${userId}`, params);
  },

  // Get hot agents (sorted by hotScore)
  getHotAgents: (params: { limit?: number; keyword?: string; page?: number; category?: string }) => {
    return http.get('/apps/hot', params);
  },

  // Toggle collect status for an agent (for hot agents)
  toggleCollect: (agentId: string, appData: any) => {
    return http.post(`/apps/${agentId}/collect`, { appData });
  },

  // Get user's collected apps
  getCollectedApps: (params: {
    page?: number;
    limit?: number;
  }) => {
    return http.get('/apps/collected', params);
  },

  // Toggle favorite status for an agent
  toggleFavorite: (agentId: string) => {
    return http.post(`/apps/${agentId}/favorite`, {
      userId: localStorage.getItem('userId') || 'default-user-id' // In a real app, use actual user ID
    });
  },

  // Remove favorite for an agent
  removeFavorite: (agentId: string) => {
    return http.delete(`/apps/${agentId}/favorite`, {
      userId: localStorage.getItem('userId') || 'default-user-id' // In a real app, use actual user ID
    });
  }
};

// 新增：AppsNew API 方法（用于智能体广场界面重新设计）
export const appsNewApi = {
  /**
   * 获取热门推荐应用（包含置顶逻辑）
   * @param params 查询参数
   */
  getHotRecommend: (params: {
    search?: string;
    sortBy?: 'hotScore' | 'createdAt';
    page?: number;
    limit?: number;
  }) => {
    return http.get('/apps-new/hot-recommend', params);
  },

  /**
   * 按分类获取应用列表
   * @param params 查询参数
   */
  getAppsByCategory: (params: {
    category?: string;
    search?: string;
    sortBy?: 'hotScore' | 'createdAt';
    page?: number;
    limit?: number;
  }) => {
    return http.get('/apps-new/by-category', params);
  },

  /**
   * 获取当前用户创建的应用
   * @param limit 返回数量，默认4
   */
  getMyCreatedApps: (limit?: number) => {
    return http.get('/apps-new/my-created', { limit: limit || 4 });
  },

  /**
   * 获取当前用户收藏的应用
   * @param limit 返回数量，默认4
   */
  getMyCollectedApps: (limit?: number) => {
    // 默认拉取更多收藏以便前端 store 保持完整列表（UI 可在显示时 slice 前 4 个）
    const fetchLimit = typeof limit === 'number' ? limit : 1000;
    return http.get('/apps-new/my-collected', { limit: fetchLimit });
  },

  /**
   * 增加应用浏览计数
   * @param appId 应用ID
   */
  // incrementAppView removed — view endpoint deprecated.

  /**
   * 获取分类列表
   */
  getCategories: () => {
    return http.get('/categories');
  },

  /**
   * 获取分类下的应用列表
   * @param categoryId 分类ID
   * @param params 查询参数
   */
  getCategoryApps: (categoryId: string, params: {
    page?: number;
    limit?: number;
    sortBy?: 'hotScore' | 'createdAt';
  }) => {
    return http.get(`/categories/${categoryId}/apps`, params);
  }
};

export default http;