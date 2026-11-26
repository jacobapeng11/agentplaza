<template>
  <!-- 搜索栏组件 -->
  <div class="search-section">
    <div class="search-bar">
      <el-input 
        :model-value="modelValue" 
        placeholder="搜索智能体"
        size="large"
        clearable
        @input="handleInput"
        @clear="handleClear"
      >
        <template #prefix>
          <el-icon style="margin-left: 10px;"><Search /></el-icon>
        </template>
      </el-input>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 搜索栏组件
 * 用于搜索智能体，支持清空和实时搜索
 */
import { Search } from '@element-plus/icons-vue';

// 组件属性定义
interface Props {
  modelValue: string; // 搜索关键词（双向绑定）
}

defineProps<Props>();

// 事件定义
const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void; // 更新搜索值
  (e: 'search', value: string): void;            // 执行搜索
  (e: 'clear'): void;                            // 清空搜索
}>();

// 处理输入
const handleInput = (value: string) => {
  emit('update:modelValue', value);
  emit('search', value);
};

// 处理清空
const handleClear = () => {
  emit('update:modelValue', '');
  emit('clear');
};
</script>

<style scoped>
.search-section {
  margin: 16px 0;
}

.search-bar {
  width: 100%;
  max-width: none;
}

.search-bar :deep(.el-input__wrapper) {
  border-radius: 8px;
  border: 1px solid #e8e8e8;
  box-shadow: none;
  padding: 0;
  background: white;
  transition: all 0.2s;
}

.search-bar :deep(.el-input__wrapper:hover) {
  border-color: #1890ff;
}

.search-bar :deep(.el-input__wrapper.is-focus) {
  border-color: #1890ff;
  box-shadow: 0 0 0 2px rgba(24, 144, 255, 0.1);
}

.search-bar :deep(.el-input__inner) {
  border: none;
  border-radius: 0;
  padding-left: 15px;
  padding-right: 15px;
  height: 48px;
  font-size: 14px;
  background: transparent;
  box-shadow: none;
}

.search-bar :deep(.el-input__prefix) {
  left: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.search-bar :deep(.el-input__prefix i) {
  color: #bfbfbf;
  font-size: 16px;
}
.search-bar .el-input__prefix{
  margin-left: 20px;
}

.search-bar :deep(.el-input__suffix) {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 20px;
}

.search-bar :deep(.el-input__suffix-inner) {
  display: flex;
  align-items: center;
}

.search-bar :deep(.el-input__clear) {
  font-size: 16px;
  color: #bfbfbf;
  cursor: pointer;
  transition: color 0.2s;
}

.search-bar :deep(.el-input__clear:hover) {
  color: #1890ff;
}

@media (max-width: 768px) {
  .search-bar {
    max-width: 100%;
  }
}
</style>
