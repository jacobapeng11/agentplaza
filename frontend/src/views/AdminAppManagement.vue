<template>
  <div class="admin-container">
    <!-- 公共头部 -->
    <PlazaHeader />

    <!-- 主体内容 -->
    <div class="main-content">
      <!-- 标题栏 -->
      <div class="page-header">
        <h1 class="page-title">应用管理</h1>
        <span class="page-desc">管理所有FastGPT应用的分类和标签</span>
      </div>

      <!-- 筛选和搜索栏 -->
      <div class="filter-bar">
        <el-input
          v-model="searchKeyword"
          placeholder="搜索应用名称或简介"
          clearable
          style="width: 300px;"
          @input="handleSearch"
        >
          <template #prefix>
            <el-icon>
              <Search />
            </el-icon>
          </template>
        </el-input>

        <el-select
          v-model="selectedCategory"
          placeholder="选择分类"
          clearable
          style="width: 200px;"
          @change="handleCategoryChange"
        >
          <el-option label="全部分类" value />
          <el-option
            v-for="cat in categories"
            :key="cat.value"
            :label="cat.label"
            :value="cat.value"
          />
        </el-select>

        <el-select
          v-model="selectedPinned"
          placeholder="置顶状态"
          clearable
          style="width: 150px;"
          @change="handlePinnedChange"
        >
          <el-option label="全部" value />
          <el-option label="已置顶" value="true" />
          <el-option label="未置顶" value="false" />
        </el-select>

        <el-select
          v-if="isWecomBotEnabled()"
          v-model="selectedWecomBotConfigured"
          placeholder="Bot 配置"
          clearable
          style="width: 160px;"
          @change="handleWecomBotFilterChange"
        >
          <el-option label="全部 Bot" value />
          <el-option label="已配置 Bot" value="true" />
          <el-option label="未配置 Bot" value="false" />
        </el-select>

        <el-select
          v-if="isWecomBotEnabled()"
          v-model="selectedWecomBotStatus"
          placeholder="Bot 状态"
          clearable
          style="width: 160px;"
          @change="handleWecomBotFilterChange"
        >
          <el-option
            v-for="status in wecomBotStatusOptions"
            :key="status.value"
            :label="status.label"
            :value="status.value"
          />
        </el-select>

        <div class="stats">
          <span class="stat-item">总计: {{ total }} 个应用</span>
          <el-button
            type="primary"
            plain
            :icon="Refresh"
            v-if="isWecomBotEnabled()"
            :disabled="selectedWecomBotRows.length === 0"
            :loading="reactivating"
            @click="handleBatchReactivateWecomBots"
          >
            批量重新激活
          </el-button>
        </div>
      </div>

      <!-- 应用表格 -->
      <el-table
        :data="apps"
        v-loading="loading"
        style="width: 100%;"
        :header-cell-style="{ background: '#f5f7fa', color: '#606266' }"
        @selection-change="handleWecomBotSelectionChange"
      >
        <el-table-column
          v-if="isWecomBotEnabled()"
          type="selection"
          width="48"
          :selectable="selectableWecomBotRow"
        />

        <el-table-column prop="name" label="应用名称" width="250" :fixed="isMobile ? false : 'left'">
          <template #default="{ row }">
            <div class="app-name-cell">
              <el-avatar :src="getAvatarUrl(row.avatar)" :size="40" style="margin-right: 12px;" />
              <div class="app-info">
                <div class="app-name">{{ row.name }}</div>
                <div class="app-id">ID: {{ row._id }}</div>
              </div>
            </div>
          </template>
        </el-table-column>

        <el-table-column prop="intro" label="简介" width="250" show-overflow-tooltip />

        <el-table-column prop="source" label="来源" width="120">
          <template #default="{ row }">
            <el-tag
              :type="row.source === 'link' ? 'success' : 'primary'"
              size="small"
            >{{ row.source === 'link' ? '外链应用' : 'FastGPT应用' }}</el-tag>
          </template>
        </el-table-column>

        <el-table-column v-if="isWecomBotEnabled()" label="Bot ID" width="180">
          <template #default="{ row }">
            <span v-if="row.wecomBot?.botId">{{ row.wecomBot.botId }}</span>
            <span v-else class="empty-text">-</span>
          </template>
        </el-table-column>

        <el-table-column v-if="isWecomBotEnabled()" label="启用状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.wecomBot" :type="row.wecomBot.enabled ? 'success' : 'info'" size="small">
              {{ row.wecomBot.enabled ? '启用' : '停用' }}
            </el-tag>
            <span v-else class="empty-text">-</span>
          </template>
        </el-table-column>

        <el-table-column v-if="isWecomBotEnabled()" label="连接状态" width="110" align="center">
          <template #default="{ row }">
            <el-tag
              v-if="row.wecomBot"
              :type="getWecomBotStatusTagType(row.wecomBot)"
              size="small"
            >
              {{ getWecomBotStatusText(row.wecomBot) }}
            </el-tag>
            <span v-else class="empty-text">-</span>
          </template>
        </el-table-column>

        <el-table-column v-if="isWecomBotEnabled()" label="最近连接" width="180">
          <template #default="{ row }">
            {{ row.wecomBot?.lastConnectedAt ? formatDate(row.wecomBot.lastConnectedAt) : '-' }}
          </template>
        </el-table-column>

        <el-table-column v-if="isWecomBotEnabled()" label="最近错误" width="220" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.wecomBot?.lastError">{{ row.wecomBot.lastError }}</span>
            <span v-else class="empty-text">-</span>
          </template>
        </el-table-column>

        <el-table-column prop="isPinned" label="置顶" width="100" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.isPinned" type="warning" size="small">
              <el-icon style="vertical-align: middle;">
                <StarFilled />
              </el-icon>置顶
            </el-tag>
            <span v-else class="empty-text">-</span>
          </template>
        </el-table-column>

        <el-table-column prop="creator" label="创建人" width="120">
          <template #default="{ row }">
            <span v-if="row.creator">{{ row.creator.Name || row.creator.Badge }}</span>
            <span v-else class="empty-text">-</span>
          </template>
        </el-table-column>

        <el-table-column prop="newType" label="分类" width="150">
          <template #default="{ row }">
            <el-tag :type="getCategoryTagType(row.newType)" size="small">{{ row.newType || '综合类' }}</el-tag>
          </template>
        </el-table-column>

        <el-table-column prop="tags" label="标签" width="300">
          <template #default="{ row }">
            <div class="tags-cell">
              <el-tag
                v-for="tag in getAppTags(row)"
                :key="tag"
                :type="getTagType(tag)"
                size="small"
                style="margin-right: 4px;"
              >{{ tag }}</el-tag>
              <span v-if="getAppTags(row).length === 0" class="empty-text">暂无标签</span>
            </div>
          </template>
        </el-table-column>

        <el-table-column prop="updateTime" label="更新时间" width="180">
          <template #default="{ row }">{{ formatDate(row.updateTime) }}</template>
        </el-table-column>

        <el-table-column label="操作" width="260" :fixed="isMobile ? false : 'right'">
          <template #default="{ row }">
            <el-button type="primary" link size="small" @click="handleEdit(row)">编辑</el-button>
            <el-button
              v-if="isWecomBotEnabled() && row.source === 'fastgpt'"
              type="primary"
              link
              size="small"
              @click="handleOpenWecomBotConfig(row)"
            >
              Bot 配置
            </el-button>
            <el-button
              v-if="isWecomBotEnabled() && row.wecomBot?.configured"
              type="warning"
              link
              size="small"
              :disabled="reactivating"
              @click="handleReactivateWecomBot(row)"
            >
              重新激活
            </el-button>
            <el-button type="danger" link size="small" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- 分页 -->
      <div class="pagination-container">
        <el-pagination
          :current-page="currentPage"
          :page-size="pageSize"
          :page-sizes="[10, 20, 50, 100]"
          :total="total"
          :layout="isMobile ? 'total, prev, pager, next' : 'total, sizes, prev, pager, next, jumper'" :small="isMobile"
          @size-change="handleSizeChange"
          @current-change="handlePageChange"
        />
      </div>
    </div>

    <!-- 编辑对话框 -->
    <el-dialog
      v-model="editDialogVisible"
      title="编辑应用分类和标签"
      width="900px"
      :close-on-click-modal="false"
    >
      <div v-if="currentApp" class="edit-dialog-content">
        <div class="app-info-section">
          <el-avatar :src="getAvatarUrl(currentApp.avatar)" :size="60" />
          <div class="app-details">
            <h3>{{ currentApp.name }}</h3>
            <p class="app-intro">{{ currentApp.intro }}</p>
          </div>
        </div>

        <el-divider />

        <el-form :model="editForm" label-width="100px" label-position="top">
          <el-form-item label="应用分类">
            <el-select v-model="editForm.category" placeholder="请选择分类" style="width: 100%;">
              <el-option
                v-for="cat in categories"
                :key="cat.value"
                :label="cat.label"
                :value="cat.value"
              />
            </el-select>
          </el-form-item>

          <el-form-item label="应用标签">
            <TagSelector v-model="editForm.tags" ref="tagSelectorRef" />
          </el-form-item>

          <el-form-item label="置顶状态">
            <el-switch v-model="editForm.isPinned" active-text="置顶" inactive-text="不置顶" />
            <div
              v-if="currentApp?.isPinned"
              style="font-size: 12px; color: #909399;margin-left: 20px;"
            >置顶时间: {{ formatDate(currentApp.pinnedAt || currentApp.updateTime) }}</div>
          </el-form-item>
        </el-form>
      </div>

      <template #footer>
        <span class="dialog-footer">
          <el-button @click="editDialogVisible = false">取消</el-button>
          <el-button type="primary" @click="handleSave" :loading="saving">保存</el-button>
        </span>
      </template>
    </el-dialog>

    <WecomBotConfigDrawer
      v-if="isWecomBotEnabled() && currentWecomBotApp"
      v-model="wecomBotDrawerVisible"
      :app-id="currentWecomBotApp._id"
      :app-name="currentWecomBotApp.name"
      admin-mode
      @saved="fetchApps"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh, Search, StarFilled } from '@element-plus/icons-vue'
import PlazaHeader from '../components/plaza/PlazaHeader.vue'
import TagSelector from '../components/TagSelector.vue'
import { isWecomBotEnabled } from '../config/adminConfig'
import WecomBotConfigDrawer from '../components/WecomBotConfigDrawer.vue'
import { wecomBotAdminApi } from '../api/wecomBot'
import { http } from '../utils/request'
import { getAppTags } from '../utils/tagUtils'
import { resolveFastgptAssetUrl } from '../config/fastgptConfig'
import type {
  AdminWecomBotConfiguredFilter,
  AdminWecomBotStatus,
  AdminWecomBotStatusFilter,
  AdminWecomBotSummary,
} from '../types/wecomBot'


const isMobile = ref(window.innerWidth <= 768)
const handleResize = () => {
  isMobile.value = window.innerWidth <= 768
}

const getAvatarUrl = (avatar: string | undefined) => {
  if (!avatar) return ''
  return resolveFastgptAssetUrl(avatar)
}

interface App {
  _id: string
  name: string
  avatar: string
  intro: string
  newType: string
  tags: string[]
  source: 'fastgpt' | 'link'
  isPinned: boolean
  pinnedAt?: string
  creator?: {
    Badge: string
    Name: string
  }
  updateTime: string
  wecomBot?: AdminWecomBotSummary
}

interface EditForm {
  category: string
  tags: string[]
  isPinned: boolean
}

// 分类列表
const categories = [
  { label: '大市场', value: '大市场' },
  { label: '财经类', value: '财经类' },
  { label: '办公类', value: '办公类' },
  { label: '行政类', value: '行政类' },
  { label: '研发类', value: '研发类' },
  { label: '综合类', value: '综合类' },
]

// 状态
const loading = ref(false)
const saving = ref(false)
const apps = ref<App[]>([])
const total = ref(0)
const currentPage = ref(1)
const pageSize = ref(isMobile.value ? 10 : 20)
const searchKeyword = ref('')
const selectedCategory = ref('')
const selectedPinned = ref('')
const selectedWecomBotConfigured = ref<AdminWecomBotConfiguredFilter>('')
const selectedWecomBotStatus = ref<AdminWecomBotStatusFilter>('')
const selectedWecomBotRows = ref<App[]>([])
const wecomBotDrawerVisible = ref(false)
const currentWecomBotApp = ref<App | null>(null)
const reactivating = ref(false)
const editDialogVisible = ref(false)
const currentApp = ref<App | null>(null)
const tagSelectorRef = ref<any>(null)

const editForm = ref<EditForm>({
  category: '',
  tags: [],
  isPinned: false,
})

const wecomBotStatusOptions = [
  { label: '全部状态', value: '' },
  { label: '在线', value: 'connected' },
  { label: '启动中', value: 'starting' },
  { label: '重连中', value: 'reconnecting' },
  { label: '掉线', value: 'disconnected' },
  { label: '异常', value: 'failed' },
  { label: '已停用', value: 'disabled' },
]

const wecomBotStatusTextMap: Record<AdminWecomBotStatus | string, string> = {
  online: '在线',
  connected: '在线',
  starting: '启动中',
  reconnecting: '重连中',
  offline: '掉线',
  disconnected: '掉线',
  failed: '异常',
  disabled: '已停用',
  stopped: '已停用',
}

const wecomBotStatusTagTypeMap: Record<string, 'success' | 'primary' | 'warning' | 'danger' | 'info'> = {
  online: 'success',
  connected: 'success',
  starting: 'primary',
  reconnecting: 'primary',
  offline: 'warning',
  disconnected: 'warning',
  failed: 'danger',
  disabled: 'info',
  stopped: 'info',
}

// 获取应用列表
const fetchApps = async () => {
  loading.value = true
  try {
    const params: any = {
      page: currentPage.value,
      limit: pageSize.value,
    }

    if (searchKeyword.value) {
      params.search = searchKeyword.value
    }

    if (selectedCategory.value) {
      params.category = selectedCategory.value
    }

    if (selectedPinned.value) {
      params.isPinned = selectedPinned.value
    }

    if (selectedWecomBotConfigured.value) {
      params.wecomBotConfigured = selectedWecomBotConfigured.value
    }

    if (selectedWecomBotStatus.value) {
      params.wecomBotStatus = selectedWecomBotStatus.value
    }

    const data: any = await http.get('/apps-new/admin/apps', params)

    if (data.success) {
      apps.value = data.data || []
      clearWecomBotSelection()
      total.value = data.pagination?.total || 0
    } else {
      throw new Error(data.message || '获取应用列表失败')
    }
  } catch (error: any) {
    console.error('获取应用列表失败:', error)
    ElMessage.error(error.message || '获取应用列表失败')
  } finally {
    loading.value = false
  }
}

// 处理搜索
let searchTimer: any = null
const handleSearch = () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    currentPage.value = 1
    clearWecomBotSelection()
    fetchApps()
  }, 500)
}

// 处理分类变化
const handleCategoryChange = () => {
  currentPage.value = 1
  clearWecomBotSelection()
  fetchApps()
}

// 处理置顶筛选变化
const handlePinnedChange = () => {
  currentPage.value = 1
  clearWecomBotSelection()
  fetchApps()
}

// 用途：清空企业微信 Bot 批量选择状态；输入：无；输出：移除已选应用，避免列表上下文变化后误操作。
const clearWecomBotSelection = () => {
  selectedWecomBotRows.value = []
}

// 用途：处理企业微信 Bot 筛选变化；输入：无；输出：重置页码、清空选择并刷新列表。
const handleWecomBotFilterChange = () => {
  currentPage.value = 1
  clearWecomBotSelection()
  fetchApps()
}

// 处理分页变化
const handlePageChange = (page: number) => {
  currentPage.value = page
  clearWecomBotSelection()
  fetchApps()
}

const handleSizeChange = (size: number) => {
  pageSize.value = size
  currentPage.value = 1
  clearWecomBotSelection()
  fetchApps()
}

// 编辑应用
const handleEdit = (app: App) => {
  currentApp.value = app
  editForm.value = {
    category: app.newType || '综合类',
    tags: [...(app.tags || [])],
    isPinned: app.isPinned || false,
  }
  editDialogVisible.value = true
}

// 保存编辑
const handleSave = async () => {
  // 验证标签
  if (tagSelectorRef.value && !tagSelectorRef.value.isValid) {
    ElMessage.warning(tagSelectorRef.value.validationMessage || '标签验证失败')
    return
  }

  if (!currentApp.value) return

  try {
    saving.value = true

    const data: any = await http.put(
      `/apps-new/admin/apps/${currentApp.value._id}`,
      {
        category: editForm.value.category,
        tags: editForm.value.tags,
        isPinned: editForm.value.isPinned,
        source: currentApp.value.source,
      }
    )

    if (!data.success) {
      throw new Error(data.message || '保存失败')
    }

    ElMessage.success('保存成功')
    editDialogVisible.value = false

    // 刷新列表
    await fetchApps()
  } catch (error: any) {
    console.error('保存失败:', error)
    ElMessage.error(error.message || '保存失败')
  } finally {
    saving.value = false
  }
}

// 删除应用
const handleDelete = async (app: any) => {
  try {
    await ElMessageBox.confirm(
      `确定要删除应用"${app.name}"吗？删除后将不再显示在应用列表中。`,
      '确认删除',
      {
        confirmButtonText: '确定删除',
        cancelButtonText: '取消',
        type: 'warning',
      }
    )

    const data: any = await http.delete(`/apps-new/admin/apps/${app._id}`)

    if (!data.success) {
      throw new Error(data.message || '删除失败')
    }

    ElMessage.success('删除成功')

    // 刷新列表
    await fetchApps()
  } catch (error: any) {
    if (error !== 'cancel') {
      console.error('删除失败:', error)
      ElMessage.error(error.message || '删除失败')
    }
  }
}

// 用途：判断应用行是否允许选择用于企业微信 Bot 批量操作；输入：应用行；输出：是否可选择。
const selectableWecomBotRow = (row: App) => {
  return row.source === 'fastgpt' && row.wecomBot?.configured === true
}

// 用途：同步企业微信 Bot 表格选择结果；输入：Element Plus 返回的应用行数组；输出：更新可批量操作的选中应用。
const handleWecomBotSelectionChange = (rows: App[]) => {
  selectedWecomBotRows.value = rows.filter(selectableWecomBotRow)
}

// 用途：获取企业微信 Bot 管理状态文案；输入：Bot 摘要；输出：中文状态文案。
const getWecomBotStatusText = (bot: AdminWecomBotSummary) => {
  return wecomBotStatusTextMap[bot.adminStatus] || wecomBotStatusTextMap[bot.connectionStatus] || '-'
}

// 用途：获取企业微信 Bot 状态标签类型；输入：Bot 摘要；输出：Element Plus 标签类型。
const getWecomBotStatusTagType = (bot: AdminWecomBotSummary) => {
  return wecomBotStatusTagTypeMap[bot.adminStatus] || wecomBotStatusTagTypeMap[bot.connectionStatus] || 'info'
}

// 用途：打开企业微信 Bot 配置抽屉；输入：当前应用；输出：设置抽屉上下文并显示抽屉。
const handleOpenWecomBotConfig = (app: App) => {
  currentWecomBotApp.value = app
  wecomBotDrawerVisible.value = true
}

// 用途：重新激活单个企业微信 Bot；输入：当前应用；输出：提交重新激活请求并刷新列表。
const handleReactivateWecomBot = async (app: App) => {
  if (reactivating.value) {
    return
  }

  if (!selectableWecomBotRow(app)) {
    ElMessage.warning('该应用未配置企业微信 Bot')
    return
  }

  try {
    await ElMessageBox.confirm(
      `确定要重新激活"${app.name}"的企业微信 Bot 吗？已停用 Bot 会被启用，掉线或异常 Bot 会被重新启动。`,
      '确认重新激活',
      {
        confirmButtonText: '重新激活',
        cancelButtonText: '取消',
        type: 'warning',
      }
    )
    reactivating.value = true
    await wecomBotAdminApi.reactivate(app._id)
    ElMessage.success('重新激活请求已提交')
    await fetchApps()
  } catch (error: any) {
    if (error !== 'cancel') {
      console.error('重新激活失败:', error)
      ElMessage.error(error.message || '重新激活失败')
    }
  } finally {
    reactivating.value = false
  }
}

// 用途：批量重新激活选中的企业微信 Bot；输入：无，读取当前选择；输出：提交批量请求、反馈结果并刷新列表。
const handleBatchReactivateWecomBots = async () => {
  if (reactivating.value) {
    return
  }

  const appIds = selectedWecomBotRows.value.map(app => app._id)
  if (appIds.length === 0) {
    ElMessage.warning('请选择已配置企业微信 Bot 的应用')
    return
  }

  try {
    await ElMessageBox.confirm(
      `确定要重新激活选中的 ${appIds.length} 个企业微信 Bot 吗？已停用 Bot 会被启用，掉线或异常 Bot 会被重新启动。`,
      '确认批量重新激活',
      {
        confirmButtonText: '批量重新激活',
        cancelButtonText: '取消',
        type: 'warning',
      }
    )
    reactivating.value = true
    const result = await wecomBotAdminApi.reactivateMany(appIds)
    if (result.failed > 0) {
      ElMessage.warning(`批量重新激活完成：成功 ${result.succeeded} 个，失败 ${result.failed} 个`)
    } else {
      ElMessage.success(`已提交 ${result.succeeded} 个 Bot 的重新激活请求`)
    }
    clearWecomBotSelection()
    await fetchApps()
  } catch (error: any) {
    if (error !== 'cancel') {
      console.error('批量重新激活失败:', error)
      ElMessage.error(error.message || '批量重新激活失败')
    }
  } finally {
    reactivating.value = false
  }
}

// 格式化日期
const formatDate = (date: string) => {
  if (!date) return '-'
  return new Date(date).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// 获取分类标签类型
const getCategoryTagType = (category: string) => {
  const typeMap: Record<string, any> = {
    推荐: '',
    大市场: 'success',
    财经类: 'warning',
    办公类: 'info',
    行政类: 'danger',
    研发类: 'primary',
    综合类: '',
  }
  return typeMap[category] || ''
}

// 获取标签类型
const getTagType = (tag: string) => {
  const coreFunctionTags = [
    '效率工具',
    '内容生成',
    '信息处理',
    '问题解答',
    '创意辅助',
    '对话交流',
    '任务执行',
    '知识学习',
  ]
  const riskTags = ['高耗资源', '含敏感信息', '外部模型']
  const operationTags = ['活动专属', '公测邀请', '内测中']

  if (coreFunctionTags.includes(tag)) return 'primary'
  if (riskTags.includes(tag)) return 'danger'
  if (operationTags.includes(tag)) return 'success'
  return ''
}

// 初始化
onMounted(() => {
  window.addEventListener('resize', handleResize)
  fetchApps()
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
})
</script>

<style scoped>
.admin-container {
  min-height: 100vh;
  background: #f5f7fa;
  overflow-x: hidden;
}

.main-content {
  max-width: 1400px;
  margin: 0 auto;
  padding: 24px;
  box-sizing: border-box;
}

.page-header {
  margin-bottom: 24px;
}

.page-title {
  font-size: 24px;
  font-weight: 600;
  color: #303133;
  margin: 0 0 8px 0;
}

.page-desc {
  font-size: 14px;
  color: #909399;
}

.filter-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px 16px;
  margin-bottom: 20px;
  padding: 16px;
  background: white;
  border-radius: 8px;
}

.stats {
  margin-left: auto;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
}

.stat-item {
  font-size: 14px;
  color: #606266;
}

.app-name-cell {
  display: flex;
  align-items: center;
}

.app-info {
  flex: 1;
  min-width: 0;
}

.app-name {
  font-weight: 500;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-id {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
}

.tags-cell {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.empty-text {
  color: #c0c4cc;
  font-size: 13px;
}

.pagination-container {
  margin-top: 20px;
  display: flex;
  justify-content: center;
}

.edit-dialog-content {
  padding: 8px 0;
}

.app-info-section {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px;
  background: #f5f7fa;
  border-radius: 8px;
}

.app-details h3 {
  margin: 0 0 8px 0;
  font-size: 18px;
  color: #303133;
}

.app-intro {
  margin: 0;
  font-size: 14px;
  color: #606266;
  line-height: 1.5;
}

:deep(.el-table) {
  border-radius: 8px;
  overflow: hidden;
}

:deep(.el-dialog__header) {
  padding: 20px 24px;
  border-bottom: 1px solid #e4e7ed;
}

:deep(.el-dialog__body) {
  padding: 24px;
}

:deep(.el-dialog__footer) {
  padding: 16px 24px;
  border-top: 1px solid #e4e7ed;
}

/* Mobile Responsiveness */
@media (max-width: 768px) {
  .main-content {
    padding: 12px;
  }

  .filter-bar {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
  }

  .filter-bar .el-input,
  .filter-bar .el-select {
    width: 100% !important;
    margin-left: 0 !important;
  }

  .stats {
    margin-left: 0;
    margin-top: 8px;
    align-self: flex-start;
  }

  /* Override fixed columns in element-plus on mobile */
  :deep(.el-table .el-table__fixed),
  :deep(.el-table .el-table__fixed-right) {
    display: none;
  }

  :deep(.el-table__body-wrapper) {
    overflow-x: auto !important;
  }

  .pagination-container {
    overflow-x: auto;
    padding-bottom: 12px;
  }
}
</style>

