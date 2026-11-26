import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const readSource = relativePath => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

const backendSource = readSource('../../backend/src/routes/appsNew.js');
const permissionServiceSource = readSource('../../backend/src/services/fastgptAppPermissionService.js');
const storeSource = readSource('../src/stores/apps.ts');
const plazaSource = readSource('../src/views/AgentPlaza.vue');
const listSource = readSource('../src/components/plaza/CategoryAppsList.vue');

const categoryRoute = backendSource.slice(
  backendSource.indexOf("router.get('/categories/:categoryId/apps'"),
  backendSource.indexOf("router.get('/apps-new/by-category-mixed'")
);

const homePlazaRoute = backendSource.slice(
  backendSource.indexOf("router.get('/apps-new/by-category'"),
  backendSource.indexOf("router.get('/apps-new/hot-recommend'")
);

test('home plaza paginates before reading precomputed card statistics', () => {
  const permissionIndex = homePlazaRoute.indexOf('await attachApplicationAccessPermission(apps, userInfo)');
  const paginationIndex = homePlazaRoute.indexOf('apps = apps.slice(skip, skip + limitNum)');
  const chatStatsIndex = homePlazaRoute.indexOf('appChatStats.getStats');

  assert.ok(permissionIndex >= 0);
  assert.ok(paginationIndex > permissionIndex);
  assert.ok(chatStatsIndex > paginationIndex);
  assert.match(homePlazaRoute, /const hotScoreDiff = Number\(b\.hotScore \|\| 0\) - Number\(a\.hotScore \|\| 0\)/);
});

test('batched permission checks index records by resource instead of rescanning them per app', () => {
  assert.match(permissionServiceSource, /function indexPermissionsByResourceId/);
  assert.match(permissionServiceSource, /const permissionsByResourceId = indexPermissionsByResourceId\(permissions\)/);
  assert.match(permissionServiceSource, /getIndexedPermissions\(\s*permissionsByResourceId,/);
  assert.match(permissionServiceSource, /getUsableAppIds\(appIds = \[\], userInfo = \{\}, preloadedApps = null\)/);
});

test('category endpoint paginates every category after sorting', () => {
  assert.match(categoryRoute, /apps = apps\.slice\(skip, skip \+ limitNum\)/);
  assert.doesNotMatch(categoryRoute, /if \(categoryId === 'all'\)/);
  assert.match(categoryRoute, /totalPages: Math\.ceil\(total \/ limitNum\)/);
});

test('pinned applications are sorted first and regular applications follow the selected sort before pagination', () => {
  const accessIndex = categoryRoute.indexOf('await attachApplicationAccessPermission(apps, userInfo)');
  const visibilityFilterIndex = categoryRoute.indexOf('apps = filterVisiblePlazaApps(apps)');
  const pinnedSortIndex = categoryRoute.indexOf('Number(b.isPinned === true) - Number(a.isPinned === true)');
  const selectedSortIndex = categoryRoute.indexOf("if (sortBy === 'createdAt')");
  const paginationIndex = categoryRoute.indexOf('apps = apps.slice(skip, skip + limitNum)');

  assert.ok(accessIndex >= 0);
  assert.ok(visibilityFilterIndex > accessIndex);
  assert.ok(pinnedSortIndex > visibilityFilterIndex);
  assert.ok(selectedSortIndex > pinnedSortIndex);
  assert.ok(paginationIndex > selectedSortIndex);
  assert.doesNotMatch(categoryRoute, /Number\(b\.canAccess === true\) - Number\(a\.canAccess === true\)/);
});

test('category store keeps server pagination and appends later pages without duplicates', () => {
  assert.match(storeSource, /const categoryPagination = ref/);
  assert.match(storeSource, /categoryPagination\.value\[categoryId\]/);
  assert.match(storeSource, /page: requestedPage/);
  assert.match(storeSource, /limit: requestedLimit/);
  assert.match(storeSource, /params\?\.append === true/);
  assert.match(storeSource, /categoryApps\.value\[categoryId\] = \[\.\.\.existingApps, \.\.\.nextApps\]/);
});

test('all tabs use flat infinite scrolling with twenty items per request', () => {
  assert.doesNotMatch(listSource, /section-title/);
  assert.doesNotMatch(listSource, /<el-pagination/);
  assert.match(listSource, /new IntersectionObserver/);
  assert.match(listSource, /emit\('load-more'\)/);
  assert.match(plazaSource, /const CATEGORY_PAGE_SIZE = 20/);
  assert.match(plazaSource, /@load-more="handleLoadMoreCategoryApps"/);
  assert.match(plazaSource, /limit: CATEGORY_PAGE_SIZE/);
  assert.match(plazaSource, /selectedCategoryPagination\.value\.page \+ 1/);
});
