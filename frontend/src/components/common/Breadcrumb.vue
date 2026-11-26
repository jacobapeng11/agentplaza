<template>
  <div class="breadcrumb-container">
    <el-button 
      text 
      @click="handleBack" 
      class="back-btn"
    >
      <el-icon><ArrowLeft /></el-icon>
      返回
    </el-button>
    <el-breadcrumb separator="/" class="breadcrumb">
      <el-breadcrumb-item 
        v-for="(item, index) in items" 
        :key="index"
        :to="item.path ? { path: item.path } : undefined"
      >
        {{ item.label }}
      </el-breadcrumb-item>
    </el-breadcrumb>
  </div>
</template>

<script setup lang="ts">
import { ArrowLeft } from '@element-plus/icons-vue';
import { useRouter } from 'vue-router';

interface BreadcrumbItem {
  label: string;
  path?: string;
}

interface Props {
  items: BreadcrumbItem[];
}

defineProps<Props>();

const router = useRouter();

const handleBack = () => {
  router.back();
};
</script>

<style scoped lang="scss">
.breadcrumb-container {
  display: flex;
  align-items: center;
  gap: 16px;
}

@media (max-width: 768px) {
  .breadcrumb-container {
    gap: 8px;
    margin-bottom: 12px;
  }
}

.back-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 14px;
  color: #606266;
  padding: 4px 8px;
  border-radius: 4px;
  transition: all 0.2s;
  
  &:hover {
    color: #409eff;
    background: rgba(64, 158, 255, 0.1);
  }
}

.breadcrumb {
  :deep(.el-breadcrumb__item) {
    .el-breadcrumb__inner {
      color: #606266;
      font-weight: normal;
      
      &.is-link {
        color: #409eff;
        
        &:hover {
          color: #66b1ff;
        }
      }
    }
    
    &:last-child {
      .el-breadcrumb__inner {
        color: #303133;
        font-weight: 500;
      }
    }
  }
  
  :deep(.el-breadcrumb__separator) {
    color: #dcdfe6;
    margin: 0 8px;
  }
}
</style>
