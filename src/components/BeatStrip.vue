<script setup lang="ts">
import { computed } from 'vue';
import type { Status } from '../../shared/types';
import { formatDateTime, formatLatency } from '../format';
import { statusClass, statusLabel } from '../status';

interface Beat {
  ts: number;
  status: Status;
  latencyMs: number | null;
  msg: string;
}

const props = withDefaults(
  defineProps<{
    beats: Beat[];
    /** 固定格數，不足的在左側補空格，讓每列寬度一致 */
    slots?: number;
    timeZone?: string;
    height?: number;
  }>(),
  { slots: 30, height: 18 },
);

const cells = computed(() => {
  const list = props.beats.slice(-props.slots);
  const pad = Math.max(0, props.slots - list.length);
  return { pad, list };
});

const summary = computed(() => {
  const list = cells.value.list;
  if (!list.length) return '尚無心跳';
  const down = list.filter((b) => b.status === 0).length;
  return `最近 ${list.length} 次心跳，${down} 次中斷`;
});

function title(b: Beat) {
  const parts = [formatDateTime(b.ts, props.timeZone, true), statusLabel(b.status)];
  if (b.latencyMs != null) parts.push(formatLatency(b.latencyMs));
  if (b.msg) parts.push(b.msg);
  return parts.join(' · ');
}
</script>

<template>
  <div class="strip" role="img" :aria-label="summary" :style="{ height: `${height}px` }">
    <span v-for="i in cells.pad" :key="`p${i}`" class="beat empty" />
    <span v-for="(b, i) in cells.list" :key="`${b.ts}-${i}`" class="beat" :class="statusClass(b.status)" :title="title(b)" />
  </div>
</template>

<style scoped>
.strip {
  display: flex;
  gap: 2px;
  min-width: 0;
}

.beat {
  flex: 1 1 0;
  min-width: 2px;
  max-width: 8px;
  border-radius: 1px;
  background: var(--s-bar);
}

.beat.empty {
  background: var(--none-bar);
  opacity: 0.5;
}
</style>
