export interface SkillCategory {
  id: string
  name: string
}

export interface SkillOwner {
  badge: string
  name: string
  departmentCode?: string
}

export type SkillSourceType = 'zip' | 'builtin'

export interface SkillSource {
  type: SkillSourceType
  name?: string
}

export interface SkillStats {
  viewCount: number
  viewerCount: number
  downloadCount: number
  favoriteCount: number
  ratingAverage: number
  ratingCount: number
}

export interface SkillListItem {
  id: string
  name: string
  summary: string
  category: string
  tags: string[]
  track: 'official' | 'community'
  visibility: string
  version: string
  owner: SkillOwner
  source: SkillSource
  stats: SkillStats
  hotScore: number
  security: { status: 'pending' | 'passed' | 'failed' | 'unscanned'; warnings?: string[] }
  isFavorite: boolean
  publishedAt?: string
  contentUpdatedAt?: string
  updatedAt?: string
}

export interface SkillParseItem {
  itemKey: string
  sourcePath: string
  name: string
  summary: string
  manifestId?: string | null
  version?: string
  category?: string
  tags: string[]
  fileCount: number
  fileManifest?: Array<{ path: string; size: number }>
  expandedSize: number
  warnings: string[]
}

export interface SkillSubmission {
  id: string
  name: string
  summary: string
  tags: string[]
  owner: SkillOwner
  source?: SkillSource
  version?: string
  status: 'pending' | 'publishing' | 'approved' | 'rejected'
  submittedAt: string
}

export interface SkillSubmissionDetail extends SkillSubmission {
  archiveName?: string
  category?: string
  track?: SkillListItem['track']
  sourcePath: string
  skillMdContent: string
  fileManifest: Array<{ path: string; size: number }>
  warnings: string[]
}

export interface SkillImportJob {
  jobId: string
  sourceType: 'zip'
  status: 'queued' | 'processing' | 'ready' | 'submitting' | 'succeeded' | 'failed'
  progress: number
  stage: string
  parseItems: SkillParseItem[]
  skippedItems?: Array<{ sourcePath: string; reason: string }>
  results: Array<{
    itemKey: string
    success: boolean
    skillId?: string
    name?: string
    version?: string
    created?: boolean
    message?: string
    action?: 'published' | 'updated' | 'unchanged' | 'skipped' | 'failed'
  }>
  error?: { code?: string; message?: string }
}

export interface SkillDetail extends SkillListItem {
  latestVersion?: {
    id?: string
    version: string
    revision: number
    sourcePath: string
    skillMdContent: string
    fileManifest: Array<{ path: string; size: number; compressedSize: number }>
    scan: { status: string; warnings?: string[]; scannedAt?: string }
    publishedAt: string
  }
}
