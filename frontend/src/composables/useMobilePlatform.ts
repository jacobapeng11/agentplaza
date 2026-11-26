import { useMediaQuery } from '@vueuse/core'

/**
 * 判断当前是否处于移动端视图
 * 断点设定在 768px 及以下，与常见设备和规范相符
 */
export function useMobilePlatform() {
  const isMobile = useMediaQuery('(max-width: 768px)')
  return {
    isMobile
  }
}