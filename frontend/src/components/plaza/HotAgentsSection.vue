<template>
  <!-- 热门智能体区域 -->
  <section class="hot-agents-section">
    <!-- 区域头部 -->
    <div class="section-header">
      <div class="section-left">
        <h2 class="section-title">热门智能体</h2>
      </div>
    </div>
    
    <!-- 智能体卡片网格 -->
    <div class="hot-agents-grid">
      <HotAgentCard
        v-for="agent in agents" 
        :key="agent._id" 
        :agent="agent"
        :show-collect-btn="isLoggedIn"
        @click="handleAgentClick"
        @collect="handleCollect"
      />
      
      <!-- 加载状态 -->
      <div v-if="loading" class="loading-state">
        <el-icon class="is-loading"><Loading /></el-icon>
        <p>正在加载热门智能体...</p>
      </div>
      
      <!-- 空状态 -->
      <div v-else-if="agents.length === 0" class="empty-state">
        <el-icon><WarningFilled /></el-icon>
        <p>{{ searchQuery ? '未找到匹配的热门智能体' : '暂无热门智能体' }}</p>
      </div>
    </div>
    
    <!-- 分页器 -->
    <div v-if="!loading && totalPages > 1" class="hot-agents-pagination">
      <el-pagination
        :current-page="currentPage"
        :page-size="pageSize"
        :total="total"
        layout="total, prev, pager, next, jumper"
        @current-change="handlePageChange"
        background
      />
    </div>
  </section>
</template>

<script setup lang="ts">
/**
 * 热门智能体区域组件
 * 展示热门智能体列表，支持分页和搜索
 */
import { Loading, WarningFilled } from '@element-plus/icons-vue';
import HotAgentCard from './HotAgentCard.vue';
import type { Agent } from '../../types/agent';

// 组件属性定义
interface Props {
  agents: Agent[];        // 智能体列表
  loading?: boolean;      // 加载状态
  isLoggedIn?: boolean;   // 是否已登录
  searchQuery?: string;   // 搜索关键词
  currentPage: number;    // 当前页码
  pageSize: number;       // 每页数量
  total: number;          // 总数
}

const props = defineProps<Props>();

// 事件定义
const emit = defineEmits<{
  (e: 'agentClick', agentId: string): void; // 点击智能体
  (e: 'collect', agent: Agent): void;       // 收藏智能体
  (e: 'pageChange', page: number): void;    // 切换页码
}>();

// 计算总页数
const totalPages = Math.ceil(props.total / props.pageSize);

// 处理智能体点击
const handleAgentClick = (agentId: string) => {
  emit('agentClick', agentId);
};

// 处理收藏操作
const handleCollect = (agent: Agent) => {
  emit('collect', agent);
};

// 处理页码切换
const handlePageChange = (page: number) => {
  emit('pageChange', page);
};
</script>

<style scoped>
.hot-agents-section {
  margin-top: 30px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.section-left {
  display: flex;
  align-items: center;
}

.section-title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: #262626;
}

.hot-agents-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
}

.empty-state {
  grid-column: 1 / -1;
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

.loading-state {
  grid-column: 1 / -1;
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

/* Hot agents pagination */
.hot-agents-pagination {
  display: flex;
  justify-content: center;
  margin-top: 32px;
  padding: 20px 0;
}

.hot-agents-pagination :deep(.el-pagination) {
  display: flex;
  align-items: center;
  gap: 8px;
}

.hot-agents-pagination :deep(.el-pagination.is-background .el-pager li) {
  border-radius: 6px;
  font-weight: 500;
  min-width: 36px;
  height: 36px;
  line-height: 36px;
}

.hot-agents-pagination :deep(.el-pagination.is-background .el-pager li:not(.is-disabled).is-active) {
  background-color: #1890ff;
}

.hot-agents-pagination :deep(.el-pagination.is-background .btn-prev),
.hot-agents-pagination :deep(.el-pagination.is-background .btn-next) {
  border-radius: 6px;
  min-width: 36px;
  height: 36px;
}

@media (max-width: 1200px) {
  .hot-agents-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 768px) {
  .hot-agents-grid {
    grid-template-columns: 1fr;
  }
  
  .hot-agents-pagination :deep(.el-pagination) {
    flex-wrap: wrap;
    justify-content: center;
  }
  
  .hot-agents-pagination :deep(.el-pagination .el-pagination__total),
  .hot-agents-pagination :deep(.el-pagination .el-pagination__jump) {
    display: none;
  }
}
</style>
