/**
 * API 错误处理工具
 * 统一的错误拦截和友好提示
 */

import { ElMessage, ElMessageBox } from 'element-plus'
import router from '@/router'

export interface ApiError {
  code?: number
  message: string
  details?: any
}

/**
 * HTTP 状态码映射
 */
const HTTP_STATUS_MESSAGES: Record<number, string> = {
  400: '请求参数错误',
  401: '未授权，请重新登录',
  403: '没有权限访问此资源',
  404: '请求的资源不存在',
  408: '请求超时',
  409: '数据冲突',
  500: '服务器内部错误',
  502: '网关错误',
  503: '服务暂时不可用',
  504: '网关超时'
}

/**
 * 业务错误码映射
 */
const BUSINESS_ERROR_MESSAGES: Record<string, string> = {
  'INVALID_TOKEN': '登录已过期，请重新登录',
  'PERMISSION_DENIED': '您没有权限执行此操作',
  'RESOURCE_NOT_FOUND': '资源不存在或已被删除',
  'DUPLICATE_ENTRY': '该记录已存在',
  'VALIDATION_ERROR': '数据验证失败',
  'FILE_TOO_LARGE': '文件大小超过限制',
  'INVALID_FILE_TYPE': '不支持的文件类型',
  'NETWORK_ERROR': '网络连接失败，请检查网络'
}

/**
 * 处理 API 错误
 * @param error - Axios错误对象
 * @param customHandler - 自定义错误处理函数
 */
export function handleApiError(error: any, customHandler?: (error: ApiError) => boolean): void {
  let apiError: ApiError = {
    message: '未知错误'
  }

  // 网络错误
  if (!error.response) {
    if (error.code === 'ECONNABORTED') {
      apiError.message = '请求超时，请稍后重试'
    } else if (error.message === 'Network Error') {
      apiError.message = BUSINESS_ERROR_MESSAGES['NETWORK_ERROR']
    } else {
      apiError.message = error.message || '网络连接失败'
    }
  } else {
    // HTTP 错误
    const status = error.response.status
    const data = error.response.data

    apiError.code = status
    apiError.message = data?.message || HTTP_STATUS_MESSAGES[status] || `请求失败 (${status})`
    apiError.details = data?.details || data

    // 特殊状态码处理
    if (status === 401) {
      handleUnauthorized()
      return
    }

    if (status === 403) {
      handleForbidden(apiError.message)
      return
    }
  }

  // 调用自定义处理器
  if (customHandler && customHandler(apiError)) {
    return
  }

  // 默认错误提示
  ElMessage.error(apiError.message)
}

/**
 * 处理未授权错误 (401)
 */
function handleUnauthorized(): void {
  ElMessageBox.confirm(
    '登录已过期，请重新登录',
    '提示',
    {
      confirmButtonText: '重新登录',
      cancelButtonText: '取消',
      type: 'warning'
    }
  ).then(() => {
    // 清除本地存储的 token
    localStorage.removeItem('token')
    sessionStorage.removeItem('token')
    
    // 跳转到登录页
    router.push('/login')
  }).catch(() => {
    // 用户取消
  })
}

/**
 * 处理禁止访问错误 (403)
 */
function handleForbidden(message: string): void {
  ElMessage.error({
    message: message || '您没有权限访问此资源',
    duration: 3000
  })
}

/**
 * 处理验证错误
 */
export function handleValidationError(error: any): string[] {
  const errors: string[] = []
  
  if (error.response?.data?.details) {
    const details = error.response.data.details
    
    if (Array.isArray(details)) {
      errors.push(...details.map((d: any) => d.message || d))
    } else if (typeof details === 'object') {
      Object.values(details).forEach((value: any) => {
        if (typeof value === 'string') {
          errors.push(value)
        } else if (Array.isArray(value)) {
          errors.push(...value)
        }
      })
    } else {
      errors.push(String(details))
    }
  }
  
  return errors.length > 0 ? errors : [error.response?.data?.message || '验证失败']
}

/**
 * 显示加载错误
 */
export function showLoadError(resource: string = '数据'): void {
  ElMessage.error(`加载${resource}失败，请稍后重试`)
}

/**
 * 显示保存错误
 */
export function showSaveError(operation: string = '保存'): void {
  ElMessage.error(`${operation}失败，请检查输入或稍后重试`)
}

/**
 * 显示删除错误
 */
export function showDeleteError(): void {
  ElMessage.error('删除失败，请稍后重试')
}

/**
 * 确认删除对话框
 */
export function confirmDelete(
  itemName: string = '该项',
  callback: () => void | Promise<void>
): void {
  ElMessageBox.confirm(
    `确定要删除${itemName}吗？此操作不可恢复`,
    '删除确认',
    {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
      confirmButtonClass: 'el-button--danger'
    }
  ).then(async () => {
    try {
      await callback()
      ElMessage.success('删除成功')
    } catch (error) {
      handleApiError(error)
    }
  }).catch(() => {
    // 用户取消删除
  })
}

/**
 * 网络超时配置
 */
export const REQUEST_TIMEOUT = {
  DEFAULT: 10000,      // 10秒
  UPLOAD: 60000,       // 60秒（上传文件）
  DOWNLOAD: 120000,    // 120秒（下载文件）
  LONG_POLL: 30000     // 30秒（长轮询）
}

/**
 * 重试配置
 */
export const RETRY_CONFIG = {
  maxRetries: 3,
  retryDelay: 1000,
  retryableStatuses: [408, 429, 500, 502, 503, 504]
}

/**
 * 检查是否应该重试
 */
export function shouldRetry(error: any, retryCount: number): boolean {
  if (retryCount >= RETRY_CONFIG.maxRetries) {
    return false
  }

  const status = error.response?.status
  if (!status) {
    // 网络错误，应该重试
    return true
  }

  return RETRY_CONFIG.retryableStatuses.includes(status)
}

/**
 * 延迟函数
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
