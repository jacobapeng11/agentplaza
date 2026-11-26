<template>
  <el-dialog
    v-bind="$attrs"
    :visible="visible"
    :custom-class="{ 'mobile-fullscreen-dialog': isMobile }"
    :fullscreen="isMobile"
    @close="handleClose"
  >
    <template #title v-if="$slots.title">
      <slot name="title"></slot>
    </template>
    
    <slot></slot>

    <template #footer v-if="$slots.footer">
      <slot name="footer"></slot>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { watch } from 'vue'
import { useMobilePlatform } from '../../composables/useMobilePlatform'
import { useHistoryBackIntercept } from '../../composables/useHistoryBackIntercept'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:visible', 'close'])

const { isMobile } = useMobilePlatform()
const { registerIntercept, removeIntercept } = useHistoryBackIntercept()

const handleClose = () => {
  removeIntercept()
  emit('update:visible', false)
  emit('close')
}

// 监听弹窗打开状态，绑定系统返回手势
watch(() => props.visible, (newVal) => {
  if (newVal && isMobile.value) {
    registerIntercept(() => {
      handleClose()
    })
  } else {
    removeIntercept()
  }
})
</script>

<style lang="scss">
.mobile-fullscreen-dialog {
  /* 移动端下覆盖 el-dialog 默认边距，使其真正全屏 */
  &.is-fullscreen {
    margin: 0 !important;
    .el-dialog__body {
       padding: 16px; 
       overflow-y: auto;
       -webkit-overflow-scrolling: touch;
       height: calc(100vh - 120px); /* 视头部和底部的实际高度减去 */
    }
  }
}
</style>