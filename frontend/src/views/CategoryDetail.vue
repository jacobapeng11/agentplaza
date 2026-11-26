<template>
  <div class="category-detail-container">
    <!-- 公共头部 -->
    <PlazaHeader />

    <!-- 主体内容 -->
    <div class="main-content">
      <!-- 分类标题区域 -->
      <div class="category-header">
        <h1 class="category-title">
          {{ categoryName }}<span class="count">({{ totalCount }})</span>
        </h1>
        
        <!-- 操作按钮组 -->
        <div class="action-buttons">
          <button 
            class="sort-btn"
            :class="{ active: currentSort === 'latest' }"
            @click="handleSortChange('latest')"
          >
            最新
          </button>
          <button 
            class="sort-btn"
            :class="{ active: currentSort === 'hot' }"
            @click="handleSortChange('hot')"
          >
            最热
          </button>
          <button 
            class="back-btn"
            @click="handleBackToPlaza"
          >
            <el-icon><ArrowLeft /></el-icon>
            返回广场
          </button>
        </div>
      </div>

      <!-- 应用网格 -->
      <div v-if="loading" class="loading-state">
        <el-skeleton :rows="2" animated />
        <div class="apps-grid">
          <div v-for="i in 8" :key="i" class="skeleton-card">
            <el-skeleton animated>
              <template #template>
                <el-skeleton-item variant="image" style="width: 100%; height: 180px;" />
                <div style="padding: 14px;">
                  <el-skeleton-item variant="h3" style="width: 60%;" />
                  <el-skeleton-item variant="text" style="margin-top: 10px;" />
                </div>
              </template>
            </el-skeleton>
          </div>
        </div>
      </div>

      <div v-else-if="sortedApps.length > 0" class="apps-grid">
        <AppCardNew
          v-for="app in sortedApps"
          :key="app._id"
          :app="app"
          @click="handleAppClick(app._id)"
        />
      </div>

      <div v-else class="empty-state">
        <el-empty description="该分类暂无应用" />
      </div>

      <!-- 加载更多 -->
      <div v-if="hasMore && !loading" class="load-more">
        <el-button @click="loadMore" :loading="loadingMore">
          加载更多
        </el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowLeft } from '@element-plus/icons-vue';
import PlazaHeader from '../components/plaza/PlazaHeader.vue';
import AppCardNew from '../components/plaza/AppCardNew.vue';
import { useAppsStore } from '../stores/apps';
import { appsNewApi } from '../api/apps';
import type { AppNew } from '../types/agent';
import { buildFastgptChatUrl } from '../config/fastgptConfig';
import { ensureAppAccessBeforeOpen } from '../utils/appAccess';

const route = useRoute();
const router = useRouter();
const appsStore = useAppsStore();

// 状态
const categoryId = ref<string>('');
const categoryName = ref<string>('');
const apps = ref<AppNew[]>([]);
const loading = ref(false);
const loadingMore = ref(false);
const currentSort = ref<'hot' | 'latest'>('hot');
const currentPage = ref(1);
const pageSize = ref(20);
const totalCount = ref(0);

// 计算属性
const hasMore = computed(() => {
  return apps.value.length < totalCount.value;
});

const sortedApps = computed(() => {
  const appsList = [...apps.value];
  
  if (currentSort.value === 'latest') {
    // 最新优先：按更新时间倒序
    return appsList.sort((a, b) => {
      const accessDiff = Number(b.canAccess === true) - Number(a.canAccess === true);
      if (accessDiff !== 0) return accessDiff;

      const dateA = a.updateTime ? new Date(a.updateTime).getTime() : 0;
      const dateB = b.updateTime ? new Date(b.updateTime).getTime() : 0;
      return dateB - dateA;
    });
  } else {
    // 热度优先：按用户使用人数 → 热度分数
    return appsList.sort((a, b) => {
      const accessDiff = Number(b.canAccess === true) - Number(a.canAccess === true);
      if (accessDiff !== 0) return accessDiff;

      const userCountA = a.userCount || 0;
      const userCountB = b.userCount || 0;
      
      if (userCountA !== userCountB) {
        return userCountB - userCountA;
      }
      
      return (b.hotScore || 0) - (a.hotScore || 0);
    });
  }
});

// 方法
/**
 * 加载分类应用数据
 */
const loadCategoryApps = async (page: number = 1) => {
  try {
    if (page === 1) {
      loading.value = true;
    } else {
      loadingMore.value = true;
    }

    // 热门推荐详情同样读取全量广场数据，按热度分页并返回 canAccess 标记。
    if (categoryId.value === 'hot') {
      const response: any = await appsNewApi.getCategoryApps('all', {
        page,
        limit: pageSize.value,
        sortBy: currentSort.value === 'latest' ? 'createdAt' : 'hotScore'
      });
      const newApps = response.data || [];
      if (page === 1) {
        apps.value = [...newApps];
      } else {
        apps.value.push(...newApps);
      }

      totalCount.value = response.pagination?.total || newApps.length;
      currentPage.value = page;
      return;
    }

    // 调用 API 获取分类应用（非热门）
    const response: any = await appsNewApi.getCategoryApps(categoryId.value, {
      page,
      limit: pageSize.value,
      sortBy: currentSort.value === 'latest' ? 'createdAt' : 'hotScore'
    });

    const newApps = response.data || [];

    if (page === 1) {
      apps.value = newApps;
    } else {
      apps.value.push(...newApps);
    }

    // 更新分类统计
      const category = appsStore.categories.find(c => c.id === categoryId.value);
      // 优先使用接口返回的分页总数，如果没有则回退到 category.count，再回退到当前批次长度
      const apiTotal = (response && response.pagination && response.pagination.total) ? response.pagination.total : (response && response.total ? response.total : undefined);
      if (typeof apiTotal === 'number') {
        totalCount.value = apiTotal;
      } else if (category && typeof category.count === 'number') {
        totalCount.value = category.count;
      } else {
        totalCount.value = newApps.length;
      }

    currentPage.value = page;
  } catch (error) {
    console.error('加载分类应用失败:', error);
  } finally {
    loading.value = false;
    loadingMore.value = false;
  }
};

/**
 * 处理排序切换
 */
const handleSortChange = (sort: 'hot' | 'latest') => {
  if (currentSort.value === sort) return;
  currentSort.value = sort;
  
  // 保存排序偏好
  localStorage.setItem('category_sort_preference', sort);
};

/**
 * 加载更多
 */
const loadMore = () => {
  loadCategoryApps(currentPage.value + 1);
};

/**
 * 返回广场首页
 */
const handleBackToPlaza = () => {
  router.push('/');
};

/**
 * 处理应用点击
 */
const handleAppClick = async (appId: string) => {
  console.log('点击应用:', appId);
  // 查找对应的应用对象
  const app = apps.value.find(a => a._id === appId);

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
};

/**
 * 处理点击"创建智能体"按钮
 */

/**
 * 初始化
 */
onMounted(async () => {
  // 从路由参数获取分类ID
  categoryId.value = route.params.categoryId as string;
  
  // 加载分类列表（如果还没有）
  if (appsStore.categories.length === 0) {
    await appsStore.fetchCategories();
  }
  
  // 获取分类名称
  const category = appsStore.categories.find(c => c.id === categoryId.value);
  if (category) {
    categoryName.value = category.name;
    // totalCount 由接口的 pagination.total 提供，后续在 loadCategoryApps 中会设置，
    // 这里不使用 category.count（可能不准确）
  } else {
    // 特殊处理：如果是热门推荐（路由 id 为 'hot'），显示中文名称
    if (categoryId.value === 'hot') {
      categoryName.value = '热门推荐';
      // totalCount 会在 loadCategoryApps 中从 store.hotAgentsTotal 填充
    } else {
      categoryName.value = categoryId.value;
    }
  }
  
  // 读取保存的排序偏好
  const savedSort = localStorage.getItem('category_sort_preference');
  if (savedSort === 'hot' || savedSort === 'latest') {
    currentSort.value = savedSort;
  }
  
  // 加载数据
  await loadCategoryApps();
});
</script>

<style scoped lang="scss">
.category-detail-container {
  min-height: 100vh;
  background-image: url('/bj.png');
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  background-attachment: fixed;
}

.main-content {
  max-width: 1680px;
  margin: 0 auto;
  padding: 24px;
}

// 分类标题区域
.category-header {
  display: flex;
  align-items: center;
  gap: 24px;
  margin-bottom: 32px;
  padding: 0;
}

.category-title {
  margin: 0;
  font-size: 32px;
  font-weight: 600;
  color: #303133;
  display: flex;
  align-items: baseline;
  
  .count {
    font-size: 24px;
    color: #909399;
    margin-left: 8px;
  }
}

// 操作按钮组
.action-buttons {
  display: flex;
  gap: 12px;
}

.sort-btn {
  padding: 8px 20px;
  border: none;
  border-radius: 6px;
  background: #fff;
  color: #606266;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.3s;

  &:hover {
    background: #3366FF;
    color: white;
  }

  &.active {
    background: #3366FF;
    color: white;
  }
}

.back-btn {
  padding: 8px 20px;
  border: none;
  border-radius: 6px;
  color: #3366FF;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: all 0.3s;
  background: transparent;

  &:hover {
    color: #3366FF;
    font-weight: 900;
  }
}

// 应用网格
.apps-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(270px, 1fr));
  gap: 16px;
  margin-bottom: 32px;
}

.skeleton-card {
  background: white;
  border-radius: 12px;
  overflow: hidden;
}

// 加载状态
.loading-state {
  .apps-grid {
    margin-top: 20px;
  }
}

// 空状态
.empty-state {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 400px;
  background: rgba(255, 255, 255, 0.95);
  border-radius: 16px;
}

// 加载更多
.load-more {
  display: flex;
  justify-content: center;
  padding: 32px 0;
}
</style>
