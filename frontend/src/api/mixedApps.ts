import request from '../utils/request';
import type { ApiResponse, PaginatedResponse } from '../types/linkApp';

/**
 * 混合应用 API（FastGPT + 外链应用）
 */
export const mixedAppsApi = {
  /**
   * 获取混合应用列表（按分类）
   */
  getMixedAppsByCategory: (params: {
    category?: string;
    search?: string;
    sortBy?: string;
    page?: number;
    limit?: number;
  }) =>
    request.get<ApiResponse<PaginatedResponse<any>>>('/apps-new/by-category-mixed', { params }),

  /**
   * 获取混合"我创建的"应用
   */
  getMyCreatedMixed: () =>
    request.get<ApiResponse<{ apps: any[]; totalCount: number; fastgptCount: number; linkCount: number }>>(
      '/apps-new/my-created-mixed'
    ),

  /**
   * 获取混合"我收藏的"应用
   */
  getMyCollectedMixed: () =>
    request.get<ApiResponse<{ apps: any[]; totalCount: number }>>(
      '/apps-new/my-collected-mixed'
    )
};
