<template>
  <main class="login-page">
    <img src="/logoImg.png" width="52" height="52" alt="">
    <h1>智能体广场</h1>
    <p v-if="route.query.failed" role="alert">登录未完成，请重试。若问题持续，请联系部署管理员。</p>
    <a :href="buildLoginUrl('/')">使用企业账号登录</a>
  </main>
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router';
import { buildLoginUrl } from '../utils/loginRedirect';

const route = useRoute();
</script>

<style scoped>
.login-page {
  display: grid;
  place-content: center;
  justify-items: center;
  min-height: 100dvh;
  padding: 24px;
  text-align: center;
}
.login-page a {
  padding: 12px 20px;
  border-radius: 8px;
  background: #186dc4;
  color: white;
  text-decoration: none;
}
</style>
