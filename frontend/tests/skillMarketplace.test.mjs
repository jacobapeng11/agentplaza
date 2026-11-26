import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const page = fs.readFileSync(new URL('../src/views/SkillMarketplace.vue', import.meta.url), 'utf8')
const router = fs.readFileSync(new URL('../src/router/index.ts', import.meta.url), 'utf8')
const header = fs.readFileSync(new URL('../src/components/plaza/PlazaHeader.vue', import.meta.url), 'utf8')
const api = fs.readFileSync(new URL('../src/api/skills.ts', import.meta.url), 'utf8')
const dialog = fs.readFileSync(new URL('../src/components/skills/SkillImportDialog.vue', import.meta.url), 'utf8')
const admin = fs.readFileSync(new URL('../src/views/AdminSkillManagement.vue', import.meta.url), 'utf8')

test('Skill plaza is routed and available from the shared plaza navigation', () => {
  assert.match(router, /path:\s*'\/skills'/)
  assert.match(router, /SkillMarketplace\.vue/)
  assert.match(header, /Skill 广场/)
  assert.match(header, /handleSkillMarket/)
  assert.match(router, /requiresSkill && !isSkillEnabled\(\)/)
  assert.match(header, /v-if="isSkillEnabled\(\)"[^>]*title="Skill 广场"/)
})

test('shared mobile plaza header stays fixed without covering page content', () => {
  assert.match(header, /\.plaza-navigation\s*\{[^}]*height:\s*calc\(60px \+ env\(safe-area-inset-top\)\)/)
  assert.match(header, /\.mobile-topbar\s*\{[^}]*position:\s*fixed[^}]*inset:\s*0 0 auto[^}]*width:\s*100%/)
  assert.match(header, /padding:\s*env\(safe-area-inset-top\) 16px 0/)
})

test('reviewed categories default to 全部 instead of 推荐', () => {
  for (const label of ['全部', '大市场', '财经类', '办公类', '行政类', '研发类', '综合类']) {
    assert.ok(page.includes(label), `missing category: ${label}`)
  }
  assert.match(page, /activeCategory = ref\('all'\)/)
})

test('personal ZIP uploads show parsing progress before the user submits for review', () => {
  assert.match(api, /\/skills\/import\/upload/)
  assert.match(api, /\/skills\/import\/jobs\/\$\{jobId\}/)
  assert.match(page, /<SkillImportDialog v-model="uploadVisible"/)
  assert.match(dialog, /pollImportJob/)
  assert.match(dialog, /await skillsApi\.uploadSkill\(form\)[\s\S]*?step\.value = 1[\s\S]*?pollImportJob\(requestRun\)/)
  assert.match(dialog, /step === 2[^>]*@click="submitImport"/)
  assert.match(dialog, /提交审核/)
  assert.match(dialog, /预览包内文件/)
})

test('mobile import dialog stays above the plaza header and scrolls inside the viewport', () => {
  assert.match(dialog, /class="skill-import-dialog skill-zip-dialog"[^>]*:z-index="2300"/)
  assert.match(dialog, /@media \(max-width: 560px\)[\s\S]*?\.skill-import-dialog[^}]*max-height:\s*calc\(100dvh - 24px\)[^}]*margin:\s*12px auto/)
  assert.match(dialog, /\.skill-import-dialog \.el-dialog__body[^}]*overscroll-behavior:\s*contain/)
  assert.match(dialog, /\.skill-import-dialog \.el-dialog__footer[^}]*flex:\s*0 0 auto/)
})

test('card title is placed beside its icon and list view stays compact', () => {
  assert.match(page, /grid-template-columns:\s*46px minmax\(0,1fr\)/)
  assert.match(page, /\.card-title-row/)
  assert.match(page, /\.skill-grid\.list-view/)
  assert.match(page, /min-height:\s*104px/)
  assert.match(page, /\.list-view \.skill-card[^}]*grid-template-columns:\s*42px minmax\(0,1fr\) 32px/)
  assert.match(page, /\.list-view \.card-footer[^}]*grid-column:\s*2 \/ 4[^}]*justify-content:\s*space-between/)
  assert.match(page, /\.list-view \.favorite-button[^}]*grid-column:\s*3[^}]*grid-row:\s*1[^}]*align-self:\s*start/)
})

test('cards and details expose stable publish and content update times', () => {
  assert.match(page, /· 更新于 \{\{ formatShortDate\(skill\.contentUpdatedAt \|\| skill\.publishedAt \|\| skill\.updatedAt\) \}\}/)
  assert.match(page, /\.card-footer-info > span\s*\{[^}]*white-space:\s*nowrap/)
  assert.match(page, /<dt>首次发布<\/dt><dd>\{\{ formatDate\(detail\.publishedAt\) \}\}<\/dd>/)
  assert.match(page, /<dt>最近更新<\/dt>/)
  assert.match(page, /function formatShortDate/)
})

test('cards expose derived page-view and unique-viewer statistics', () => {
  assert.match(page, /skill\.stats\?\.viewCount \|\| 0/)
  assert.match(page, /skill\.stats\?\.viewerCount \|\| 0/)
  assert.match(page, /浏览量\/浏览人数/)
})

test('Skill management provides admin-only navigation and confirmed featured actions', () => {
  assert.match(api, /setOfficial:\s*\(id: string, official: boolean\) => request\.put\(`\/skills\/\$\{id\}\/official`/)
  assert.match(router, /path: '\/admin\/skills'[\s\S]*?requiresAdmin: true/)
  assert.match(header, /v-if="isAppAdminUser && isSkillEnabled\(\)"[^>]*title="Skill 管理"/)
  assert.match(admin, /ElMessageBox\.confirm/)
  assert.match(admin, /skillsApi\.setOfficial/)
  assert.doesNotMatch(page, /skillsApi\.setOfficial/)
})

test('library toolbar keeps isolated names and stable responsive columns', () => {
  assert.match(page, /class="skill-toolbar"/)
  assert.match(page, /class="skill-search-box"/)
  assert.match(page, /grid-template-columns:\s*minmax\(280px,1fr\) 140px max-content max-content/)
  assert.match(page, /\.skill-sort-select,\.skill-filter-button\s*\{[^}]*white-space:\s*nowrap/)
  assert.doesNotMatch(page, /class="(?:toolbar|search-box|sort-select|filter-button)"/)
})

test('the customer release exposes ZIP upload without remote imports', () => {
  assert.match(api, /uploadSkill/)
  assert.doesNotMatch(admin, /导入外部 Skill/)
  assert.doesNotMatch(dialog, /外部源地址/)
})

test('sort control uses an aligned purpose-built chevron', () => {
  assert.match(page, /class="skill-sort-control"/)
  assert.match(page, /\.skill-sort-control::after[^}]*right:\s*15px/)
  assert.match(page, /\.skill-sort-select[^}]*padding:\s*0 36px 0 13px[^}]*appearance:\s*none/)
})

test('downloads use the authenticated same-origin API and a versioned filename', () => {
  assert.match(api, /downloadSkill:\s*\(id: string\) => request\.get\(`\/skills\/\$\{id\}\/download`, \{ responseType: 'blob'/)
  assert.match(page, /URL\.createObjectURL\(blob\)/)
  assert.match(page, /anchor\.download = `\$\{safeName\}-v\$\{version\}\.zip`/)
  assert.doesNotMatch(page, /window\.open\(data\.url/)
})

test('native controls neutralize the leaked global focus glow', () => {
  assert.match(page, /\.skill-search-box input:focus,[^}]*box-shadow:\s*none !important/)
  assert.match(page, /\.skill-search-box:focus-within\s*\{[^}]*border-color:\s*#78bdd5/)
  assert.match(page, /\.skill-filter-button:focus,[^}]*box-shadow:\s*none !important/)
  assert.match(page, /\.primary-button:focus-visible,[\s\S]*?outline:\s*2px solid/)
})

test('import results stay compact and show submitted items as awaiting approval', () => {
  assert.match(dialog, /class="dialog-footer-actions"/)
  assert.match(dialog, /class="result-list"/)
  assert.match(dialog, /max-height:\s*min\(32vh, 280px\)/)
  assert.match(dialog, /待审批/)
})

test('detail drawer stays fixed while its active content owns scrolling', () => {
  assert.match(page, /class="skill-detail-drawer"/)
  assert.match(page, /\.skill-detail-drawer \.el-drawer__body[^}]*overflow:\s*hidden/)
  assert.match(page, /name="markdown" class="markdown-tab-pane"/)
  assert.match(page, /\.markdown-preview\s*\{[^}]*height:\s*100%[^}]*overflow:\s*auto/)
})
