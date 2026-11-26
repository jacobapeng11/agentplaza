// 外链应用类型定义
export interface LinkApp {
  _id: string;
  teamId: string;
  tmbId: string;
  name: string;
  type: string;
  version: string;
  avatar: string;
  intro: string;
  inheritPermission: boolean;
  newType: string;
  tags: string[];
  isPinned: boolean;
  pinnedAt: Date | null;
  chatCount: number;
  userCount: number;
  favoriteCount: number;
  hotScore: number;
  deptPermissions: string[];
  userPermissions: string[];
  creator: {
    Badge: string;
    Name: string;
  };
  appUrl: string;
  updater: {
    at: Date;
    by: string;
  };
  createdAt?: string;
  updatedAt?: string;
  source?: 'link' | 'fastgpt';
}

// 外链应用表单数据
export interface LinkAppFormData {
  name: string;
  appUrl: string;
  intro: string;
  newType: string;
  tags: string[];
  avatar: string;
  userPermissions: string[];
  deptPermissions: string[];
}

// 外链应用列表查询参数
export interface LinkAppListQuery {
  page: number;
  limit: number;
  category?: string;
  search?: string;
  sortBy?: 'hot' | 'latest';
}

// API 响应类型
export interface ApiResponse<T> {
  code: number;
  success: boolean;
  data: T;
  message?: string;
}

// 分页响应
export interface PaginatedResponse<T> {
  apps: T[];
  pagination?: {
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
  };
  totalCount?: number;
}
