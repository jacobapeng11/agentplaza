<template>
  <article
    v-if="app"
    class="app-card-new"
    role="button"
    tabindex="0"
    :aria-label="`打开${app.name || '未命名应用'}`"
    @click="handleClick"
    @keydown.enter="handleClick"
    @keydown.space.prevent="handleClick"
  >
    <div class="card-summary">
      <div class="card-avatar">
        <el-avatar
          :src="avatarUrl"
          :size="56"
          :alt="app.name || '应用图标'"
          shape="square"
        >
          <img src="/defAiImg.png" alt="默认应用图标" />
        </el-avatar>
      </div>

      <div class="card-copy">
        <div class="card-title-row">
          <h3 class="card-app-name" :title="app.name || ''">
            {{ app.name || '未命名应用' }}
          </h3>
          <div v-if="canAccess || app.isPinned" class="status-badges">
            <span v-if="canAccess" class="access-badge" title="当前账号可直接使用">有权限</span>
            <span v-if="app.isPinned" class="pin-badge">置顶</span>
          </div>
        </div>
        <p class="card-description" :title="app.description || app.intro || ''">
          {{ app.description || app.intro || '点击进入应用，开始智能协作' }}
        </p>
      </div>
    </div>

    <div v-if="displayTags.length > 0" class="card-tags" aria-label="应用标签">
      <span
        v-for="(tag, index) in displayTags"
        :key="`${tag}-${index}`"
        class="tag-item"
      >
        {{ tag }}
      </span>
    </div>

    <div class="card-footer">
      <div class="card-metrics">
        <el-tooltip content="浏览次数" placement="top">
          <div class="metric-stat" aria-label="浏览次数">
            <el-icon><View /></el-icon>
            <span>{{ formatCount(browseCount) }}</span>
          </div>
        </el-tooltip>
        <el-tooltip content="使用人数" placement="top">
          <div class="metric-stat" aria-label="使用人数">
            <el-icon><User /></el-icon>
            <span>{{ formatCount(usageCount) }}</span>
          </div>
        </el-tooltip>
      </div>

      <div class="card-actions">
        <el-tooltip v-if="canConfigureWecomBot" content="对接企业微信 Bot" placement="top">
          <button class="icon-action" type="button" aria-label="对接企业微信 Bot" @click.stop="openWecomBotDrawer">
            <el-icon><Connection /></el-icon>
          </button>
        </el-tooltip>
        <el-tooltip :content="isCollected ? '取消收藏' : '收藏'" placement="top">
          <button
            class="collect-button"
            :class="{ 'is-collected': isCollected }"
            type="button"
            :aria-label="isCollected ? '取消收藏' : '收藏'"
            @click.stop="handleToggleCollect"
          >
            <img
              class="collect-icon"
              :src="isCollected ? '/appIcon3_active.png' : '/appIcon3.png'"
              alt=""
            />
            <span>{{ formatCount(collectCount) }}</span>
          </button>
        </el-tooltip>
      </div>
    </div>

    <WecomBotConfigDrawer
      v-if="canConfigureWecomBot"
      v-model="wecomBotDrawerVisible"
      :app-id="app._id"
      :app-name="app.name"
    />

  </article>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Connection, User, View } from '@element-plus/icons-vue';
import type { AppNew } from '../../types/agent';
import { useAppsStore } from '../../stores/apps';
import { getDisplayTags } from '../../utils/tagUtils';
import { isWecomBotEnabled } from '../../config/adminConfig';
import WecomBotConfigDrawer from '../WecomBotConfigDrawer.vue';
import { resolveFastgptAssetUrl } from '../../config/fastgptConfig';

// Props
interface Props {
  app: AppNew;
  searchKeyword?: string;
}

const props = defineProps<Props>();

// Emits
const emit = defineEmits<{
  click: [appId: string];
}>();

const appsStore = useAppsStore();

// 收藏状态本地（避免直接修改 prop）
const isCollected = ref<boolean>((props.app as any)?.isCollected ?? false);
const collectCount = ref<number>((props.app as any)?.collectCount ?? (props.app as any)?.favoriteCount ?? 0);
const wecomBotDrawerVisible = ref(false);

// 当 prop 更新时同步本地状态（深度监听以捕获属性变化）
watch(
  () => props.app,
  (newApp) => {
    if (!newApp) return;
    isCollected.value = (newApp as any)?.isCollected ?? false;
    collectCount.value = (newApp as any)?.collectCount ?? (newApp as any)?.favoriteCount ?? 0;
  },
  { immediate: true, deep: true }
);

// 如果 store 中的我的收藏包含此应用，则标记为已收藏（兼容后端未在 app 中回传 isCollected 的场景）
watch(
  () => appsStore.myCollectedAppsNew,
  (newList) => {
    try {
      const id = props.app?._id;
      if (!id) return;
      const found = Array.isArray(newList) && newList.find((a: any) => a && (a._id === id || a.tmbId === id));
      if (found) {
        isCollected.value = true;
        collectCount.value = ((found as any).collectCount ?? (found as any).favoriteCount ?? collectCount.value) as number;
      } else {
        // 如果在收藏列表中找不到，说明已取消收藏
        isCollected.value = false;
      }
    } catch (err) {
      // ignore
    }
  },
  { immediate: true }
);

// 收藏/取消收藏处理
const handleToggleCollect = async (event?: Event) => {
  // 停止事件冒泡（模板中也使用 .stop）
  if (event && typeof (event as any).stopPropagation === 'function') {
    (event as any).stopPropagation();
  }

  if (!props.app || !props.app._id) return;

  try {
    const response: any = await appsStore.toggleCollect(props.app._id, props.app);
    const newState = response?.data?.isCollected;
    const newCount = response?.data?.collectCount || response?.data?.favoriteCount;
    
    if (typeof newState === 'boolean') {
      // 更新本地状态（使用后端返回的真实收藏数）
      isCollected.value = newState;
      if (typeof newCount === 'number') {
        collectCount.value = newCount;
      }
    }
    
    // toggleCollect 方法已经在 store 中处理了所有数据的同步更新
    // 不需要在这里重复调用刷新方法
  } catch (err) {
    console.error('toggle collect failed', err);
  }
};

// 处理头像 URL：外链应用直接使用，普通应用拼接
const avatarUrl = computed(() => {
  const avatar = props.app?.avatar;
  if (!avatar) return '/defAiImg.png';
  
  // 如果是外链应用，avatar 已经是完整 URL，直接使用
  const isLinkApp = (props.app as any)?.isLinkApp;
  if (isLinkApp) {
    return avatar;
  }
  
  // 普通应用：判断是否是图片文件，如果是则拼接 URL
  const hasImageExt = avatar.indexOf('.png') > -1 || 
                      avatar.indexOf('.jpg') > -1 || 
                      avatar.indexOf('.jpeg') > -1 || 
                      avatar.indexOf('.gif') > -1 || 
                      avatar.indexOf('.webp') > -1;
  
  if (hasImageExt) {
    return resolveFastgptAssetUrl(avatar);
  }
  
  return '/defAiImg.png';
});

// Computed
const displayTags = computed(() => {
  // 使用工具函数获取标签，自动在最前面添加分类标签
  return getDisplayTags(props.app, 2);
});

const browseCount = computed(() => {
  return props.app?.viewCount ?? props.app?.chatCount ?? 0;
});

const usageCount = computed(() => {
  return props.app?.usageCount ?? props.app?.userCount ?? 0;
});

const canConfigureWecomBot = computed(() => {
  return isWecomBotEnabled() && props.app?.canConfigureWecomBot === true;
});

const canAccess = computed(() => {
  return props.app?.canAccess === true;
});

// Methods
const formatCount = (count: number | undefined): string => {
  if (!count || count === 0) {
    return '0';
  }
  if (count >= 10000) {
    return `${(count / 10000).toFixed(1)}万`;
  } else if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  return count.toString();
};

const handleClick = async () => {
  if (!props.app || !props.app._id) {
    console.error('App data is invalid');
    return;
  }
  // 只触发点击事件，由父组件处理跳转逻辑
  emit('click', props.app._id);
};

/**
 * 打开企业微信 Bot 配置抽屉。
 * 输入: 当前卡片点击事件已被模板阻止冒泡。
 * 输出: 展示配置抽屉，不触发应用跳转。
 */
function openWecomBotDrawer() {
  wecomBotDrawerVisible.value = true;
}
</script>

<style scoped lang="scss">
.app-card-new {
  position: relative;
  width: 100%;
  height: 100%;
  background-color: #fff;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  overflow: hidden;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  flex-direction: column;

  &:hover {
    transform: translateY(-4px);
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.12);

    .card-hover-overlay {
      opacity: 1;
    }
  }
}

// 顶部背景区域
.card-header {
  position: relative;
  height: 120px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 30px;
  
  .header-background {
    position: absolute;
    top: 8px;
    bottom: 8px;
    left: 10px;
    right: 10px;
    width: calc(100% - 20px);
    height: calc(100% - 16px);
    /* 背景图将从 public 目录加载，使用 cover 以适配卡片 */
    background-size: cover;
    background-position: center;
    /* 顶部两个角保留圆角，底部两个角为直角 */
    border-radius: 8px 8px 0 0;
    z-index: 0;
  }

  // 变体配色
  /* 使用 public 目录下的四张背景图：app_bj1.png ~ app_bj4.png */
  .header-background.bg-variant-0 { background-image: url('/app_bj1.png'); }
  .header-background.bg-variant-1 { background-image: url('/app_bj2.png'); }
  .header-background.bg-variant-2 { background-image: url('/app_bj3.png'); }
  .header-background.bg-variant-3 { background-image: url('/app_bj4.png'); }

  .link-app-indicator {
    position: absolute;
    left: 20px;
    right: 20px;
    bottom: 10px;
    height: 10px;
    border-radius: 999px;
    background: linear-gradient(90deg, rgba(37, 99, 235, 0) 0%, rgba(37, 99, 235, 0.14) 18%, rgba(45, 212, 191, 0.2) 50%, rgba(37, 99, 235, 0.14) 82%, rgba(37, 99, 235, 0) 100%);
    box-shadow: 0 8px 18px rgba(15, 23, 42, 0.08);
    backdrop-filter: blur(6px);
    z-index: 1;
    opacity: 1;

    &::after {
      content: '';
      position: absolute;
      left: 10px;
      right: 10px;
      top: 50%;
      height: 3px;
      border-radius: 999px;
      transform: translateY(-50%);
      background: linear-gradient(90deg, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 0.72) 12%, rgba(255, 255, 255, 0.98) 50%, rgba(255, 255, 255, 0.72) 88%, rgba(255, 255, 255, 0) 100%);
      box-shadow: 0 0 10px rgba(255, 255, 255, 0.28);
    }
  }
  
  .status-badges {
    position: absolute;
    top: 14px;
    right: 16px;
    z-index: 2;
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 3px;
    padding: 3px;
    border: 1px solid rgba(255, 255, 255, 0.72);
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.88);
    box-shadow: 0 3px 10px rgba(27, 44, 82, 0.16);
    backdrop-filter: blur(8px);

    .access-badge,
    .pin-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      height: 22px;
      color: #fff;
      font-size: 12px;
      font-weight: 600;
      line-height: 1;
      padding: 0 9px;
      border-radius: 999px;
      white-space: nowrap;
    }

    .access-badge {
      background: linear-gradient(135deg, #12a86d 0%, #20c77b 100%);
    }

    .pin-badge {
      background: linear-gradient(135deg, #ff6b35 0%, #ff8c42 100%);
    }
  }
  
  // 应用名称包裹器（左侧）
  .app-name-wrapper {
    position: relative;
    z-index: 1;
    display: inline-flex;
    max-width: calc(100% - 120px);
    margin-right: 12px;
    // background: rgba(255, 255, 255, 0.95);
    border-radius: 8px;
    padding: 6px 0px;
    // box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    backdrop-filter: blur(10px);
    flex-direction: column;
    
    .app-name {
      font-family: var(--font-alimama);
      font-size: 24px;
      font-weight: bold;
      color: #fff;
    //   color: #7D83FF;
      margin: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: 1.4;
    }
    .creator-badge{
        font-family: PingFang SC;
        font-size: 14px;
        font-weight: 600;
        background: #fff;
        border-radius: 8px;
        width: max-content;
        padding: 2px 8px;
        margin-top: 8px;
        color: #333; /* 默认色，下面按变体覆盖 */
    }
  }

  /* 按背景变体覆盖创建人名字颜色 */
  &.bg-variant-0 .creator-badge { color: #857cff; }
  &.bg-variant-1 .creator-badge { color: #64b4ff; }
  &.bg-variant-2 .creator-badge { color: #47cfed; }
  &.bg-variant-3 .creator-badge { color: #9bbfff; }

  /* 如果 bgClass 被应用在 .header-background 上，使用兄弟选择器匹配后续的 .app-name-wrapper */
  .header-background.bg-variant-0 ~ .app-name-wrapper .creator-badge { color: #857cff; }
  .header-background.bg-variant-1 ~ .app-name-wrapper .creator-badge { color: #64b4ff; }
  .header-background.bg-variant-2 ~ .app-name-wrapper .creator-badge { color: #47cfed; }
  .header-background.bg-variant-3 ~ .app-name-wrapper .creator-badge { color: #9bbfff; }
  
  // 头像（右侧）
  .card-avatar {
    position: relative;
    z-index: 1;
    height: 90px;
    flex-shrink: 0;
    
    :deep(.el-avatar) {
    //   border: 3px solid rgba(255, 255, 255, 0.3);
    //   box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      background-color: transparent;
      border-radius: 8px;
    }
  }
}

// 内容区域
.card-body {
  flex: 1;
  padding: 0px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background-color: #fff;
  position: relative; /* 用于 tags 背景绝对定位 */
}

// 应用名称（内容区）
.card-app-name {
  font-family: PingFang SC;
  font-size: 16px;
  font-weight: 600;
  color: #303133;
  /* 总距说明（包含父容器 padding/gap）：
    上方 total = card-body padding-top (8px) + margin-top (4px) = 12px
    下方 total = margin-bottom (2px) + card-body gap (8px) = 10px
  */
  margin: 0px 0 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.4;
}

// 标签样式
.card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  min-height: 28px;
  position: relative;
  z-index: 1;

  /* 在标签下方加一个模糊的背景色块（稍微偏下一点） */
  &::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    height: 32px;
    top: 8px; /* 偏下一点 */
    opacity: 0.7;
    z-index: 0;
    border-radius: 8px;
    pointer-events: none;
  }
  
  .tag-item {
    display: inline-block;
    padding: 4px 12px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
    
    /* 调整三种标签颜色，按设计图 */
    &.tag-0 {
      background-color: #E6F0FF; /* 浅蓝 */
      color: #3B66D6; /* 深蓝文字 */
    }

    &.tag-1 {
      background-color: #E8FFF2; /* 浅绿 */
      color: #17B76A; /* 绿色文字 */
    }

    &.tag-2 {
      background-color: #FFF4E6; /* 浅橙 */
      color: #FF9B3B; /* 橙色文字 */
    }

    &.tag-3 {
      background-color: #F7F8FC; /* 备用浅色 */
      color: #909399;
    }
  }
  
  .tag-placeholder {
    display: inline-block;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 20px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
    background: #E7E9FE;
    color: #3366FF;
    padding: 0 8px;
    
    &:nth-child(2) {
      background: #DFFAEB;
      color: #009F08;
    }
    
    &:nth-child(3) {
      background: #FEF2E7;
      color: #CB9500;
    }
  }
}

// 描述文本
.card-description {
  font-size: 13px;
  color: #888F99;
  line-height: 16px;
  margin: 0;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  text-overflow: ellipsis;
  word-break: break-all;
}

// 底部统计
.card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px 12px;
  background-color: transparent;
  position: relative;
}

.card-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.bot-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #fff;
  color: #3366ff;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    border-color: #3366ff;
    background: #eef4ff;
  }
}

.stats-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #999;

  .stat-icon {
    width: 13px;
    height: 13px;
  }

  .el-icon {
    font-size: 13px;
    color: #bbb;
  }

  span {
    font-weight: 400;
  }
}

// 收藏按钮（右侧，与其他图标在同一水平线）
.collect-button {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #999;
  cursor: pointer;
  transition: all 0.3s;
  
  .collect-icon {
    width: 13px;
    height: 13px;
    transition: all 0.3s;
  }
  
  span {
    font-weight: 400;
  }
  
  // 只有未收藏状态才在 hover 时换图片
  &:not(:has(.collect-icon[src*="active"])):hover {
    .collect-icon {
      content: url('/appIcon3_hover.png');
    }
  }
}

// Hover 覆盖层
.card-hover-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: linear-gradient(135deg, rgba(102, 126, 234, 0.05), rgba(118, 75, 162, 0.05));
  opacity: 0;
  transition: opacity 0.3s;
  pointer-events: none;
  z-index: 1;
}

// 响应式调整
@media (max-width: 768px) {
  .app-card-new {
    border-radius: 8px;
  }
  
  .card-header {
    height: 120px;
    padding: 12px 25px;
    
    .header-background {
      top: 8px;
      bottom: 8px;
      left: 10px;
      right: 10px;
      width: calc(100% - 20px);
      height: calc(100% - 16px);
    }
    
    .status-badges {
      right: 18px;
    }
    
    .app-name-wrapper {
      max-width: calc(100% - 130px);
      margin-right: 8px;
      padding: 4px 12px;
      
      .app-name {
        font-size: 18px;
      }
    }
    
    .card-avatar {
      :deep(.el-avatar) {
        width: 90px;
        height: 90px;
      }
    }
  }

  .card-body {
    padding: 12px;
    gap: 8px;
  }

  .card-description {
    font-size: 12px;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }

  .card-footer {
    padding: 10px 12px;
  }

  .stat-item {
    font-size: 11px;

    .el-icon {
      font-size: 14px;
    }
  }
}
</style>

<style scoped lang="scss">
/* 参考紧凑横向卡片：把识别、说明、标签和热度收进一张低高度卡片。 */
.app-card-new {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  min-width: 0;
  min-height: 168px;
  height: 100%;
  padding: 18px 20px 14px;
  overflow: hidden;
  border: 1px solid #c7e7f2;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 4px 16px rgba(43, 108, 137, 0.06);
  cursor: pointer;
  outline: none;
  transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;

  &:hover,
  &:focus-visible {
    transform: translateY(-2px);
    border-color: #79c8e3;
    box-shadow: 0 10px 26px rgba(43, 108, 137, 0.13);
  }

  &:focus-visible {
    box-shadow: 0 0 0 3px rgba(51, 170, 255, 0.16), 0 10px 26px rgba(43, 108, 137, 0.13);
  }
}

.card-summary {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}

.card-avatar {
  width: 56px;
  height: 56px;
  flex: 0 0 56px;

  :deep(.el-avatar) {
    width: 56px;
    height: 56px;
    border: 1px solid rgba(68, 161, 198, 0.14);
    border-radius: 14px;
    background: #eef8fb;
    box-shadow: 0 3px 10px rgba(43, 108, 137, 0.08);
  }
}

.card-copy {
  min-width: 0;
  flex: 1;
}

.card-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.card-app-name {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: #284451;
  font-family: var(--font-alimama);
  font-size: 17px;
  font-weight: 700;
  line-height: 24px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-badges {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;

  span {
    display: inline-flex;
    align-items: center;
    height: 20px;
    padding: 0 7px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 600;
    line-height: 1;
    white-space: nowrap;
  }

  .access-badge {
    color: #0d8a65;
    background: #e8f9f3;
  }

  .pin-badge {
    color: #d86a24;
    background: #fff2e9;
  }
}

.card-description {
  display: block;
  margin: 4px 0 0;
  overflow: hidden;
  color: #71818a;
  font-size: 13px;
  line-height: 20px;
  text-overflow: ellipsis;
  white-space: nowrap;
  word-break: normal;
}

.card-tags {
  display: flex;
  flex-wrap: nowrap;
  gap: 8px;
  min-height: 24px;
  margin-top: 13px;
  overflow: hidden;

  &::before {
    display: none;
  }

  .tag-item {
    display: inline-flex;
    align-items: center;
    max-width: 50%;
    height: 24px;
    padding: 0 10px;
    overflow: hidden;
    border-radius: 4px;
    color: #66818c;
    background: #eaf7f9;
    font-size: 12px;
    font-weight: 500;
    line-height: 24px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 28px;
  margin-top: auto;
  padding: 10px 0 0;
  background: transparent;
}

.card-metrics {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}

.metric-stat {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: #8fa0a8;
  font-size: 13px;

  .el-icon {
    color: #8fb0bd;
    font-size: 17px;
  }
}

.card-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.icon-action,
.collect-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 28px;
  margin: 0;
  padding: 0 7px;
  border: 0;
  border-radius: 8px;
  color: #8b9aa2;
  background: transparent;
  font: inherit;
  cursor: pointer;
  transition: color 0.2s ease, background 0.2s ease;

  &:hover,
  &:focus-visible {
    color: #2788ad;
    background: #edf8fb;
    outline: none;
  }
}

.collect-button {
  gap: 4px;
  font-size: 12px;

  &.is-collected {
    color: #3976e8;
    background: #eef4ff;
  }

  .collect-icon {
    width: 14px;
    height: 14px;
  }
}

@media (max-width: 768px) {
  .app-card-new {
    min-height: 154px;
    padding: 16px;
    border-radius: 16px;
  }

  .card-summary {
    gap: 12px;
  }

  .card-avatar,
  .card-avatar :deep(.el-avatar) {
    width: 50px;
    height: 50px;
  }

  .card-avatar {
    flex-basis: 50px;
  }

  .card-app-name {
    font-size: 15px;
  }

  .status-badges .access-badge {
    display: none;
  }

  .card-tags {
    margin-top: 11px;
  }
}
</style>
