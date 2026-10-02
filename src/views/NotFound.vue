<script setup lang="ts">
import { RouterLink } from 'vue-router';
</script>

<template>
  <div class="nf">
    <h1>找不到這個頁面</h1>
    <p class="muted">網址可能打錯了，或頁面已經移除。</p>
    <RouterLink to="/" class="btn">回狀態頁</RouterLink>
  </div>
</template>

<style scoped>
.nf {
  display: grid;
  justify-items: start;
  gap: 12px;
  max-width: 560px;
  margin: 0 auto;
  padding: 80px 24px;
}

h1 {
  font-size: var(--fs-xl);
}
</style>
