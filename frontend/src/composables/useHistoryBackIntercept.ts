import { ref, onMounted, onUnmounted } from 'vue'

/**
 * 封装 History API 拦截返回手势/案件逻辑
 */
export function useHistoryBackIntercept() {
  const isIntercepting = ref(false)
  let _callback: (() => void) | null = null

  const handlePopState = (event: PopStateEvent) => {
    if (isIntercepting.value && _callback) {
      _callback()
      // 注意: 这里不主动 back, 让页面处于正常状态
      _callback = null
      isIntercepting.value = false
    }
  }

  const registerIntercept = (callback: () => void) => {
    if (!isIntercepting.value) {
      window.history.pushState({ modalOpen: true }, '')
      isIntercepting.value = true
      _callback = callback
    }
  }

  const removeIntercept = () => {
    if (isIntercepting.value) {
      _callback = null
      isIntercepting.value = false
      // 如果是我们加的 state, 应该回退以保持 history 栈一致
      if (window.history.state && window.history.state.modalOpen) {
          window.history.back()
      }
    }
  }

  onMounted(() => {
    window.addEventListener('popstate', handlePopState)
  })

  onUnmounted(() => {
    window.removeEventListener('popstate', handlePopState)
    removeIntercept()
  })

  return {
    registerIntercept,
    removeIntercept
  }
}