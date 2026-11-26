<template>
  <div class="my-agents-container">
    <!-- 公共头部 -->
    <PlazaHeader />

    <!-- 主体内容 -->
    <div class="main-content">
      <!-- 面包屑导航 -->
      <Breadcrumb :items="breadcrumbItems" />

      <!-- 我创建的应用区域 -->
  <div id="created-section" class="section-container">
        <div class="section-header">
          <h2 class="section-title">我创建的<span class="count">({{ appsStore.myCreatedAppsNewTotal }})</span></h2>
          <button 
            class="sort-btn"
            :class="{ active: createdSort === 'latest' }"
            @click="createdSort = 'latest'"
          >
            最新
          </button>
          <button 
            class="sort-btn"
            :class="{ active: createdSort === 'hot' }"
            @click="createdSort = 'hot'"
          >
            最热
          </button>
        </div>

        <div v-if="loadingCreated" class="loading-state">
          <el-skeleton :rows="2" animated />
          <div class="apps-grid">
            <div v-for="i in 4" :key="i" class="skeleton-card">
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

        <div v-else-if="sortedCreatedApps.length > 0" class="apps-grid">
          <AppCardNew
            v-for="app in sortedCreatedApps"
            :key="app._id"
            :app="app"
            @click="handleAppClick(app._id)"
          />
        </div>

        <div v-else class="empty-state">
          <el-empty description="暂无创建的应用" />
        </div>
      </div>

      <!-- 我收藏的应用区域 -->
  <div id="collected-section" class="section-container">
        <div class="section-header">
          <h2 class="section-title">我收藏的<span class="count">({{ myCollectedApps.length }})</span></h2>
          <button 
            class="sort-btn"
            :class="{ active: collectedSort === 'latest' }"
            @click="collectedSort = 'latest'"
          >
            最新
          </button>
          <button 
            class="sort-btn"
            :class="{ active: collectedSort === 'hot' }"
            @click="collectedSort = 'hot'"
          >
            最热
          </button>
        </div>

        <div v-if="loadingCollected" class="loading-state">
          <el-skeleton :rows="2" animated />
          <div class="apps-grid">
            <div v-for="i in 4" :key="i" class="skeleton-card">
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

        <div v-else-if="sortedCollectedApps.length > 0" class="apps-grid">
          <AppCardNew
            v-for="app in sortedCollectedApps"
            :key="app._id"
            :app="app"
            @click="handleAppClick(app._id)"
          />
        </div>

        <div v-else class="empty-state">
          <el-empty description="暂无收藏的应用" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import PlazaHeader from '../components/plaza/PlazaHeader.vue';
import Breadcrumb from '../components/common/Breadcrumb.vue';
import AppCardNew from '../components/plaza/AppCardNew.vue';
import { useAppsStore } from '../stores/apps';
import { agentsApi } from '../api/apps';
import type { Agent } from '../types/agent';
import { buildFastgptChatUrl } from '../config/fastgptConfig';

const router = useRouter();
const route = useRoute();
const appsStore = useAppsStore();

// 状态
const loadingCreated = ref(false);
const loadingCollected = ref(false);
const createdSort = ref<'hot' | 'latest'>('hot');
const collectedSort = ref<'hot' | 'latest'>('hot');

// 面包屑数据
const breadcrumbItems = [
  { label: '智能体广场', path: '/' },
  { label: '我的智能体' }
];

// 使用 store 中的数据
const myCreatedApps = computed(() => appsStore.myCreatedAppsNew || []);
const myCollectedApps = computed(() => appsStore.myCollectedAppsNew || []);

// 计算属性 - 排序后的创建应用
const sortedCreatedApps = computed(() => {
  const apps = [...myCreatedApps.value];
  
  if (createdSort.value === 'latest') {
    // 最新优先：按更新时间倒序
    return apps.sort((a, b) => {
      const dateA = a.updateTime ? new Date(a.updateTime).getTime() : 0;
      const dateB = b.updateTime ? new Date(b.updateTime).getTime() : 0;
      return dateB - dateA;
    });
  } else {
    // 热度优先：按用户使用人数 → 热度分数
    return apps.sort((a, b) => {
      const userCountA = a.userCount || 0;
      const userCountB = b.userCount || 0;
      
      if (userCountA !== userCountB) {
        return userCountB - userCountA;
      }
      
      return (b.hotScore || 0) - (a.hotScore || 0);
    });
  }
});

// 计算属性 - 排序后的收藏应用
const sortedCollectedApps = computed(() => {
  const apps = [...myCollectedApps.value];
  
  if (collectedSort.value === 'latest') {
    // 最新优先：按更新时间倒序
    return apps.sort((a, b) => {
      const dateA = a.updateTime ? new Date(a.updateTime).getTime() : 0;
      const dateB = b.updateTime ? new Date(b.updateTime).getTime() : 0;
      return dateB - dateA;
    });
  } else {
    // 热度优先：按用户使用人数 → 热度分数
    return apps.sort((a, b) => {
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
 * 加载我创建的应用
 */
const loadMyCreatedApps = async () => {
  try {
    loadingCreated.value = true;
    // 使用新的 API，加载所有数据（传入大 limit 以获取全量）
    await appsStore.fetchMyCreatedAppsNew(1000);
  } catch (error) {
    console.error('加载我创建的应用失败:', error);
  } finally {
    loadingCreated.value = false;
  }
};

/**
 * 加载我收藏的应用
 */
const loadMyCollectedApps = async () => {
  try {
    loadingCollected.value = true;
    // 使用新的 API，加载所有数据
    await appsStore.fetchMyCollectedAppsNew();
  } catch (error) {
    console.error('加载我收藏的应用失败:', error);
  } finally {
    loadingCollected.value = false;
  }
};

/**
 * 处理应用点击
 */
const handleAppClick = async (appId: string) => {
  console.log('点击应用:', appId);
  
  // 查找对应的应用对象（从创建和收藏列表中查找）
  let app = sortedCreatedApps.value.find(a => a._id === appId) || 
            sortedCollectedApps.value.find(a => a._id === appId);
  
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
  // 读取保存的排序偏好
  const savedCreatedSort = localStorage.getItem('my_created_sort_preference');
  if (savedCreatedSort === 'hot' || savedCreatedSort === 'latest') {
    createdSort.value = savedCreatedSort;
  }
  
  const savedCollectedSort = localStorage.getItem('my_collected_sort_preference');
  if (savedCollectedSort === 'hot' || savedCollectedSort === 'latest') {
    collectedSort.value = savedCollectedSort;
  }
  
  // 加载数据
  await Promise.all([
    loadMyCreatedApps(),
    loadMyCollectedApps()
  ]);

  // 如果路由带有 tab 参数，滚动到对应的区块
  try {
    const tab = (route.query?.tab || '') as string;
    if (tab === 'created') {
      const el = document.getElementById('created-section');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (tab === 'collected') {
      const el = document.getElementById('collected-section');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  } catch (err) {
    // ignore
  }
});

// 监听排序变化，保存到 localStorage
import { watch } from 'vue';

watch(createdSort, (newSort) => {
  localStorage.setItem('my_created_sort_preference', newSort);
});

watch(collectedSort, (newSort) => {
  localStorage.setItem('my_collected_sort_preference', newSort);
});
</script>

<style scoped lang="scss">
.my-agents-container {
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

/* 移动端排版优化 */
@media (max-width: 768px) {
  .main-content {
    padding: 12px;
  }
}

// 区块容器
.section-container {
  margin-bottom: 48px;
  margin-top: 20px;
  
  &:first-of-type {
    margin-top: 24px;
  }
}

.section-header {
  display: flex;
  align-items: center;
  gap: 24px;
  margin-bottom: 24px;
  flex-wrap: wrap; /* 允许在移动端折行 */
}

@media (max-width: 600px) {
  .section-header {
    gap: 12px;
    margin-bottom: 16px;
  }
}

.section-title {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
  color: #303133;
  display: flex;
  align-items: baseline;
  
  .count {
    font-size: 18px;
    color: #909399;
    margin-left: 8px;
  }
}

/* 标题响应式 */
@media (max-width: 600px) {
  .section-title {
    font-size: 20px;
    width: 100%;
    
    .count {
      font-size: 16px;
    }
  }
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

// 应用网格
.apps-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(270px, 1fr));
  gap: 16px;
  margin-bottom: 32px;

  /* 响应式适配 */
  @media (max-width: 600px) {
    grid-template-columns: repeat(1, minmax(0, 1fr));
  }
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
  min-height: 200px;
  background: rgba(255, 255, 255, 0.95);
  border-radius: 16px;
  margin-bottom: 32px;
}
</style>
