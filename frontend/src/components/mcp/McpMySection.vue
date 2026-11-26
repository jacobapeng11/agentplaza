<template>
  <section class="mcp-my-section">
    <div class="section-content">
      <div class="section-apps">
        <div class="section-header">
          <h3 class="section-title">
            {{ labels.created }}<span v-if="created.length > 0" class="count">({{ created.length }})</span>
          </h3>
          <a v-if="created.length > 0" class="view-more-link" @click="emit('view-created')">
            {{ labels.more }} <el-icon><ArrowRight /></el-icon>
          </a>
        </div>

        <div v-if="loading" class="loading-container">
          <el-skeleton :rows="1" animated />
        </div>

        <div v-else-if="displayedCreated.length > 0" class="apps-row">
          <div v-for="item in displayedCreated" :key="item.id" class="app-card" @click="emit('service-click', item.id)">
            <img :src="getMcpAvatarUrl(item)" class="app-avatar" alt="MCP" />
            <div class="app-content">
              <div class="app-name" :title="item.displayName">{{ item.displayName }}</div>
              <span class="source-badge">{{ getMcpSourceTypeLabel(item.higressMcpType) }}</span>
              <div class="app-stats">
                <span class="stat-item">
                  <el-icon><View /></el-icon>
                  <span class="stat-value">{{ formatCount(item.viewCount || 0) }}</span>
                </span>
                <span class="stat-item collect-item" @click.stop="emit('favorite', item.id)">
                  <img class="stat-icon" :src="item.isCollected ? '/appIcon3_active.png' : '/appIcon3.png'" alt="favorite" />
                  <span class="stat-value">{{ formatCount(item.favoriteCount || item.collectCount || 0) }}</span>
                </span>
              </div>
            </div>
          </div>
        </div>

        <div v-else class="empty-state">
          <img src="/topIcon2.png" alt="" />
          <p>{{ labels.emptyCreated }}</p>
        </div>
      </div>

      <div class="section-apps">
        <div class="section-header">
          <h3 class="section-title">
            {{ labels.collected }}<span v-if="collected.length > 0" class="count">({{ collected.length }})</span>
          </h3>
          <a v-if="collected.length > 0" class="view-more-link" @click="emit('view-collected')">
            {{ labels.more }} <el-icon><ArrowRight /></el-icon>
          </a>
        </div>

        <div v-if="loading" class="loading-container">
          <el-skeleton :rows="1" animated />
        </div>

        <div v-else-if="displayedCollected.length > 0" class="apps-row">
          <div v-for="item in displayedCollected" :key="item.id" class="app-card" @click="emit('service-click', item.id)">
            <img :src="getMcpAvatarUrl(item)" class="app-avatar" alt="MCP" />
            <div class="app-content">
              <div class="app-name" :title="item.displayName">{{ item.displayName }}</div>
              <span class="source-badge">{{ getMcpSourceTypeLabel(item.higressMcpType) }}</span>
              <div class="app-stats">
                <span class="stat-item">
                  <el-icon><View /></el-icon>
                  <span class="stat-value">{{ formatCount(item.viewCount || 0) }}</span>
                </span>
                <span class="stat-item collect-item" @click.stop="emit('favorite', item.id)">
                  <img class="stat-icon" :src="item.isCollected ? '/appIcon3_active.png' : '/appIcon3.png'" alt="favorite" />
                  <span class="stat-value">{{ formatCount(item.favoriteCount || item.collectCount || 0) }}</span>
                </span>
              </div>
            </div>
          </div>
        </div>

        <div v-else class="empty-state">
          <img src="/topIcon1.png" alt="" />
          <p>{{ labels.emptyCollected }}</p>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { ArrowRight, View } from '@element-plus/icons-vue'
import type { McpListItem } from '../../types/mcp'
import { getMcpAvatarUrl, getMcpSourceTypeLabel } from '../../utils/mcpPresentation'

const props = defineProps<{
  created: McpListItem[]
  collected: McpListItem[]
  loading?: boolean
  sortType?: 'hot' | 'latest'
}>()

const emit = defineEmits<{
  (e: 'service-click', id: string): void
  (e: 'view-created'): void
  (e: 'view-collected'): void
  (e: 'favorite', id: string): void
}>()

const labels = {
  created: '\u6211\u521b\u5efa\u7684 MCP',
  collected: '\u6211\u6536\u85cf\u7684 MCP',
  more: '\u67e5\u770b\u66f4\u591a',
  emptyCreated: '\u70b9\u51fb\u53f3\u4e0a\u89d2\u201c\u53d1\u5e03MCP\u201d\uff0c\u53d1\u5e03\u4f60\u7684\u7b2c\u4e00\u4e2a MCP \u5427\uff01',
  emptyCollected: '\u8fd8\u6ca1\u6709\u6536\u85cf MCP\uff0c\u53bb\u5e02\u573a\u91cc\u627e\u4e00\u4e2a\u987a\u624b\u7684\u670d\u52a1\u5427\uff01',
}

function statusWeight(status?: McpListItem['syncStatus']) {
  const weights = { active: 5, updating: 4, creating: 3, failed: 2, deleting: 1 }
  return weights[status || 'failed'] || 0
}

function sortItems(items: McpListItem[]) {
  const source = [...items]
  if (props.sortType === 'hot') {
    return source.sort((a, b) => {
      const countGap = (b.viewCount || 0) - (a.viewCount || 0)
      if (countGap !== 0) return countGap
      return statusWeight(b.syncStatus) - statusWeight(a.syncStatus)
    })
  }

  return source.sort(
    (a, b) => new Date(b.createdAt || b.updatedAt).getTime() - new Date(a.createdAt || a.updatedAt).getTime()
  )
}

const displayedCreated = computed(() => sortItems(props.created).slice(0, 4))
const displayedCollected = computed(() => sortItems(props.collected).slice(0, 4))


function formatCount(count: number) {
  if (!count) return '0'
  if (count >= 10000) return (count / 10000).toFixed(1) + 'w'
  if (count >= 1000) return (count / 1000).toFixed(1) + 'k'
  return String(count)
}
</script>

<style scoped lang="scss">
.mcp-my-section { margin: 0; }
.section-content { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; align-items: stretch; }
.section-apps { min-height: 100px; padding: 14px 16px; border: 1px solid rgba(126, 184, 207, 0.12); border-radius: 14px; background: rgba(255, 255, 255, 0.22); box-shadow: none; display: flex; flex-direction: column; }
.section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.section-title { font-size: 18px; font-weight: 600; color: #244653; margin: 0; display: flex; align-items: baseline; }
.count { font-size: 14px; color: #69a8c2; font-weight: 400; margin-left: 4px; }
.view-more-link { display: flex; align-items: center; gap: 4px; font-size: 13px; color: #64a6c0; cursor: pointer; text-decoration: none; transition: color 0.3s; }
.view-more-link:hover { color: #318db4; }
.view-more-link .el-icon { font-size: 12px; }
.apps-row { display: grid; grid-template-columns: repeat(auto-fill, minmax(168px, 182px)); gap: 10px; justify-content: start; }
.app-card { width: 100%; min-height: 84px; background: rgba(255, 255, 255, 0.94); border: 1px solid #c7e7f2; border-radius: 14px; padding: 10px 11px; cursor: pointer; transition: all 0.3s; display: flex; align-items: center; gap: 10px; box-sizing: border-box; min-width: 0; box-shadow: 0 3px 12px rgba(43, 108, 137, 0.05); }
.app-card:hover { border-color: #79c8e3; box-shadow: 0 8px 20px rgba(43, 108, 137, 0.11); transform: translateY(-2px); }
.app-avatar { width: 42px; height: 42px; border: 1px solid rgba(68, 161, 198, 0.14); border-radius: 11px; object-fit: cover; flex-shrink: 0; background: #eef8fb; }
.app-content { flex: 1; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.app-name { font-size: 14px; font-weight: 650; color: #284451; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.4; }
.source-badge { align-self: flex-start; max-width: 100%; height: 18px; padding: 0 6px; border-radius: 4px; background: #eaf7f9; color: #66818c; font-size: 11px; font-weight: 500; line-height: 18px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; box-sizing: border-box; }
.app-stats { display: flex; gap: 12px; align-items: center; }
.stat-item { display: flex; align-items: center; gap: 4px; }
.stat-item :deep(.el-icon) { font-size: 14px; color: #909399; }
.stat-icon { width: 14px; height: 14px; object-fit: contain; }
.stat-value { color: #909399; font-size: 12px; }
.collect-item { cursor: pointer; }
.loading-container { padding: 20px; }
.empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; border-radius: 8px; margin-top: -24px; min-height: 96px; }
.empty-state p { margin: 0; color: #1a66f3; font-family: PingFang SC, sans-serif; font-size: 13px; }
.empty-state img { width: 60px; height: 60px; }
@media (max-width: 1200px) {
  .section-content {
    grid-template-columns: 1fr;
    gap: 12px;
  }
}

@media (max-width: 768px) {
  .section-apps {
    padding: 0;
    margin-bottom: 20px;
    background: none !important;
  }

  .section-title {
    font-size: 16px;
  }

  .apps-row {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .app-card {
    width: 100%;
    min-width: 0;
    border: 1px solid #c7e7f2;
    border-radius: 13px;
    box-shadow: 0 3px 12px rgba(43, 108, 137, 0.05);
    background: rgba(255, 255, 255, 0.94);
    backdrop-filter: blur(10px);
  }
}

@media (max-width: 600px) {
  .section-header {
    align-items: flex-start;
    flex-direction: column;
    gap: 6px;
  }

  .view-more-link {
    align-self: flex-start;
  }

  .apps-row {
    grid-template-columns: 1fr;
  }
}
</style>
