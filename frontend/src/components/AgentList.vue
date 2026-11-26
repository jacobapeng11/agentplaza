<template>
  <div class="agent-list-container">
    <div class="list-header">
      <h2 class="list-title">{{ title }}</h2>
      <div class="list-controls">
        <el-input
          v-model="searchKeyword"
          placeholder="搜索智能体"
          clearable
          prefix-icon="el-icon-search"
          class="search-input"
          @input="handleSearch"
        />
        <el-select
          v-model="selectedType"
          placeholder="类型筛选"
          clearable
          class="type-filter"
          @change="handleFilterChange"
        >
          <el-option
            v-for="type in availableTypes"
            :key="type"
            :label="type"
            :value="type"
          />
        </el-select>
        <el-select
          v-model="sortBy"
          placeholder="排序方式"
          class="sort-select"
          @change="handleSortChange"
        >
          <el-option label="热门度" value="hotScore" />
          <el-option label="更新时间" value="updateTime" />
          <el-option label="名称" value="name" />
        </el-select>
      </div>
    </div>

    <div class="agent-cards-container">
      <el-skeleton 
        v-if="loading" 
        :rows="2" 
        :loading="true" 
        animated 
        v-for="i in skeletonCount" 
        :key="i"
      >
        <template #template>
          <div class="skeleton-card">
            <el-skeleton-item variant="image" class="skeleton-image" />
            <div class="skeleton-content">
              <el-skeleton-item variant="h3" class="skeleton-title" />
              <el-skeleton-item variant="text" class="skeleton-text" />
              <el-skeleton-item variant="text" class="skeleton-text" style="width: 60%" />
            </div>
          </div>
        </template>
      </el-skeleton>

      <AgentCard
        v-else
        v-for="agent in agents"
        :key="agent._id"
        :agent="agent"
        class="agent-card-item"
        @update-favorite="handleUpdateFavorite"
      />
    </div>

    <div v-if="!loading && agents.length === 0" class="empty-state">
      <el-empty description="暂无智能体数据" />
    </div>

    <div v-if="showPagination" class="pagination-container">
      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :page-sizes="[12, 24, 48, 96]"
        :total="total"
        layout="total, sizes, prev, pager, next, jumper"
        @size-change="handleSizeChange"
        @current-change="handleCurrentChange"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import AgentCard from './AgentCard.vue';
import type { Agent } from '../types/agent';

interface Props {
  agents: Agent[];
  loading?: boolean;
  title?: string;
  showPagination?: boolean;
  total?: number;
  skeletonCount?: number;
  availableTypes?: string[];
}

const props = withDefaults(defineProps<Props>(), {
  loading: false,
  title: '智能体列表',
  showPagination: true,
  total: 0,
  skeletonCount: 6,
  availableTypes: () => []
});

// Local state
const currentPage = ref(1);
const pageSize = ref(12);
const searchKeyword = ref('');
const selectedType = ref('');
const sortBy = ref('hotScore');

// Handle search input
const handleSearch = () => {
  emit('search', {
    keyword: searchKeyword.value,
    page: currentPage.value,
    limit: pageSize.value,
    type: selectedType.value,
    sortBy: sortBy.value
  });
};

// Handle filter change
const handleFilterChange = () => {
  currentPage.value = 1; // Reset to first page when filter changes
  emit('filter', {
    keyword: searchKeyword.value,
    page: currentPage.value,
    limit: pageSize.value,
    type: selectedType.value,
    sortBy: sortBy.value
  });
};

// Handle sort change
const handleSortChange = () => {
  currentPage.value = 1; // Reset to first page when sorting changes
  emit('sort', {
    keyword: searchKeyword.value,
    page: currentPage.value,
    limit: pageSize.value,
    type: selectedType.value,
    sortBy: sortBy.value
  });
};

// Handle pagination size change
const handleSizeChange = (size: number) => {
  pageSize.value = size;
  currentPage.value = 1; // Reset to first page when page size changes
  emit('pagination', {
    keyword: searchKeyword.value,
    page: currentPage.value,
    limit: pageSize.value,
    type: selectedType.value,
    sortBy: sortBy.value
  });
};

// Handle pagination current page change
const handleCurrentChange = (page: number) => {
  currentPage.value = page;
  emit('pagination', {
    keyword: searchKeyword.value,
    page: currentPage.value,
    limit: pageSize.value,
    type: selectedType.value,
    sortBy: sortBy.value
  });
};

// Handle favorite update from child component
const handleUpdateFavorite = (data: { agentId: string; isFavorited: boolean; favoriteCount: number }) => {
  emit('update-favorite', data);
};

// Expose methods to parent
defineExpose({
  resetPagination: () => {
    currentPage.value = 1;
  }
});

const emit = defineEmits<{
  'search': [value: { keyword: string; page: number; limit: number; type: string; sortBy: string }];
  'filter': [value: { keyword: string; page: number; limit: number; type: string; sortBy: string }];
  'sort': [value: { keyword: string; page: number; limit: number; type: string; sortBy: string }];
  'pagination': [value: { keyword: string; page: number; limit: number; type: string; sortBy: string }];
  'update-favorite': [value: { agentId: string; isFavorited: boolean; favoriteCount: number }];
}>();
</script>

<style scoped>
.agent-list-container {
  width: 100%;
}

.list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--spacing-lg);
  flex-wrap: wrap;
  gap: var(--spacing-md);
}

.list-title {
  margin: 0;
  font-size: var(--font-size-large);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
}

.list-controls {
  display: flex;
  gap: var(--spacing-sm);
  flex-wrap: wrap;
}

.search-input {
  width: 240px;
}

.type-filter {
  width: 160px;
}

.sort-select {
  width: 140px;
}

.agent-cards-container {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: var(--spacing-lg);
  margin-bottom: var(--spacing-lg);
}

.agent-card-item {
  height: 100%;
}

.skeleton-card {
  border-radius: var(--border-radius-medium);
  overflow: hidden;
  border: 1px solid var(--border-lighter);
  height: 200px;
}

.skeleton-image {
  width: 100%;
  height: 100px;
}

.skeleton-content {
  padding: var(--spacing-md);
}

.skeleton-title {
  width: 70%;
  margin-bottom: var(--spacing-sm);
}

.skeleton-text {
  margin-bottom: var(--spacing-xs);
}

.empty-state {
  text-align: center;
  padding: var(--spacing-xl) 0;
}

.pagination-container {
  display: flex;
  justify-content: center;
  margin-top: var(--spacing-lg);
}

@media (max-width: 768px) {
  .list-header {
    flex-direction: column;
    align-items: stretch;
  }
  
  .list-controls {
    justify-content: center;
  }
  
  .search-input, .type-filter, .sort-select {
    width: 100% !important;
  }
  
  .agent-cards-container {
    grid-template-columns: 1fr;
  }
}
</style>