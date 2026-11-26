<template>
  <div class="plaza-navigation">
    <header class="mobile-topbar">
      <button class="mobile-brand" type="button" aria-label="返回智能体广场" @click="handleLogoClick">
        <img src="/logoImg.png" alt="" />
        <span>智能体广场</span>
      </button>
      <button
        class="mobile-menu-button"
        type="button"
        :aria-label="isSidebarExpanded ? '收起导航' : '展开导航'"
        :aria-expanded="isSidebarExpanded"
        @click="toggleSidebar"
      >
        <el-icon><Menu /></el-icon>
      </button>
    </header>

    <button
      v-if="isMobile && isSidebarExpanded"
      class="sidebar-mask"
      type="button"
      aria-label="关闭导航"
      @click="closeMobileSidebar"
    />

    <aside
      class="plaza-sidebar"
      :class="{ 'is-expanded': isSidebarExpanded, 'is-collapsed': !isSidebarExpanded }"
      aria-label="智能体广场主导航"
    >
      <div class="sidebar-header">
        <button class="brand-button" type="button" title="智能体广场" @click="handleLogoClick">
          <img src="/logoImg.png" alt="" class="brand-logo" />
          <span v-show="isSidebarExpanded" class="brand-title">智能体广场</span>
        </button>
        <button
          class="collapse-button"
          type="button"
          :title="isSidebarExpanded ? '收起侧边栏' : '展开侧边栏'"
          :aria-label="isSidebarExpanded ? '收起侧边栏' : '展开侧边栏'"
          :aria-expanded="isSidebarExpanded"
          @click="toggleSidebar"
        >
          <el-icon>
            <ArrowLeft v-if="isSidebarExpanded" />
            <ArrowRight v-else />
          </el-icon>
        </button>
      </div>

      <nav class="sidebar-menu">
        <button
          class="sidebar-item"
          :class="{ active: route.path === '/' }"
          type="button"
          title="广场首页"
          @click="navigateTo('/')"
        >
          <el-icon><House /></el-icon>
          <span v-show="isSidebarExpanded">广场首页</span>
        </button>

        <button
          v-if="isSkillEnabled()"
          class="sidebar-item"
          :class="{ active: route.path.startsWith('/skills') }"
          type="button"
          title="Skill 广场"
          @click="handleSkillMarket"
        >
          <el-icon><MagicStick /></el-icon>
          <span v-show="isSidebarExpanded">Skill 广场</span>
        </button>

        <button
          class="sidebar-item"
          :class="{ active: route.path.startsWith('/my-agents') }"
          type="button"
          title="我的智能体"
          @click="handleMyAgents"
        >
          <el-icon><User /></el-icon>
          <span v-show="isSidebarExpanded">我的智能体</span>
        </button>

        <button
          class="sidebar-item"
          :class="{ active: route.path.startsWith('/link-app') }"
          type="button"
          title="外链应用管理"
          @click="handleLinkApps"
        >
          <el-icon><Connection /></el-icon>
          <span v-show="isSidebarExpanded">外链应用管理</span>
        </button>

        <button
          v-if="isMcpEnabled()"
          class="sidebar-item"
          :class="{ active: route.path.startsWith('/mcp') || route.path.startsWith('/my-mcps') }"
          type="button"
          title="MCP 市场"
          @click="handleMcpMarket"
        >
          <el-icon><Grid /></el-icon>
          <span v-show="isSidebarExpanded">MCP 市场</span>
        </button>

        <button
          v-if="isAppAdminUser"
          class="sidebar-item"
          :class="{ active: route.path.startsWith('/admin/apps') }"
          type="button"
          title="应用管理"
          @click="handleAdminApps"
        >
          <el-icon><Setting /></el-icon>
          <span v-show="isSidebarExpanded">应用管理</span>
        </button>

        <button
          v-if="isAppAdminUser && isSkillEnabled()"
          class="sidebar-item"
          :class="{ active: route.path.startsWith('/admin/skills') }"
          type="button"
          title="Skill 管理"
          @click="navigateTo('/admin/skills')"
        >
          <el-icon><DocumentChecked /></el-icon>
          <span v-show="isSidebarExpanded">Skill 管理</span>
        </button>

        <div v-if="FASTGPT_DASHBOARD_APPS_URL" class="sidebar-divider" />

        <button
          v-if="FASTGPT_DASHBOARD_APPS_URL"
          class="sidebar-item sidebar-item--primary"
          type="button"
          title="创建智能体"
          @click="handleCreateFastGpt"
        >
          <el-icon><Plus /></el-icon>
          <span v-show="isSidebarExpanded">创建智能体</span>
        </button>

      </nav>

      <div v-if="userName || userBadge" class="sidebar-user" :title="`${userName} ${userBadge}`.trim()">
        <span class="user-avatar">{{ userInitial }}</span>
        <div v-show="isSidebarExpanded" class="user-copy">
          <strong>{{ userName || '当前用户' }}</strong>
          <span v-if="userBadge">{{ userBadge }}</span>
        </div>
      </div>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  ArrowLeft,
  ArrowRight,
  Connection,
  DocumentChecked,
  Grid,
  House,
  MagicStick,
  Menu,
  Plus,
  Setting,
  User
} from '@element-plus/icons-vue';
import { useRoute, useRouter } from 'vue-router';
import { isAppAdmin, isMcpEnabled, isSkillEnabled } from '../../config/adminConfig';
import { FASTGPT_DASHBOARD_APPS_URL } from '../../config/fastgptConfig';

const router = useRouter();
const route = useRoute();
const isMobile = ref(window.innerWidth <= 768);
const isSidebarExpanded = ref(window.innerWidth > 768);
const userName = ref('');
const userBadge = ref('');

const isAppAdminUser = computed(() => isAppAdmin());
const userInitial = computed(() => (userName.value || userBadge.value || '用').trim().slice(0, 1));

const syncBodyLayout = () => {
  document.body.classList.add('has-plaza-sidebar');
  document.body.classList.toggle('plaza-sidebar-collapsed', !isSidebarExpanded.value && !isMobile.value);
};

const handleResize = () => {
  const wasMobile = isMobile.value;
  isMobile.value = window.innerWidth <= 768;

  if (wasMobile !== isMobile.value) {
    isSidebarExpanded.value = !isMobile.value;
  }
  syncBodyLayout();
};

onMounted(() => {
  try {
    const userInfoStr = localStorage.getItem('userInfo');
    if (userInfoStr) {
      const userInfo = JSON.parse(userInfoStr);
      userName.value = userInfo.Name || '';
      userBadge.value = String(userInfo.Badge || '');
      if (userInfo.Badge) {
        localStorage.setItem('userBadge', String(userInfo.Badge));
      }
    }
  } catch {
    userName.value = '';
    userBadge.value = '';
  }

  syncBodyLayout();
  window.addEventListener('resize', handleResize);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize);
  document.body.classList.remove('has-plaza-sidebar', 'plaza-sidebar-collapsed');
});

watch(isSidebarExpanded, () => {
  syncBodyLayout();
});

const closeMobileSidebar = () => {
  if (isMobile.value) {
    isSidebarExpanded.value = false;
  }
};

const toggleSidebar = () => {
  isSidebarExpanded.value = !isSidebarExpanded.value;
};

const navigateTo = (path: string) => {
  router.push(path);
  closeMobileSidebar();
};

const handleLogoClick = () => navigateTo('/');

const handleMyAgents = () => {
  navigateTo('/my-agents');
};

const handleLinkApps = () => navigateTo('/link-apps');
const handleSkillMarket = () => navigateTo('/skills');
const handleMcpMarket = () => navigateTo('/mcp');
const handleAdminApps = () => navigateTo('/admin/apps');

const handleCreateFastGpt = () => {
  window.open(FASTGPT_DASHBOARD_APPS_URL, '_blank', 'noopener,noreferrer');
};

</script>

<style scoped>
:global(body.has-plaza-sidebar #app) {
  padding-left: 248px;
  transition: padding-left 0.24s ease;
}

:global(body.has-plaza-sidebar.plaza-sidebar-collapsed #app) {
  padding-left: 76px;
}

.mobile-topbar {
  display: none;
}

.plaza-sidebar {
  position: fixed;
  inset: 0 auto 0 0;
  z-index: 2100;
  display: flex;
  flex-direction: column;
  width: 248px;
  padding: 16px 14px;
  overflow: hidden;
  border-right: 1px solid #dbeaf0;
  background: rgba(247, 252, 254, 0.97);
  box-shadow: 8px 0 30px rgba(36, 92, 117, 0.06);
  backdrop-filter: blur(18px);
  transition: width 0.24s ease, transform 0.24s ease;
}

.plaza-sidebar.is-collapsed {
  width: 76px;
  padding-inline: 10px;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 48px;
  margin-bottom: 22px;
}

.brand-button,
.collapse-button,
.sidebar-item,
.mobile-brand,
.mobile-menu-button {
  border: 0;
  font: inherit;
  cursor: pointer;
}

.brand-button {
  display: flex;
  align-items: center;
  min-width: 0;
  padding: 4px;
  color: #264653;
  background: transparent;
}

.brand-logo {
  width: 40px;
  height: 40px;
  flex: 0 0 40px;
  object-fit: contain;
}

.brand-title {
  margin-left: 10px;
  overflow: hidden;
  font-family: var(--font-alimama);
  font-size: 18px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.collapse-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex: 0 0 32px;
  border: 1px solid #d7e9ef;
  border-radius: 10px;
  color: #66818c;
  background: #ffffff;
  transition: color 0.2s ease, border-color 0.2s ease, background 0.2s ease;
}

.collapse-button:hover {
  border-color: #8bcfe5;
  color: #227fa4;
  background: #eff9fc;
}

.is-collapsed .sidebar-header {
  flex-direction: column;
  gap: 8px;
  margin-bottom: 14px;
}

.is-collapsed .collapse-button {
  width: 42px;
}

.sidebar-menu {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: thin;
}

.sidebar-item {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 44px;
  padding: 0 13px;
  border-radius: 12px;
  color: #5d737d;
  background: transparent;
  font-size: 14px;
  font-weight: 500;
  text-align: left;
  white-space: nowrap;
  transition: color 0.18s ease, background 0.18s ease, transform 0.18s ease;
}

.sidebar-item .el-icon {
  width: 20px;
  margin-right: 12px;
  flex: 0 0 20px;
  font-size: 19px;
}

.sidebar-item:hover {
  color: #287fa2;
  background: #eaf7fb;
}

.sidebar-item.active {
  color: #1d7fa8;
  background: linear-gradient(135deg, #dff4fa, #eaf8fb);
  box-shadow: inset 3px 0 #4bb4d7;
  font-weight: 650;
}

.sidebar-item--primary {
  color: #ffffff;
  background: linear-gradient(135deg, #35aee0, #3978e8);
  box-shadow: 0 7px 18px rgba(47, 132, 199, 0.18);
}

.sidebar-item--primary:hover {
  color: #ffffff;
  background: linear-gradient(135deg, #48b9e6, #4b86ef);
}

.is-collapsed .sidebar-item {
  justify-content: center;
  padding: 0;
}

.is-collapsed .sidebar-item .el-icon {
  margin-right: 0;
}

.sidebar-divider {
  height: 1px;
  margin: 8px 10px;
  background: #dfedf2;
}

.sidebar-user {
  display: flex;
  align-items: center;
  min-height: 58px;
  margin-top: 14px;
  padding: 9px;
  overflow: hidden;
  border: 1px solid #dcebf0;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.82);
}

.user-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  flex: 0 0 38px;
  border-radius: 12px;
  color: #ffffff;
  background: linear-gradient(135deg, #4fc0dd, #4d7ee7);
  font-weight: 700;
}

.user-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
  margin-left: 10px;
}

.user-copy strong,
.user-copy span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-copy strong {
  color: #38505b;
  font-size: 13px;
}

.user-copy span {
  margin-top: 2px;
  color: #91a0a7;
  font-size: 11px;
}

.is-collapsed .sidebar-user {
  justify-content: center;
  padding: 8px;
}

.sidebar-mask {
  display: none;
}

@media (max-width: 768px) {
  :global(body.has-plaza-sidebar #app),
  :global(body.has-plaza-sidebar.plaza-sidebar-collapsed #app) {
    padding-left: 0;
  }

  .plaza-navigation {
    height: calc(60px + env(safe-area-inset-top));
    flex: 0 0 calc(60px + env(safe-area-inset-top));
  }

  .mobile-topbar {
    position: fixed;
    inset: 0 0 auto;
    z-index: 2050;
    box-sizing: border-box;
    display: flex;
    width: 100%;
    align-items: center;
    justify-content: space-between;
    height: calc(60px + env(safe-area-inset-top));
    padding: env(safe-area-inset-top) 16px 0;
    border-bottom: 1px solid #deedf2;
    background: rgba(248, 252, 254, 0.98);
    box-shadow: 0 6px 18px rgba(34, 78, 98, 0.07);
    backdrop-filter: blur(16px);
  }

  .mobile-brand {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 0;
    color: #294752;
    background: transparent;
    font-family: var(--font-alimama);
    font-size: 16px;
    font-weight: 700;
  }

  .mobile-brand img {
    width: 34px;
    height: 34px;
  }

  .mobile-menu-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 38px;
    height: 38px;
    border-radius: 11px;
    color: #3c7f9d;
    background: #e9f6fa;
    font-size: 20px;
  }

  .sidebar-mask {
    position: fixed;
    inset: 0;
    z-index: 2150;
    display: block;
    border: 0;
    background: rgba(26, 48, 58, 0.34);
    backdrop-filter: blur(2px);
  }

  .plaza-sidebar,
  .plaza-sidebar.is-collapsed {
    z-index: 2200;
    width: min(86vw, 288px);
    padding: 16px 14px;
    transform: translateX(-102%);
  }

  .plaza-sidebar.is-expanded {
    transform: translateX(0);
  }

  .is-collapsed .sidebar-header {
    flex-direction: row;
  }
}
</style>
