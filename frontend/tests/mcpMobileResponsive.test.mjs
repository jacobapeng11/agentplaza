import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const marketplaceSource = readFileSync(new URL('../src/views/McpMarketplace.vue', import.meta.url), 'utf8')
const myMcpsSource = readFileSync(new URL('../src/views/MyMcps.vue', import.meta.url), 'utf8')
const detailSource = readFileSync(new URL('../src/views/McpDetail.vue', import.meta.url), 'utf8')
const publishSource = readFileSync(new URL('../src/views/McpPublish.vue', import.meta.url), 'utf8')
const mySectionSource = readFileSync(new URL('../src/components/mcp/McpMySection.vue', import.meta.url), 'utf8')

test('MCP market page follows agent-market mobile card breakpoints', () => {
  assert.match(marketplaceSource, /@media \(max-width:\s*768px\)[\s\S]*\.apps-grid\s*\{[\s\S]*repeat\(2,\s*minmax\(0,\s*1fr\)\)/)
  assert.match(marketplaceSource, /@media \(max-width:\s*480px\)[\s\S]*\.apps-grid\s*\{[\s\S]*grid-template-columns:\s*1fr/)
  assert.match(marketplaceSource, /@media \(max-width:\s*600px\)[\s\S]*\.market-main\s*\{[\s\S]*padding:\s*12px/)
})

test('MCP market compact cards keep metadata and actions on one footer row', () => {
  assert.match(marketplaceSource, /\.card-footer\s*\{[\s\S]*flex-direction:\s*row/)
  assert.match(marketplaceSource, /\.stat-item span\s*\{[\s\S]*text-overflow:\s*ellipsis/)
  assert.match(marketplaceSource, /\.pin-button,[\s\S]*\.pin-badge\s*\{[\s\S]*position:\s*static/)
})

test('My MCP list and market summary cards collapse at the same mobile breakpoint', () => {
  assert.match(myMcpsSource, /@media \(max-width:\s*600px\)[\s\S]*\.apps-grid\s*\{[\s\S]*grid-template-columns:\s*1fr/)
  assert.match(mySectionSource, /@media \(max-width:\s*600px\)[\s\S]*\.apps-row\s*\{[\s\S]*grid-template-columns:\s*1fr/)
  assert.match(mySectionSource, /@media \(max-width:\s*600px\)[\s\S]*\.section-header\s*\{[\s\S]*align-items:\s*flex-start/)
})

test('MCP detail page has phone-specific layout and overflow protection', () => {
  assert.match(detailSource, /@media \(max-width:\s*640px\)[\s\S]*\.detail-main\s*\{[\s\S]*padding:\s*12px/)
  assert.match(detailSource, /@media \(max-width:\s*640px\)[\s\S]*h1\s*\{[\s\S]*font-size:\s*26px/)
  assert.match(detailSource, /@media \(max-width:\s*640px\)[\s\S]*\.config-mode-switch\s*\{[\s\S]*grid-template-columns:\s*1fr/)
  assert.match(detailSource, /@media \(max-width:\s*640px\)[\s\S]*\.code-block\s*\{[\s\S]*max-width:\s*100%/)
  assert.match(detailSource, /\.detail-shell\s*\{[\s\S]*min-width:\s*0/)
  assert.match(detailSource, /\.section-block\s*\{[\s\S]*min-width:\s*0/)
  assert.match(detailSource, /\.config-example-group\s*\{[\s\S]*min-width:\s*0/)
  assert.match(detailSource, /class="hero-actions"\s*:class="\{\s*'hero-actions--single':\s*!canManage\s*\}"/)
  assert.match(detailSource, /\.hero-actions--single\s*\{[\s\S]*grid-template-columns:\s*126px/)
  assert.match(detailSource, /@media \(max-width:\s*900px\)[\s\S]*\.hero-actions--single\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/)
})

test('MCP publish form collapses dense controls on phones', () => {
  assert.match(publishSource, /@media \(max-width:\s*640px\)[\s\S]*\.publish-main\s*\{[\s\S]*padding:\s*12px/)
  assert.match(publishSource, /@media \(max-width:\s*640px\)[\s\S]*\.form-section\s*\{[\s\S]*padding:\s*16px/)
  assert.match(publishSource, /@media \(max-width:\s*640px\)[\s\S]*\.field-grid\.two\s*\{[\s\S]*grid-template-columns:\s*1fr/)
  assert.match(publishSource, /@media \(max-width:\s*640px\)[\s\S]*\.plugin-card__head\s*\{[\s\S]*flex-direction:\s*column/)
  assert.doesNotMatch(publishSource, /@media \(max-width:\s*760px\)[\s\S]*\.editor-field--plain,\s*[\r\n\s]*\.card-header\s*\{[\s\S]*flex-direction:\s*column/)
  assert.match(publishSource, /@media \(max-width:\s*760px\)[\s\S]*\.mcp-card--preview \.card-header\s*\{[\s\S]*flex-direction:\s*row/)
  assert.match(publishSource, /@media \(max-width:\s*640px\)[\s\S]*\.mcp-card--preview \.mcp-icon\s*\{[\s\S]*width:\s*56px[\s\S]*height:\s*56px/)
})
