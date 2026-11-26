<template>
  <!-- 分类筛选栏 -->
  <div class="category-filter">
    <button
      v-for="category in categories"
      :key="category.value"
      :class="['category-btn', { active: activeCategory === category.value }]"
      @click="handleCategoryChange(category.value)"
    >
      <el-icon v-if="category.icon">
        <component :is="category.icon" />
      </el-icon>
      {{ category.label }}
    </button>
  </div>
</template>

<script setup lang="ts">
/**
 * 分类筛选组件
 * 用于筛选不同类型的智能体
 */
import { 
  Grid, 
  Star, 
  Shop, 
  Coin, 
  Document, 
  User, 
  Monitor, 
  Menu 
} from '@element-plus/icons-vue';

// 分类选项定义
interface Category {
  label: string;
  value: string;
  icon?: any;
}

const categories: Category[] = [
  { label: '推荐', value: '', icon: Star },
  { label: '大市场', value: '大市场', icon: Shop },
  { label: '财经类', value: '财经类', icon: Coin },
  { label: '办公类', value: '办公类', icon: Document },
  { label: '行政类', value: '行政类', icon: User },
  { label: '研发类', value: '研发类', icon: Monitor },
  { label: '综合类', value: '综合类', icon: Menu }
];

// 组件属性定义
interface Props {
  activeCategory?: string; // 当前激活的分类
}

withDefaults(defineProps<Props>(), {
  activeCategory: ''
});

// 事件定义
const emit = defineEmits<{
  (e: 'change', category: string): void; // 分类改变
}>();

// 处理分类切换
const handleCategoryChange = (category: string) => {
  emit('change', category);
};
</script>

<style scoped>
.category-filter {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
  padding: 8px 0;
}

.category-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 20px;
  border: 1px solid #e8e8e8;
  border-radius: 8px;
  background: white;
  color: #666;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.category-btn:hover {
  border-color: #1890ff;
  color: #1890ff;
  background: #f0f8ff;
  transform: translateY(-1px);
}

.category-btn.active {
  border-color: #1890ff;
  background: #1890ff;
  color: white;
  box-shadow: 0 2px 8px rgba(24, 144, 255, 0.3);
}

.category-btn .el-icon {
  font-size: 16px;
}

@media (max-width: 768px) {
  .category-filter {
    overflow-x: auto;
    flex-wrap: nowrap;
    padding-bottom: 12px;
    -webkit-overflow-scrolling: touch;
  }
  
  .category-filter::-webkit-scrollbar {
    height: 4px;
  }
  
  .category-filter::-webkit-scrollbar-thumb {
    background: #d9d9d9;
    border-radius: 2px;
  }
  
  .category-btn {
    flex-shrink: 0;
    padding: 8px 16px;
    font-size: 13px;
  }
}
</style>
