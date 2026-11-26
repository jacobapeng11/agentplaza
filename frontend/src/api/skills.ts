import request from '../utils/request'
import type { SkillImportJob } from '../types/skill'

interface SkillBatchResult {
  results: Array<{ id: string; success: boolean; message?: string }>
}

export const skillsApi = {
  getCategories: () => request.get('/skills/categories'),
  getOverview: () => request.get('/skills/overview'),
  getSkills: (params: Record<string, unknown>) => request.get('/skills', { params }),
  getDetail: (id: string) => request.get(`/skills/${id}`),
  getVersions: (id: string) => request.get(`/skills/${id}/versions`),
  toggleFavorite: (id: string) => request.post(`/skills/${id}/favorite`),
  setOfficial: (id: string, official: boolean) => request.put(`/skills/${id}/official`, { official }),
  getManagedSkills: (params: { status: string; page: number; limit: number; search?: string }) =>
    request.get('/skills/admin', { params }),
  getSubmission: (id: string) => request.get(`/skills/admin/submissions/${encodeURIComponent(id)}`),
  downloadSubmissionArchive: (id: string) => request.get(`/skills/admin/submissions/${encodeURIComponent(id)}/download`, { responseType: 'blob' }),
  reviewSubmission: (id: string, review: { decision: 'approve'; category: string; official: boolean } | { decision: 'reject' }) =>
    request.put(`/skills/admin/submissions/${encodeURIComponent(id)}/review`, review),
  reviewSubmissions: (ids: string[], review: { decision: 'approve'; category: string; official?: true } | { decision: 'reject' }) =>
    request.put<SkillBatchResult>('/skills/admin/submissions/batch-review', { ids, ...review }),
  setCategories: (ids: string[], category: string) => request.put<SkillBatchResult>('/skills/admin/batch/category', { ids, category }),
  setCategory: (id: string, category: string) => request.put(`/skills/admin/${id}/category`, { category }),
  setStatus: (id: string, status: 'published' | 'offline') => request.put(`/skills/admin/${id}/status`, { status }),
  downloadSkill: (id: string) => request.get(`/skills/${id}/download`, { responseType: 'blob', timeout: 150000 }),
  uploadSkill: (formData: FormData) => request.post('/skills/import/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 150000
  }),
  getImportJob: (jobId: string) => request.get(`/skills/import/jobs/${jobId}`, { timeout: 10000 }),
  submitImportJob: (jobId: string, selections: Array<Record<string, unknown>>) => request.post(`/skills/import/jobs/${jobId}/submit`, { selections })
}

export default skillsApi
