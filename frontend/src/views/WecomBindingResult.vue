<template>
  <main class="wecom-binding-result">
    <el-result
      :icon="resultIcon"
      :title="resultTitle"
      :sub-title="resultSubtitle"
    >
      <template #extra>
        <el-button type="primary" @click="router.push({ name: 'Home' })">
          返回智能体广场
        </el-button>
      </template>
    </el-result>
  </main>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAppsStore } from '../stores/apps';

const route = useRoute();
const router = useRouter();
const appsStore = useAppsStore();

const resultStatus = computed(() => appsStore.wecomBindingResult?.status || route.query.status);
const resultIcon = computed(() => (resultStatus.value === 'success' ? 'success' : 'error'));
const resultTitle = computed(() => (resultStatus.value === 'success' ? '企业微信身份认证成功' : '企业微信身份认证失败'));
const resultSubtitle = computed(() => {
  if (appsStore.wecomBindingResult?.status === 'success') {
    const data = appsStore.wecomBindingResult.data;
    return data ? `已绑定工号 ${data.username}，企业微信用户 ${data.wecomUserIdMasked}` : '认证关系已保存';
  }
  if (resultStatus.value === 'success') {
    return '认证关系已保存，可以回到企业微信继续对话';
  }

  return appsStore.wecomBindingResult?.message || '请返回企业微信重新打开认证链接';
});
</script>

<style scoped>
.wecom-binding-result {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f7f8fa;
}
</style>
