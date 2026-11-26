import { http } from '../utils/request'
import type { CreateMcpPayload, McpConnectionPreview, McpDetailItem, McpListItem, McpTransport, UpdateMcpPayload } from '../types/mcp'

export const mcpApi = {
  getCatalog(params?: { search?: string; transport?: string; category?: string; tag?: string; sortBy?: string }) {
    return http.get<{ items: McpListItem[] }>('/mcp/catalog', params)
  },

  getCatalogDetail(id: string) {
    return http.get<McpDetailItem>('/mcp/catalog/' + id)
  },

  getMyServices(params?: { search?: string; syncStatus?: string; transport?: string; category?: string; tag?: string }) {
    return http.get<{ items: McpListItem[] }>('/mcp/my-services', params)
  },

  getMyCreated(params?: { search?: string; transport?: string; category?: string; tag?: string; sortBy?: string }) {
    return http.get<{ items: McpListItem[] }>('/mcp/my-created', params)
  },

  getMyCollected(params?: { search?: string; transport?: string; category?: string; tag?: string; sortBy?: string }) {
    return http.get<{ items: McpListItem[] }>('/mcp/my-collected', params)
  },

  previewConnection(payload: { upstreamUrl: string; transport?: McpTransport }) {
    return http.post<McpConnectionPreview>('/mcp/connection-preview', payload)
  },

  toggleFavorite(id: string) {
    return http.post<{ id: string; serviceKey: string; isCollected: boolean; favoriteCount: number; collectCount: number }>('/mcp/catalog/' + id + '/favorite')
  },

  togglePinned(id: string, isPinned: boolean) {
    return http.put<{ id: string; serviceKey: string; isPinned: boolean; pinnedAt: string | null }>('/mcp/catalog/' + id + '/pin', { isPinned })
  },

  createMyService(payload: CreateMcpPayload) {
    return http.post<McpDetailItem>('/mcp/my-services', payload)
  },

  getMyServiceDetail(id: string) {
    return http.get<McpDetailItem>('/mcp/my-services/' + id)
  },

  updateMyService(id: string, payload: UpdateMcpPayload) {
    return http.patch<McpDetailItem>('/mcp/my-services/' + id, payload)
  },

  resyncMyService(id: string) {
    return http.post<McpDetailItem>('/mcp/my-services/' + id + '/resync')
  },

  deleteMyService(id: string) {
    return http.delete<{ id: string; serviceKey: string }>('/mcp/my-services/' + id)
  }
}
