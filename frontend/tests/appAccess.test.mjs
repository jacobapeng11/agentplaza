import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const readSource = relativePath => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

const cardSource = readSource('../src/components/plaza/AppCardNew.vue');
const plazaSource = readSource('../src/views/AgentPlaza.vue');
const categorySource = readSource('../src/views/CategoryDetail.vue');
const accessSource = readSource('../src/utils/appAccess.ts');
const myAgentsSource = readSource('../src/views/MyAgents.vue');
const myAgentsSectionSource = readSource('../src/components/plaza/MyAgentsSection.vue');
const fastgptConfigSource = readSource('../src/config/fastgptConfig.ts');

test('created-app cards open FastGPT details while collected and public cards open chat', () => {
  assert.match(fastgptConfigSource, /openDetail \? buildFastgptUrl\('\/app\/detail'/);
  assert.match(fastgptConfigSource, /: buildFastgptChatUrl\(appId, pane\)/);
  assert.match(myAgentsSectionSource, /handleAppClick\(app\._id, 'created'\)/);
  assert.match(myAgentsSectionSource, /handleAppClick\(app\._id, 'collected'\)/);
  assert.match(plazaSource, /buildFastgptAppOpenUrl\(appId, source === 'created', 'ra'\)/);
  assert.match(myAgentsSource, /buildFastgptAppOpenUrl\(appId, source === 'created', 'ra'\)/);
  assert.match(categorySource, /buildFastgptAppOpenUrl\(appId, false, 'ra'\)/);
});

test('link applications keep priority over FastGPT access', () => {
  for (const source of [plazaSource, categorySource, myAgentsSource]) {
    const linkBranch = source.indexOf('if (appUrl)');
    const fastgptBranch = source.indexOf('buildFastgptAppOpenUrl(appId', linkBranch);
    assert.notEqual(linkBranch, -1);
    assert.ok(fastgptBranch > linkBranch);
  }
});

test('AppCardNew only marks applications with explicit access', () => {
  assert.match(cardSource, /v-if="canAccess"[^>]*>有权限</);
  assert.match(cardSource, /props\.app\?\.canAccess === true/);
});

test('plaza and category detail block denied applications before opening them', () => {
  for (const source of [plazaSource, categorySource]) {
    const guardIndex = source.indexOf('await ensureAppAccessBeforeOpen(app)');
    const openIndex = source.indexOf('window.open', guardIndex);

    assert.notEqual(guardIndex, -1);
    assert.ok(openIndex > guardIndex);
  }
});

test('denied applications tell the user to contact the creator', () => {
  assert.match(accessSource, /app\.canAccess !== false/);
  assert.match(accessSource, /请联系 \$\{creatorText\} 添加权限/);
  assert.match(accessSource, /暂无应用权限/);
});
