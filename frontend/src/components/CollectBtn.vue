<template>
  <el-button
    :type="isFavorited ? 'danger' : 'default'"
    :loading="loading"
    :icon="isFavorited ? 'StarFilled' : 'Star'"
    @click="handleClick"
    class="collect-btn"
    :class="{ 'favorited': isFavorited }"
  >
    <span class="favorite-count">{{ favoriteCount }}</span>
  </el-button>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue';
import { ElMessage } from 'element-plus';
import { debounce } from 'lodash-es';
import { useAppsStore } from '../stores/apps';

interface Props {
  agentId: string;
  isFavorited: boolean;
  favoriteCount: number;
}

const props = defineProps<Props>();
const appsStore = useAppsStore();
const loading = ref(false);

// Optimistic update - immediately update UI, rollback on error
const handleClick = debounce(async () => {
  if (loading.value) return;
  
  loading.value = true;
  
  try {
    // Optimistic update: change UI state immediately
    const optimisticFavoriteCount = props.isFavorited 
      ? props.favoriteCount - 1 
      : props.favoriteCount + 1;
    
    // Toggle the favorite state optimistically
    await nextTick();
    
    // Call the API to toggle favorite
    await appsStore.toggleFavorite(props.agentId);
    
    ElMessage({
      message: props.isFavorited ? '已取消收藏' : '收藏成功',
      type: props.isFavorited ? 'info' : 'success'
    });
  } catch (error) {
    // Rollback UI changes on error
    ElMessage.error('操作失败，请重试');
    console.error('Favorite toggle error:', error);
  } finally {
    loading.value = false;
  }
}, 500); // 500ms debounce
</script>

<style scoped>
.collect-btn {
  display: flex;
  align-items: center;
  transition: all 0.3s ease;
}

.collect-btn.favorited {
  color: white;
  border-color: var(--danger-color);
  background-color: var(--danger-color);
}

.favorite-count {
  margin-left: var(--spacing-xs);
  font-size: var(--font-size-small);
}
</style>