<template>
  <span>{{ label }}</span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { SkillSource } from '../../types/skill'

const props = defineProps<{ source?: SkillSource }>()
const label = computed(() => {
  if (props.source?.type === 'zip') return 'ZIP 上传'
  if (props.source?.type === 'builtin') return '平台内置'
  return '未知来源'
})
</script>
