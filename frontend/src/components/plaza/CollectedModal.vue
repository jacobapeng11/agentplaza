<template>
  <!-- 收藏应用弹窗 -->
  <el-dialog
    :model-value="visible"
    title="我收藏的应用"
    width="80%"
    @update:model-value="handleClose"
    class="collected-modal"
  >
    <div class="collected-content">
      <!-- 加载状态 -->
      <div v-if="loading && agents.length === 0" class="loading-state">
        <el-icon class="is-loading"><Loading /></el-icon>
        <p>正在加载收藏应用...</p>
      </div>
      
      <!-- 空状态 -->
      <div v-else-if="agents.length === 0" class="empty-state">
        <el-icon><WarningFilled /></el-icon>
        <p>暂无收藏的应用</p>
      </div>
      
      <!-- 收藏应用网格 -->
      <div v-else class="collected-grid">
        <div 
          v-for="agent in agents" 
          :key="agent._id" 
          class="collected-card"
          @click="handleAgentClick(agent._id)"
        >
          <!-- 应用图标 -->
          <div class="card-icon">
            <img 
              style="width: 100%;" 
              :src="getAvatarUrl(agent)" 
              alt="应用头像"
            >
          </div>
          <!-- 应用信息 -->
          <div class="card-content">
            <h3 class="agent-name">{{ agent.name }}</h3>
            <p class="collected-time">收藏于 {{ formatDate(agent.collectedAt) }}</p>
            <div class="card-stats">
              <span class="stat-item">
                <el-icon><View /></el-icon>
                {{ agent.chatCount || 0 }}
              </span>
              <span class="stat-item">
                <el-icon><User /></el-icon>
                {{ agent.userCount || 0 }}
              </span>
            </div>
          </div>
        </div>
      </div>
      
      <!-- 加载更多按钮 -->
      <div v-if="hasMore" class="load-more-section">
        <el-button 
          @click="handleLoadMore" 
          :loading="loading"
          type="primary"
          plain
        >
          加载更多 ({{ agents.length }}/{{ total }})
        </el-button>
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
/**
 * 收藏应用弹窗组件
 * 显示用户收藏的所有应用，支持分页加载
 */
import { Loading, WarningFilled, View, User } from '@element-plus/icons-vue';
import { resolveFastgptAssetUrl } from '../../config/fastgptConfig';

// 组件属性定义
interface Props {
  visible: boolean;   // 弹窗是否可见
  agents: any[];      // 收藏的应用列表
  loading?: boolean;  // 加载状态
  total: number;      // 总数
  hasMore: boolean;   // 是否有更多
}

defineProps<Props>();

// 事件定义
const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void;  // 更新可见状态
  (e: 'agentClick', agentId: string): void;     // 点击应用
  (e: 'loadMore'): void;                        // 加载更多
}>();

// 关闭弹窗
const handleClose = () => {
  emit('update:visible', false);
};

// 处理应用点击
const handleAgentClick = (agentId: string) => {
  emit('agentClick', agentId);
};

// 处理加载更多
const handleLoadMore = () => {
  emit('loadMore');
};

/**
 * 获取默认图标颜色
 * 基于应用ID生成一致的颜色,确保同一应用始终使用相同颜色
 */
const getDefaultIconColor = (seed: string) => {
  const colors = ['#f39c12', '#2ecc71', '#3498db', '#9b59b6', '#e74c3c', '#1abc9c', '#34495e', '#16a085'];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
};

/**
 * 获取头像 URL：外链应用直接使用，普通应用拼接
 */
const getAvatarUrl = (agent: any) => {
  const avatar = agent?.avatar;
  if (!avatar) return '/defAiImg.png';
  
  // 如果是外链应用，avatar 已经是完整 URL，直接使用
  if (agent.isLinkApp) {
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

/**
 * 格式化日期
 * 将日期字符串格式化为 YYYY/MM/DD 格式
 */
const formatDate = (dateString: string) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
};
</script>

<style scoped>
.collected-modal :deep(.el-dialog) {
  border-radius: 16px;
  overflow: hidden;
}

.collected-modal :deep(.el-dialog__header) {
  background: linear-gradient(135deg, #1890ff 0%, #36cfc9 100%);
  color: white;
  padding: 20px 24px;
  margin: 0;
}

.collected-modal :deep(.el-dialog__title) {
  color: white;
  font-size: 18px;
  font-weight: 600;
}

.collected-modal :deep(.el-dialog__close) {
  color: white;
  font-size: 20px;
}

.collected-modal :deep(.el-dialog__body) {
  padding: 24px;
  max-height: 70vh;
  overflow-y: auto;
}

.collected-content {
  min-height: 200px;
}

.collected-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
  margin-bottom: 20px;
}

.collected-card {
  background: white;
  border: 1px solid #f0f0f0;
  border-radius: 12px;
  padding: 16px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.collected-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  border-color: #e6f7ff;
}

.collected-card .card-icon {
  width: 56px;
  height: 56px;
  flex-shrink: 0;
  border-radius: 12px;
  overflow: hidden;
}

.default-icon {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: 600;
  font-size: 18px;
}

.collected-card .card-content {
  flex: 1;
  min-width: 0;
}

.collected-card .agent-name {
  margin: 0 0 8px 0;
  font-size: 16px;
  font-weight: 600;
  color: #262626;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.collected-card .collected-time {
  margin: 0 0 8px 0;
  font-size: 11px;
  color: #bfbfbf;
}

.collected-card .card-stats {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: #8c8c8c;
}

.collected-card .stat-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.collected-card .stat-item .el-icon {
  font-size: 14px;
}

.load-more-section {
  text-align: center;
  padding: 20px 0;
}

.loading-state {
  text-align: center;
  padding: 60px 20px;
  color: #8c8c8c;
}

.loading-state p {
  font-size: 14px;
  margin: 16px 0 0 0;
}

.loading-state .el-icon {
  font-size: 24px;
  color: #1890ff;
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: #bfbfbf;
}

.empty-state p {
  font-size: 14px;
  margin: 8px 0 0 0;
}

.empty-state i,
.empty-state .el-icon {
  font-size: 48px;
  color: #d9d9d9;
  margin-bottom: 16px;
}

@media (max-width: 768px) {
  .collected-modal :deep(.el-dialog) {
    width: 95% !important;
    margin: 5vh auto;
  }
  
  .collected-grid {
    grid-template-columns: 1fr;
  }
}
</style>
