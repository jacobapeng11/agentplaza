<template>
  <div class="tag-selector">
    <el-select
      v-model="selectedTags"
      multiple
      collapse-tags
      collapse-tags-tooltip
      :max-collapse-tags="3"
      placeholder="请选择标签（最多3个）"
      class="tag-select"
    >
      <template v-for="dimension in tagDimensions" :key="dimension.name">
        <el-option-group :label="getDimensionLabel(dimension)">
          <el-option
            v-for="tag in dimension.tags"
            :key="tag"
            :label="tag"
            :value="tag"
            :disabled="isTagDisabled(tag)"
          />
        </el-option-group>
      </template>
    </el-select>
    
    <div class="tag-rules" v-if="!isValid">
      <el-alert
        :title="validationMessage"
        type="warning"
        :closable="false"
        show-icon
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';

interface Props {
  modelValue: string[];
  maxTags?: number;
}

interface Emits {
  (e: 'update:modelValue', value: string[]): void;
}

const props = withDefaults(defineProps<Props>(), {
  maxTags: 3
});

const emit = defineEmits<Emits>();

// 三维度标签体系
const tagDimensions = [
  {
    name: '核心功能',
    desc: '必选至少1个',
    required: true,
    tags: ['效率工具', '内容生成', '信息处理', '问题解答', '创意辅助', '对话交流', '任务执行', '知识学习']
  },
  {
    name: '风险提示',
    desc: '可选',
    required: false,
    tags: ['高耗资源', '含敏感信息', '外部模型']
  },
  {
    name: '运营标签',
    desc: '可选',
    required: false,
    tags: ['活动专属', '公测邀请', '内测中']
  }
];

const selectedTags = ref<string[]>(props.modelValue || []);

// 监听外部变化
watch(() => props.modelValue, (newVal) => {
  selectedTags.value = newVal || [];
});

// 监听内部变化并触发更新
watch(selectedTags, (newVal) => {
  emit('update:modelValue', newVal);
});

// 获取维度标签（带必选标识和描述）
const getDimensionLabel = (dimension: any) => {
  const requiredMark = dimension.required ? ' *' : '';
  return `${dimension.name}${requiredMark} - ${dimension.desc}`;
};

// 判断标签是否应该禁用
const isTagDisabled = (tag: string) => {
  // 如果已达到最大数量限制，且该标签未被选中，则禁用
  return selectedTags.value.length >= props.maxTags && !selectedTags.value.includes(tag);
};

// 移除标签
const removeTag = (tag: string) => {
  const index = selectedTags.value.indexOf(tag);
  if (index > -1) {
    selectedTags.value.splice(index, 1);
  }
};
// 获取标签类型（用于显示不同颜色）
const getTagType = (tag: string) => {
  const coreFunctionTags = ['效率工具', '内容生成', '信息处理', '问题解答', '创意辅助', '对话交流', '任务执行', '知识学习'];
  const riskTags = ['高耗资源', '含敏感信息', '外部模型'];
  const operationTags = ['活动专属', '公测邀请', '内测中'];
  
  if (coreFunctionTags.includes(tag)) return 'primary';
  if (riskTags.includes(tag)) return 'danger';
  if (operationTags.includes(tag)) return 'success';
  return '';
};

// 验证标签选择
const isValid = computed(() => {
  // 规则1：最多3个标签
  if (selectedTags.value.length > props.maxTags) {
    return false;
  }
  
  // 规则2：必须包含至少1个核心功能标签
  const coreFunctionTags = ['效率工具', '内容生成', '信息处理', '问题解答', '创意辅助', '对话交流', '任务执行', '知识学习'];
  const hasCoreFunctionTag = selectedTags.value.some(tag => coreFunctionTags.includes(tag));
  if (selectedTags.value.length > 0 && !hasCoreFunctionTag) {
    return false;
  }
  
  return true;
});

const validationMessage = computed(() => {
  if (selectedTags.value.length > props.maxTags) {
    return `最多只能选择 ${props.maxTags} 个标签`;
  }
  
  const coreFunctionTags = ['效率工具', '内容生成', '信息处理', '问题解答', '创意辅助', '对话交流', '任务执行', '知识学习'];
  const hasCoreFunctionTag = selectedTags.value.some(tag => coreFunctionTags.includes(tag));
  if (selectedTags.value.length > 0 && !hasCoreFunctionTag) {
    return '必须包含至少 1 个核心功能标签';
  }
  
  return '';
});

// 暴露验证方法给父组件
defineExpose({
  isValid,
  validationMessage
});
</script>

<script lang="ts">
// 确保组件可以被正确导入
export default {
  name: 'TagSelector',
}
</script>

<style scoped>
.tag-selector {
  width: 100%;
}

.tag-select {
  width: 100%;
}

.tag-rules {
  margin-top: 12px;
}
</style>
