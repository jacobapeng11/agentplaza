import { createRouter, createWebHistory } from 'vue-router';
import { useAppsStore } from '../stores/apps';
import { isAppAdmin, isMcpEnabled, isWecomBotEnabled } from '../config/adminConfig';

const routes = [
  {
    path: '/',
    name: 'Home',
    component: () => import('../views/AgentPlaza.vue')
  },
  {
    path: '/category/:categoryId',
    name: 'CategoryDetail',
    component: () => import('../views/CategoryDetail.vue')
  },
  {
    path: '/my-agents',
    name: 'MyAgents',
    component: () => import('../views/MyAgents.vue')
  },
  {
    path: '/my-mcps',
    name: 'MyMcps',
    component: () => import('../views/MyMcps.vue')
  },
  {
    path: '/mcp',
    name: 'McpMarketplace',
    component: () => import('../views/McpMarketplace.vue')
  },
  {
    path: '/mcp/publish',
    name: 'McpPublish',
    component: () => import('../views/McpPublish.vue'),
    meta: { requiresAdmin: true }
  },
  {
    path: '/mcp/publish/:id',
    name: 'McpEdit',
    component: () => import('../views/McpPublish.vue'),
    meta: { requiresAdmin: true }
  },
  {
    path: '/mcp/server/:id',
    name: 'McpDetail',
    component: () => import('../views/McpDetail.vue')
  },
  {
    path: '/link-apps',
    name: 'LinkAppsManagement',
    component: () => import('../views/LinkAppsManagement.vue')
  },
  {
    path: '/link-app/create',
    name: 'LinkAppCreate',
    component: () => import('../views/LinkAppEditor.vue')
  },
  {
    path: '/link-app/edit/:id',
    name: 'LinkAppEdit',
    component: () => import('../views/LinkAppEditor.vue')
  },
  {
    path: '/admin/apps',
    name: 'AdminAppManagement',
    component: () => import('../views/AdminAppManagement.vue'),
    meta: { requiresAdmin: true }
  },
  {
    path: '/wecom-binding-result',
    name: 'WecomBindingResult',
    component: () => import('../views/WecomBindingResult.vue')
  },
  {
    path: '/login',
    name: 'Login',
    component: () => import('../views/LoginView.vue')
  },
  {
    path: '/:pathMatch(.*)*', // 404 route
    name: 'NotFound',
    component: () => import('../views/AgentPlaza.vue')
  }
];

const router = createRouter({
  history: createWebHistory(),
  routes
});

router.beforeEach(async (to) => {
  if (to.name === 'Login') return true;

  const appsStore = useAppsStore();
  const { code, state, error, qw_token: qwToken } = to.query;
  if (typeof qwToken === 'string') appsStore.rememberWecomQwToken(qwToken);

  if (to.path === '/' && (code || state || error)) {
    if (typeof code !== 'string' || typeof state !== 'string' || error) {
      return { name: 'Login', query: { failed: '1' }, replace: true };
    }

    try {
      const returnTo = await appsStore.completeLoginWithCode(code, state);
      return { ...router.resolve(returnTo), replace: true };
    } catch {
      return { name: 'Login', query: { failed: '1' }, replace: true };
    }
  }

  if (!appsStore.checkAuthStatus()) {
    appsStore.redirectToLogin(to.fullPath);
    return false;
  }

  if (to.meta.requiresAdmin && !isAppAdmin()) return { name: 'Home' };
  if ((to.path.startsWith('/mcp') || to.name === 'MyMcps') && !isMcpEnabled()) {
    return { name: 'Home' };
  }

  if (to.name !== 'WecomBindingResult' && isWecomBotEnabled()) {
    const result = await appsStore.bindPendingWecomQwToken();
    if (result) return { name: 'WecomBindingResult', query: { status: result.status }, replace: true };
  }

  return true;
});

// 路由切换时更新浏览器页签标题 (无 meta.title 时回退到 index.html 默认 "智能体广场")
router.afterEach((to) => {
  const title = (to.meta?.title as string | undefined) || (to.matched[0]?.meta?.title as string | undefined);
  if (title) {
    document.title = title;
  } else {
    document.title = '智能体广场';
  }
});

export default router;
