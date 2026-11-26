import { getAppConfigValue } from './runtimeConfig'

function normalizeFastgptFrontendBaseUrl(value?: unknown): string {
  try {
    const url = new URL(String(value || '').trim())
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return ''
    return url.origin
  } catch {
    return ''
  }
}

export const FASTGPT_FRONTEND_BASE_URL = normalizeFastgptFrontendBaseUrl(
  getAppConfigValue('VITE_FASTGPT_FRONTEND_BASE_URL')
)

export const FASTGPT_DASHBOARD_APPS_URL = FASTGPT_FRONTEND_BASE_URL
  ? new URL('/dashboard/apps', FASTGPT_FRONTEND_BASE_URL).toString()
  : ''

function buildFastgptUrl(path: '/chat' | '/app/detail', appId: string, pane?: string): string {
  if (!FASTGPT_FRONTEND_BASE_URL) return ''
  const url = new URL(path, FASTGPT_FRONTEND_BASE_URL)
  url.searchParams.set('appId', appId)
  if (pane) url.searchParams.set('pane', pane)
  return url.toString()
}

export function buildFastgptChatUrl(appId: string, pane?: string): string {
  return buildFastgptUrl('/chat', appId, pane)
}

export function buildFastgptAppOpenUrl(appId: string, openDetail: boolean, pane?: string): string {
  return openDetail ? buildFastgptUrl('/app/detail', appId, pane) : buildFastgptChatUrl(appId, pane)
}

export function resolveFastgptAssetUrl(assetPath?: string): string {
  const value = String(assetPath || '').trim()
  if (/^https?:\/\//i.test(value)) return value
  if (!value || !FASTGPT_FRONTEND_BASE_URL) return '/defAiImg.png'
  const url = new URL(value, FASTGPT_FRONTEND_BASE_URL)
  return url.origin === FASTGPT_FRONTEND_BASE_URL ? url.toString() : '/defAiImg.png'
}
