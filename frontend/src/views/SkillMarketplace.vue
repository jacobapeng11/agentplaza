<template>
  <div class="skill-page">
    <PlazaHeader />

    <main class="skill-main-page">
      <section class="hero-panel">
        <div class="hero-copy">
          <span class="eyebrow">AGENT PLAZA · SKILLS</span>
          <h1>让优质 Skill 在团队中持续复用</h1>
          <p>上传 Skill 包，审核通过后即可在广场分享。</p>
          <div class="hero-actions">
            <button class="primary-button" type="button" @click="uploadVisible = true"><CloudUpload class="upload-button-icon" aria-hidden="true" /> 上传 Skill</button>
          </div>
        </div>
        <div class="hero-guide">
          <strong>发布流程</strong>
          <div><span>1</span><p><b>上传制品</b><small>ZIP 格式</small></p></div>
          <div><span>2</span><p><b>解析 Skill</b><small>识别 SKILL.md 和包内文件</small></p></div>
          <div><span>3</span><p><b>管理员审批</b><small>通过后发布</small></p></div>
        </div>
      </section>

      <section class="stats-grid" aria-label="Skill 统计">
        <article><span>Skill 总数</span><strong>{{ overview.total || 0 }}</strong><small>组织内已发布内容</small></article>
        <article><span>官方精选</span><strong>{{ overview.official || 0 }}</strong><small>平台认证 Skill</small></article>
        <article><span>社区 Skill</span><strong>{{ overview.community || 0 }}</strong><small>员工共享内容</small></article>
        <article><span>累计下载</span><strong>{{ overview.downloads || 0 }}</strong><small>采用短暂延迟的派生统计</small></article>
      </section>

      <section class="library-panel">
        <header class="library-header">
          <div class="library-title-row">
            <div class="library-title"><h2>Skill 库</h2></div>
            <div class="view-switch" aria-label="视图切换">
              <button :class="{ active: viewMode === 'card' }" type="button" @click="setView('card')">▦ 卡片</button>
              <button :class="{ active: viewMode === 'list' }" type="button" @click="setView('list')">☷ 列表</button>
            </div>
          </div>

          <div class="skill-toolbar">
            <label class="skill-search-box">
              <span>⌕</span>
              <input v-model="searchInput" type="search" placeholder="搜索 Skill 名称、简介、标签或贡献者" @keyup.enter="applySearch" />
            </label>
            <label class="skill-sort-control">
              <select v-model="sort" class="skill-sort-select" aria-label="排序方式" @change="reloadFromFirstPage">
                <option value="hot">最热优先</option>
                <option value="latest">最近更新</option>
                <option value="downloads">下载最多</option>
                <option value="favorites">收藏最多</option>
              </select>
            </label>
            <button class="skill-filter-button" :class="{ active: favoriteOnly }" type="button" @click="toggleFavoriteFilter">
              {{ favoriteOnly ? '♥ 已筛收藏' : '♡ 我的收藏' }}
            </button>
            <button class="skill-filter-button" :class="{ active: ownerOnly }" type="button" @click="toggleOwnerFilter">
              {{ ownerOnly ? '✓ 我的 Skill' : '我的 Skill' }}
            </button>
          </div>

          <nav class="category-tabs" aria-label="Skill 分类">
            <button
              v-for="category in categories"
              :key="category.id"
              :class="{ active: activeCategory === category.id }"
              type="button"
              @click="selectCategory(category.id)"
            >{{ category.name }}</button>
          </nav>

          <div class="result-row">
            <span>共 {{ pagination.total }} 个 Skill</span>
            <button class="text-button" type="button" @click="resetFilters">重置筛选</button>
          </div>
        </header>

        <div v-loading="loading" class="library-body">
          <div v-if="skills.length" class="skill-grid" :class="{ 'list-view': viewMode === 'list' }">
            <article
              v-for="skill in skills"
              :key="skill.id"
              class="skill-card"
              role="button"
              tabindex="0"
              @click="openDetail(skill.id)"
              @keydown.enter="openDetail(skill.id)"
            >
              <div class="skill-icon" :class="iconClass(skill.name)">{{ skill.name.slice(0, 1).toUpperCase() }}</div>
              <div class="card-copy">
                <div class="card-title-row">
                  <h3 :title="skill.name">{{ skill.name }}</h3>
                  <span class="track-badge" :class="skill.track">{{ skill.track === 'official' ? '官方精选' : '社区 Skill' }}</span>
                </div>
                <p class="card-summary" :title="skill.summary">{{ skill.summary || '暂无 Skill 简介' }}</p>
                <div class="tag-row">
                  <span>{{ categoryName(skill.category) }}</span>
                  <span v-for="tag in skill.tags.slice(0, 2)" :key="tag">{{ tag }}</span>
                </div>
              </div>
              <button class="favorite-button" :class="{ active: skill.isFavorite }" type="button" @click.stop="toggleFavorite(skill)">
                {{ skill.isFavorite ? '♥' : '♡' }}
              </button>
              <footer class="card-footer">
                <div class="card-footer-info">
                  <span>
                    {{ skill.owner?.name || skill.owner?.badge || '未知贡献者' }} · v{{ skill.version }}
                    <time
                      v-if="skill.contentUpdatedAt || skill.publishedAt || skill.updatedAt"
                      :datetime="skill.contentUpdatedAt || skill.publishedAt || skill.updatedAt"
                      :title="formatDate(skill.contentUpdatedAt || skill.publishedAt || skill.updatedAt)"
                    >· 更新于 {{ formatShortDate(skill.contentUpdatedAt || skill.publishedAt || skill.updatedAt) }}</time>
                  </span>
                </div>
                <div class="card-metrics">
                  <span title="浏览量"><Eye aria-hidden="true" /><span class="sr-only">浏览量</span>{{ skill.stats?.viewCount || 0 }}</span>
                  <span title="浏览人数"><UserRound aria-hidden="true" /><span class="sr-only">浏览人数</span>{{ skill.stats?.viewerCount || 0 }}</span>
                  <span title="下载量"><ArrowDownToLine aria-hidden="true" /><span class="sr-only">下载量</span>{{ skill.stats?.downloadCount || 0 }}</span>
                  <span title="收藏量"><Heart aria-hidden="true" /><span class="sr-only">收藏量</span>{{ skill.stats?.favoriteCount || 0 }}</span>
                </div>
              </footer>
            </article>
          </div>
          <el-empty v-else-if="!loading" description="没有找到匹配的 Skill" />

          <el-pagination
            v-if="pagination.pages > 1"
            v-model:current-page="page"
            class="pagination"
            background
            layout="prev, pager, next"
            :page-count="pagination.pages"
            @current-change="loadSkills"
          />
        </div>
      </section>
    </main>

    <el-drawer v-model="detailVisible" class="skill-detail-drawer" size="min(680px, 100vw)" :with-header="false" destroy-on-close>
      <div v-loading="detailLoading" class="detail-drawer">
        <template v-if="detail">
          <header class="detail-header">
            <div class="detail-icon" :class="iconClass(detail.name)">{{ detail.name.slice(0, 1).toUpperCase() }}</div>
            <div><div class="detail-title-row"><h2>{{ detail.name }}</h2><span class="track-badge" :class="detail.track">{{ detail.track === 'official' ? '官方精选' : '社区 Skill' }}</span></div><p>{{ detail.summary }}</p></div>
          </header>
          <div class="detail-actions">
            <button class="secondary-button" type="button" @click="toggleDetailFavorite">{{ detail.isFavorite ? '♥ 已收藏' : '♡ 收藏' }}</button>
            <button class="primary-button" type="button" @click="downloadSkill(detail.id)">↓ 下载 ZIP</button>
          </div>
          <el-tabs v-model="detailTab" class="detail-tabs">
            <el-tab-pane label="概览" name="overview" class="detail-scroll-pane">
              <dl class="detail-meta">
                <div><dt>当前版本</dt><dd>v{{ detail.version }}</dd></div>
                <div><dt>分类</dt><dd>{{ categoryName(detail.category) }}</dd></div>
                <div><dt>首次发布</dt><dd>{{ formatDate(detail.publishedAt) }}</dd></div>
                <div><dt>最近更新</dt><dd>{{ formatDate(detail.contentUpdatedAt || detail.latestVersion?.publishedAt || detail.publishedAt || detail.updatedAt) }}</dd></div>
                <div><dt>贡献者</dt><dd>{{ detail.owner?.name || detail.owner?.badge }}</dd></div>
                <div class="detail-source"><dt>来源</dt><dd><SkillSourceLabel :source="detail.source" /></dd></div>
                <div>
                  <dt>安全状态</dt>
                  <dd :class="{ 'safe-text': detail.security?.status === 'passed' }">{{ securityLabel[detail.security?.status] || '待检查' }}</dd>
                </div>
                <div><dt>浏览量/浏览人数</dt><dd>{{ detail.stats.viewCount || 0 }} / {{ detail.stats.viewerCount || 0 }}</dd></div>
                <div><dt>下载/收藏</dt><dd>{{ detail.stats.downloadCount }} / {{ detail.stats.favoriteCount }}</dd></div>
              </dl>
              <div class="detail-tag-row"><span v-for="tag in detail.tags" :key="tag">{{ tag }}</span></div>
            </el-tab-pane>
            <el-tab-pane v-if="detail.security?.status !== 'unscanned'" label="SKILL.md" name="markdown" class="markdown-tab-pane">
              <pre class="markdown-preview">{{ detail.latestVersion?.skillMdContent || '暂无内容快照' }}</pre>
            </el-tab-pane>
            <el-tab-pane v-if="detail.security?.status !== 'unscanned'" label="文件" name="files" class="detail-scroll-pane">
              <ul class="file-list"><li v-for="file in detail.latestVersion?.fileManifest || []" :key="file.path"><span>{{ file.path }}</span><small>{{ formatBytes(file.size) }}</small></li></ul>
            </el-tab-pane>
            <el-tab-pane label="版本记录" name="versions" class="detail-scroll-pane">
              <ul class="version-list"><li v-for="version in versions" :key="version.id"><div><strong>v{{ version.version }}</strong><span>第 {{ version.revision }} 个平台版本</span></div><time>{{ formatDate(version.publishedAt || version.createdAt) }}</time></li></ul>
            </el-tab-pane>
          </el-tabs>
        </template>
      </div>
    </el-drawer>

    <SkillImportDialog v-model="uploadVisible" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { ArrowDownToLine, CloudUpload, Eye, Heart, UserRound } from 'lucide-vue-next'
import PlazaHeader from '../components/plaza/PlazaHeader.vue'
import { skillsApi } from '../api/skills'
import SkillImportDialog from '../components/skills/SkillImportDialog.vue'
import SkillSourceLabel from '../components/skills/SkillSourceLabel.vue'
import type { SkillCategory, SkillDetail, SkillListItem } from '../types/skill'

const fallbackCategories: SkillCategory[] = [
  { id: 'all', name: '全部' }, { id: 'market', name: '大市场' }, { id: 'finance', name: '财经类' },
  { id: 'office', name: '办公类' }, { id: 'administration', name: '行政类' }, { id: 'research', name: '研发类' }, { id: 'general', name: '综合类' }
]

const categories = ref<SkillCategory[]>(fallbackCategories)
const overview = reactive({ total: 0, official: 0, community: 0, downloads: 0, favorites: 0 })
const skills = ref<SkillListItem[]>([])
const loading = ref(false)
const searchInput = ref('')
const search = ref('')
const activeCategory = ref('all')
const sort = ref(localStorage.getItem('skill_market_sort') || 'hot')
const favoriteOnly = ref(false)
const ownerOnly = ref(false)
const viewMode = ref<'card' | 'list'>((localStorage.getItem('skill_market_view') as 'card' | 'list') || 'card')
const page = ref(1)
const pagination = reactive({ total: 0, pages: 0, limit: 24 })
const detailVisible = ref(false)
const detailLoading = ref(false)
const detail = ref<SkillDetail | null>(null)
const versions = ref<any[]>([])
const detailTab = ref('overview')
const uploadVisible = ref(false)
const securityLabel = { pending: '待检查', passed: '✓ 解析检查通过', failed: '检查失败', unscanned: '未解析' }
let searchTimer: number | undefined

function unwrap(response: any) { return response?.data || {} }
function iconClass(name: string) { return `tone-${Math.abs([...name].reduce((sum, char) => sum + char.charCodeAt(0), 0)) % 4}` }
function categoryName(id: string) { return categories.value.find((item) => item.id === id)?.name || '综合类' }
function formatDate(value?: string) { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-' }
function formatShortDate(value?: string) { return value ? new Date(value).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }) : '-' }
function formatBytes(value = 0) { if (value < 1024) return `${value} B`; if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`; return `${(value / 1024 / 1024).toFixed(1)} MB` }

async function loadCategories() {
  try { const data = unwrap(await skillsApi.getCategories()); categories.value = data.items?.length ? data.items : fallbackCategories } catch { categories.value = fallbackCategories }
}
async function loadOverview() { try { Object.assign(overview, unwrap(await skillsApi.getOverview())) } catch {} }
async function loadSkills() {
  loading.value = true
  try {
    const data = unwrap(await skillsApi.getSkills({ page: page.value, limit: pagination.limit, category: activeCategory.value, search: search.value, sort: sort.value, favoriteOnly: favoriteOnly.value, ownerOnly: ownerOnly.value }))
    skills.value = data.items || []
    Object.assign(pagination, data.pagination || { total: 0, pages: 0, limit: 24 })
  } finally { loading.value = false }
}

function applySearch() { search.value = searchInput.value.trim(); page.value = 1; loadSkills() }
function reloadFromFirstPage() { localStorage.setItem('skill_market_sort', sort.value); page.value = 1; loadSkills() }
function selectCategory(category: string) { activeCategory.value = category; page.value = 1; loadSkills() }
function toggleFavoriteFilter() { favoriteOnly.value = !favoriteOnly.value; page.value = 1; loadSkills() }
function toggleOwnerFilter() { ownerOnly.value = !ownerOnly.value; page.value = 1; loadSkills() }
function resetFilters() { searchInput.value = ''; search.value = ''; activeCategory.value = 'all'; sort.value = 'hot'; favoriteOnly.value = false; ownerOnly.value = false; page.value = 1; loadSkills() }
function setView(mode: 'card' | 'list') { viewMode.value = mode; localStorage.setItem('skill_market_view', mode) }

watch(searchInput, () => { window.clearTimeout(searchTimer); searchTimer = window.setTimeout(applySearch, 450) })

async function toggleFavorite(skill: SkillListItem) {
  const data = unwrap(await skillsApi.toggleFavorite(skill.id))
  skill.isFavorite = data.isFavorite
  skill.stats.favoriteCount = data.favoriteCount
  if (favoriteOnly.value && !data.isFavorite) skills.value = skills.value.filter((item) => item.id !== skill.id)
}

async function openDetail(id: string) {
  detailVisible.value = true; detailLoading.value = true; detailTab.value = 'overview'
  try {
    const [detailResponse, versionsResponse] = await Promise.all([skillsApi.getDetail(id), skillsApi.getVersions(id)])
    detail.value = unwrap(detailResponse)
    versions.value = unwrap(versionsResponse).items || []
  } finally { detailLoading.value = false }
}

async function toggleDetailFavorite() {
  if (!detail.value) return
  const data = unwrap(await skillsApi.toggleFavorite(detail.value.id))
  detail.value.isFavorite = data.isFavorite; detail.value.stats.favoriteCount = data.favoriteCount
  const card = skills.value.find((item) => item.id === detail.value?.id)
  if (card) { card.isFavorite = data.isFavorite; card.stats.favoriteCount = data.favoriteCount }
}

async function downloadSkill(id: string) {
  const current = detail.value?.id === id ? detail.value : skills.value.find((item) => item.id === id)
  const version = current?.version || '1.0.0'
  const safeName = String(current?.name || 'skill').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || 'skill'
  const blob = await skillsApi.downloadSkill(id) as unknown as Blob
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = `${safeName}-v${version}.zip`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
  ElMessage.success(`正在下载 ${anchor.download}`)
}

onMounted(async () => { await loadCategories(); await Promise.all([loadOverview(), loadSkills()]) })
onBeforeUnmount(() => window.clearTimeout(searchTimer))
</script>

<style scoped>
.skill-page { min-height: 100vh; color: #23404c; background: #f3f9fb url('/bj.png') center/cover fixed; }
.skill-main-page { width: min(1540px, calc(100% - 40px)); margin: 0 auto; padding: 24px 0 56px; }
.hero-panel { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(320px, .7fr); gap: 28px; padding: 30px 34px; border: 1px solid #d4eaf1; border-radius: 24px; background: linear-gradient(135deg, rgba(255,255,255,.98), rgba(235,248,252,.96)); box-shadow: 0 14px 40px rgba(43, 107, 132, .08); }
.eyebrow { color: #278eb3; font-size: 12px; font-weight: 750; letter-spacing: .12em; }
.hero-copy h1 { margin: 9px 0 10px; color: #173b4a; font-family: var(--font-alimama); font-size: clamp(28px, 3vw, 42px); line-height: 1.2; }
.hero-copy p { max-width: 800px; margin: 0; color: #69818b; font-size: 14px; line-height: 1.8; }
.hero-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 22px; }.hero-actions .primary-button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; }
.upload-button-icon { width: 17px; height: 17px; flex: none; }
.primary-button,.secondary-button,.skill-filter-button,.text-button,.view-switch button,.category-tabs button { border: 0; font: inherit; cursor: pointer; }
.primary-button,.secondary-button { min-height: 38px; padding: 0 16px; border-radius: 11px; font-weight: 650; }
.primary-button { color: #fff; background: linear-gradient(135deg,#38add8,#3f75e5); box-shadow: 0 7px 18px rgba(48,132,199,.18); }
.primary-button:disabled,.secondary-button:disabled { cursor: not-allowed; opacity: .55; }
.secondary-button { border: 1px solid #cce3eb; color: #397184; background: #fff; }
.hero-guide { display: grid; align-content: center; gap: 10px; padding: 18px; border: 1px solid #d5e9f1; border-radius: 18px; background: rgba(255,255,255,.8); }
.hero-guide > strong { color: #397083; font-size: 13px; }
.hero-guide > div { display: grid; grid-template-columns: 28px 1fr; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 12px; background: #f4fafc; }
.hero-guide span { display: grid; width: 26px; height: 26px; place-items: center; border-radius: 9px; color: #fff; background: #4aaed1; font-size: 12px; font-weight: 700; }
.hero-guide p { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 0; }
.hero-guide b { color: #456673; font-size: 13px; }.hero-guide small { color: #8da0a7; }
.stats-grid { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 12px; margin: 14px 0; }
.stats-grid article { min-height: 106px; padding: 17px 19px; border: 1px solid #d9ebf1; border-radius: 17px; background: rgba(255,255,255,.94); box-shadow: 0 8px 22px rgba(43,107,132,.05); }
.stats-grid span,.stats-grid small { display: block; color: #84979f; font-size: 12px; }.stats-grid strong { display: block; margin: 7px 0 4px; color: #1d4657; font-size: 25px; }
.library-panel { overflow: hidden; border: 1px solid #d6e9f0; border-radius: 22px; background: rgba(255,255,255,.95); box-shadow: 0 12px 34px rgba(43,107,132,.07); }
.library-header { display: grid; gap: 11px; padding: 16px 18px 13px; border-bottom: 1px solid #e3eff3; background: rgba(255,255,255,.96); }
.library-title-row,.result-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }.library-title { display: flex; align-items: baseline; gap: 9px; }.library-title h2 { margin: 0; color: #173c4b; font-size: 20px; }.library-title span,.result-row { color: #79909a; font-size: 12px; }
.view-switch { display: inline-flex; padding: 3px; border: 1px solid #d7e8ee; border-radius: 11px; background: #f3f8fa; }.view-switch button { height: 29px; padding: 0 10px; border-radius: 8px; color: #708791; background: transparent; }.view-switch button.active { color: #247fa2; background: #fff; box-shadow: 0 2px 6px rgba(42,100,120,.1); font-weight: 650; }
.skill-toolbar { display: grid; grid-template-columns: minmax(280px,1fr) 140px max-content max-content; align-items: center; gap: 10px; }
.skill-search-box { box-sizing: border-box; display: flex; width: 100%; height: 42px; min-width: 0; align-items: center; gap: 10px; padding: 0 13px; border: 1px solid #cfe5ed; border-radius: 12px; background: #fbfdfe; }.skill-search-box span { flex: 0 0 auto; color: #6593a5; font-size: 18px; }.skill-search-box input { display: block; width: 100%; min-width: 0; border: 0; outline: 0; color: #385967; background: transparent; font: inherit; }
.skill-sort-select,.skill-filter-button { box-sizing: border-box; height: 42px; border: 1px solid #cfe5ed; border-radius: 12px; color: #55737f; background: #fff; white-space: nowrap; }.skill-sort-control { position: relative; display: block; width: 140px; min-width: 140px; max-width: 140px; }.skill-sort-control::after { position: absolute; top: 50%; right: 15px; width: 6px; height: 6px; border-right: 1.5px solid #6d8a95; border-bottom: 1.5px solid #6d8a95; content: ''; pointer-events: none; transform: translateY(-70%) rotate(45deg); }.skill-sort-select { width: 100%; min-width: 0; max-width: none; padding: 0 36px 0 13px; outline: 0; appearance: none; -webkit-appearance: none; }.skill-filter-button { width: auto; min-width: 108px; padding: 0 15px; line-height: 1; }.skill-filter-button.active { color: #d35563; border-color: #efc4c8; background: #fff4f5; }
.skill-search-box:focus-within { border-color: #78bdd5; }
.skill-search-box input:focus,.skill-sort-select:focus { outline: none; box-shadow: none !important; }
.skill-sort-select:focus { border-color: #78bdd5; }
.secondary-button:focus,.skill-filter-button:focus,.text-button:focus,.view-switch button:focus,.category-tabs button:focus,.favorite-button:focus { outline: none; box-shadow: none !important; }
.primary-button:focus { outline: none; box-shadow: 0 7px 18px rgba(48,132,199,.18) !important; }
.primary-button:focus-visible,.secondary-button:focus-visible,.skill-filter-button:focus-visible,.text-button:focus-visible,.view-switch button:focus-visible,.category-tabs button:focus-visible,.favorite-button:focus-visible { outline: 2px solid rgba(74,174,209,.7); outline-offset: 2px; }
.category-tabs { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 2px; }.category-tabs button { min-width: max-content; height: 34px; padding: 0 15px; border: 1px solid #d7e8ee; border-radius: 10px; color: #647f8a; background: #fff; }.category-tabs button.active { color: #fff; border-color: transparent; background: linear-gradient(135deg,#4baace,#3989ba); }
.text-button { color: #527787; background: transparent; font-size: 12px; }.library-body { min-height: 320px; padding: 14px 18px 18px; }
.skill-grid { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 12px; }.skill-card { position: relative; display: grid; min-width: 0; min-height: 205px; grid-template-columns: 46px minmax(0,1fr); grid-template-rows: auto 1fr auto; gap: 0 12px; padding: 15px; overflow: hidden; border: 1px solid #d8e8ed; border-radius: 17px; background: #fff; cursor: pointer; transition: .2s ease; }.skill-card:hover { transform: translateY(-2px); border-color: #89c8dc; box-shadow: 0 12px 26px rgba(36,92,117,.1); }
.skill-icon,.detail-icon { display: grid; place-items: center; border-radius: 14px; color: #2f718a; background: linear-gradient(145deg,#e3f5f9,#cce8f0); font-size: 19px; font-weight: 800; }.skill-icon { width: 46px; height: 46px; }.tone-1 { color: #6a56a4; background: linear-gradient(145deg,#f1eefb,#dfd8f4); }.tone-2 { color: #277c68; background: linear-gradient(145deg,#e7f7f1,#cdece3); }.tone-3 { color: #a46d19; background: linear-gradient(145deg,#fff7e7,#f8e5bc); }
.card-copy { display: contents; }.card-title-row { display: flex; min-width: 0; min-height: 46px; align-items: center; gap: 7px; padding-right: 38px; }.card-title-row h3 { min-width: 0; margin: 0; overflow: hidden; color: #173f50; font-size: 16px; text-overflow: ellipsis; white-space: nowrap; }.track-badge { flex: 0 0 auto; padding: 4px 8px; border-radius: 999px; font-size: 10px; font-weight: 650; }.track-badge.official { color: #986516; background: #fff3d8; }.track-badge.community { color: #2e7b64; background: #e6f6ef; }
.card-summary,.tag-row { grid-column: 1 / -1; }.card-summary { display: -webkit-box; min-height: 38px; margin: 7px 0 9px; overflow: hidden; color: #687f89; font-size: 12px; line-height: 1.55; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }.tag-row,.detail-tag-row { display: flex; gap: 5px; flex-wrap: wrap; }.tag-row span,.detail-tag-row span { padding: 3px 7px; border-radius: 7px; color: #5c7884; background: #f0f7f9; font-size: 10px; }
.favorite-button { position: absolute; top: 15px; right: 15px; display: grid; width: 32px; height: 32px; place-items: center; border: 1px solid #d7e7ec; border-radius: 10px; color: #8fa1a8; background: #fff; cursor: pointer; }.favorite-button.active { color: #d65f6b; border-color: #efc3c8; background: #fff3f4; }
.card-footer { display: flex; grid-column: 1 / -1; align-self: end; align-items: center; justify-content: space-between; gap: 8px; margin-top: 10px; padding-top: 9px; border-top: 1px solid #edf3f5; color: #80939b; font-size: 10px; }.card-footer-info { min-width: 0; }.card-footer-info > span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.card-footer-info time { color: #9aabb2; }.card-metrics { flex: 0 0 auto; white-space: nowrap; }
.skill-grid.list-view { grid-template-columns: 1fr; }.list-view .skill-card { min-height: 104px; grid-template-columns: 42px minmax(0,1fr) 32px; grid-template-rows: minmax(0,1fr) auto; align-items: start; gap: 6px 14px; padding: 13px 15px; }.list-view .skill-icon { width: 42px; height: 42px; grid-column: 1; grid-row: 1 / 3; align-self: center; }.list-view .card-copy { display: block; min-width: 0; grid-column: 2; grid-row: 1; }.list-view .card-title-row { min-height: 0; padding-right: 0; }.list-view .card-summary { min-height: 0; margin: 3px 0 6px; white-space: nowrap; text-overflow: ellipsis; -webkit-line-clamp: 1; }.list-view .tag-row { flex-wrap: nowrap; overflow: hidden; }.list-view .card-footer { min-width: 0; grid-column: 2 / 4; grid-row: 2; flex-direction: row; align-items: center; align-self: end; justify-content: space-between; gap: 10px; margin: 0; padding: 2px 0 0; border: 0; }.list-view .card-footer-info { width: auto; min-width: 0; text-align: left; }.list-view .card-footer-info > span,.list-view .card-footer > span { display: block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.list-view .favorite-button { position: static; grid-column: 3; grid-row: 1; align-self: start; justify-self: end; }
.card-metrics,
.card-metrics > span {
  display: inline-flex;
  align-items: center;
}
.card-metrics { gap: 8px; }
.card-metrics > span { gap: 3px; }
.card-metrics .sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
.card-metrics svg {
  width: 12px;
  height: 12px;
  stroke: currentColor;
  stroke-width: 1.5;
}
.pagination { justify-content: center; margin-top: 18px; }
:deep(.skill-detail-drawer .el-drawer__body) { padding: 0; overflow: hidden; }
.detail-drawer { box-sizing: border-box; display: flex; height: 100%; min-height: 0; flex-direction: column; overflow: hidden; padding: 24px; }.detail-header { display: grid; flex: 0 0 auto; grid-template-columns: 62px 1fr; gap: 14px; align-items: center; }.detail-icon { width: 62px; height: 62px; font-size: 24px; }.detail-header h2 { margin: 0; color: #173f50; }.detail-header p { margin: 6px 0 0; color: #71858e; line-height: 1.6; }.detail-title-row { display: flex; align-items: center; gap: 8px; }.detail-actions { display: flex; flex: 0 0 auto; justify-content: flex-end; gap: 9px; margin: 20px 0 8px; }.detail-tabs { display: flex; min-height: 0; flex: 1; flex-direction: column; margin-top: 8px; }:deep(.detail-tabs .el-tabs__header) { flex: 0 0 auto; }:deep(.detail-tabs .el-tabs__content) { min-height: 0; flex: 1; overflow: hidden; }:deep(.detail-tabs .el-tab-pane) { height: 100%; }:deep(.detail-tabs .detail-scroll-pane) { overflow-x: hidden; overflow-y: auto; }:deep(.detail-tabs .markdown-tab-pane) { overflow: hidden; }.detail-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }.detail-meta > div { padding: 12px; border-radius: 11px; background: #f4f9fb; }.detail-meta dt { color: #8b9ba2; font-size: 11px; }.detail-meta dd { margin: 5px 0 0; color: #3c5e6b; font-size: 13px; }.safe-text { color: #2a8a68!important; }.markdown-preview { box-sizing: border-box; height: 100%; max-height: none; margin: 0; padding: 16px; overflow: auto; overflow-wrap: anywhere; border-radius: 12px; color: #375662; background: #f4f8fa; white-space: pre-wrap; line-height: 1.7; }.file-list,.version-list { margin: 0; padding: 0; list-style: none; }.file-list li,.version-list li { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 4px; border-bottom: 1px solid #e7eff2; }.file-list span { overflow-wrap: anywhere; }.file-list small,.version-list span,.version-list time { color: #8a9ba2; font-size: 11px; }.version-list div { display: flex; flex-direction: column; gap: 3px; }
.detail-actions { flex-wrap: wrap; }
.detail-meta .detail-source { grid-column: 1 / -1; min-width: 0; }
@media (max-width: 1180px) { .skill-grid { grid-template-columns: repeat(2,minmax(0,1fr)); }.stats-grid { grid-template-columns: repeat(2,minmax(0,1fr)); } }
@media (max-width: 820px) { .skill-main-page { width: calc(100% - 24px); padding-top: 14px; }.hero-panel { grid-template-columns: 1fr; padding: 22px; }.skill-toolbar { grid-template-columns: 132px repeat(2,minmax(110px,1fr)); }.skill-search-box { grid-column: 1 / -1; }.skill-sort-control { width: 132px; min-width: 132px; max-width: 132px; }.skill-filter-button { width: 100%; min-width: 0; }.skill-grid { grid-template-columns: 1fr; }.list-view .skill-card { grid-template-columns: 42px minmax(0,1fr) 32px; grid-template-rows: minmax(0,1fr) auto; align-items: start; }.list-view .favorite-button { grid-column: 3; grid-row: 1; }.list-view .card-footer { grid-column: 2 / -1; grid-row: 2; flex-direction: row; align-items: center; align-self: auto; justify-content: space-between; gap: 10px; padding: 2px 0 0; border: 0; }.list-view .card-footer-info { width: auto; }}
@media (max-width: 560px) { .stats-grid { grid-template-columns: 1fr 1fr; gap: 8px; }.stats-grid article { min-height: 92px; padding: 13px; }.library-title-row { align-items: flex-start; }.skill-toolbar { grid-template-columns: 1fr 1fr; }.skill-sort-control { grid-column: 1 / -1; width: 100%; min-width: 0; max-width: none; }.skill-filter-button { min-width: 0; }.card-footer { align-items: flex-start; flex-direction: column; }.detail-meta { grid-template-columns: 1fr; }}
</style>
