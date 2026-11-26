import { FASTGPT_DASHBOARD_APPS_URL } from '../config/fastgptConfig'

﻿export type PresentationTransport = 'streamable' | 'sse'
export type PresentationSyncStatus = 'creating' | 'active' | 'updating' | 'failed' | 'deleting'
export type PresentationMcpSourceType = 'DIRECT_ROUTE' | 'OPEN_API'

type OwnerDetail = {
  ownerBadge?: string | number | null
  ownerName?: string | null
  owner?: {
    badge?: string | number | null
    Badge?: string | number | null
    name?: string | null
    Name?: string | null
  } | null
  creator?: {
    badge?: string | number | null
    Badge?: string | number | null
    name?: string | null
    Name?: string | null
  } | null
  badge?: string | number | null
  Badge?: string | number | null
  name?: string | null
  Name?: string | null
}

type ClientConfigDetail = {
  serviceKey?: string | null
  displayName?: string | null
  gatewayAccessUrl?: string | null
}

type AvatarDetail = {
  avatar?: string | null
}

export type StaticInstallClient = {
  key: string
  name: string
  description: string
  actionLabel: string
  actionHref?: string
  secondaryLabel: string
  tutorial: {
    title: string
    intro: string
    hint: string
    steps: Array<{
      id: number
      title: string
      description: string
    }>
  }
}

export function normalizeBadge(value?: string | null) {
  return String(value || '').trim().toLowerCase()
}

function normalizeIdentityValue(value?: string | number | null) {
  return String(value || '').trim().toLowerCase()
}

function collectIdentityValues(values: Array<string | number | null | undefined>) {
  return Array.from(new Set(values.map(normalizeIdentityValue).filter(Boolean)))
}

function getOwnerBadges(detail: OwnerDetail) {
  return collectIdentityValues([
    detail.ownerBadge,
    detail.owner?.badge,
    detail.owner?.Badge,
    detail.creator?.badge,
    detail.creator?.Badge,
    detail.badge,
    detail.Badge
  ])
}

function getOwnerNames(detail: OwnerDetail) {
  return collectIdentityValues([
    detail.ownerName,
    detail.owner?.name,
    detail.owner?.Name,
    detail.creator?.name,
    detail.creator?.Name,
    detail.name,
    detail.Name
  ])
}

function firstIdentityValue(values: Array<string | number | null | undefined>) {
  return values.map(value => String(value || '').trim()).find(Boolean) || ''
}

export type CurrentUserIdentity = {
  badge?: string | null
  name?: string | null
  employeeNumber?: string | null
  username?: string | null
}

export function isMcpOwner(detail: OwnerDetail, user?: string | CurrentUserIdentity | null) {
  const ownerBadges = getOwnerBadges(detail)
  const ownerNames = getOwnerNames(detail)

  if (typeof user === 'string') {
    const userBadge = normalizeBadge(user)
    return Boolean(userBadge && ownerBadges.includes(userBadge))
  }

  const userBadges = collectIdentityValues([
    user?.badge,
    user?.employeeNumber,
    user?.username
  ])

  if (ownerBadges.some(ownerBadge => userBadges.includes(ownerBadge))) {
    return true
  }

  const userNames = collectIdentityValues([
    user?.name,
    user?.employeeNumber,
    user?.username,
    user?.badge
  ])

  return ownerNames.some(ownerName => userNames.includes(ownerName))
}

export function getTransportLabel(transport: PresentationTransport) {
  return transport === 'sse' ? 'SSE（服务端事件流）' : 'Streamable HTTP（可流式 HTTP）'
}

export function getTransportShortLabel(transport: PresentationTransport) {
  return transport === 'sse' ? 'SSE' : 'Streamable HTTP'
}

export function getVisibilityLabel(visibilityMode?: string | null) {
  if (visibilityMode === 'restricted') return '指定可见'
  if (visibilityMode === 'private') return '仅创建者可见'
  return '公开可见'
}

export function getMcpSourceTypeLabel(type?: string | null) {
  if (type === 'OPEN_API') return 'OpenAPI 转换'
  return '直接路由'
}

export function getOwnerText(detail: OwnerDetail) {
  const ownerName = firstIdentityValue([
    detail.ownerName,
    detail.owner?.name,
    detail.owner?.Name,
    detail.creator?.name,
    detail.creator?.Name,
    detail.name,
    detail.Name
  ])
  const ownerBadge = firstIdentityValue([
    detail.ownerBadge,
    detail.owner?.badge,
    detail.owner?.Badge,
    detail.creator?.badge,
    detail.creator?.Badge,
    detail.badge,
    detail.Badge
  ])

  if (ownerName && ownerBadge) return `${ownerName}（${ownerBadge}）`
  return ownerName || ownerBadge || '未知发布者'
}

export function getMcpAvatarUrl(detail?: AvatarDetail | null) {
  const avatar = String(detail?.avatar || '').trim()
  return avatar || '/mcp-logo.webp'
}

export function formatMcpDate(value?: string | null) {
  if (!value) return '尚未更新'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '尚未更新'
  return date.toLocaleDateString('zh-CN')
}

export function getSyncStatusMeta(status: PresentationSyncStatus) {
  const meta: Record<PresentationSyncStatus, { text: string; tagType: 'success' | 'danger' | 'warning' | 'info'; tone: string }> = {
    creating: { text: '创建中', tagType: 'info', tone: 'is-creating' },
    active: { text: '运行正常', tagType: 'success', tone: 'is-active' },
    updating: { text: '同步中', tagType: 'warning', tone: 'is-updating' },
    failed: { text: '同步异常', tagType: 'danger', tone: 'is-failed' },
    deleting: { text: '删除中', tagType: 'info', tone: 'is-deleting' }
  }

  return meta[status] || meta.creating
}

export function buildRouteHint(detail: { gatewayDomain?: string | null; gatewayPath?: string | null }) {
  const domain = String(detail.gatewayDomain || '').trim() || '*'
  const path = normalizeGatewayPath(detail.gatewayPath)
  return `${domain}${path}`
}

export function normalizeGatewayPath(value?: string | null) {
  const path = String(value || '').trim()
  if (!path) return '/'
  return path.startsWith('/') ? path : `/${path}`
}

function buildClientConfigKey(detail: ClientConfigDetail) {
  const displayName = String(detail.displayName || '').trim()
  if (displayName) return displayName

  const serviceKey = String(detail.serviceKey || '').trim()
  return serviceKey ? `mcp-${serviceKey.slice(0, 8)}` : 'mcp-server'
}

export function buildMcpClientConfig(detail: ClientConfigDetail) {
  return JSON.stringify(
    {
      mcpServers: {
        [buildClientConfigKey(detail)]: {
          url: String(detail.gatewayAccessUrl || '')
        }
      }
    },
    null,
    2
  )
}

export function getStaticInstallClients(): StaticInstallClient[] {
  if (!FASTGPT_DASHBOARD_APPS_URL) return []
  return [
    {
      key: 'fastgpt',
      name: 'FastGPT',
      description: '适合桌面端快速验证 MCP 连接配置。',
      actionLabel: '\u524d\u5f80 FastGPT \u914d\u7f6e',
      actionHref: FASTGPT_DASHBOARD_APPS_URL,
      secondaryLabel: '\u67e5\u770b\u63a5\u5165\u6559\u7a0b',
      tutorial: {
        title: 'FastGPT 接入教程',
        intro: '按照下面步骤，即可在 FastGPT 中接入当前 MCP 服务，并完成工具发布与调试。',
        hint: '如果解析失败，请先确认当前 MCP 地址可访问，并已完成服务发布与同步。如需重新获取地址，请返回当前 MCP 详情页复制“网关路由 URL”配置。',
        steps: [
          {
            id: 1,
            title: '进入 FastGPT 工具页',
            description: '在 FastGPT 左侧导航进入“工具”，切换到“MCP 工具”分类，点击右上角“新建工具”，再选择“MCP 工具”。'
          },
          {
            id: 2,
            title: '填写 MCP 地址并解析',
            description: '在弹窗中输入当前页面提供的 MCP 地址，点击“解析”。解析成功后，会自动识别该 MCP 服务下的工具列表。确认无误后点击“确认”。'
          },
          {
            id: 3,
            title: '检查工具内容并保存',
            description: '进入工具详情页后，确认左侧已展示 MCP 地址和工具列表，右侧可看到调试预览参数。此时点击右上角“保存”，完成工具创建。'
          },
          {
            id: 4,
            title: '补充应用信息',
            description: '在“应用信息设置”中，可按需要补充应用介绍，并确认协作者信息。完成后点击“保存”。'
          },
          {
            id: 5,
            title: '在工作流或应用中使用工具',
            description: '回到应用编排或工作流页面，在“工具”面板中找到刚创建的 MCP 工具，将它加入当前应用节点中，即可开始调试和使用。'
          }
        ]
      }
    }
  ]
}

function parseStoredUser(rawValue?: string | null) {
  if (!rawValue) return null

  try {
    return JSON.parse(rawValue) as {
      Badge?: string | number | null
      badge?: string | number | null
      userNumber?: string | number | null
      number?: string | number | null
      employeeNumber?: string | number | null
      username?: string | number | null
      Name?: string | null
      name?: string | null
    }
  } catch {
    return null
  }
}

export function resolveCurrentUserBadge(storage?: Pick<Storage, 'getItem'> | null) {
  const userInfo = parseStoredUser(storage?.getItem('userInfo'))
  const user = parseStoredUser(storage?.getItem('user'))
  const rawBadge = storage?.getItem('userBadge')

  return firstIdentityValue([
    userInfo?.badge,
    userInfo?.Badge,
    user?.userNumber,
    user?.number,
    user?.employeeNumber,
    user?.username,
    rawBadge
  ])
}

export function resolveCurrentUserIdentity(storage?: Pick<Storage, 'getItem'> | null): CurrentUserIdentity {
  const userInfo = parseStoredUser(storage?.getItem('userInfo'))
  const user = parseStoredUser(storage?.getItem('user'))

  return {
    badge: resolveCurrentUserBadge(storage),
    name: firstIdentityValue([userInfo?.Name, userInfo?.name, user?.Name, user?.name]),
    employeeNumber: firstIdentityValue([user?.number, user?.employeeNumber, user?.userNumber]),
    username: firstIdentityValue([user?.name, user?.username])
  }
}
