<template>
  <el-dialog
    v-model="visible"
    class="skill-import-dialog skill-zip-dialog"
    width="min(620px, calc(100vw - 28px))"
    :z-index="2300"
    title="上传 Skill"
    align-center
    modal-class="skill-zip-overlay"
    :close-on-click-modal="false"
    :close-on-press-escape="!busy"
    :show-close="!busy"
    destroy-on-close
  >
    <template #header="{ titleId }">
      <div class="upload-heading">
        <span class="upload-heading-icon" aria-hidden="true"><CloudUpload /></span>
        <div>
          <h2 :id="titleId">上传 Skill</h2>
          <p>上传 ZIP 技能包，确认解析结果后提交审核。</p>
        </div>
      </div>
    </template>

    <el-steps :active="step" align-center finish-status="success" class="import-steps">
      <el-step title="选择文件" />
      <el-step title="解析" />
      <el-step title="提交审核" />
      <el-step title="结果" />
    </el-steps>

    <el-alert v-if="formError" class="form-error" :title="formError" type="error" :closable="false" show-icon />

    <el-form v-if="step === 0" label-position="top" :disabled="busy" @submit.prevent="startImport">
      <input ref="fileInput" type="file" accept=".zip,application/zip" aria-label="选择 Skill ZIP 文件" hidden @change="selectFile" />
      <div class="upload-zone" :class="{ 'is-dragging': dragging, 'has-file': file }" @dragover.prevent="showDropTarget" @dragleave="hideDropTarget" @drop.prevent="dropFile">
        <div v-if="file" class="file-selection">
          <span class="file-type-icon" aria-hidden="true"><FileArchive /></span>
          <div class="file-details" aria-live="polite">
            <strong :title="file.name">{{ file.name }}</strong>
            <span>{{ fileSize }}</span>
          </div>
          <div class="file-actions">
            <button ref="pickFileButton" class="replace-file" type="button" :disabled="busy" @click="fileInput?.click()">重新选择</button>
            <button class="remove-file" type="button" aria-label="移除文件" :disabled="busy" @click="removeFile"><X aria-hidden="true" /></button>
          </div>
        </div>
        <button v-else ref="pickFileButton" class="upload-drop-button" type="button" aria-describedby="skill-zip-help" :disabled="busy" @click="fileInput?.click()">
          <span class="upload-zone-icon" aria-hidden="true"><FileArchive /></span>
          <strong>{{ dragging ? '松开以选择 ZIP' : '选择 ZIP 文件' }}</strong>
          <span class="drop-hint">点击选择文件，或拖拽到此处</span>
        </button>
      </div>
      <p id="skill-zip-help" class="zip-requirements">
        <Info aria-hidden="true" />
        <span>最大 50 MB，压缩包内须包含 <code>SKILL.md</code></span>
      </p>
    </el-form>

    <div v-else-if="step === 1" class="zip-progress" aria-live="polite">
      <strong>{{ parseHeadline }}</strong>
      <p v-if="parseMessage || file?.name">{{ parseMessage || file?.name }}</p>
      <el-progress
        :percentage="progress"
        :status="parseMessage ? 'exception' : undefined"
      />
      <p v-if="parseHint" class="parse-hint">{{ parseHint }}</p>
      <details v-if="parseMessage && skippedItems.length" class="skipped-items">
        <summary>查看跳过的 {{ skippedItems.length }} 项</summary>
        <ul><li v-for="item in skippedItems" :key="item.sourcePath"><strong>{{ item.sourcePath }}</strong> · {{ item.reason }}</li></ul>
      </details>
    </div>

    <section v-else-if="step === 2" class="zip-review">
      <p class="import-note">识别到 {{ items.length }} 个 Skill。确认信息后，选择要提交审核的条目。</p>
      <details v-if="skippedItems.length" class="skipped-items">
        <summary>可导入 {{ items.length }} 项，已跳过 {{ skippedItems.length }} 项</summary>
        <ul><li v-for="item in skippedItems" :key="item.sourcePath"><strong>{{ item.sourcePath }}</strong> · {{ item.reason }}</li></ul>
      </details>
      <div v-if="items.length > itemsPerPage" class="parse-pagination">
        <div class="selection-count">
          <span>已选 {{ selectedCount }} 项，共 {{ items.length }} 项</span>
        </div>
        <el-pagination
          v-model:current-page="parsePage"
          :page-size="itemsPerPage"
          :total="items.length"
          :pager-count="5"
          size="small"
          layout="prev, pager, next"
        />
      </div>
      <article v-for="item in visibleItems" :key="item.itemKey" class="parse-item">
        <el-checkbox v-model="item.selected">{{ item.sourcePath }}</el-checkbox>
        <el-form label-position="top" :disabled="!item.selected">
          <el-form-item label="名称" required><el-input v-model="item.name" maxlength="120" /></el-form-item>
          <el-form-item label="简介"><el-input v-model="item.summary" type="textarea" :rows="2" maxlength="1000" /></el-form-item>
          <el-form-item label="标签"><el-input v-model="item.tagsText" placeholder="用逗号分隔" /></el-form-item>
        </el-form>
        <small class="import-note">{{ item.fileCount }} 个文件<span v-if="item.version"> · 声明版本 {{ item.version }}</span></small>
        <details v-if="item.fileManifest?.length" class="file-preview">
          <summary>预览包内文件</summary>
          <ul><li v-for="entry in item.fileManifest" :key="entry.path">{{ entry.path }}</li></ul>
        </details>
      </article>
    </section>

    <section v-else aria-live="polite">
      <el-alert :title="resultMessage" :type="successCount ? 'success' : 'error'" :closable="false" show-icon />
      <p v-if="successCount" class="zip-result-note">审核通过后，Skill 将在广场展示。</p>
      <ul class="result-list">
        <li v-for="result in results" :key="result.itemKey">
          <strong>{{ result.name || items.find(item => item.itemKey === result.itemKey)?.name || result.itemKey }}</strong>
          <span>{{ result.success ? '待审批' : result.message }}</span>
        </li>
      </ul>
    </section>

    <template #footer>
      <div class="dialog-footer-actions">
        <el-button :disabled="busy" @click="visible = false">{{ step === 3 ? '关闭' : '取消' }}</el-button>
        <el-button v-if="step === 0" type="primary" :loading="busy" :disabled="!file" @click="startImport">上传并解析</el-button>
        <el-button v-else-if="step === 1 && parseMessage" type="primary" @click="backToSource">返回修改</el-button>
        <el-button v-else-if="step === 2" type="primary" :loading="busy" @click="submitImport">提交审核</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { isAxiosError } from 'axios'
import { CloudUpload, FileArchive, Info, X } from 'lucide-vue-next'
import { skillsApi } from '../../api/skills'
import type { SkillImportJob, SkillParseItem } from '../../types/skill'

interface EditableItem extends SkillParseItem {
  selected: boolean
  tagsText: string
}

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; submitted: [] }>()
const visible = computed({ get: () => props.modelValue, set: (value) => emit('update:modelValue', value) })
const maxZipBytes = 50 * 1024 * 1024
const step = ref(0)
const file = ref<File>()
const fileInput = ref<HTMLInputElement>()
const pickFileButton = ref<HTMLButtonElement>()
const dragging = ref(false)
const fileSize = computed(() => {
  const bytes = file.value?.size || 0
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
})
const jobId = ref('')
const progress = ref(0)
const parseMessage = ref('')
const stage = ref('')
const pollingUnavailable = ref(false)
const stageLabels: Record<string, string> = {
  queued: '等待解析服务接单',
  retry_wait: '等待自动重试',
  acquiring_package: '正在准备解析',
  downloading_stored_archive: '正在读取 Skill 包',
  parsing_archive: '正在解析 Skill 包',
  uploading_skill_artifacts: '正在保存解析结果'
}
const parseHeadline = computed(() => {
  if (parseMessage.value) return '解析失败'
  if (pollingUnavailable.value) return '正在重新获取任务状态'
  return stageLabels[stage.value] || '正在解析 Skill 包'
})
const parseHint = computed(() => {
  if (parseMessage.value) return ''
  if (pollingUnavailable.value) return '暂时无法获取进度，系统会自动重试。'
  if (stage.value === 'queued') return '任务已进入队列，开始处理后会自动更新进度。'
  return ''
})
const formError = ref('')
const busy = ref(false)
const items = ref<EditableItem[]>([])
const skippedItems = ref<NonNullable<SkillImportJob['skippedItems']>>([])
const itemsPerPage = 12
const parsePage = ref(1)
const visibleItems = computed(() => {
  const start = (parsePage.value - 1) * itemsPerPage
  return items.value.slice(start, start + itemsPerPage)
})
const selectedCount = computed(() => items.value.filter(item => item.selected).length)
const results = ref<SkillImportJob['results']>([])
const successCount = computed(() => results.value.filter(item => item.success).length)
const resultMessage = computed(() => {
  const failed = results.value.length - successCount.value
  return `成功提交 ${successCount.value} 项${failed ? `，失败 ${failed} 项` : ''}`
})

let pollTimer: number | undefined
let run = 0

function reset() {
  run += 1
  window.clearTimeout(pollTimer)
  step.value = 0
  file.value = undefined
  dragging.value = false
  jobId.value = ''
  progress.value = 0
  parseMessage.value = ''
  stage.value = ''
  pollingUnavailable.value = false
  formError.value = ''
  items.value = []
  skippedItems.value = []
  parsePage.value = 1
  results.value = []
}

function selectFile(event: Event) {
  const input = event.target as HTMLInputElement
  useFiles(input.files)
  input.value = ''
  void nextTick(() => pickFileButton.value?.focus())
}

function useFiles(files: FileList | null | undefined) {
  if (busy.value || !files?.length) return
  const selected = files[0]
  formError.value = ''
  if (files.length !== 1) formError.value = '一次请选择一个 ZIP 文件。'
  else if (!/\.zip$/i.test(selected.name)) formError.value = '仅支持 ZIP 格式的 Skill 包。'
  else if (selected.size > maxZipBytes) formError.value = 'ZIP 文件大小须在 50 MB 以内。'
  file.value = formError.value ? undefined : selected
}

function showDropTarget(event: DragEvent) {
  if (busy.value || !event.dataTransfer?.types.includes('Files')) return
  event.dataTransfer.dropEffect = 'copy'
  dragging.value = true
}

function hideDropTarget(event: DragEvent) {
  const zone = event.currentTarget as HTMLElement
  if (event.relatedTarget instanceof Node && zone.contains(event.relatedTarget)) return
  dragging.value = false
}

function dropFile(event: DragEvent) {
  dragging.value = false
  useFiles(event.dataTransfer?.files)
}

function removeFile() {
  file.value = undefined
  formError.value = ''
  void nextTick(() => pickFileButton.value?.focus())
}

function backToSource() {
  file.value = undefined
  step.value = 0
}

async function startImport() {
  if (busy.value) return
  formError.value = ''
  if (!file.value) {
    formError.value = '请选择 Skill ZIP 文件'
    return
  }
  busy.value = true
  const requestRun = ++run
  try {
    const form = new FormData()
    form.append('file', file.value)
    const response = await skillsApi.uploadSkill(form)
    if (requestRun !== run) return
    const job: SkillImportJob = response.data
    jobId.value = job.jobId
    progress.value = job.progress
    parseMessage.value = ''
    stage.value = job.stage
    pollingUnavailable.value = false
    step.value = 1
    void pollImportJob(requestRun)
  } catch (error) {
    if (requestRun === run) formError.value = (isAxiosError(error) && error.response?.data?.message) || '创建解析任务失败，请重试。'
  } finally {
    busy.value = false
  }
}

async function pollImportJob(requestRun: number) {
  let delay = 1600
  try {
    const { data }: { data: SkillImportJob } = await skillsApi.getImportJob(jobId.value)
    if (requestRun !== run) return
    progress.value = data.progress
    stage.value = data.stage
    pollingUnavailable.value = false
    if (data.status === 'ready') {
      skippedItems.value = data.skippedItems || []
      items.value = data.parseItems.map(item => ({
        ...item,
        selected: true,
        tagsText: (item.tags || []).join(', ')
      }))
      parsePage.value = 1
      step.value = 2
      return
    }
    if (data.status === 'failed') {
      skippedItems.value = data.skippedItems || []
      parseMessage.value = data.error?.message || 'Skill 解析失败'
      return
    }
  } catch (error) {
    if (requestRun !== run) return
    if ((error as { response?: { status?: number } }).response?.status === 404) {
      parseMessage.value = '解析任务已失效，请重新提交文件。'
      return
    }
    pollingUnavailable.value = true
    delay = 3000
  }
  if (requestRun === run) pollTimer = window.setTimeout(() => void pollImportJob(requestRun), delay)
}

async function submitImport() {
  const selected = items.value.filter(item => item.selected)
  formError.value = ''
  if (!selected.length) formError.value = '请至少选择一个 Skill'
  else if (selected.some(item => !item.name.trim())) formError.value = '请填写所选 Skill 的名称'
  if (formError.value) return
  const selections = selected.map(item => ({
    itemKey: item.itemKey,
    name: item.name,
    summary: item.summary,
    tags: item.tagsText.split(/[,，]/).map(tag => tag.trim()).filter(Boolean)
  }))
  busy.value = true
  try {
    const { data }: { data: SkillImportJob } = await skillsApi.submitImportJob(jobId.value, selections)
    results.value = data.results || []
    step.value = 3
    if (successCount.value) emit('submitted')
  } catch (error) {
    formError.value = (isAxiosError(error) && error.response?.data?.message) || '提交失败，请重试。'
  } finally {
    busy.value = false
  }
}

watch(visible, (value) => { if (!value) reset() })
onBeforeUnmount(() => { run += 1; window.clearTimeout(pollTimer) })
</script>

<style scoped>
:global(.skill-category-popper) { z-index: 2301 !important; }
.import-steps { margin-bottom: 24px; }
.form-error { margin-bottom: 12px; }
.import-note { margin: 0 0 12px; color: #5f7984; }
.parse-item { margin-bottom: 12px; padding: 16px; border: 1px solid #d8e8ed; border-radius: 12px; }
.parse-item :deep(.el-checkbox__label) { overflow-wrap: anywhere; white-space: normal; }
.parse-item :deep(.el-select) { width: 100%; }
.file-preview { margin-top: 6px; font-size: 12px; overflow-wrap: anywhere; }
.file-preview summary { color: #24699f; }
.file-preview summary { cursor: pointer; }
.file-preview ul { max-height: 140px; overflow: auto; margin: 6px 0 0; padding-inline-start: 22px; }
.skipped-items { margin: 10px 0 14px; padding: 9px 12px; border-radius: 8px; background: #fff6e5; color: #77571f; font-size: 13px; overflow-wrap: anywhere; }
.skipped-items summary { cursor: pointer; }
.skipped-items ul { max-height: 160px; margin: 8px 0 0; padding-left: 20px; overflow: auto; }
.dialog-footer-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 12px; }
.dialog-footer-actions :deep(.el-button) { margin: 0; }
.result-list { display: grid; gap: 8px; max-height: min(32vh, 280px); padding: 0; overflow: auto; list-style: none; }
.result-list li { display: grid; gap: 3px; padding: 10px; border-radius: 8px; background: #f4f8fa; overflow-wrap: anywhere; }
:deep(.skill-import-dialog) { display: flex; max-height: calc(100dvh - 48px); margin: 24px auto; flex-direction: column; overflow: hidden; }
:deep(.skill-import-dialog .el-dialog__body) { min-height: 0; overflow: auto; overscroll-behavior: contain; }
:deep(.skill-import-dialog .el-dialog__footer) { flex: 0 0 auto; }
:global(.skill-zip-overlay.el-overlay) { background: rgb(15 35 48 / 48%); backdrop-filter: blur(2px); }
:global(.skill-zip-overlay .el-overlay-dialog) { padding: 12px 0; }
:global(.skill-import-dialog.skill-zip-dialog) {
  display: flex;
  max-height: calc(100dvh - 24px);
  flex-direction: column;
  margin: auto;
  padding: 0;
  overflow: hidden;
  border: 1px solid #daebf2;
  border-radius: 20px;
  background: #fff;
  box-shadow: 0 24px 72px rgb(13 49 70 / 30%);
}
:global(.skill-zip-dialog .el-dialog__header) {
  flex: none;
  margin: 0;
  padding: 24px 58px 20px 24px;
  border-bottom: 1px solid #e6eff3;
  background: linear-gradient(120deg, #f2f9fc, #fff 76%);
}
:global(.skill-zip-dialog .el-dialog__headerbtn) { top: 15px; right: 15px; width: 36px; height: 36px; color: #557687; }
:global(.skill-zip-dialog .el-dialog__body) { min-height: 0; padding: 20px 24px 22px; overflow: auto; overscroll-behavior: contain; }
:global(.skill-zip-dialog .el-dialog__footer) { flex: none; padding: 14px 24px; border-top: 1px solid #e6eff3; background: #f8fbfd; }
.upload-heading { display: flex; align-items: center; gap: 13px; }
.upload-heading-icon, .upload-zone-icon, .file-type-icon { display: grid; flex: none; place-items: center; color: #246d94; background: #e5f3fa; }
.upload-heading-icon { width: 46px; height: 46px; border-radius: 13px; }
.upload-heading-icon svg { width: 24px; height: 24px; }
.upload-heading h2 { margin: 0; color: #173d50; font-size: 22px; line-height: 1.3; }
.upload-heading p { margin: 4px 0 0; color: #536f7e; font-size: 13px; line-height: 1.45; }
.upload-zone { overflow: hidden; border: 1px dashed #97c5db; border-radius: 14px; background: #f6fbfe; }
.upload-zone:has(.upload-drop-button:hover), .upload-zone.is-dragging { border-color: #357fa5; background: #edf7fc; }
.upload-zone.has-file { border-style: solid; border-color: #cde3ee; }
.upload-zone.has-file.is-dragging { border-style: dashed; border-color: #357fa5; }
.upload-drop-button { display: grid; width: 100%; min-height: 166px; justify-items: center; align-content: center; gap: 8px; padding: 16px; border: 0; background: transparent; color: #214e67; font: inherit; cursor: pointer; }
.upload-zone-icon { width: 52px; height: 52px; border: 1px solid #cee7f3; border-radius: 15px; }
.upload-zone-icon svg { width: 25px; height: 25px; }
.upload-drop-button strong { font-size: 15px; }
.drop-hint { color: #536f7e; font-size: 13px; }
.upload-drop-button:focus-visible { outline: 2px solid #357fa5; outline-offset: -4px; }
.file-selection { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 11px; padding: 14px; }
.file-type-icon { width: 40px; height: 40px; border-radius: 11px; }
.file-type-icon svg { width: 20px; height: 20px; }
.file-details { display: grid; gap: 3px; color: #536f7e; font-size: 12px; }
.file-details strong { overflow: hidden; color: #214e67; font-size: 14px; text-overflow: ellipsis; white-space: nowrap; }
.file-actions { display: flex; align-items: center; gap: 4px; }
.file-actions button { display: inline-flex; min-height: 34px; align-items: center; justify-content: center; padding: 0 6px; border: 0; border-radius: 6px; background: transparent; color: #246d94; font: inherit; font-size: 12px; cursor: pointer; }
.file-actions button:hover:not(:disabled) { background: #e3f0f7; }
.file-actions button:focus-visible { outline: 2px solid #357fa5; }
.file-actions button:disabled { opacity: .6; cursor: not-allowed; }
.file-actions .remove-file { min-width: 34px; color: #536f7e; }
.remove-file svg, .zip-requirements svg { width: 15px; height: 15px; flex: none; }
.zip-requirements { display: flex; align-items: flex-start; gap: 6px; margin: 12px 0 0; color: #536f7e; font-size: 12px; line-height: 1.5; }
.zip-requirements svg { margin-top: 1px; color: #37799b; }
.zip-progress { display: grid; justify-items: center; gap: 10px; padding: 24px 16px; border: 1px solid #dcebf2; border-radius: 14px; background: #f6fbfe; text-align: center; }
.zip-progress strong { color: #214e67; font-size: 15px; }
.zip-progress p { margin: 0; color: #536f7e; overflow-wrap: anywhere; }
.zip-progress :deep(.el-progress) { width: min(100%, 360px); }
.parse-hint { color: #536f7e; font-size: 12px; }
.parse-pagination { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 12px; color: #536f7e; font-size: 13px; }
.zip-result-note { margin: 10px 0 0; color: #536f7e; }
.skill-zip-dialog .dialog-footer-actions :deep(.el-button) { min-height: 38px; padding-inline: 16px; border-radius: 9px; }
.skill-zip-dialog .dialog-footer-actions :deep(.el-button--primary:not(.is-disabled)) { --el-button-bg-color: #246b9c; --el-button-border-color: #246b9c; --el-button-hover-bg-color: #205d8a; --el-button-hover-border-color: #205d8a; }
.skill-zip-dialog .dialog-footer-actions :deep(.el-button--primary.is-disabled) { --el-button-disabled-bg-color: #e4eef4; --el-button-disabled-border-color: #d5e5ee; --el-button-disabled-text-color: #567382; }
@media (max-width: 560px) {
  :deep(.skill-import-dialog) { width: calc(100vw - 24px); max-height: calc(100dvh - 24px); margin: 12px auto; }
  :global(.skill-zip-dialog .el-dialog__header) { padding: 17px 44px 16px 16px; }
  :global(.skill-zip-dialog .el-dialog__headerbtn) { top: 10px; right: 9px; }
  :global(.skill-zip-dialog .el-dialog__body) { padding: 16px; }
  :global(.skill-zip-dialog .el-dialog__footer) { padding: 12px 16px; }
  .upload-heading { gap: 10px; }
  .upload-heading-icon { width: 40px; height: 40px; }
  .upload-heading h2 { font-size: 20px; }
  .upload-drop-button { min-height: 142px; }
  .file-selection { gap: 8px; padding: 10px; }
}
</style>
