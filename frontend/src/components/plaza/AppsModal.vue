<template>
  <el-dialog
    :model-value="visible"
    :title="title"
    :width="dialogWidth"
    :fullscreen="isMobile"
    @update:model-value="handleClose"
    @close="handleClose"
  >
    <div class="apps-modal-content">
      <!-- 应用网格 -->
      <div v-if="apps.length > 0" class="apps-grid">
        <AppCardNew
          v-for="app in apps"
          :key="app._id"
          :app="app"
          @click="handleAppClick"
        />
      </div>

      <!-- 空状态 -->
      <div v-else-if="!loading" class="empty-state">
        <el-icon :size="60" color="#C0C4CC"><Document /></el-icon>
        <p>{{ emptyText }}</p>
      </div>

      <!-- 加载状态 -->
      <div v-if="loading" class="loading-more">
        <el-icon class="is-loading"><Loading /></el-icon>
        <span>加载中...</span>
      </div>

      <!-- 无限滚动触发器 -->
      <div v-if="hasMore && !loading" ref="sentinelRef" class="load-more-trigger">
        <!-- 哨兵元素，用于 Intersection Observer -->
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { Document, Loading } from '@element-plus/icons-vue';
import type { AppNew } from '../../types/agent';
import AppCardNew from './AppCardNew.vue';

// Props
interface Props {
  visible: boolean;
  title: string;
  apps: AppNew[];
  loading?: boolean;
  hasMore?: boolean;
  emptyText?: string;
}

const props = withDefaults(defineProps<Props>(), {
  loading: false,
  hasMore: false,
  emptyText: '暂无应用'
});

// Emits
const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void;
  (e: 'loadMore'): void;
  (e: 'appClick', appId: string): void;
}>();

// State
const sentinelRef = ref<HTMLElement | null>(null);
const isMobile = ref(window.innerWidth < 768);
let observer: IntersectionObserver | null = null;

// Computed
const dialogWidth = computed(() => {
  if (isMobile.value) return '100%';
  return '80%';
});

// Methods
const handleClose = () => {
  emit('update:visible', false);
};

const handleAppClick = (appId: string) => {
  emit('appClick', appId);
};

const handleResize = () => {
  isMobile.value = window.innerWidth < 768;
};

// 设置 Intersection Observer 实现无限滚动
const setupObserver = () => {
  if (!sentinelRef.value) return;

  observer = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting && props.hasMore && !props.loading) {
        emit('loadMore');
      }
    },
    {
      threshold: 0.1
    }
  );

  observer.observe(sentinelRef.value);
};

// Lifecycle
onMounted(() => {
  window.addEventListener('resize', handleResize);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize);
  if (observer) {
    observer.disconnect();
  }
});

// Watch for sentinel element
watch(
  () => sentinelRef.value,
  (newVal) => {
    if (newVal && props.visible) {
      setupObserver();
    }
  }
);

// Watch for dialog visibility
watch(
  () => props.visible,
  (newVal) => {
    if (newVal && sentinelRef.value) {
      setupObserver();
    } else if (!newVal && observer) {
      observer.disconnect();
    }
  }
);
</script>

<style scoped lang="scss">
.apps-modal-content {
  min-height: 400px;
  max-height: 70vh;
  overflow-y: auto;
  padding: 8px;
}

.apps-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(270px, 1fr));
  gap: 16px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 20px;
  text-align: center;

  p {
    margin-top: 20px;
    color: #909399;
    font-size: 16px;
  }
}

.loading-more {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  color: #909399;
  font-size: 14px;
  gap: 8px;

  .el-icon {
    font-size: 18px;
  }
}

.load-more-trigger {
  height: 1px;
  width: 100%;
}

// 响应式布局
@media (max-width: 768px) {
  .apps-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .apps-modal-content {
    max-height: 80vh;
  }
}

@media (max-width: 480px) {
  .apps-grid {
    grid-template-columns: 1fr;
  }
}
</style>
