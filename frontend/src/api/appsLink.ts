import request from '../utils/request';
import type { LinkApp, LinkAppFormData, LinkAppListQuery, ApiResponse, PaginatedResponse } from '../types/linkApp';

export const linkAppsApi = {
  /**
   * 创建外链应用
   */
  create: (data: LinkAppFormData) => 
    request.post<ApiResponse<LinkApp>>('/apps-link', data),
  
  /**
   * 获取外链应用列表（带权限过滤）
   */
  getList: (params: LinkAppListQuery) =>
    request.get<ApiResponse<PaginatedResponse<LinkApp>>>('/apps-link', { params }),
  
  /**
   * 获取我创建的外链应用
   */
  getMyCreated: (params: { page: number; limit: number; sortBy?: string }) =>
    request.get<ApiResponse<PaginatedResponse<LinkApp>>>('/apps-link/my-created', { params }),
  
  /**
   * 获取单个外链应用详情
   */
  getById: (id: string) =>
    request.get<ApiResponse<LinkApp>>(`/apps-link/${id}`),
  
  /**
   * 更新应用
   */
  update: (id: string, data: Partial<LinkAppFormData>) =>
    request.put<ApiResponse<LinkApp>>(`/apps-link/${id}`, data),
  
  /**
   * 删除应用
   */
  delete: (id: string) =>
    request.delete<ApiResponse<{ message: string }>>(`/apps-link/${id}`),
  
  /**
   * 收藏/取消收藏
   */
  toggleFavorite: (id: string) =>
    request.post<ApiResponse<{ isFavorited: boolean; favoriteCount?: number }>>(`/apps-link/${id}/favorite`),
  
  /**
   * 记录访问
   */
  trackVisit: (id: string) =>
    request.post<ApiResponse<any>>(`/apps-link/${id}/track-visit`),
  
  /**
   * 上传图片
   */
  uploadImage: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return request.post<ApiResponse<{ url: string }>>('/apps-link/upload-image', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  }
};
