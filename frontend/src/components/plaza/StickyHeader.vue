<template>
  <div class="sticky-header-wrapper">
    <div 
      ref="headerRef" 
      class="sticky-header" 
      :class="{ 'with-shadow': isScrolled }"
    >
        <!-- 全屏背景层（与顶部背景融合），仅在吸顶时显示 -->
        <!-- v-show 代替 v-if：避免 iOS 惯性滚动期间 DOM 增删导致闪烁 -->
        <div v-show="isSticky" class="sticky-bleed-bg" aria-hidden="true"></div>

      <!-- 内部受限宽度内容 -->
      <div class="sticky-inner">
        <div v-if="props.title" class="sticky-title">{{ props.title }}</div>
        <div class="header-row">
        <!-- 左侧：分类标签 + 排序选项 -->
        <div class="left-section">
          <!-- 分类标签 -->
          <div class="category-tabs">
            <div
              v-for="category in categories"
              :key="category.id"
              class="category-tab"
              :class="{ active: currentCategory === category.id }"
              @click="handleCategoryClick(category.id)"
            >
              <span class="category-name">{{ category.name }}</span>
            </div>
          </div>

          <!-- 分隔符 -->
          <div class="divider">|</div>

          <!-- 排序选项 -->
          <div class="sort-tabs" :aria-busy="sortLoading">
            <div
              class="sort-tab"
              :class="{ active: currentSort === 'latest', loading: sortLoading && currentSort === 'latest' }"
              @click="handleSortChange('latest')"
            >
              <el-icon v-if="sortLoading && currentSort === 'latest'" class="sort-loading-icon"><Loading /></el-icon>
              最新
            </div>
            <div
              class="sort-tab"
              :class="{ active: currentSort === 'hot', loading: sortLoading && currentSort === 'hot' }"
              @click="handleSortChange('hot')"
            >
              <el-icon v-if="sortLoading && currentSort === 'hot'" class="sort-loading-icon"><Loading /></el-icon>
              最热
            </div>
          </div>
        </div>

        <!-- 右侧：搜索框 -->
        <div class="search-box">
            <el-input
              v-model="searchKeyword"
              :placeholder="props.searchPlaceholder"
              :prefix-icon="Search"
              clearable
              @input="handleSearchInput"
              @clear="handleSearchClear"
            />
        </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { Loading, Search } from '@element-plus/icons-vue';
import { debounce } from 'lodash-es';
import type { Category } from '@/types/agent';

interface Props {
  categories: Category[];
  currentCategory: string;
  modelValue?: string; // v-model for search keyword
  currentSort?: string; // 当前排序方式
  sortLoading?: boolean; // 排序切换中的加载状态
  title?: string; // 页面标题，会与分类一起吸顶显示
  searchPlaceholder?: string;
}

interface Emits {
  (e: 'category-change', categoryId: string): void;
  (e: 'search', keyword: string): void;
  (e: 'update:modelValue', value: string): void;
  (e: 'sort-change', sortType: string): void;
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: '',
  currentSort: 'hot',
  sortLoading: false,
  title: '',
  searchPlaceholder: '\u641c\u7d22\u667a\u80fd\u4f53'
});

const emit = defineEmits<Emits>();

const headerRef = ref<HTMLElement | null>(null);
const isScrolled = ref(false);
// 当 header 实际处于吸顶（stuck）状态时为 true
const isSticky = ref(false);
const searchKeyword = ref(props.modelValue);

watch(() => props.modelValue, (value) => {
  if (value !== searchKeyword.value) {
    searchKeyword.value = value || '';
  }
});

// Intersection Observer 监听滚动状态
const setupScrollObserver = () => {
  if (!headerRef.value) return;

  const observer = new IntersectionObserver(
    ([entry]) => {
      // 当元素不完全可见时,显示阴影
      isScrolled.value = entry.intersectionRatio < 1;
    },
    {
      threshold: [1],
      rootMargin: '-1px 0px 0px 0px' // 轻微偏移以触发
    }
  );

  observer.observe(headerRef.value);

  return observer;
};

// 处理分类点击
const handleCategoryClick = (categoryId: string) => {
  if (categoryId === props.currentCategory) return;
  
  // 清空搜索
  searchKeyword.value = '';
  emit('update:modelValue', '');
  
  // 触发分类切换
  emit('category-change', categoryId);
};

// 防抖搜索处理
const debouncedSearch = debounce((keyword: string) => {
  emit('search', keyword);
}, 300);

// 处理搜索输入
const handleSearchInput = (value: string) => {
  emit('update:modelValue', value);
  debouncedSearch(value);
};

// 处理搜索清除
const handleSearchClear = () => {
  emit('update:modelValue', '');
  emit('search', '');
};

// 处理排序切换
const handleSortChange = (sortType: string) => {
  if (props.sortLoading || sortType === props.currentSort) return;
  emit('sort-change', sortType);
};

let observer: IntersectionObserver | null = null;

onMounted(() => {
  observer = setupScrollObserver() || null;
});

onUnmounted(() => {
  if (observer) {
    observer.disconnect();
  }
});

// 通过检测元素的 top 值判断是否处于吸顶位置（top <= 0）
// 使用 requestAnimationFrame 节流以减小滚动性能开销
let ticking = false;
const updateSticky = () => {
  if (!headerRef.value) return;
  const rect = headerRef.value.getBoundingClientRect();
  isSticky.value = rect.top <= 0;
};

const onScroll = () => {
  if (!ticking) {
    ticking = true;
    window.requestAnimationFrame(() => {
      updateSticky();
      ticking = false;
    });
  }
};

onMounted(() => {
  // 初始检查
  updateSticky();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', updateSticky);
});

onUnmounted(() => {
  window.removeEventListener('scroll', onScroll as EventListener);
  window.removeEventListener('resize', updateSticky as EventListener);
});
</script>

<style scoped lang="scss">
.sticky-header-wrapper {
  position: sticky;
  top: 0;
  left: 0;
  width: 100%;
  z-index: 100;
  /* 未吸顶时无需背景，保持透明；吸顶时由 .sticky-bleed-bg 渲染渐变与模糊效果 */
  background: transparent;
  /* GPU 合成层：减少 iOS Safari 在惯性滚动时的重绘闪烁 */
  -webkit-transform: translateZ(0);
  transform: translateZ(0);
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
}

.sticky-header {
  padding: 16px 0;
  transition: box-shadow 0.3s ease;
}

.sticky-bleed-bg {
  position: absolute;
  /* 扩展左右以避免模糊时被裁切 */
  left: -40px;
  right: -40px;
  top: -8px;
  bottom: 0;
  pointer-events: none;
  z-index: 0;
  /* 背景色只在吸顶时显示：将渐变放到此处 */
  background: linear-gradient(180deg, #e8f4fe 0%, #f5faff 100%);
  /* 使边界模糊，不要清晰的边界 */
  filter: blur(5px);
  opacity: 0.95;
  /* v-show 切换时平滑过渡，避免突然出现/消失 */
  transition: opacity 0.15s ease;
  /* 使用 mask 渐变进一步柔化左右边缘（兼容 WebKit） */
  -webkit-mask-image: linear-gradient(90deg, transparent 0px, black 20px, black calc(100% - 20px), transparent 100%);
  mask-image: linear-gradient(90deg, transparent 0px, black 20px, black calc(100% - 20px), transparent 100%);
}

.sticky-inner {
  position: relative;
  z-index: 1;
  max-width: 1680px;
  margin: 0 auto;
  padding: 0;
}

.sticky-title {
  text-align: center;
  font-size: 22px;
  font-weight: 600;
  color: #1a1a1a;
  margin-bottom: 20px;
}

.header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  min-width: 0;
}

.left-section {
  display: flex;
  align-items: center;
  gap: 16px;
  /* 不让左侧被过度压缩，优先保持分类在一行 */
  flex: 0 1 auto;
  min-width: 0;
}

.category-tabs {
  display: flex;
  gap: 8px;
  /* 禁止换行，超出时允许横向滚动以避免换行导致布局高度增加 */
  flex-wrap: nowrap;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.category-tab {
  flex-shrink: 0;
  padding: 8px 16px;
  border-radius: 6px;
  background: #FFFFFF;
  color: #666;
  cursor: pointer;
  transition: all 0.3s ease;
  user-select: none;
  font-size: 14px;
  white-space: nowrap; /* 保证单个标签内部不换行 */

  &:hover {
    background: #3366FF;
    color: #fff;
  }

  &.active {
    background: #3366FF;
    color: #fff;
  }

  .category-name {
    font-size: 14px;
    font-weight: 400;
  }
}

.divider {
  color: #d0d0d0;
  font-size: 16px;
  line-height: 1;
  user-select: none;
}

.sort-tabs {
  display: flex;
  gap: 8px;
}

.sort-tab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 60px;
  flex-shrink: 0;
  padding: 8px 16px;
  border-radius: 6px;
  background: #fff;
  color: #666;
  cursor: pointer;
  transition: all 0.3s ease;
  user-select: none;
  font-size: 14px;
  white-space: nowrap;

  &:hover {
    background: #3366FF;
    color: #fff;
  }

  &.active {
    background: #3366FF;
    color: #fff;
  }

  &.loading {
    cursor: wait;
  }
}

.sort-loading-icon {
  font-size: 14px;
  animation: sort-loading-rotate 0.8s linear infinite;
}

@keyframes sort-loading-rotate {
  to {
    transform: rotate(360deg);
  }
}

.search-box {
  /* 不使用固定宽度，改为 flex 自适应：在大屏以 600px 为基准，可收缩/扩展；在窄屏会占满可用宽度 */
  width: auto;
  flex: 1 1 600px; /* grow | shrink | base */
  max-width: 100%;
  min-width: 200px;
  /* 保持与左侧分类的最小间距（在大屏时增大间隔以提升可视分离） */
  margin-left: 200px;

  :deep(.el-input__wrapper) {
    border-radius: 8px;
    padding: 4px 16px;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
    transition: all 0.3s ease;

    &:hover {
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
    }
  }

  :deep(.el-input__inner) {
    font-size: 14px;
  }
}

// 响应式布局
@media (max-width: 1200px) {
  .header-row {
    flex-wrap: wrap;
  }

  .left-section {
    width: 100%;
    flex: 1 1 100%;
    /* 不要在这里让它换行，保持左到右滚动更好看 */
  }

  .category-tabs {
    /* 恢复横向滚动，隐藏滚动条 */
    flex-wrap: nowrap;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    flex: 1;
    
    // 隐藏滚动条
    &::-webkit-scrollbar {
      display: none;
    }
    scrollbar-width: none;
  }

  .search-box {
    width: 100%;
    margin-left: 0;
    flex: 1 1 100%;
    margin-top: 12px;
  }
}

@media (max-width: 768px) {
  .sticky-header {
    padding: 12px 0;
  }
  
  .sticky-bleed-bg {
    background: #f4faff; 
    opacity: 1;
    filter: none;
    mask-image: none;
    -webkit-mask-image: none;
    left: 0;
    right: 0;
      top: 0;
  }

  .header-row {
      gap: 8px; /* 减小标题与过滤区的整体间距 */
      flex-direction: column;
      align-items: stretch;
      margin-left: 0;
    }
  
    .left-section {
      flex-direction: column;
      align-items: flex-start; /* 确保左侧对齐 */
      gap: 8px; /* 减小分类那一行和排序列的上下间距 */
    }
  
    .category-tabs {
      width: 100%;
      gap: 8px;
      padding-top: 0px;
      padding-bottom: 0px; 
    }
  
    .divider {
      display: none; /* 移动端不显示分隔符 */
    }
  
    .sort-tabs {
      width: 100%;
      justify-content: flex-start;
      margin-top: 0px;
      padding-top: 0px;
      padding-bottom: 0px;
  }

  .category-tab,
  .sort-tab {
    padding: 6px 14px;
    font-size: 13px;
    border-radius: 16px; /* 更圆润像胶囊 */
    background: #f0f2f5; /* 增加一点背景色对比 */
  }

  .search-box {
    margin-top: 4px;
  }
}
</style>
