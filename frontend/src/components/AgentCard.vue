<template>
  <el-card 
    class="agent-card" 
    :body-style="{ padding: '0px' }"
    shadow="never"
    @click="handleCardClick"
  >
    <div class="card-content">
      <div class="card-header">
        <img 
          v-if="agent.avatar && (agent.avatar.indexOf('.png') > -1 || agent.avatar.indexOf('.jpg') > -1 || agent.avatar.indexOf('.jpeg') > -1 || agent.avatar.indexOf('.gif') > -1)" 
          :src="agent.avatar" 
          class="agent-avatar" 
          alt="Agent Avatar"
          @error="onImageError"
        />
        <div v-else class="default-avatar">
          <i class="el-icon-chat-dot-round"></i>
        </div>
        
        <div class="agent-info">
          <h3 class="agent-name">{{ agent.name }}</h3>
          <p class="agent-type">{{ agent.type }}</p>
        </div>
      </div>
      
      <div class="card-body">
        <p class="agent-description" v-if="agent.description">
          {{ agent.description }}
        </p>
      </div>
      
      <div class="card-footer">
        <div class="agent-stats">
          <span class="stat-item">
            <i class="el-icon-star-on"></i> {{ agent.favoriteCount }}
          </span>
          <span class="stat-item">
            <i class="el-icon-view"></i> {{ agent.hotScore }}
          </span>
        </div>
        
        <CollectBtn 
          :agent-id="agent._id" 
          :is-favorited="isFavorited"
          :favorite-count="agent.favoriteCount"
          @update-favorite="handleFavoriteUpdate"
        />
      </div>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import CollectBtn from './CollectBtn.vue';
import type { Agent } from '../types/agent';
import { buildFastgptChatUrl } from '../config/fastgptConfig';

interface Props {
  agent: Agent;
}

const props = defineProps<Props>();

// Check if the current agent is favorited
const isFavorited = computed(() => {
  return props.agent.isFavorited || false;
});

// Handle card click to navigate to the agent workspace
const handleCardClick = () => {
  // 检查是否有 appUrl 字段（外链应用）
  const appUrl = (props.agent as any).appUrl;
  let url: string;
  
  if (appUrl) {
    // 外链应用：直接跳转到 appUrl
    url = appUrl;
  } else {
    // 普通应用：跳转到应用详情页
    url = buildFastgptChatUrl(props.agent._id);
  }
  
  if (url) window.open(url, '_blank', 'noopener,noreferrer');
};

// Handle favorite update
const handleFavoriteUpdate = (newFavoriteState: boolean, newFavoriteCount: number) => {
  emit('update-favorite', { 
    agentId: props.agent._id, 
    isFavorited: newFavoriteState,
    favoriteCount: newFavoriteCount 
  });
};

const emit = defineEmits<{
  'update-favorite': [value: { agentId: string; isFavorited: boolean; favoriteCount: number }];
}>();

// Handle image error by showing default placeholder
const onImageError = (e: Event) => {
  const target = e.target as HTMLImageElement;
  target.src = '/placeholder-avatar.png'; // Default placeholder
};
</script>

<style scoped>
.agent-card {
  border-radius: var(--border-radius-medium);
  overflow: hidden;
  transition: all 0.3s ease;
  height: 100%;
  display: flex;
  flex-direction: column;
  cursor: pointer;
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.04);
}

.agent-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 16px 0 rgba(0, 0, 0, 0.1);
}

.card-content {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.card-header {
  display: flex;
  padding: var(--spacing-md);
  border-bottom: 1px solid var(--border-lighter);
}

.agent-avatar {
  width: 60px;
  height: 60px;
  border-radius: var(--border-radius-medium);
  object-fit: cover;
  margin-right: var(--spacing-md);
}

.default-avatar {
  width: 60px;
  height: 60px;
  border-radius: var(--border-radius-medium);
  background-color: #f5f7fa;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: var(--spacing-md);
  color: #909399;
  font-size: var(--font-size-large);
}

.agent-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.agent-name {
  margin: 0;
  font-size: var(--font-size-medium);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-type {
  margin: var(--spacing-xs) 0 0 0;
  font-size: var(--font-size-small);
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-body {
  padding: var(--spacing-md);
  flex: 1;
  display: flex;
  align-items: flex-start;
}

.agent-description {
  margin: 0;
  font-size: var(--font-size-small);
  color: var(--text-regular);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}

.card-footer {
  padding: var(--spacing-md);
  border-top: 1px solid var(--border-lighter);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.agent-stats {
  display: flex;
  gap: var(--spacing-lg);
}

.stat-item {
  display: flex;
  align-items: center;
  font-size: var(--font-size-small);
  color: var(--text-secondary);
}

.stat-item i {
  margin-right: var(--spacing-xs);
}

.stat-item .el-icon-star-on.favorited {
  color: var(--warning-color);
}

.collect-btn-wrapper {
  display: flex;
  align-items: center;
}
</style>
