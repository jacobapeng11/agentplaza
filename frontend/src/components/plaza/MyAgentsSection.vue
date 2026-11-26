<template>
  <!-- 我的智能体区域 - 左右分栏布局 -->
  <section class="my-agents-section-new">
    <!-- 内容行：左右分栏 -->
    <div class="section-content">
      <!-- 左侧：我创建的应用列表 -->
      <div class="section-apps">
        <!-- 标题 -->
        <div class="section-header">
          <h3 class="section-title">
            我创建的<span v-if="myCreatedAppsTotal > 0" class="count">({{ myCreatedAppsTotal }})</span>
          </h3>
          <a
            v-if="myCreatedAppsTotal > 0"
            class="view-more-link"
            @click="handleViewMoreCreated"
          >
            查看更多 <el-icon><ArrowRight /></el-icon>
          </a>
        </div>

        <!-- 加载状态 -->
        <div v-if="loading" class="loading-container">
          <el-skeleton :rows="1" animated />
        </div>

        <!-- 应用列表 -->
        <div v-else-if="myCreatedApps && myCreatedApps.length > 0" class="apps-row">
          <div
            v-for="app in displayedCreatedApps"
            :key="app._id"
            class="app-card"
            @click="handleAppClick(app._id, 'created')"
          >
            <img :src="getAvatarUrl(app)" class="app-avatar">
            <div class="app-content">
              <div class="app-name">{{ app.name || '未命名应用' }}</div>
              <div class="app-stats">
                <span class="stat-item">
                  <img class="stat-icon" src="/appIcon1.png" alt="user" />
                  <span class="stat-value">{{ formatCount(app.userCount || 0) }}人</span>
                </span>
                <span class="stat-item collect-item" @click.stop="toggleCollect(app)">
                  <img class="stat-icon" :src="isAppCollected(app._id) ? '/appIcon3_active.png' : '/appIcon3.png'" alt="fav" />
                  <span class="stat-value">{{ formatCount(app.favoriteCount || 0) }}次</span>
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- 空状态 -->
        <div v-else class="empty-state">
          <img src="/topIcon2.png" alt="">
          <p v-if="!isLoggedIn">请登录查看我创建的智能体</p>
          <p v-else>点击页面右上角“创建智能体”，创建你的第一个智能体吧！</p>
        </div>
      </div>

      <!-- 右侧：我收藏的应用列表 -->
      <div class="section-apps">
        <!-- 标题 -->
        <div class="section-header">
          <h3 class="section-title">
            我收藏的<span v-if="myCollectedApps.length > 0" class="count">({{ myCollectedApps.length }})</span>
          </h3>
          <a
            v-if="myCollectedApps.length > 0"
            class="view-more-link"
            @click="handleViewMoreCollected"
          >
            查看更多 <el-icon><ArrowRight /></el-icon>
          </a>
        </div>

        <!-- 加载状态 -->
        <div v-if="loading" class="loading-container">
          <el-skeleton :rows="1" animated />
        </div>

        <!-- 应用列表 -->
        <div v-else-if="myCollectedApps && myCollectedApps.length > 0" class="apps-row">
          <div
            v-for="app in displayedCollectedApps"
            :key="app._id"
            class="app-card"
            @click="handleAppClick(app._id, 'collected')"
          >
            <img :src="getAvatarUrl(app)" class="app-avatar" />
            <div class="app-content">
              <div class="app-name">{{ app.name || '未命名应用' }}</div>
              <div class="app-tag" v-if="getFirstTag(app)">
                {{ getFirstTag(app) }}
              </div>
            </div>
          </div>
        </div>

        <!-- 空状态 -->
        <div v-else class="empty-state">
          <img src="/topIcon1.png" alt="">
          <p v-if="!isLoggedIn">请登录查看我收藏的智能体</p>
          <p style="margin: 0;" v-else>还没有收藏哦~  快去广场收藏你喜欢的智能体吧！</p>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
/**
 * 我的智能体区域组件（横向布局版本）
 * 上方显示"我创建的"，下方显示"我收藏的"
 * 每行最多显示4个应用（横向排列）
 */
import { computed, onMounted } from 'vue';
import { Document, Star, User, ArrowRight } from '@element-plus/icons-vue';
import type { AppNew } from '../../types/agent';
import { useAppsStore } from '../../stores/apps';
import { resolveFastgptAssetUrl } from '../../config/fastgptConfig';

// 组件属性定义
interface Props {
  loading?: boolean;  // 加载状态
}

defineProps<Props>();

// 事件定义
const emit = defineEmits<{
  (e: 'viewMoreCreated'): void;    // 查看更多创建的应用
  (e: 'viewMoreCollected'): void;  // 查看更多收藏的应用
  (e: 'appClick', appId: string, source: 'created' | 'collected'): void;  // 点击应用卡片
}>();

const appsStore = useAppsStore();

// Computed
const isLoggedIn = computed(() => appsStore.isLoggedIn);
const myCreatedApps = computed(() => appsStore.myCreatedAppsNew || []);
const myCreatedAppsTotal = computed(() => appsStore.myCreatedAppsNewTotal || 0);
const myCollectedApps = computed(() => appsStore.myCollectedAppsNew || []);

// 最多显示4个应用
const displayedCreatedApps = computed(() => {
  const apps = myCreatedApps.value;
  return Array.isArray(apps) ? apps.slice(0, 4) : [];
});
const displayedCollectedApps = computed(() => {
  const apps = myCollectedApps.value;
  return Array.isArray(apps) ? apps.slice(0, 4) : [];
});

// Methods
const handleViewMoreCreated = () => {
  emit('viewMoreCreated');
};

const handleViewMoreCollected = () => {
  emit('viewMoreCollected');
};

const handleAppClick = (appId: string, source: 'created' | 'collected') => {
  emit('appClick', appId, source);
};

// 格式化数字
const formatCount = (count: number | undefined): string => {
  if (!count || count === 0) {
    return '0';
  }
  if (count >= 10000) {
    return `${(count / 10000).toFixed(1)}万`;
  } else if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  return count.toString();
};

// 判断某个应用是否在我的收藏列表中
const isAppCollected = (appId: string) => {
  try {
    return Array.isArray(myCollectedApps.value) && myCollectedApps.value.some((a: any) => (a && (a._id || a._id?.toString()) === appId || a._id?.toString() === appId));
  } catch (err) {
    return false;
  }
};

// 切换收藏状态（用于小型卡片的收藏按钮）
const toggleCollect = async (app: any) => {
  if (!app || !app._id) return;
  try {
    await appsStore.toggleCollect(app._id, app);
    // 静默刷新收藏列表，确保 store 保持最新的完整收藏数据
    if (typeof appsStore.fetchMyCollectedAppsNewSilent === 'function') {
      await appsStore.fetchMyCollectedAppsNewSilent();
    } else {
      await appsStore.fetchMyCollectedAppsNew();
    }
  } catch (err) {
    console.error('切换收藏失败:', err);
  }
};

// 获取头像 URL：外链应用直接使用，普通应用拼接
const getAvatarUrl = (app: any) => {
  const avatar = app?.avatar;
  if (!avatar) return '/defAiImg.png';
  
  // 如果是外链应用，avatar 已经是完整 URL，直接使用
  if (app.isLinkApp) {
    return avatar;
  }
  
  // 普通应用：判断是否是图片文件，如果是则拼接 URL
  const hasImageExt = avatar.indexOf('.png') > -1 || 
                      avatar.indexOf('.jpg') > -1 || 
                      avatar.indexOf('.jpeg') > -1 || 
                      avatar.indexOf('.gif') > -1;
  
  if (hasImageExt) {
    return resolveFastgptAssetUrl(avatar);
  }
  
  return '/defAiImg.png';
};

// 获取应用的第一个标签
const getFirstTag = (app: any) => {
  if (!app) return '';
  
  // 优先返回分类作为第一个标签
  const category = app.newType || app.type || app.category;
  if (category) {
    return category;
  }
  
  // 如果没有分类，尝试从 tags 数组获取
  if (Array.isArray(app.tags) && app.tags.length > 0) {
    return app.tags[0];
  }
  
  return '';
};

// 组件自洽加载：父页面同时加载时由 store 的并发去重合并为一次请求
onMounted(async () => {
  const results = await Promise.allSettled([
    appsStore.fetchMyCreatedAppsNew(undefined, true),
    appsStore.fetchMyCollectedAppsNew(undefined, true)
  ]);
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.error(`加载${index === 0 ? '我创建的' : '我收藏的'}失败:`, result.reason);
    }
  });
});
</script>

<style scoped lang="scss">
.my-agents-section-new {
  margin-bottom: 0px;
}

// 标题行（现在在每个模块内部）
.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.section-title {
  font-size: 18px;
  font-weight: 600;
  color: #244653;
  margin: 0;
  display: flex;
  align-items: baseline;
  
  .count {
    font-size: 14px;
    color: #69a8c2;
    font-weight: 400;
    margin-left: 4px;
  }
}

.view-more-link {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: #64a6c0;
  cursor: pointer;
  text-decoration: none;
  transition: color 0.3s;
  
  &:hover {
    color: #318db4;
  }
  
  .el-icon {
    font-size: 12px;
  }
}

// 内容区域：左右分栏
.section-content {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.section-apps {
  min-height: 100px;
  padding: 16px;
  border-radius: 12px;
  
  // 第一个模块（我创建的）
  &:first-child {
    background: linear-gradient(259deg, rgba(255, 255, 255, 0.48) -4%, rgba(255, 255, 255, 0) 103%);
  }
  
  // 第二个模块（我收藏的）
  &:last-child {
    background: linear-gradient(280deg, rgba(255, 255, 255, 0) 10%, rgba(255, 255, 255, 0.7) 113%);
  }
}

// 应用列表：每个区域横向显示4个
.apps-row {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

// 应用卡片 - 左右结构
.app-card {
  width: 182px;
  height: 64px;
  background: #ffffff;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  padding: 12px;
  cursor: pointer;
  transition: all 0.3s;
  display: flex;
  align-items: center;
  gap: 12px;
  
  &:hover {
    border-color: #409eff;
    box-shadow: 0 2px 12px rgba(64, 158, 255, 0.15);
    transform: translateY(-2px);
  }
}

// 左侧头像
.app-avatar {
  width: 35px;
  height: 35px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
  background: #f5f7fa;
}

// 右侧内容区（上下结构）
.app-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0; // 允许文字截断
}

// 应用名称
.app-name {
  font-size: 14px;
  font-weight: 500;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.4;
}

// 统计信息：横向排列
.app-stats {
  display: flex;
  gap: 12px;
  align-items: center;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 4px;
  
  .stat-icon {
    width: 14px;
    height: 14px;
    object-fit: contain;
  }
  
  .stat-value {
    color: #909399;
    font-size: 12px;
  }
}

/* 可点击的收藏图标样式 */
.collect-item {
  cursor: pointer;
}

.collect-item .stat-value {
  user-select: none;
}

// 标签样式（用于收藏列表）
.app-tag {
  display: inline-block;
  padding: 4px 12px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  background-color: #E6F0FF;
  color: #3B66D6;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  width: fit-content;
}

.loading-container {
  padding: 20px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  // padding: 40px 20px;
  text-align: center;
  border-radius: 8px;
  margin-top: -30px;

  p {
    margin-top: 12px;
    color: #1A66F3;
    font-family: PingFang SC;
    font-size: 13px;
    margin: 0;
  }
  img {
    width: 60px;
    height: 60px;
  }
}

// 响应式布局
@media (max-width: 1600px) {
  .apps-row {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media (max-width: 1200px) {
  .section-content {
    grid-template-columns: 1fr;
    gap: 12px;
  }
  
  .section-headers {
    grid-template-columns: 1fr;
    gap: 16px;
  }
  
  .apps-row {
    grid-template-columns: repeat(4, 1fr);
  }
}

@media (max-width: 768px) {
  .section-apps {
    padding: 0;
    margin-bottom: 20px;
    background: none !important;
  }
  .section-title {
    font-size: 16px;
    font-weight: 600;
      margin-bottom: 0px;
    
    .count {
      font-size: 13px;
      color: #909399;
      margin-left: 4px;
      font-weight: normal;
    }
  }
  
  .apps-row {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }
  
  .app-card {
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    padding: 12px;
    border: none;
    border-radius: 12px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06), 0 1px 4px rgba(0,0,0, 0.03);
    background: rgba(255, 255, 255, 0.85);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    transition: transform 0.2s, box-shadow 0.2s;
  }
  
  .app-card:active {
    transform: scale(0.97);
  }
  
  .app-name {
    font-size: 13px;
  }
  
  .app-stats {
    font-size: 11px;
  }
}

@media (max-width: 480px) {
  .apps-row {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>

<style scoped lang="scss">
/* 顶部模块使用与页面一致的低对比底色，减少与广场内容的视觉分层。 */
.section-content {
  gap: 10px;
}

.section-apps,
.section-apps:first-child,
.section-apps:last-child {
  min-height: 100px;
  padding: 14px 16px;
  border: 1px solid rgba(126, 184, 207, 0.12);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.22);
  box-shadow: none;
}

/* 首页个人应用保持小尺寸，同时与广场卡片共享边框、圆角和配色语言。 */
.apps-row {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(168px, 182px));
  justify-content: start;
  gap: 10px;
}

.app-card {
  width: 100%;
  min-width: 0;
  height: 72px;
  padding: 11px 12px;
  border: 1px solid #c7e7f2;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 3px 12px rgba(43, 108, 137, 0.05);

  &:hover {
    border-color: #79c8e3;
    box-shadow: 0 8px 20px rgba(43, 108, 137, 0.11);
    transform: translateY(-2px);
  }
}

.app-avatar {
  width: 42px;
  height: 42px;
  border: 1px solid rgba(68, 161, 198, 0.14);
  border-radius: 11px;
  background: #eef8fb;
}

.app-name {
  color: #284451;
  font-weight: 650;
}

.app-tag {
  height: 20px;
  max-width: 100%;
  padding: 0 8px;
  overflow: hidden;
  border-radius: 4px;
  color: #66818c;
  background: #eaf7f9;
  font-weight: 500;
  line-height: 20px;
  text-overflow: ellipsis;
}

@media (max-width: 768px) {
  .section-apps,
  .section-apps:first-child,
  .section-apps:last-child {
    padding: 0;
    border: 0;
    background: none;
  }

  .apps-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .app-card {
    height: 68px;
    padding: 10px;
    border: 1px solid #c7e7f2;
    border-radius: 13px;
    box-shadow: 0 3px 12px rgba(43, 108, 137, 0.05);
  }
}
</style>
