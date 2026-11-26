export type RuntimeAppConfigValue = string | number | boolean | null | undefined
export type RuntimeAppConfig = Record<string, RuntimeAppConfigValue>

/**
 * 判断对象是否可作为运行时配置表读取。
 * 输入: 任意全局变量值。
 * 输出: 普通对象返回 true，其它值返回 false。
 */
function isRuntimeAppConfig(value: unknown): value is RuntimeAppConfig {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

/**
 * 判断配置值是否显式可用。
 * 输入: 运行时配置或构建时环境变量中的值。
 * 输出: 非空字符串、数字和布尔值返回 true；空字符串、null、undefined 返回 false。
 */
function isConfiguredValue(value: RuntimeAppConfigValue): boolean {
  if (value === undefined || value === null) {
    return false
  }

  return typeof value !== 'string' || value.trim() !== ''
}

/**
 * 读取浏览器运行时配置。
 * 输入: 无；内部读取 window.__APP_CONFIG__ 或 globalThis.__APP_CONFIG__。
 * 输出: K8s ConfigMap 注入的配置对象；未注入时返回空对象。
 */
export function getRuntimeAppConfig(): RuntimeAppConfig {
  const runtimeGlobal = globalThis as typeof globalThis & {
    __APP_CONFIG__?: unknown
    window?: {
      __APP_CONFIG__?: unknown
    }
  }
  const windowConfig = runtimeGlobal.window?.__APP_CONFIG__
  if (isRuntimeAppConfig(windowConfig)) {
    return windowConfig
  }

  const globalConfig = runtimeGlobal.__APP_CONFIG__
  return isRuntimeAppConfig(globalConfig) ? globalConfig : {}
}

/**
 * 按优先级读取前端配置值。
 * 输入: 配置键名和 Vite 构建时环境变量对象。
 * 输出: window.__APP_CONFIG__ 中的非空值优先，其次返回 Vite env 中的值。
 */
export function getAppConfigValue(
  key: string,
  viteEnv: RuntimeAppConfig = (import.meta as any).env || {}
): RuntimeAppConfigValue {
  const runtimeValue = getRuntimeAppConfig()[key]
  if (isConfiguredValue(runtimeValue)) {
    return runtimeValue
  }

  return viteEnv[key]
}
