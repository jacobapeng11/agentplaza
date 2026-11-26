<template>
  <!-- 热门智能体卡片 -->
  <div 
    class="hot-agent-card"
    @click="handleClick"
  >
    <!-- 卡片头部 -->
    <div class="card-header">
      <!-- 智能体图标 -->
      <div class="card-icon">
        <img 
          style="width: 100%;" 
          :src="avatarUrl" 
          alt="智能体头像"
        >
      </div>
      <!-- 操作按钮区域 -->
      <div class="card-actions" v-if="showCollectBtn">
        <button 
          class="collect-btn"
          :class="{ 'collected': agent.isCollected }"
          @click.stop="handleCollect"
        >
          <el-icon>
            <StarFilled v-if="agent.isCollected" />
            <Star v-else />
          </el-icon>
          {{ agent.isCollected ? '已收藏' : '收藏' }}
        </button>
      </div>
    </div>
    <!-- 卡片内容 -->
    <div class="card-body">
      <h3 class="agent-name">{{ agent.name }}</h3>
      <p class="agent-description">{{ agent.intro || defaultDescription }}</p>
    </div>
    <!-- 卡片底部统计 -->
    <div class="card-footer">
      <div class="stats">
        <span class="stat-item">
          <el-icon><View /></el-icon>
          {{ agent.chatCount }}
        </span>
        <span class="stat-item">
          <el-icon><User /></el-icon>
          {{ agent.userCount || 0 }}
        </span>
        <span class="stat-item">
          <el-icon><StarFilled /></el-icon>
          {{ agent.collectCount || 0 }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 热门智能体卡片组件
 * 展示智能体的图标、名称、描述和统计信息
 */
import { computed } from 'vue';
import { View, StarFilled, Star, User } from '@element-plus/icons-vue';
import type { Agent } from '../../types/agent';
import { resolveFastgptAssetUrl } from '../../config/fastgptConfig';

// 组件属性定义
interface Props {
  agent: Agent;           // 智能体数据
  showCollectBtn?: boolean; // 是否显示收藏按钮
}

const props = defineProps<Props>();

// 事件定义
const emit = defineEmits<{
  (e: 'click', agentId: string): void;  // 点击卡片
  (e: 'collect', agent: Agent): void;   // 收藏/取消收藏
}>();

/**
 * 获取默认描述
 * 根据智能体类型返回合适的默认描述
 */
const defaultDescription = computed(() => {
  const type = props.agent.type || '';
  if (type.includes('对话') || type.includes('助手')) return '智能对话助手，为您提供专业的咨询和支持服务';
  if (type.includes('写作') || type.includes('文档')) return '专业的文档处理助手,帮助您快速创建和编辑各类文档';
  if (type.includes('开发') || type.includes('代码')) return '代码开发助手，提供代码审查、优化建议和开发支持';
  if (type.includes('分析') || type.includes('数据')) return '数据分析专家，提供数据处理、分析和可视化服务';
  if (type.includes('人事') || type.includes('客户')) return '客户服务助手，提供专业友好的客户支持服务';
  return '智能助手，为您提供全方位的AI服务支持';
});

/**
 * 获取默认图标颜色
 * 基于应用ID生成一致的颜色，确保同一应用始终使用相同颜色
 */
const defaultIconColor = computed(() => {
  const colors = ['#f39c12', '#2ecc71', '#3498db', '#9b59b6', '#e74c3c', '#1abc9c', '#34495e', '#16a085'];
  const id = props.agent._id || '';
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
});

/**
 * 处理头像 URL：外链应用直接使用，普通应用拼接
 */
const avatarUrl = computed(() => {
  const avatar = props.agent?.avatar;
  if (!avatar) return '/defAiImg.png';
  
  // 如果是外链应用，avatar 已经是完整 URL，直接使用
  const isLinkApp = (props.agent as any)?.isLinkApp;
  if (isLinkApp) {
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
});

// 处理卡片点击
const handleClick = () => {
  emit('click', props.agent._id);
};

// 处理收藏操作
const handleCollect = () => {
  emit('collect', props.agent);
};
</script>

<style scoped>
.hot-agent-card {
  background: white;
  border-radius: 12px;
  padding: 0;
  border: none;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
  cursor: pointer;
}

.hot-agent-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.12);
}

.hot-agent-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 80px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  z-index: 0;
}

.card-header {
  position: relative;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 16px 16px 0;
  margin-bottom: 40px;
  z-index: 1;
}

.card-icon {
  width: 64px;
  height: 64px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  overflow: hidden;
  border: 3px solid rgba(255, 255, 255, 0.3);
  background-color: #fff;
}

.default-icon {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: 600;
  font-size: 24px;
  text-transform: uppercase;
}

.card-actions {
  position: relative;
  display: flex;
  align-items: center;
  z-index: 1;
}

.collect-btn {
  padding: 6px 12px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.3);
  color: #666;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
  backdrop-filter: blur(10px);
}

.collect-btn:hover {
  background: rgba(255, 255, 255, 1);
  border-color: rgba(255, 255, 255, 0.5);
  color: #409eff;
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.collect-btn.collected {
  background: rgba(255, 255, 255, 1);
  border-color: rgba(64, 158, 255, 0.3);
  color: #409eff;
}

.collect-btn.collected:hover {
  background: rgba(255, 255, 255, 1);
  border-color: rgba(64, 158, 255, 0.5);
  color: #409eff;
}

.collect-btn .el-icon {
  font-size: 14px;
}

.card-body {
  position: relative;
  flex: 1;
  padding: 0 16px 16px;
  z-index: 1;
}

.agent-name {
  margin: 0 0 8px 0;
  font-size: 16px;
  font-weight: 600;
  color: #303133;
  line-height: 1.4;
}

.agent-description {
  margin: 0;
  font-size: 13px;
  color: #666;
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-footer {
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 12px 16px;
  border-top: 1px solid #f0f0f0;
  background-color: #fafafa;
  z-index: 1;
}

.stats {
  display: flex;
  gap: 20px;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #999;
  font-weight: 400;
}

.stat-item i {
  font-size: 16px;
  color: #bbb;
}
</style>
