<script setup lang="ts">
import { CircleX, LockKeyhole } from '@lucide/vue';

defineProps<{ message: string; auth?: boolean }>();
</script>

<template>
  <div class="notice notice-error" role="alert">
    <LockKeyhole v-if="auth" aria-hidden="true" />
    <CircleX v-else aria-hidden="true" />
    <div>
      <div>{{ message }}</div>
      <div v-if="auth" class="muted">登入後重新整理這個頁面。</div>
      <slot />
    </div>
  </div>
</template>
