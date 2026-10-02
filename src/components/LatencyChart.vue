<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { Heartbeat } from '../../shared/types';
import { formatDateTime, formatLatency, formatTime } from '../format';
import { statusLabel } from '../status';

const props = withDefaults(
  defineProps<{
    beats: Heartbeat[];
    timeZone?: string;
    height?: number;
  }>(),
  { height: 200 },
);

const wrap = ref<HTMLDivElement | null>(null);
const width = ref(600);
let ro: ResizeObserver | undefined;

onMounted(() => {
  if (!wrap.value) return;
  width.value = wrap.value.clientWidth || 600;
  ro = new ResizeObserver((entries) => {
    const w = entries[0]?.contentRect.width;
    if (w) width.value = Math.round(w);
  });
  ro.observe(wrap.value);
});

onBeforeUnmount(() => ro?.disconnect());

const PAD = { top: 12, right: 8, bottom: 24, left: 52 };

function niceCeil(v: number): number {
  if (v <= 0) return 100;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / exp;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * exp;
}

const sorted = computed(() => [...props.beats].sort((a, b) => a.ts - b.ts));

const geo = computed(() => {
  const list = sorted.value;
  const w = Math.max(100, width.value - PAD.left - PAD.right);
  const h = props.height - PAD.top - PAD.bottom;
  const t0 = list[0]?.ts ?? 0;
  const t1 = list[list.length - 1]?.ts ?? 1;
  const span = Math.max(1, t1 - t0);
  const maxLat = Math.max(0, ...list.map((b) => b.latencyMs ?? 0));
  const yMax = niceCeil(maxLat * 1.1);
  const x = (ts: number) => PAD.left + (list.length === 1 ? w / 2 : ((ts - t0) / span) * w);
  const y = (lat: number) => PAD.top + h - (lat / yMax) * h;

  // 中斷或沒有延遲的點會切斷線條，讓斷線本身就是訊號
  let line = '';
  let area = '';
  let seg: { x: number; y: number }[] = [];
  const flush = () => {
    if (!seg.length) return;
    line += seg.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('');
    const base = (PAD.top + h).toFixed(1);
    area +=
      `M${seg[0]!.x.toFixed(1)},${base}` +
      seg.map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('') +
      `L${seg[seg.length - 1]!.x.toFixed(1)},${base}Z`;
    seg = [];
  };
  for (const b of list) {
    if (b.latencyMs == null || b.status === 0) {
      flush();
      continue;
    }
    seg.push({ x: x(b.ts), y: y(b.latencyMs) });
  }
  flush();

  const band = Math.max(2, w / Math.max(list.length, 1));
  const marks = list
    .map((b) => ({ b, x: x(b.ts) }))
    .filter(({ b }) => b.status === 0 || b.status === 3);
  const pending = list.filter((b) => b.status === 2 && b.latencyMs != null).map((b) => ({ x: x(b.ts), y: y(b.latencyMs!) }));

  const ticks = [0, yMax / 2, yMax].map((v) => ({ v, y: y(v) }));
  const xTicks =
    list.length > 1
      ? [list[0]!, list[Math.floor(list.length / 2)]!, list[list.length - 1]!].map((b, i) => ({
          x: x(b.ts),
          label: formatTime(b.ts, props.timeZone).slice(0, 5),
          anchor: i === 0 ? 'start' : i === 2 ? 'end' : 'middle',
        }))
      : [];

  return { w, h, x, line, area, band, marks, pending, ticks, xTicks, base: PAD.top + h };
});

const hover = ref<number | null>(null);

function onMove(e: PointerEvent) {
  const svg = e.currentTarget as SVGSVGElement;
  const rect = svg.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const list = sorted.value;
  if (!list.length) return;
  let best = 0;
  let bestD = Infinity;
  list.forEach((b, i) => {
    const d = Math.abs(geo.value.x(b.ts) - px);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  hover.value = best;
}

const hoverInfo = computed(() => {
  if (hover.value == null) return null;
  const b = sorted.value[hover.value];
  if (!b) return null;
  const x = geo.value.x(b.ts);
  return {
    x,
    left: Math.min(Math.max(x, 90), width.value - 90),
    time: formatDateTime(b.ts, props.timeZone, true),
    status: statusLabel(b.status),
    latency: formatLatency(b.latencyMs),
    msg: b.msg,
    cls: b.status === 0 ? 's-down' : b.status === 2 ? 's-pending' : b.status === 3 ? 's-maint' : 's-up',
  };
});

const summary = computed(() => {
  const lats = sorted.value.map((b) => b.latencyMs).filter((v): v is number => v != null);
  if (!lats.length) return '延遲圖：尚無資料';
  const avg = lats.reduce((a, b) => a + b, 0) / lats.length;
  return `延遲圖：最近 ${sorted.value.length} 次心跳，平均 ${formatLatency(avg)}，最高 ${formatLatency(Math.max(...lats))}`;
});
</script>

<template>
  <div ref="wrap" class="chart">
    <p v-if="!sorted.length" class="empty faint">尚無心跳資料</p>
    <template v-else>
      <svg
        :width="width"
        :height="height"
        role="img"
        :aria-label="summary"
        @pointermove="onMove"
        @pointerdown="onMove"
        @pointerleave="hover = null"
      >
        <g class="grid">
          <line
            v-for="t in geo.ticks"
            :key="t.v"
            :x1="PAD.left"
            :x2="PAD.left + geo.w"
            :y1="t.y"
            :y2="t.y"
          />
        </g>
        <g class="ylabels">
          <text v-for="t in geo.ticks" :key="t.v" :x="PAD.left - 8" :y="t.y" dy="0.32em" text-anchor="end">
            {{ formatLatency(t.v) }}
          </text>
        </g>
        <g class="xlabels">
          <text v-for="t in geo.xTicks" :key="t.x" :x="t.x" :y="height - 6" :text-anchor="t.anchor">
            {{ t.label }}
          </text>
        </g>
        <g>
          <rect
            v-for="(m, i) in geo.marks"
            :key="i"
            :class="m.b.status === 0 ? 'mark-down' : 'mark-maint'"
            :x="m.x - geo.band / 2"
            :y="PAD.top"
            :width="geo.band"
            :height="geo.h"
          />
        </g>
        <path class="area" :d="geo.area" />
        <path class="line" :d="geo.line" />
        <circle v-for="(p, i) in geo.pending" :key="i" class="pending" :cx="p.x" :cy="p.y" r="3" />
        <line
          v-if="hoverInfo"
          class="guide"
          :x1="hoverInfo.x"
          :x2="hoverInfo.x"
          :y1="PAD.top"
          :y2="geo.base"
        />
      </svg>
      <div v-if="hoverInfo" class="tip" :style="{ left: `${hoverInfo.left}px` }">
        <div class="tip-time num">{{ hoverInfo.time }}</div>
        <div>
          <span :class="hoverInfo.cls" class="tip-status">{{ hoverInfo.status }}</span>
          <span class="num"> · {{ hoverInfo.latency }}</span>
        </div>
        <div v-if="hoverInfo.msg" class="tip-msg">{{ hoverInfo.msg }}</div>
      </div>
      <ul class="legend" aria-hidden="true">
        <li><span class="key key-line" />延遲</li>
        <li><span class="key key-down" />中斷</li>
        <li><span class="key key-pending" />待確認</li>
        <li><span class="key key-maint" />維護</li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.chart {
  position: relative;
  min-width: 0;
}

svg {
  display: block;
  touch-action: pan-y;
}

.empty {
  padding: 32px 0;
  text-align: center;
  font-size: var(--fs-sm);
}

.grid line {
  stroke: var(--line);
  stroke-width: 1;
}

.ylabels text,
.xlabels text {
  fill: var(--ink-3);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.area {
  fill: color-mix(in srgb, var(--up-bar) 14%, transparent);
}

.line {
  fill: none;
  stroke: var(--up-bar);
  stroke-width: 1.75;
  stroke-linejoin: round;
}

.mark-down {
  fill: color-mix(in srgb, var(--down-bar) 35%, transparent);
}

.mark-maint {
  fill: color-mix(in srgb, var(--maint-bar) 25%, transparent);
}

.pending {
  fill: var(--pending-bar);
  stroke: var(--surface);
  stroke-width: 1.5;
}

.guide {
  stroke: var(--ink-3);
  stroke-dasharray: 3 3;
}

.tip {
  position: absolute;
  top: 0;
  z-index: 2;
  max-width: 220px;
  padding: 6px 9px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  font-size: var(--fs-xs);
  line-height: 1.45;
  transform: translateX(-50%);
  pointer-events: none;
  box-shadow: 0 4px 12px -6px rgb(0 0 0 / 0.25);
}

.tip-time {
  color: var(--ink-2);
}

.tip-status {
  color: var(--s);
  font-weight: 600;
}

.tip-msg {
  color: var(--ink-2);
  overflow-wrap: anywhere;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin: 6px 0 0;
  padding: 0 0 0 52px;
  list-style: none;
  font-size: var(--fs-xs);
  color: var(--ink-3);
}

.legend li {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.key {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
}

.key-line {
  height: 2px;
  background: var(--up-bar);
}

.key-down {
  background: color-mix(in srgb, var(--down-bar) 55%, transparent);
}

.key-pending {
  border-radius: 50%;
  background: var(--pending-bar);
}

.key-maint {
  background: color-mix(in srgb, var(--maint-bar) 40%, transparent);
}
</style>
