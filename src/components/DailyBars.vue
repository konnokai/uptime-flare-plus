<script setup lang="ts">
import { computed, ref } from 'vue';
import type { DailyStat } from '../../shared/types';
import { dayClass, dayUptime, formatLatency, formatPercent } from '../format';

const props = defineProps<{
  daily: DailyStat[];
}>();

const active = ref<number | null>(null);

const summary = computed(() => {
  const withData = props.daily.filter((d) => d.up + d.down > 0);
  const bad = withData.filter((d) => (dayUptime(d) ?? 1) < 0.999).length;
  return `過去 ${props.daily.length} 天，${withData.length} 天有資料，${bad} 天有中斷`;
});

function describe(d: DailyStat): string {
  const u = dayUptime(d);
  if (u == null) return `${d.day} · 無資料`;
  const parts = [d.day, `可用率 ${formatPercent(u)}`];
  if (d.avgLatencyMs != null) parts.push(`平均 ${formatLatency(d.avgLatencyMs)}`);
  if (d.down > 0) parts.push(`${d.down} 次中斷`);
  return parts.join(' · ');
}

const readout = computed(() => {
  if (active.value == null) return null;
  const d = props.daily[active.value];
  return d ? describe(d) : null;
});

function pick(e: Event) {
  const i = (e.target as HTMLElement).dataset.i;
  if (i != null) active.value = Number(i);
}
</script>

<template>
  <div class="daily">
    <div
      class="bars"
      role="img"
      :aria-label="summary"
      @pointerover="pick"
      @pointerdown="pick"
      @pointerleave="active = null"
    >
      <span
        v-for="(d, i) in daily"
        :key="d.day"
        class="bar"
        :class="[dayClass(d), { on: active === i }]"
        :data-i="i"
        :title="describe(d)"
      />
    </div>
    <div class="caption" aria-hidden="true">
      <template v-if="readout">
        <span class="readout num">{{ readout }}</span>
      </template>
      <template v-else>
        <span class="wide">{{ daily.length }} 天前</span>
        <span class="narrow">{{ Math.min(30, daily.length) }} 天前</span>
        <span class="rule" />
        <span>今天</span>
      </template>
    </div>
  </div>
</template>

<style scoped>
.daily {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.bars {
  display: flex;
  gap: 2px;
  height: 30px;
  touch-action: pan-y;
}

.bar {
  flex: 1 1 0;
  min-width: 0;
  border-radius: 1px;
  background: var(--s-bar);
  transition: opacity 120ms;
}

.bars:hover .bar:not(.on) {
  opacity: 0.7;
}

.caption {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 18px;
  font-size: var(--fs-xs);
  color: var(--ink-3);
}

.rule {
  flex: 1;
  height: 1px;
  background: var(--line);
}

.readout {
  color: var(--ink-2);
}

.narrow {
  display: none;
}

/* 窄螢幕只畫最近 30 天，避免橫向捲動 */
@media (max-width: 640px) {
  .bar:nth-last-child(n + 31) {
    display: none;
  }
  .wide {
    display: none;
  }
  .narrow {
    display: inline;
  }
}
</style>
