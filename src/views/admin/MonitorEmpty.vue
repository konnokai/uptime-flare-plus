<script setup lang="ts">
import { Activity } from '@lucide/vue';
</script>

<template>
  <div class="empty">
    <Activity aria-hidden="true" />
    <p>從左側選一個監測項目，查看延遲、可用率和事件紀錄。</p>
  </div>
</template>

<style scoped>
.empty {
  display: grid;
  justify-items: center;
  gap: 10px;
  margin-top: 64px;
  padding: 40px 24px;
  color: var(--ink-3);
  text-align: center;
}

.empty svg {
  width: 28px;
  height: 28px;
}
</style>
