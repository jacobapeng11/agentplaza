<template>
  <section class="category-apps-list" :aria-busy="loading">
    <div v-if="apps.length > 0" class="apps-grid">
      <AppCardNew
        v-for="app in apps"
        :key="app._id || app.tmbId"
        :app="app"
        @click="handleAppClick(app._id)"
      />
    </div>

    <div v-if="isInitialLoading" class="loading-state" aria-label="正在加载应用">
      <div class="apps-grid">
        <div v-for="index in 8" :key="index" class="skeleton-card">
          <el-skeleton animated>
            <template #template>
              <div class="skeleton-summary">
                <el-skeleton-item variant="image" class="skeleton-avatar" />
                <div class="skeleton-copy">
                  <el-skeleton-item variant="h3" style="width: 55%" />
                  <el-skeleton-item variant="text" style="width: 90%; margin-top: 10px" />
                </div>
              </div>
              <el-skeleton-item variant="text" style="width: 45%; margin-top: 18px" />
            </template>
          </el-skeleton>
        </div>
      </div>
    </div>

    <div v-else-if="apps.length === 0" class="empty-state">
      <el-empty description="暂无应用" />
    </div>

    <div v-if="apps.length > 0" class="scroll-status" aria-live="polite">
      <div v-if="hasMore" ref="loadMoreTrigger" class="load-more-trigger">
        <span v-if="loading" class="loading-more">
          <el-icon class="is-loading"><Loading /></el-icon>
          正在加载更多应用...
        </span>
        <span v-else class="scroll-hint">继续向下滚动加载更多</span>
      </div>
      <span v-else class="end-hint">已加载全部应用</span>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Loading } from '@element-plus/icons-vue';
import AppCardNew from './AppCardNew.vue';
import type { AppNew } from '@/types/agent';

interface Props {
  apps: AppNew[];
  loading?: boolean;
  currentCategory: string;
  hasMore?: boolean;
}

interface Emits {
  (e: 'app-click', appId: string): void;
  (e: 'load-more'): void;
}

const props = withDefaults(defineProps<Props>(), {
  loading: false,
  hasMore: false
});

const emit = defineEmits<Emits>();
const loadMoreTrigger = ref<HTMLElement | null>(null);
const loadRequested = ref(false);
let observer: IntersectionObserver | null = null;

const isInitialLoading = computed(() => props.loading && props.apps.length === 0);

const handleAppClick = (appId: string) => {
  emit('app-click', appId);
};

const requestNextPage = () => {
  if (!props.hasMore || props.loading || loadRequested.value) {
    return;
  }

  loadRequested.value = true;
  emit('load-more');
};

const observeLoadTrigger = async () => {
  observer?.disconnect();
  observer = null;

  if (!props.hasMore) {
    return;
  }

  await nextTick();
  if (!loadMoreTrigger.value) {
    return;
  }

  observer = new IntersectionObserver(
    entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        requestNextPage();
      }
    },
    {
      root: null,
      rootMargin: '320px 0px',
      threshold: 0.01
    }
  );
  observer.observe(loadMoreTrigger.value);
};

watch(
  () => props.loading,
  loading => {
    if (!loading) {
      loadRequested.value = false;
      void observeLoadTrigger();
    }
  }
);

watch(
  () => [props.currentCategory, props.hasMore, props.apps.length],
  () => {
    loadRequested.value = false;
    void observeLoadTrigger();
  }
);

onMounted(() => {
  void observeLoadTrigger();
});

onBeforeUnmount(() => {
  observer?.disconnect();
});
</script>

<style scoped lang="scss">
.category-apps-list {
  margin-top: 24px;
}

.apps-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(270px, 1fr));
  gap: 16px;
}

.loading-state {
  width: 100%;
}

.skeleton-card {
  min-height: 168px;
  padding: 18px 20px;
  overflow: hidden;
  border: 1px solid #d8eaf0;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.9);
}

.skeleton-summary {
  display: flex;
  align-items: center;
  gap: 14px;
}

.skeleton-avatar {
  width: 56px !important;
  height: 56px !important;
  flex: 0 0 56px;
  border-radius: 14px;
}

.skeleton-copy {
  min-width: 0;
  flex: 1;
}

.empty-state {
  display: flex;
  min-height: 260px;
  align-items: center;
  justify-content: center;
}

.scroll-status {
  display: flex;
  min-height: 72px;
  align-items: center;
  justify-content: center;
  color: #8b9da6;
  font-size: 13px;
}

.load-more-trigger {
  display: flex;
  width: 100%;
  min-height: 72px;
  align-items: center;
  justify-content: center;
}

.loading-more {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #4c94b2;
}

.scroll-hint,
.end-hint {
  color: #9aabb2;
}

@media (max-width: 768px) {
  .category-apps-list {
    margin-top: 18px;
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
