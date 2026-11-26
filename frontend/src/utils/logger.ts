import { getAppConfigValue, type RuntimeAppConfig } from '../config/runtimeConfig'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<LogLevel, number> = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
})
const DEFAULT_LEVEL: LogLevel = 'info'
const SENSITIVE_KEY_PATTERN = /(secret|token|api[-_]?key|apikey|authorization|authtoken|ciphertext|password|client[-_]?secret)/i

/**
 * 规范化前端日志级别。
 * 输入: 运行时或构建时配置中的日志级别。
 * 输出: 合法日志级别；非法或缺失时返回 info。
 */
export function normalizeLogLevel(level: unknown): LogLevel {
  const normalized = String(level || '').trim().toLowerCase()
  return Object.prototype.hasOwnProperty.call(LEVEL_ORDER, normalized)
    ? normalized as LogLevel
    : DEFAULT_LEVEL
}

/**
 * 读取当前前端日志级别。
 * 输入: 可选 Vite 环境变量对象。
 * 输出: window.__APP_CONFIG__.LOG_LEVEL 优先，其次 VITE_LOG_LEVEL，最终回落 info。
 */
export function getCurrentLogLevel(viteEnv: RuntimeAppConfig = (import.meta as any).env || {}): LogLevel {
  const runtimeLevel = getAppConfigValue('LOG_LEVEL', viteEnv)
  const viteLevel = getAppConfigValue('VITE_LOG_LEVEL', viteEnv)
  return normalizeLogLevel(runtimeLevel || viteLevel)
}

/**
 * 判断目标日志级别是否应该输出。
 * 输入: 目标日志级别和当前配置级别。
 * 输出: 当前配置允许输出时返回 true。
 */
export function shouldLog(messageLevel: LogLevel, configuredLevel = getCurrentLogLevel()): boolean {
  return LEVEL_ORDER[messageLevel] >= LEVEL_ORDER[normalizeLogLevel(configuredLevel)]
}

/**
 * 递归脱敏日志参数中的敏感字段。
 * 输入: 任意日志参数和值对象。
 * 输出: 保留结构但替换敏感字段后的安全值。
 */
export function redactSensitivePayload(value: unknown, seen = new WeakSet<object>()): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitivePayload(item, seen))
  }

  if (value && typeof value === 'object') {
    if (seen.has(value)) {
      return '[Circular]'
    }
    seen.add(value)

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, fieldValue]) => [
        key,
        SENSITIVE_KEY_PATTERN.test(key) ? '[REDACTED]' : redactSensitivePayload(fieldValue, seen)
      ])
    )
  }

  if (typeof value === 'string') {
    return value
      .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
      .replace(/(api[-_]?key|secret|token|password|client[-_]?secret)\s*[:=]\s*[^,\s]+/gi, '$1=[REDACTED]')
  }

  return value
}

/**
 * 脱敏一组日志参数。
 * 输入: console 方法的原始参数。
 * 输出: 可安全输出到浏览器控制台的参数。
 */
function redactArgs(args: unknown[]): unknown[] {
  return args.map((arg) => redactSensitivePayload(arg))
}

/**
 * 创建浏览器日志器。
 * 输入: console 兼容对象，便于测试注入。
 * 输出: debug/info/warn/error/getLevel/shouldLog 方法集合。
 */
export function createFrontendLogger(consoleRef: Pick<Console, 'debug' | 'info' | 'warn' | 'error'> = console) {
  return {
    debug: (...args: unknown[]) => {
      if (shouldLog('debug')) {
        consoleRef.debug(...redactArgs(args))
      }
    },
    info: (...args: unknown[]) => {
      if (shouldLog('info')) {
        consoleRef.info(...redactArgs(args))
      }
    },
    warn: (...args: unknown[]) => {
      if (shouldLog('warn')) {
        consoleRef.warn(...redactArgs(args))
      }
    },
    error: (...args: unknown[]) => {
      if (shouldLog('error')) {
        consoleRef.error(...redactArgs(args))
      }
    },
    getLevel: getCurrentLogLevel,
    shouldLog
  }
}

export const logger = createFrontendLogger()
export default logger
