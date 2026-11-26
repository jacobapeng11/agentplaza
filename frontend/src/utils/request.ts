import axios, { AxiosResponse, AxiosError, InternalAxiosRequestConfig } from 'axios';
import { ElMessage, ElLoading } from 'element-plus';
import { buildLoginUrl, clearAuthSession } from './loginRedirect.ts';
import { logger } from './logger';
import { reuseStartupPreload } from './startupPreload';

// 创建 axios 实例
const request = axios.create({
  baseURL: '/api', // 基础路径
  timeout: 150000, // 请求超时时间
  headers: {
    'Content-Type': 'application/json;charset=UTF-8'
  }
});

// 请求加载实例
let loadingInstance: any = null;
let requestCount = 0;

// 显示加载
const showLoading = () => {
  if (requestCount === 0 && !loadingInstance) {
    loadingInstance = ElLoading.service({
      text: '加载中...',
      background: 'rgba(0, 0, 0, 0.7)',
      spinner: 'el-icon-loading'
    });
  }
  requestCount++;
};

// 隐藏加载
const hideLoading = () => {
  requestCount--;
  if (requestCount <= 0) {
    requestCount = 0;
    if (loadingInstance) {
      loadingInstance.close();
      loadingInstance = null;
    }
  }
};

// 请求拦截器
request.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    // 显示加载效果（可根据需要开启）
    // showLoading();
    
    // 避免对登录接口添加认证头 (only /api/login endpoint)
    if (config.url !== '/login') {
      // 添加认证 token
      const token = localStorage.getItem('token');
      if (token && config.headers) {
        config.headers.Authorization = `Bearer ${token}`;
        config.headers.AuthToken = token; // Add AuthToken header as required
      }
    }
    
    // 添加用户 ID（如果存在）
    const userId = localStorage.getItem('userId');
    if (userId && config.headers) {
      config.headers['X-User-ID'] = userId;
    }
    
    logger.debug('请求拦截器 - 发送请求:', {
      url: config.url,
      method: config.method
    });
    
    reuseStartupPreload(config);
    return config;
  },
  (error: AxiosError) => {
    hideLoading();
    logger.error('请求拦截器 - 请求错误:', error.code);
    ElMessage.error('请求配置错误！');
    return Promise.reject(error);
  }
);

// 响应拦截器
request.interceptors.response.use(
  (response: AxiosResponse) => {
    hideLoading();
    
    logger.debug('响应拦截器 - 收到响应:', {
      url: response.config.url,
      status: response.status
    });
    
    // 统一处理响应数据格式
    const { data, status } = response;
    
    // 如果响应状态码不是 200，抛出错误
    if (status !== 200) {
      ElMessage.error(`请求失败，状态码: ${status}`);
      return Promise.reject(new Error(`HTTP Error: ${status}`));
    }
    
    // 检查业务状态码
    if (data && typeof data === 'object') {
      // 检查后端返回的 code 字段，兼容不同后端的成功码约定（0 或 200）
      if ('code' in data) {
        if (data.code === 401 && response.config.url !== '/login') {
          // 登录失效，清除认证信息并跳转到登录（静默处理，不显示错误提示）
          clearAuthSession();
          window.location.href = buildLoginUrl();
          return Promise.reject(new Error('Authentication required'));
        } else if (data.code === 302) {
          // 处理重定向响应，跳转到指定地址
          if (data.data && data.data.redirectUrl) {
            ElMessage.warning('用户未注册，正在跳转...');
            window.location.href = data.data.redirectUrl;
            return Promise.reject(new Error('User not found, redirecting to registration'));
          } else {
            ElMessage.error('重定向地址未找到');
            return Promise.reject(new Error('Redirect URL not found'));
          }
        } else if (data.code !== 0 && data.code !== 200 && data.code !== 401) {
          // 排除 401，避免重复提示错误
          const errorMessage = data.message || data.msg || '请求失败';
          ElMessage.error(errorMessage);
          return Promise.reject(new Error(errorMessage));
        }
      }
      // 保持向后兼容：如果后端返回的数据有 success 字段
      else if ('success' in data) {
        if (data.success === false) {
          // 优先展示 detail.message（苍穹接口具体原因），其次 message，最后兜底
          const detailMsg = (data as any).detail?.message;
          const errorMessage = detailMsg || data.message || '请求失败';
          const displayMsg = detailMsg ? `${data.message || '操作失败'}：${detailMsg}` : errorMessage;
          ElMessage.error(displayMsg);
          return Promise.reject(new Error(displayMsg));
        }
      }
      
      // 成功时直接返回 response，让调用方通过 response.data 访问数据
      return response.data;
    }
    
    // 默认情况下直接返回 response
    return response.data;
  },
  (error: AxiosError) => {
    hideLoading();
    
    logger.error('响应拦截器 - 响应错误:', { code: error.code, status: error.response?.status });
    
    // 处理不同类型的错误
    if (error.response) {
      // 服务器响应了错误状态码
      const { status, data } = error.response;

      if (status === 401 && error.config?.url !== '/login') {
        // 登录失效，静默处理
        clearAuthSession();
        window.location.href = buildLoginUrl();
      } else if (data && typeof data === 'object') {
        // 优先展示业务错误：detail.message（苍穹具体原因） > message（顶层摘要） > HTTP 通用文案
        const detailMsg = (data as any).detail?.message as string | undefined;
        const bodyMsg   = (data as any).message as string | undefined;
        if (detailMsg || bodyMsg) {
          const displayMsg = detailMsg ? `${bodyMsg || '操作失败'}：${detailMsg}` : bodyMsg!;
          ElMessage.error(displayMsg);
        } else {
          // 没有业务错误信息，使用 HTTP 状态码通用提示
          const statusText: Record<number, string> = {
            400: '请求参数错误', 403: '拒绝访问', 404: '请求的资源不存在',
            500: '服务器内部错误', 502: '网关错误', 503: '服务不可用',
          };
          ElMessage.error(statusText[status] || `请求失败，状态码: ${status}`);
        }
      } else {
        ElMessage.error(`请求失败，状态码: ${status}`);
      }
    } else if (error.request) {
      // 请求已发出但没有收到响应
      ElMessage.error('网络连接失败，请检查网络设置');
    } else {
      // 其他错误（排除 401 认证错误）
      if (error.message !== 'Authentication required') {
        ElMessage.error('请求失败：' + error.message);
      }
    }
    
    return Promise.reject(error);
  }
);

// 封装常用的请求方法
export const http = {
  get<T = any>(url: string, params?: any): Promise<AxiosResponse<T>> {
    return request.get(url, { params });
  },
  
  post<T = any>(url: string, data?: any): Promise<AxiosResponse<T>> {
    return request.post(url, data);
  },
  
  put<T = any>(url: string, data?: any): Promise<AxiosResponse<T>> {
    return request.put(url, data);
  },
  
  delete<T = any>(url: string, params?: any): Promise<AxiosResponse<T>> {
    return request.delete(url, { params });
  },
  
  patch<T = any>(url: string, data?: any): Promise<AxiosResponse<T>> {
    return request.patch(url, data);
  }
};

// 导出 axios 实例（用于特殊场景）
export default request;
