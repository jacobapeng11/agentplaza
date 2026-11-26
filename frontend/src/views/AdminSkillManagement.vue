<template>
  <div class="admin-skill-page">
    <PlazaHeader />
    <main>
      <header class="page-heading">
        <h1>Skill 管理</h1>
      </header>

      <section class="management-panel">
        <div class="management-toolbar">
          <el-tabs v-model="tab" class="management-tabs" @tab-change="changeFilters">
            <el-tab-pane label="待审批" name="pending" />
            <el-tab-pane label="已发布" name="published" />
            <el-tab-pane label="已下架" name="offline" />
          </el-tabs>
          <div class="management-filters">
            <label class="management-search">
              <Search class="search-icon" aria-hidden="true" />
              <input
                v-model="searchInput"
                type="search"
                aria-label="搜索 Skill"
                placeholder="搜索 Skill 名称、简介、标签或贡献者"
                @keyup.enter="applySearch"
              />
            </label>
          </div>
        </div>

        <div v-if="selectedSkills.size" class="batch-toolbar">
          <span class="selection-count" aria-live="polite">已选 {{ selectedSkills.size }} 项</span>
          <div class="batch-actions">
            <template v-if="tab === 'pending'">
              <el-button size="small" type="primary" :disabled="loading || !!marked" @click="openBatch('approve')">批量审批通过</el-button>
              <el-button size="small" type="danger" plain :disabled="loading || !!marked" @click="openBatch('reject')">批量驳回</el-button>
            </template>
            <el-button v-else size="small" type="primary" plain :disabled="loading || !!marked" @click="openBatch('category')">批量设置分类</el-button>
            <el-button size="small" text :disabled="!!marked" @click="selectedSkills.clear()">清除选择</el-button>
          </div>
        </div>

        <div v-loading="loading" class="table-frame">
          <div ref="tableScroll" class="table-scroll" role="region" aria-label="Skill 列表" :aria-busy="loading" tabindex="0">
            <table class="skills-table" :class="{ 'is-pending': tab === 'pending' }">
              <colgroup>
                <col class="selection-col" />
                <col />
                <template v-if="tab === 'pending'">
                  <col class="owner-col" />
                  <col class="submitted-col" />
                  <col class="track-col" />
                </template>
                <template v-else>
                  <col class="category-col" />
                  <col class="owner-col" />
                  <col class="version-col" />
                  <col class="track-col" />
                </template>
                <col class="action-col" />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col" class="selection-cell">
                    <el-checkbox
                      aria-label="全选当前页"
                      :model-value="allPageSelected"
                      :indeterminate="somePageSelected && !allPageSelected"
                      :disabled="loading || loadFailed || !!marked || !selectableRows.length"
                      @change="togglePageSelection"
                    />
                  </th>
                  <th scope="col">Skill</th>
                  <template v-if="tab === 'pending'">
                    <th scope="col">提交人</th>
                    <th scope="col" aria-sort="descending">提交时间</th>
                    <th scope="col">状态</th>
                  </template>
                  <template v-else>
                    <th scope="col">分类</th>
                    <th scope="col">贡献者</th>
                    <th scope="col">版本</th>
                    <th scope="col">展示类型</th>
                  </template>
                  <th class="action-cell" scope="col">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="loadFailed">
                  <td :colspan="tab === 'pending' ? 6 : 7">
                    <div class="load-error">
                      <p>Skill 列表加载失败</p>
                      <el-button size="small" @click="loadList">重试</el-button>
                    </div>
                  </td>
                </tr>
                <tr v-else-if="!loading && !rows.length">
                  <td :colspan="tab === 'pending' ? 6 : 7">
                    <div class="table-empty"><el-empty :image-size="74" :description="emptyText" /></div>
                  </td>
                </tr>
                <template v-else>
                  <tr v-for="row in rows" :key="row.item.id" :class="{ 'is-selected': selectedSkills.has(row.item.id) }">
                    <td class="selection-cell">
                      <el-checkbox
                        :aria-label="`选择 ${row.item.name}`"
                        :model-value="selectedSkills.has(row.item.id)"
                        :disabled="loading || !!marked || (row.kind === 'submission' && row.item.status === 'publishing')"
                        @change="toggleRowSelection(row, $event === true)"
                      />
                    </td>
                    <td>
                      <div class="skill-name">{{ row.item.name }}</div>
                      <button
                        v-if="row.item.summary"
                        class="skill-summary"
                        type="button"
                        :aria-label="`查看 ${row.item.name} 的${row.item.summary ? '完整简介' : '来源'}`"
                        @click="previewSkill = row.item"
                      >{{ row.item.summary || '查看来源' }}</button>
                      <button
                        v-if="row.item.source?.name"
                        class="skill-source-name"
                        type="button"
                        :aria-label="`查看 ${row.item.name} 的来源 ${row.item.source.name}`"
                        @click="previewSkill = row.item"
                      >{{ row.item.source.name }}</button>
                    </td>
                    <template v-if="row.kind === 'submission'">
                      <td class="owner-cell">{{ row.item.owner.name || row.item.owner.badge }}</td>
                      <td><time class="timestamp" :datetime="row.item.submittedAt">{{ formatDate(row.item.submittedAt) }}</time></td>
                      <td><span class="status-pill" :class="row.item.status === 'publishing' ? 'status-processing' : 'status-pending'">{{ row.item.status === 'publishing' ? '审批处理中' : '待审批' }}</span></td>
                      <td class="action-cell">
                        <el-button size="small" type="primary" plain :loading="marked === row.item.id" :disabled="!!marked && marked !== row.item.id" @click="openReview(row.item.id)">查看并审批</el-button>
                      </td>
                    </template>
                    <template v-else>
                      <td><span class="category-chip">{{ categoryName(row.item.category) }}</span></td>
                      <td class="owner-cell">{{ row.item.owner.name || row.item.owner.badge }}</td>
                      <td><span class="version">v{{ row.item.version }}</span></td>
                      <td><span class="status-pill" :class="row.item.track === 'official' ? 'status-official' : 'status-community'">{{ row.item.track === 'official' ? '官方精选' : '社区 Skill' }}</span></td>
                      <td>
                        <div class="row-actions">
                          <el-button size="small" :disabled="!!marked" @click="openCategory(row.item)">修改分类</el-button>
                          <el-button size="small" :disabled="!!marked" @click="toggleOfficial(row.item)">{{ row.item.track === 'official' ? '取消精选' : '设为精选' }}</el-button>
                          <el-button size="small" :type="tab === 'offline' ? 'primary' : 'danger'" plain :disabled="!!marked" @click="toggleStatus(row.item)">
                            {{ tab === 'offline' ? '重新上架' : '下架' }}
                          </el-button>
                        </div>
                      </td>
                    </template>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
        </div>

        <footer class="table-footer">
          <span class="table-count" aria-live="polite">{{ loadFailed ? '加载失败' : loading ? '加载中…' : `共 ${total} 条` }}</span>
          <el-pagination
            v-if="total > limit"
            v-model:current-page="page"
            :page-size="limit"
            :pager-count="5"
            :total="total"
            size="small"
            background
            layout="prev, pager, next"
            @current-change="changePage"
          />
        </footer>
      </section>
    </main>

    <el-dialog :model-value="!!previewSkill" :title="previewSkill?.name" width="min(620px, 94vw)" :z-index="2300" @update:model-value="previewSkill = undefined">
      <p v-if="previewSkill?.summary" class="summary-preview">{{ previewSkill.summary }}</p>
      <dl v-if="previewSkill?.source" class="review-source">
        <dt>来源</dt>
        <dd><SkillSourceLabel :source="previewSkill.source" /></dd>
      </dl>
    </el-dialog>

    <el-dialog v-model="reviewVisible" title="审批 Skill" width="min(680px, 94vw)" :z-index="2300" :close-on-click-modal="false" :show-close="!marked" :close-on-press-escape="!marked">
      <el-alert v-if="dialogError" class="dialog-error" :title="dialogError" type="error" :closable="false" show-icon />
      <template v-if="submission">
        <div class="review-title">
          <h2>{{ submission.name }}</h2>
          <p>提交人 {{ submission.owner.name || submission.owner.badge }}<template v-if="submission.version"> · {{ submission.category ? '当前版本' : '声明版本' }} {{ submission.version }}</template></p>
        </div>
        <p v-if="submission.summary">{{ submission.summary }}</p>
        <p v-if="submission.tags.length" class="row-meta">{{ submission.tags.join(' · ') }}</p>
        <dl class="review-source">
          <dt>来源</dt>
          <dd><SkillSourceLabel :source="submission.source" /></dd>
        </dl>
        <div v-if="submission.archiveName" class="review-source archive-review">
          <span>{{ submission.archiveName }}</span>
          <el-button size="small" :loading="downloadingArchive" @click="downloadReviewArchive">下载原始 ZIP</el-button>
        </div>
        <el-tabs v-else>
          <el-tab-pane label="SKILL.md">
            <p class="row-meta">{{ submission.sourcePath }}</p>
            <pre class="review-content">{{ submission.skillMdContent || '暂无内容快照' }}</pre>
          </el-tab-pane>
          <el-tab-pane :label="`文件（${submission.fileManifest.length}）`">
            <ul class="review-content">
              <li v-for="file in submission.fileManifest" :key="file.path">{{ file.path }}</li>
            </ul>
          </el-tab-pane>
          <el-tab-pane v-if="submission.warnings.length" label="解析提示">
            <ul class="review-content"><li v-for="(warning, index) in submission.warnings" :key="index">{{ warning }}</li></ul>
          </el-tab-pane>
        </el-tabs>
        <el-form label-position="top" class="review-form">
          <el-form-item label="分类" required>
            <el-select v-model="reviewCategory" popper-class="skill-category-popper" placeholder="请选择分类">
              <el-option v-for="option in categories" :key="option.id" :label="option.name" :value="option.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="展示类型">
            <el-checkbox v-model="reviewOfficial">同时设为官方精选</el-checkbox>
          </el-form-item>
        </el-form>
      </template>
      <template #footer>
        <el-button :disabled="!!marked" @click="reviewVisible = false">取消</el-button>
        <el-button type="danger" plain :disabled="!!marked || submission?.status === 'publishing'" @click="review('reject')">驳回</el-button>
        <el-button type="primary" :loading="!!marked" :disabled="!reviewCategory" @click="review('approve')">审批通过</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="categoryVisible" title="修改分类" width="min(410px, 94vw)" :z-index="2300" :close-on-click-modal="false" :show-close="!marked" :close-on-press-escape="!marked">
      <el-alert v-if="dialogError" class="dialog-error" :title="dialogError" type="error" :closable="false" show-icon />
      <el-form label-position="top">
        <el-form-item :label="categorySkill?.name || 'Skill 分类'">
          <el-select v-model="editedCategory" popper-class="skill-category-popper" placeholder="请选择分类">
            <el-option v-for="option in categories" :key="option.id" :label="option.name" :value="option.id" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="!!marked" @click="categoryVisible = false">取消</el-button>
        <el-button type="primary" :loading="!!marked" :disabled="!editedCategory" @click="saveCategory">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="batchVisible" :title="batchTitle" width="min(480px, 94vw)" :z-index="2300" :close-on-click-modal="false" :show-close="!marked" :close-on-press-escape="!marked">
      <el-alert v-if="dialogError" class="dialog-error" :title="dialogError" type="error" :closable="false" show-icon />
      <ul v-if="batchFailures.length" class="batch-failures">
        <li v-for="failure in batchFailures" :key="failure.id"><strong>{{ failure.name }}</strong><span>{{ failure.message }}</span></li>
      </ul>
      <p class="batch-description">{{ batchDescription }}</p>
      <el-form v-if="batchAction !== 'reject'" label-position="top">
        <el-form-item label="统一分类" required>
          <el-select v-model="batchCategory" popper-class="skill-category-popper" placeholder="请选择分类" :disabled="!!marked">
            <el-option v-for="option in categories" :key="option.id" :label="option.name" :value="option.id" />
          </el-select>
        </el-form-item>
        <el-checkbox v-if="batchAction === 'approve'" v-model="batchOfficial" :disabled="!!marked">同时设为官方精选</el-checkbox>
      </el-form>
      <template #footer>
        <el-button :disabled="!!marked" @click="batchVisible = false">{{ batchFailures.length ? '关闭' : '取消' }}</el-button>
        <el-button
          :type="batchAction === 'reject' ? 'danger' : 'primary'"
          :loading="marked === 'batch'"
          :disabled="!selectedSkills.size || (batchAction !== 'reject' && !batchCategory)"
          @click="submitBatch"
        >{{ batchFailures.length ? '重试失败项' : batchTitle }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { isAxiosError } from 'axios'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search } from '@element-plus/icons-vue'
import { skillsApi } from '../api/skills'
import PlazaHeader from '../components/plaza/PlazaHeader.vue'
import SkillSourceLabel from '../components/skills/SkillSourceLabel.vue'
import type { SkillCategory, SkillListItem, SkillSubmission, SkillSubmissionDetail } from '../types/skill'

type Tab = 'pending' | 'published' | 'offline'
type BatchAction = 'category' | 'approve' | 'reject'
type ManagedRow = { kind: 'submission'; item: SkillSubmission } | { kind: 'skill'; item: SkillListItem }
const tab = ref<Tab>('pending')
const page = ref(1)
const limit = 20
const total = ref(0)
const searchInput = ref('')
const search = ref('')
const categories = ref<SkillCategory[]>([])
const rows = ref<ManagedRow[]>([])
const tableScroll = ref<HTMLDivElement>()
const previewSkill = ref<SkillSubmission | SkillListItem>()
const loading = ref(false)
const loadFailed = ref(false)
const marked = ref('')
const dialogError = ref('')
const emptyText = computed(() => search.value
  ? '未找到符合筛选条件的 Skill'
  : ({ pending: '暂无待审批的 Skill', published: '暂无已发布的 Skill', offline: '暂无已下架的 Skill' })[tab.value])

const reviewVisible = ref(false)
const downloadingArchive = ref(false)
const submission = ref<SkillSubmissionDetail>()
const reviewCategory = ref('')
const reviewOfficial = ref(false)
const categoryVisible = ref(false)
const categorySkill = ref<SkillListItem>()
const editedCategory = ref('')
const selectedSkills = ref(new Map<string, string>())
const maxBatchSize = 200
const selectableRows = computed(() => rows.value.filter(row => row.kind === 'skill' || row.item.status !== 'publishing'))
const allPageSelected = computed(() => selectableRows.value.length > 0 && selectableRows.value.every(row => selectedSkills.value.has(row.item.id)))
const somePageSelected = computed(() => selectableRows.value.some(row => selectedSkills.value.has(row.item.id)))
const batchVisible = ref(false)
const batchAction = ref<BatchAction>('category')
const batchCategory = ref('')
const batchOfficial = ref(false)
const batchFailures = ref<Array<{ id: string; name: string; message: string }>>([])
const batchTitle = computed(() => ({ category: '批量设置分类', approve: '批量审批通过', reject: '批量驳回' })[batchAction.value])
const batchDescription = computed(() => {
  const count = selectedSkills.value.size
  return {
    category: `为已选的 ${count} 个 Skill 设置同一分类。`,
    approve: `审批通过后，所选的 ${count} 个 Skill 将发布到广场。`,
    reject: `确认驳回所选的 ${count} 个 Skill？`
  }[batchAction.value]
})
let requestId = 0
let searchTimer: number | undefined

function formatDate(value: string) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

function categoryName(id: string) {
  return categories.value.find(item => item.id === id)?.name || id
}

async function loadCategories() {
  try {
    const { data } = await skillsApi.getCategories()
    categories.value = (data.items as SkillCategory[]).filter(item => item.id !== 'all')
  } catch {
    // The shared request client displays the server error.
  }
}

async function loadList() {
  const id = ++requestId
  const status = tab.value
  loading.value = true
  loadFailed.value = false
  try {
    const { data } = await skillsApi.getManagedSkills({
      status, page: page.value, limit, search: search.value
    })
    if (id !== requestId) return
    total.value = data.pagination.total
    const lastPage = Math.max(1, Math.ceil(total.value / limit))
    if (page.value > lastPage) {
      page.value = lastPage
      return await loadList()
    }
    rows.value = status === 'pending'
      ? (data.items as SkillSubmission[]).map(item => ({ kind: 'submission', item }))
      : (data.items as SkillListItem[]).map(item => ({ kind: 'skill', item }))
  } catch {
    if (id === requestId) loadFailed.value = true
  } finally {
    if (id === requestId) loading.value = false
  }
}

function changeFilters() {
  window.clearTimeout(searchTimer)
  search.value = searchInput.value.trim()
  loadFirstPage()
}

function loadFirstPage() {
  selectedSkills.value.clear()
  page.value = 1
  total.value = 0
  rows.value = []
  tableScroll.value?.scrollTo({ top: 0, left: 0 })
  void loadList()
}

function applySearch() {
  window.clearTimeout(searchTimer)
  const value = searchInput.value.trim()
  if (value === search.value) return
  search.value = value
  loadFirstPage()
}

function changePage() {
  tableScroll.value?.scrollTo({ top: 0 })
  void loadList()
}

function updateSelection(items: ManagedRow[], checked: boolean) {
  const selection = new Map(selectedSkills.value)
  for (const { item } of items) {
    if (checked) selection.set(item.id, item.name)
    else selection.delete(item.id)
  }
  if (selection.size > maxBatchSize) {
    ElMessage.warning(`每次最多选择 ${maxBatchSize} 个 Skill`)
    return
  }
  selectedSkills.value = selection
}

function toggleRowSelection(row: ManagedRow, checked: boolean) {
  updateSelection([row], checked)
}

function togglePageSelection() {
  updateSelection(selectableRows.value, !allPageSelected.value)
}

function openBatch(action: BatchAction) {
  batchAction.value = action
  batchCategory.value = ''
  batchOfficial.value = false
  batchFailures.value = []
  dialogError.value = ''
  batchVisible.value = true
  if (action !== 'reject' && !categories.value.length) void loadCategories()
}

async function submitBatch() {
  if (marked.value || !selectedSkills.value.size) return
  const selection = new Map(selectedSkills.value)
  const ids = [...selection.keys()]
  const action = batchAction.value
  marked.value = 'batch'
  dialogError.value = ''
  batchFailures.value = []
  try {
    const { data } = action === 'category'
      ? await skillsApi.setCategories(ids, batchCategory.value)
      : await skillsApi.reviewSubmissions(ids, action === 'approve'
        ? { decision: 'approve', category: batchCategory.value, official: batchOfficial.value ? true : undefined }
        : { decision: 'reject' })
    for (const result of data.results) {
      if (result.success) selectedSkills.value.delete(result.id)
      else batchFailures.value.push({ id: result.id, name: selection.get(result.id) || result.id, message: result.message || '操作失败' })
    }
    const failed = batchFailures.value.length
    const succeeded = data.results.length - failed
    if (failed) {
      dialogError.value = `成功 ${succeeded} 项，失败 ${failed} 项`
    } else {
      batchVisible.value = false
      ElMessage.success(`${batchTitle.value}成功，共 ${succeeded} 项`)
    }
    await loadList()
  } catch (error) {
    dialogError.value = (isAxiosError(error) && error.response?.data?.message) || '操作失败，请重试。'
  } finally {
    marked.value = ''
  }
}

async function downloadReviewArchive() {
  const row = submission.value
  if (!row?.archiveName || downloadingArchive.value) return
  downloadingArchive.value = true
  try {
    const blob = await skillsApi.downloadSubmissionArchive(row.id) as unknown as Blob
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = row.archiveName
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch {
    // 请求客户端已显示失败提示。
  } finally {
    downloadingArchive.value = false
  }
}

async function openReview(id: string) {
  marked.value = id
  try {
    if (!categories.value.length) await loadCategories()
    const { data } = await skillsApi.getSubmission(id)
    submission.value = data
    reviewCategory.value = data.category || ''
    reviewOfficial.value = data.track === 'official'
    dialogError.value = ''
    reviewVisible.value = true
  } catch {
    // The shared request client displays the server error.
  } finally {
    marked.value = ''
  }
}

async function confirmAction(message: string, action: string) {
  try {
    await ElMessageBox.confirm(message, action, { confirmButtonText: action, cancelButtonText: '取消', type: 'warning', modalClass: 'skill-admin-confirm' })
    return true
  } catch {
    return false
  }
}

async function save(id: string, action: () => Promise<unknown>, message: string, close?: () => void) {
  if (marked.value) return
  marked.value = id
  dialogError.value = ''
  try {
    await action()
    selectedSkills.value.delete(id)
    close?.()
    ElMessage.success(message)
    await loadList()
  } catch (error) {
    dialogError.value = (isAxiosError(error) && error.response?.data?.message) || '操作失败，请重试。'
  } finally {
    marked.value = ''
  }
}

async function review(decision: 'approve' | 'reject') {
  const row = submission.value
  if (!row) return
  if (decision === 'reject' && !await confirmAction(`确认驳回“${row.name}”的提交？`, '驳回')) return
  const review = decision === 'approve'
    ? { decision, category: reviewCategory.value, official: reviewOfficial.value } as const
    : { decision } as const
  await save(row.id, () => skillsApi.reviewSubmission(row.id, review),
    decision === 'approve' ? '审批通过' : '已驳回提交', () => { reviewVisible.value = false })
}

function openCategory(row: SkillListItem) {
  categorySkill.value = row
  editedCategory.value = row.category
  dialogError.value = ''
  categoryVisible.value = true
  if (!categories.value.length) void loadCategories()
}

function saveCategory() {
  const id = categorySkill.value?.id
  if (id) void save(id, () => skillsApi.setCategory(id, editedCategory.value), '分类已更新', () => { categoryVisible.value = false })
}

async function toggleOfficial(row: SkillListItem) {
  const official = row.track !== 'official'
  const action = official ? '设为官方精选' : '取消官方精选'
  if (await confirmAction(`确认${official ? '将' : '取消'}“${row.name}”${official ? '设为官方精选' : '的官方精选标记'}？`, action)) {
    await save(row.id, () => skillsApi.setOfficial(row.id, official), official ? '已设为官方精选' : '已取消官方精选')
  }
}

async function toggleStatus(row: SkillListItem) {
  const offline = tab.value === 'published'
  const action = offline ? '下架' : '重新上架'
  const message = offline ? '下架后，广场将隐藏此 Skill。' : '重新上架后，广场将展示此 Skill。'
  if (await confirmAction(`确认${action}“${row.name}”？${message}`, action)) {
    await save(row.id, () => skillsApi.setStatus(row.id, offline ? 'offline' : 'published'), `已${action}`)
  }
}

onMounted(() => {
  void loadCategories()
  void loadList()
})
watch(searchInput, () => {
  window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(applySearch, 450)
})
onBeforeUnmount(() => window.clearTimeout(searchTimer))
</script>

<style scoped>
:global(.skill-admin-confirm.el-overlay) { z-index: 2310 !important; }
:global(#app:has(.admin-skill-page)),
:global(.app-root:has(> .admin-skill-page)) { min-height: 100dvh; }
.admin-skill-page {
  display: flex;
  height: 100vh;
  height: 100dvh;
  flex-direction: column;
  overflow: hidden;
  color: #23404c;
  background: #f3f9fb url('/bj.png') center / cover fixed;
}
main {
  display: flex;
  width: min(1280px, calc(100% - 48px));
  min-width: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 20px;
  margin: 0 auto;
  padding: 28px 0 24px;
}
.page-heading { display: flex; flex: none; align-items: center; justify-content: space-between; gap: 12px; }
h1, h2, p { margin: 0; }
h1 { color: #173d50; font-size: clamp(24px, 3vw, 32px); line-height: 1.25; }
h2 { font-size: 16px; overflow-wrap: anywhere; }
.management-panel {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid #d3e5ee;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 12px 32px #23546e12;
}
.management-toolbar { display: flex; flex: none; align-items: center; justify-content: space-between; gap: 16px; padding: 0 20px; border-bottom: 1px solid #e0ebf1; }
.management-tabs { min-width: 0; flex: none; }
.management-tabs :deep(.el-tabs__header) { margin: 0; }
.management-tabs :deep(.el-tabs__content),
.management-tabs :deep(.el-tabs__nav-wrap::after) { display: none; }
.management-tabs :deep(.el-tabs__item) { height: 52px; padding-inline: 18px; color: #526d7b; font-weight: 600; }
.management-tabs :deep(.el-tabs__item.is-active) { color: #276caa; }
.management-tabs :deep(.el-tabs__active-bar) { height: 3px; border-radius: 3px 3px 0 0; background: #3481bc; }
.management-filters { display: flex; width: min(564px, 100%); min-width: 0; gap: 8px; }
.management-search { display: flex; width: min(360px, 100%); min-width: 0; height: 36px; align-items: center; gap: 9px; padding: 0 11px; border: 1px solid #cfe5ed; border-radius: 9px; background: #fbfdfe; color: #446d83; }
.management-search:focus-within { border-color: #3481bc; outline: 1px solid #3481bc; }
.search-icon { width: 16px; height: 16px; flex: none; }
.management-search input { width: 100%; min-width: 0; padding: 0; border: 0; outline: 0; background: transparent; color: #294d60; font: inherit; font-size: 13px; }
.management-search input:focus { outline: none; box-shadow: none !important; }
.batch-toolbar { display: flex; flex: none; flex-wrap: wrap; align-items: center; gap: 8px 12px; min-height: 44px; padding: 6px 20px; border-bottom: 1px solid #dcebf3; background: #f2f8fc; }
.selection-count { color: #285d80; font-size: 13px; font-weight: 650; }
.batch-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.batch-actions :deep(.el-button) { margin: 0; }
.table-frame { display: flex; min-width: 0; min-height: 0; flex: 1; }
.table-scroll {
  min-width: 0;
  min-height: 0;
  flex: 1;
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-color: #aec7d5 #f4f8fa;
  scrollbar-gutter: stable;
}
.table-scroll:focus-visible { outline: 2px solid #3481bc; outline-offset: -2px; }
.skills-table { width: 100%; min-width: 880px; table-layout: fixed; border-spacing: 0; text-align: left; }
.skills-table.is-pending { min-width: 700px; }
.selection-col { width: 52px; }
.category-col { width: 96px; }
.owner-col { width: 116px; }
.version-col { width: 82px; }
.track-col { width: 106px; }
.submitted-col { width: 172px; }
.action-col { width: 238px; }
.is-pending .action-col { width: 146px; }
.skills-table th, .skills-table td { padding-inline: 12px; }
.skills-table th:first-child, .skills-table td:first-child { padding-left: 20px; }
.skills-table th:last-child, .skills-table td:last-child { padding-right: 20px; }
.selection-cell :deep(.el-checkbox) { margin: 0; }
.skills-table th {
  position: sticky;
  z-index: 1;
  top: 0;
  height: 44px;
  background: #f2f7fa;
  box-shadow: inset 0 -1px #dde9f0;
  color: #466474;
  font-size: 13px;
  font-weight: 650;
  white-space: nowrap;
}
.skills-table td { height: 72px; padding-block: 11px; border-bottom: 1px solid #e7eef3; color: #384e5e; font-size: 13px; }
.skills-table tbody tr:nth-child(even) { background: #fafcfd; }
.skills-table tbody tr:hover { background: #f2f8fc; }
.skills-table tbody tr.is-selected { background: #edf6fc; }
.skill-name { color: #173d50; font-size: 14px; font-weight: 700; line-height: 1.4; overflow-wrap: anywhere; }
.skill-summary {
  display: -webkit-box;
  width: 100%;
  margin-top: 4px;
  padding: 0;
  overflow: hidden;
  border: 0;
  background: transparent;
  color: #546b79;
  font: inherit;
  line-height: 1.45;
  overflow-wrap: anywhere;
  text-align: left;
  cursor: pointer;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.skill-summary:hover { color: #24699f; text-decoration: underline; }
.skill-source-name { max-width: 100%; margin-top: 5px; padding: 0; border: 0; background: transparent; color: #5a7483; font: inherit; font-size: 12px; overflow-wrap: anywhere; text-align: left; cursor: pointer; }
.skill-source-name:hover { color: #24699f; text-decoration: underline; }
.skill-summary:focus-visible, .skill-source-name:focus-visible { outline: 2px solid #3481bc; outline-offset: 2px; }
.owner-cell { overflow-wrap: anywhere; }
.timestamp, .version { font-variant-numeric: tabular-nums; }
.version { overflow-wrap: anywhere; }
.category-chip, .status-pill { display: inline-block; padding: 3px 7px; border-radius: 6px; font-size: 12px; line-height: 1.4; white-space: nowrap; }
.category-chip { background: #eaf3f7; color: #385d71; }
.status-official { background: #fff1d9; color: #855211; }
.status-community { background: #eef2f6; color: #53697a; }
.status-pending { background: #fff1d9; color: #855211; }
.status-processing { background: #e8f2fd; color: #28669e; }
.action-cell { text-align: right; }
.row-actions { display: flex; justify-content: flex-end; gap: 6px; }
.row-actions :deep(.el-button) { margin: 0; }
.table-footer { display: flex; min-height: 54px; flex: none; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 20px; border-top: 1px solid #dfeaf0; }
.table-count { color: #516b79; font-size: 13px; white-space: nowrap; }
.table-empty, .load-error { position: sticky; left: 0; width: min(100%, calc(100vw - 64px)); margin-inline: auto; }
.load-error { display: grid; justify-items: center; gap: 12px; padding: 24px; }
.row-meta, .review-title p { margin-top: 5px; color: #627b85; font-size: 13px; }
.summary-preview { max-height: 58dvh; overflow: auto; color: #384e5e; line-height: 1.65; overflow-wrap: anywhere; white-space: pre-wrap; }
.review-title { margin-bottom: 10px; }
.review-source { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 12px; margin: 12px 0; padding: 10px 12px; border-radius: 8px; background: #f3f8fa; }
.review-source dt { color: #516b79; }
.review-source dd { margin: 0; }
.archive-review { grid-template-columns: minmax(0, 1fr) auto; align-items: center; }
.archive-review span { overflow-wrap: anywhere; }
.dialog-error { margin-bottom: 12px; }
.batch-description { margin-bottom: 16px; }
.batch-failures { display: grid; gap: 8px; max-height: min(200px, 28dvh); margin: 0 0 16px; padding: 10px 12px; overflow: auto; overflow-wrap: anywhere; border-radius: 8px; background: #f6f9fb; list-style: none; }
.batch-failures li { display: grid; gap: 2px; }
.batch-failures span { color: #516b79; }
.review-content { max-height: 24vh; margin: 8px 0 0; padding: 12px 16px; overflow: auto; overflow-wrap: anywhere; border-radius: 8px; background: #f3f8fa; white-space: pre-wrap; }
ul.review-content { padding-left: 28px; }
.review-form { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; margin-top: 16px; }
@media (max-width: 680px) {
  main { width: calc(100% - 24px); gap: 14px; padding: 16px 0 max(12px, env(safe-area-inset-bottom)); }
  .management-toolbar { align-items: stretch; gap: 8px; flex-direction: column; padding: 0 12px 10px; }
  .management-search { width: 100%; }
  .batch-toolbar { padding-inline: 12px; }
  .table-footer { padding-inline: 12px; }
  .management-tabs :deep(.el-tabs__item) { height: 46px; }
  .table-footer { min-height: 46px; }
  .skills-table th:first-child, .skills-table td:first-child { padding-left: 12px; }
  .table-empty, .load-error { margin-left: 0; }
}
</style>
