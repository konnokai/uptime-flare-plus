<script setup lang="ts">
import { ref } from 'vue';
import { Check, Copy } from '@lucide/vue';

const props = withDefaults(defineProps<{ text: string; label?: string }>(), { label: '複製' });

const state = ref<'idle' | 'done' | 'fail'>('idle');
let timer: ReturnType<typeof setTimeout> | undefined;

async function copy() {
  try {
    await navigator.clipboard.writeText(props.text);
    state.value = 'done';
  } catch {
    state.value = 'fail';
  }
  clearTimeout(timer);
  timer = setTimeout(() => (state.value = 'idle'), 1800);
}
</script>

<template>
  <button type="button" class="btn btn-sm" @click="copy">
    <Check v-if="state === 'done'" aria-hidden="true" />
    <Copy v-else aria-hidden="true" />
    <span>{{ state === 'done' ? '已複製' : state === 'fail' ? '複製失敗' : label }}</span>
  </button>
</template>
