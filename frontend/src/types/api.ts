// API 响应基础格式
export interface ApiResponse<T = any> {
  success: boolean;
  data: T;
  message: string;
  code?: number;
}

// 分页信息
export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// 分页响应数据格式
export interface PaginatedResponse<T> {
  agents: T[];
  pagination: Pagination;
}

// 智能体相关API响应类型
export interface AgentsResponse {
  agents: Agent[];
  pagination: Pagination;
}

export interface HotAgentsResponse {
  agents: Agent[];
}

export interface FavoriteResponse {
  isFavorite: boolean;
  favoriteCount: number;
}

// 用于类型推断的智能体接口
export interface Agent {
  _id: string;
  name: string;
  type: string;
  updateTime: string;
  intro: string;
  chatCount?: number;
  teamId: string;
  version?: string;
  avatar?: string;
  inheritPermission?: boolean;
  likeCount: number;
  favoriteCount: number;
  hotScore: number;
  description?: string;
  isFavorited?: boolean;
  views?: number;
  rating?: number;
  tag?: string;
  iconClass?: string;
  iconColor?: string;
  count?: number;
}