<template>
  <Transition name="fade">
    <div v-if="visible" class="category-modal-overlay" @click="handleOverlayClick">
      <div class="category-modal" @click.stop>
        <!-- Header -->
        <div class="modal-header">
          <div class="header-left">
            <span class="category-icon">{{ categoryIcon }}</span>
            <h2 class="modal-title">{{ title }}</h2>
            <span class="app-count">({{ total || apps.length }} 个应用)</span>
          </div>
          <button class="close-btn" @click="handleClose">
            <el-icon><Close /></el-icon>
          </button>
        </div>

        <!-- Content -->
        <div ref="scrollContainerRef" class="modal-content">
          <div v-if="apps.length > 0" class="apps-grid">
            <AppCardNew
              v-for="app in apps"
              :key="app._id"
              :app="app"
              @click="handleAppClick(app._id)"
            />
          </div>

          <!-- Loading More -->
          <div v-if="loading" class="loading-more">
            <el-icon class="is-loading"><Loading /></el-icon>
            <span class="ml-8">加载中...</span>
          </div>

          <!-- Load More Trigger (Intersection Observer Sentinel) -->
          <div v-if="hasMore && !loading" ref="sentinelRef" class="load-more-trigger"></div>

          <!-- Empty State -->
          <div v-if="!loading && apps.length === 0" class="empty-state">
            <el-empty :description="emptyText || '暂无应用'" />
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { Close, Loading } from '@element-plus/icons-vue';
import AppCardNew from './AppCardNew.vue';
import type { AppNew } from '@/types/agent';

interface Props {
  visible: boolean;
  title: string;
  categoryIcon?: string;
  apps: AppNew[];
  loading?: boolean;
  hasMore?: boolean;
  total?: number;
  emptyText?: string;
}

interface Emits {
  (e: 'update:visible', value: boolean): void;
  (e: 'load-more'): void;
  (e: 'app-click', appId: string): void;
}

const props = withDefaults(defineProps<Props>(), {
  loading: false,
  hasMore: false,
  categoryIcon: '📦',
  emptyText: '暂无应用'
});

const emit = defineEmits<Emits>();

const scrollContainerRef = ref<HTMLElement | null>(null);
const sentinelRef = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;

// 处理关闭
const handleClose = () => {
  emit('update:visible', false);
};

// 处理遮罩点击
const handleOverlayClick = () => {
  handleClose();
};

// 处理应用卡片点击
const handleAppClick = (appId: string) => {
  emit('app-click', appId);
  // 不关闭弹窗,保持打开状态
};

// 设置 Intersection Observer
const setupObserver = () => {
  if (!sentinelRef.value) return;

  observer = new IntersectionObserver(
    (entries) => {
      const [entry] = entries;
      if (entry.isIntersecting && props.hasMore && !props.loading) {
        emit('load-more');
      }
    },
    {
      root: scrollContainerRef.value,
      threshold: 0.1
    }
  );

  observer.observe(sentinelRef.value);
};

// 监听弹窗显示状态
watch(() => props.visible, async (newVal) => {
  if (newVal) {
    // 弹窗打开时,等待DOM更新后设置observer
    await nextTick();
    setupObserver();
    
    // 阻止body滚动
    document.body.style.overflow = 'hidden';
  } else {
    // 弹窗关闭时,清理observer
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    
    // 恢复body滚动
    document.body.style.overflow = '';
  }
});

// 监听ESC键关闭
const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && props.visible) {
    handleClose();
  }
};

onMounted(() => {
  document.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown);
  if (observer) {
    observer.disconnect();
  }
  // 确保恢复body滚动
  document.body.style.overflow = '';
});
</script>

<style scoped lang="scss">
// 淡入淡出动画
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.category-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
  padding: 20px;
}

.category-modal {
  background: #fff;
  border-radius: 16px;
  width: 100%;
  max-width: 1200px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
  animation: modalSlideIn 0.4s ease-out;
}

@keyframes modalSlideIn {
  from {
    transform: translateY(20px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 24px 32px;
  border-bottom: 1px solid #ebeef5;
  flex-shrink: 0;

  .header-left {
    display: flex;
    align-items: center;
    gap: 12px;

    .category-icon {
      font-size: 28px;
    }

    .modal-title {
      font-size: 24px;
      font-weight: 600;
      color: #303133;
      margin: 0;
    }

    .app-count {
      font-size: 14px;
      color: #909399;
    }
  }

  .close-btn {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    border: none;
    background: #f5f7fa;
    color: #606266;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.3s ease;
    font-size: 20px;

    &:hover {
      background: #e4e7ed;
      color: #303133;
    }
  }
}

.modal-content {
  flex: 1;
  overflow-y: auto;
  padding: 32px;
}

.apps-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(270px, 1fr));
  gap: 16px;
  margin-bottom: 20px;
}

.loading-more {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 0;
  color: #909399;
  font-size: 14px;

  .is-loading {
    font-size: 20px;
    animation: rotating 1s linear infinite;
  }

  .ml-8 {
    margin-left: 8px;
  }
}

@keyframes rotating {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.load-more-trigger {
  height: 20px;
}

.empty-state {
  padding: 80px 0;
  text-align: center;
}

// 响应式布局
@media (max-width: 768px) {
  .category-modal-overlay {
    padding: 0;
  }

  .category-modal {
    max-width: 100%;
    max-height: 100vh;
    border-radius: 0;
  }

  .modal-header {
    padding: 20px;

    .header-left {
      gap: 8px;

      .category-icon {
        font-size: 24px;
      }

      .modal-title {
        font-size: 20px;
      }

      .app-count {
        font-size: 12px;
      }
    }

    .close-btn {
      width: 36px;
      height: 36px;
    }
  }

  .modal-content {
    padding: 20px;
  }

  .apps-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }
}

@media (max-width: 480px) {
  .apps-grid {
    grid-template-columns: 1fr;
  }
}
</style>
