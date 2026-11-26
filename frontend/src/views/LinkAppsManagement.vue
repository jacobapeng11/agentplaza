<template>
  <div class="link-apps-management">
    <!-- 添加统一的页面头部 -->
    <PlazaHeader />
    
    <div class="main-content">
      <!-- 面包屑导航 -->
      <div class="header-actions">
        <Breadcrumb :items="breadcrumbItems" />
        <el-button type="primary" size="large" @click="handleCreate" class="create-btn">
          <el-icon><Plus /></el-icon>
          创建应用
        </el-button>
      </div>
      
      <div class="table-container">
        <el-table 
          v-loading="loading"
          :data="apps" 
          stripe 
          style="width: 100%"
          class="custom-table"
        >
          <el-table-column prop="avatar" label="图标" width="80">
            <template #default="{ row }">
              <el-avatar 
                :src="row.avatar" 
                :size="40" 
                shape="square"
                class="app-avatar"
              >
                <el-icon><Plus /></el-icon>
              </el-avatar>
            </template>
          </el-table-column>
          <el-table-column prop="name" label="应用名称" width="200">
            <template #default="{ row }">
              <div class="app-name">
                <span class="name">{{ row.name }}</span>
                <!-- <span class="type-tag">{{ row.newType }}</span> -->
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="appUrl" label="应用链接" show-overflow-tooltip>
            <template #default="{ row }">
              <el-link :href="row.appUrl" target="_blank" type="primary" class="app-link">
                {{ row.appUrl }}
              </el-link>
            </template>
          </el-table-column>
          <el-table-column label="统计" width="160" align="center">
            <template #default="{ row }">
              <div class="stats-cell">
                <div class="stat-item">
                  <el-icon class="stat-icon favorite"><StarFilled /></el-icon>
                  <span>{{ row.favoriteCount || 0 }}</span>
                </div>
                <div class="stat-item">
                  <el-icon class="stat-icon visit"><View /></el-icon>
                  <span>{{ row.chatCount || 0 }}</span>
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="创建时间" width="160">
            <template #default="{ row }">
              <div class="date-cell">
                {{ formatDate(row.createdAt) }}
              </div>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="200" :fixed="isMobile ? false : 'right'">
            <template #default="{ row }">
              <div class="action-buttons">
                <el-button size="small" type="primary" @click="handleEdit(row)">
                  编辑
                </el-button>
                <el-button size="small" type="danger" @click="handleDelete(row)">
                  删除
                </el-button>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </div>
      
      <div class="pagination-container">
        <el-pagination
          :current-page="currentPage"
          :page-size="pageSize"
          :total="total"
          layout="total, prev, pager, next, jumper"
          @current-change="handleCurrentChange"
          background
        />
      </div>
    </div>

    <!-- 编辑弹窗 -->
    <el-dialog
      v-model="dialogVisible"
      :title="editingApp ? '编辑外链应用' : '创建外链应用'"
      width="900px"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      @close="handleDialogClose"
      class="custom-dialog"
      align-center
    >
      <template #header>
        <div class="dialog-header">
          <div class="dialog-title">
            <el-icon class="title-icon"><Plus /></el-icon>
            <span>{{ editingApp ? '编辑外链应用' : '创建外链应用' }}</span>
          </div>
        </div>
      </template>
      <template v-if="dialogVisible">
        <LinkAppEditor
          :app-data="editingApp || undefined"
          :is-edit="!!editingApp"
          @success="handleEditSuccess"
          @cancel="handleDialogClose"
        />
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, defineAsyncComponent } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus, StarFilled, View } from '@element-plus/icons-vue';
import { linkAppsApi } from '../api/appsLink';
import type { LinkApp } from '../types/linkApp';
import PlazaHeader from '../components/plaza/PlazaHeader.vue';
import Breadcrumb from '../components/common/Breadcrumb.vue';

// 异步导入组件 - 使用完整的编辑器
const LinkAppEditor = defineAsyncComponent(() => import('../components/LinkAppEditor.vue'));

const router = useRouter();
const apps = ref<LinkApp[]>([]);
const loading = ref(false);
const currentPage = ref(1);
const pageSize = ref(20);
const total = ref(0);

// 对话框相关
const dialogVisible = ref(false);
const editingApp = ref<LinkApp | null>(null);

// 面包屑数据
const breadcrumbItems = [
  { label: '智能体广场', path: '/' },
  { label: '应用管理' }
];

async function loadApps() {
  try {
    loading.value = true;
    const response: any = await linkAppsApi.getMyCreated({
      page: currentPage.value,
      limit: pageSize.value
    });
    
    console.log('API response:', response); // 调试日志
    
    // 处理响应数据，使用灵活的访问方式
    apps.value = response?.data?.apps || response?.apps || [];
    total.value = response?.data?.totalCount || response?.totalCount || 0;
    
    console.log('Loaded apps:', apps.value.length, 'Total:', total.value);
  } catch (error: any) {
    console.error('Load apps error:', error);
    ElMessage.error('加载失败: ' + (error.message || '未知错误'));
    apps.value = [];
    total.value = 0;
  } finally {
    loading.value = false;
  }
}

function handleCurrentChange(page: number) {
  currentPage.value = page;
  loadApps();
}

function handleCreate() {
  editingApp.value = null; // 清空编辑数据
  dialogVisible.value = true;
}


function handleEdit(app: LinkApp) {
  editingApp.value = { ...app }; // 克隆数据避免直接修改原数据
  dialogVisible.value = true;
}

// 处理对话框关闭
function handleDialogClose() {
  dialogVisible.value = false;
  editingApp.value = null;
}

// 处理编辑成功
function handleEditSuccess() {
  dialogVisible.value = false;
  editingApp.value = null;
  loadApps(); // 重新加载列表
  // ElMessage.success('操作成功');
}

async function handleDelete(app: LinkApp) {
  try {
    await ElMessageBox.confirm('确认删除此应用？删除后无法恢复。', '提示', {
      confirmButtonText: '确认删除',
      cancelButtonText: '取消',
      type: 'warning'
    });
    
    await linkAppsApi.delete(app._id);
    ElMessage.success('删除成功');
    loadApps();
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.response?.data?.message || '删除失败');
    }
  }
}

function formatDate(dateStr: string) {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleString('zh-CN');
}

const isMobile = ref(window.innerWidth <= 768);
  const handleResize = () => {
    isMobile.value = window.innerWidth <= 768;
  };

  onMounted(() => {
    window.addEventListener('resize', handleResize);
    loadApps();
  });

  onUnmounted(() => {
    window.removeEventListener('resize', handleResize);
});
</script>

<style scoped lang="scss">
.link-apps-management {
  min-height: 100vh;
  background: #f4faff;
}

.main-content {
  max-width: 1400px;
  margin: 0 auto;
  padding: 24px;
}

.header-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.create-btn {
  height: 44px;
  padding: 0 24px;
  font-size: 16px;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(64, 158, 255, 0.3);
  transition: all 0.3s ease;
  
  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(64, 158, 255, 0.4);
  }
}

.table-container {
  background: white;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.custom-table {
  :deep(.el-table__header) {
    background: #f8f9fa;
    
    th {
      background: #f8f9fa !important;
      color: #495057;
      font-weight: 600;
      border: none;
      height: 56px;
    }
  }
  
  :deep(.el-table__row) {
    transition: all 0.3s ease;
    
    &:hover {
      background: #f8f9ff !important;
      transform: translateY(-1px);
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.05);
    }
  }
  
  :deep(.el-table td) {
    border: none;
    padding: 16px 0;
  }
}

.app-avatar {
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.app-name {
  .name {
    font-weight: 600;
    color: #1a1a1a;
    display: block;
    margin-bottom: 4px;
  }
  
  .type-tag {
    display: inline-block;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 12px;
    font-weight: 500;
  }
}

.app-link {
  font-weight: 500;
  
  &:hover {
    color: #409eff;
  }
}

.stats-cell {
  display: flex;
  gap: 16px;
  justify-content: center;
  
  .stat-item {
    display: flex;
    align-items: center;
    gap: 4px;
    
    .stat-icon {
      font-size: 16px;
      
      &.favorite {
        color: #f39c12;
      }
      
      &.visit {
        color: #27ae60;
      }
    }
    
    span {
      font-weight: 600;
      color: #495057;
    }
  }
}

.date-cell {
  color: #6c757d;
  font-size: 14px;
}

.action-buttons {
  display: flex;
  gap: 8px;
  
  .el-button {
    border-radius: 6px;
    transition: all 0.3s ease;
    
    &:hover {
      transform: translateY(-1px);
    }
  }
}

.pagination-container {
  display: flex;
  justify-content: center;
  padding: 20px 0;
  
  :deep(.el-pagination) {
    .btn-next,
    .btn-prev {
      border-radius: 6px;
    }
    
    .el-pager li {
      border-radius: 6px;
      margin: 0 2px;
      
      &:hover {
        color: #409eff;
      }
      
      &.is-active {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        border-color: transparent;
      }
    }
  }
}
:deep(.custom-dialog) {
    padding: 0;
    border-radius: 10px;
  .el-dialog__header {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    padding: 20px 24px;
    margin: 0;
    border-radius: 8px 8px 0 0;
    
    .el-dialog__title {
    //   color: white;
      font-weight: 600;
      font-size: 18px;
    }
    
    .el-dialog__headerbtn {
      .el-dialog__close {
        color: white;
        font-size: 18px;
        
        &:hover {
          color: #f0f0f0;
        }
      }
    }
  }
  
  .el-dialog {
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.15);
  }
  
  .el-dialog__body {
    padding: 24px;
  }
}

.dialog-header {
  .dialog-title {
    display: flex;
    align-items: center;
    gap: 12px;
    color: white;
    font-size: 18px;
    font-weight: 600;
    
    .title-icon {
      font-size: 20px;
    }
  }
}

/* Mobile Responsiveness */
@media (max-width: 768px) {
  .main-content {
    padding: 12px;
  }

  .header-actions {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }

  .create-btn {
    width: 100%;
    margin-top: 4px;
  }

  .table-container {
    padding: 12px;
    overflow-x: auto;
  }

  /* Reduce table column widths globally and undo sticky right fixed pos on mobile */
  :deep(.el-table .el-table__fixed-right) {
    height: 100% !important;
  }
  :deep(.el-table__fixed-right) {
    right: 0 !important;
    position: relative !important;
  }
  
  :deep(.el-table) {
    width: 100% !important;
  }

  .custom-table {
    min-width: 600px; /* Ensure table forces a horizontal scroll if too small */
  }

  .pagination-container {
    overflow-x: auto;
    padding-bottom: 8px;
  }
}
</style>
