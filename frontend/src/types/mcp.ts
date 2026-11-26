export type McpTransport = 'streamable' | 'sse'
export type McpVisibilityMode = 'private' | 'public' | 'restricted'
export type McpSyncStatus = 'creating' | 'active' | 'updating' | 'failed' | 'deleting'
export type HigressMcpType = 'DIRECT_ROUTE' | 'OPEN_API'
export type OpenApiInputMode = 'content' | 'url'
export type OpenApiCredentialType = 'bearer' | 'apiKey'
export type OpenApiCredentialLocation = 'header' | 'query'
export type HigressServiceSourceType = 'static' | 'dns' | 'nacos' | 'nacos2' | 'nacos3' | 'zookeeper' | 'consul' | 'eureka'
export type HigressServiceProtocol = '' | 'http' | 'https'


export interface HeaderEntry {
  key: string
  value: string
}

export interface HeaderStageConfig {
  add: HeaderEntry[]
  set: HeaderEntry[]
  remove: string[]
}

export interface McpRoutePluginConfig {
  rewrite: {
    enabled: boolean
    path: string
    host: string
  }
  headerModify: {
    enabled: boolean
    request: HeaderStageConfig
    response: HeaderStageConfig
  }
  keyAuth: {
    enabled: boolean
    allowedCredentialTypes: string[]
    allowedConsumers: string[]
    rawConfigurations: string
  }
  transformer: {
    enabled: boolean
    rawConfigurations: string
  }
}
export interface OpenApiAuthConfig {
  enabled: boolean
  credentialType: OpenApiCredentialType
  client?: { in: OpenApiCredentialLocation; name: string; scheme?: 'bearer' | 'apiKey' }
  backend?: { in: OpenApiCredentialLocation; name: string; scheme?: 'bearer' | 'apiKey' }
  applyTo?: { mode: 'all' | 'selected'; toolNames: string[] }
}

export interface McpConnectionPreview {
  reachable: boolean
  transport: McpTransport
  source: {
    serviceSourceType: HigressServiceSourceType
    serviceSourceDomain: string
    serviceSourcePort: number
    serviceSourceProtocol: HigressServiceProtocol
  }
  routeAdaptation: { enabled: boolean; path: string; host: string }
  toolCount: number
  tools: McpToolSnapshotItem[]
  errorMessage?: string
}
export interface McpListItem {
  id: string
  serviceKey: string
  displayName: string
  summary: string
  description: string
  avatar?: string
  category: string
  newType?: string
  tags: string[]
  higressMcpType?: HigressMcpType
  transport: McpTransport
  serviceSourceType: HigressServiceSourceType
  serviceSourceDomain: string
  serviceSourcePort: number
  serviceSourceProtocol: HigressServiceProtocol
  gatewayDomain: string
  gatewayPath: string
  visibilityMode: McpVisibilityMode
  userPermissions?: string[]
  deptPermissions?: string[]
  syncStatus: McpSyncStatus
  syncMessage: string
  gatewayAccessUrl: string
  debugGatewayAccessUrl?: string
  ownerName: string
  ownerBadge: string
  viewCount?: number
  isPinned?: boolean
  pinnedAt?: string | null
  updatedAt: string
  createdAt: string
  lastSyncedAt?: string | null
  isCollected?: boolean
  favoriteCount?: number
  collectCount?: number
  hasClientAccess?: boolean
  clientAccessMessage?: string
}

export interface McpToolSnapshotItem {
  name: string
  title?: string
  description: string
  inputSchemaSummary: string[]
  rawInputSchema?: Record<string, any>
}

export interface McpToolSnapshot {
  sourceUrl: string
  transport: McpTransport
  fetchedAt: string
  toolCount: number
  tools: McpToolSnapshotItem[]
}

export interface McpSyncRecordSummary {
  id: string
  action: 'create' | 'update' | 'resync'
  status: 'running' | 'success' | 'failed'
  errorCode: string
  errorMessage: string
  createdAt: string
  finishedAt?: string | null
}

export interface McpDetailItem extends McpListItem {
  lastErrorCode: string
  latestSyncRecord: McpSyncRecordSummary | null
  hasSourceConfigAccess?: boolean
  upstreamUrl?: string
  upstreamUrlMasked: boolean
  upstreamUrlPlaceholder: string
  toolCount?: number
  lastToolDiscoveryAt?: string | null
  lastToolDiscoveryFailedAt?: string | null
  lastToolDiscoveryError?: string
  toolSnapshot?: McpToolSnapshot | null
  openApiInputMode?: OpenApiInputMode
  openApiContent?: string
  openApiUrl?: string
  openApiAuthConfig?: OpenApiAuthConfig
  routePluginConfig?: McpRoutePluginConfig
  hasSecretConfig?: {
    upstreamUrl?: boolean
    openApiContent?: boolean
    openApiUrl?: boolean
    openApiRawConfigurations?: boolean
    openApiAuthConfig?: boolean
    routePluginConfig?: boolean
  }
}

export interface CreateMcpPayload {
  displayName: string
  summary: string
  description: string
  avatar?: string
  category: string
  tags: string[]
  visibilityMode?: McpVisibilityMode
  userPermissions?: string[]
  deptPermissions?: string[]
  higressMcpType: HigressMcpType
  transport: McpTransport
  upstreamUrl: string
  openApiInputMode: OpenApiInputMode
  openApiContent: string
  openApiUrl: string
  openApiAuthConfig: OpenApiAuthConfig
  serviceSourceType: HigressServiceSourceType
  serviceSourceDomain: string
  serviceSourcePort: number
  serviceSourceProtocol: HigressServiceProtocol
  gatewayDomain: string
  gatewayPath: string
  routePluginConfig: McpRoutePluginConfig
}

export interface UpdateMcpPayload {
  displayName?: string
  summary?: string
  description?: string
  avatar?: string
  category?: string
  tags?: string[]
  visibilityMode?: McpVisibilityMode
  userPermissions?: string[]
  deptPermissions?: string[]
  higressMcpType?: HigressMcpType
  transport?: McpTransport
  upstreamUrl?: string
  openApiInputMode?: OpenApiInputMode
  openApiContent?: string
  openApiUrl?: string
  openApiAuthConfig?: OpenApiAuthConfig
  serviceSourceType?: HigressServiceSourceType
  serviceSourceDomain?: string
  serviceSourcePort?: number
  serviceSourceProtocol?: HigressServiceProtocol
  gatewayDomain?: string
  gatewayPath?: string
  routePluginConfig?: McpRoutePluginConfig
}
