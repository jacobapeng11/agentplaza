export interface Agent {
  _id: string;
  name: string;
  type: string;
  newType?: string; // 新分类系统：'大市场' | '财务' | 'IT办公类' | '行政人事类'
  intro: string;
  chatCount?: number;
  userCount?: number; // 使用人数
  updateTime: string;
  teamId: string;
  version?: string;
  avatar?: string;
  inheritPermission?: boolean;
  likeCount: number;
  favoriteCount: number;
  hotScore: number;
  description?: string;
  isFavorited?: boolean;
  isCollected?: boolean;
  collectCount?: number;
  views?: number;
  rating?: number;
  tag?: string;
  iconClass?: string;
  iconColor?: string;
  count?: number;
}

// 新增：AppsNew 接口（用于智能体广场界面重新设计）
export interface AppNew {
  _id: string;
  name: string;
  type?: string;
  newType?: string; // 新分类系统：'大市场' | '财务' | 'IT办公类' | '行政人事类'
  avatar?: string;
  backgroundImage?: string;
  description?: string;
  intro?: string; // 兼容旧模型
  category?: 'all' | 'market' | 'finance' | 'it-office' | 'hr-admin' | string;
  tags?: string[]; // 最多4个
  isPinned?: boolean;
  pinnedAt?: Date;
  likeCount?: number;
  favoriteCount?: number;
  viewCount?: number;
  usageCount?: number;
  chatCount?: number; // 兼容旧模型
  userCount?: number; // 兼容旧模型
  hotScore: number;
  teamId?: string;
  tmbId?: string;
  createdAt?: Date;
  updatedAt?: Date;
  updateTime?: string; // 兼容旧模型
  version?: string;
  inheritPermission?: boolean;
  canConfigureWecomBot?: boolean;
  canAccess?: boolean;
  isLinkApp?: boolean;
  appUrl?: string | null;
  creator?: {
    Badge?: string | number;
    Name?: string | null;
  } | null;
}

// 分类接口
export interface Category {
  id: string;
  name: string;
  icon: string;
  count?: number;
}

// API 响应接口
export interface PaginationResponse<T> {
  success: boolean;
  data: T[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  total?: number;
  message?: string;
}
