<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';
import type { Component } from 'vue';
import { CircleCheck, CircleDashed, CircleX, Info, OctagonAlert, TriangleAlert, Wrench } from '@lucide/vue';
import type { Incident, OverallStatus, PublicStatus } from '../../shared/types';
import { api, errorMessage } from '../api';
import { formatDateTime, formatPercent, formatWeekdayDateTime } from '../format';
import { usePolling } from '../polling';
import DailyBars from '../components/DailyBars.vue';
import StatusBadge from '../components/StatusBadge.vue';

const data = shallowRef<PublicStatus | null>(null);
const error = ref('');
const loading = ref(true);
const lastOk = ref<number | null>(null);

async function load() {
  try {
    data.value = await api.get<PublicStatus>('/api/status');
    error.value = '';
    lastOk.value = Date.now();
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}

usePolling(load, 60_000);

const tz = computed(() => data.value?.timezone);

watch(
  () => data.value?.title,
  (t) => {
    if (t) document.title = t;
  },
);

const OVERALL: Record<OverallStatus, { text: string; cls: string; icon: Component }> = {
  up: { text: '所有服務正常', cls: 's-up', icon: CircleCheck },
  degraded: { text: '部分服務異常', cls: 's-pending', icon: TriangleAlert },
  down: { text: '服務中斷', cls: 's-down', icon: OctagonAlert },
  maintenance: { text: '維護中', cls: 's-maint', icon: Wrench },
  unknown: { text: '尚無資料', cls: 's-none', icon: CircleDashed },
};

const overall = computed(() => (data.value ? OVERALL[data.value.overall] : null));

const openIncidents = computed(() =>
  (data.value?.incidents ?? [])
    .filter((i) => i.resolvedAt == null)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt),
);
const resolvedIncidents = computed(() =>
  (data.value?.incidents ?? []).filter((i) => i.resolvedAt != null).sort((a, b) => b.resolvedAt! - a.resolvedAt!),
);
const activeMaint = computed(() => (data.value?.maintenances ?? []).filter((m) => m.inProgress));
const upcomingMaint = computed(() =>
  (data.value?.maintenances ?? [])
    .filter((m) => !m.inProgress)
    .sort((a, b) => (a.window?.start ?? Infinity) - (b.window?.start ?? Infinity)),
);

const monitorCount = computed(() => (data.value?.groups ?? []).reduce((n, g) => n + g.monitors.length, 0));

// marked + DOMPurify 只有在有公告時才載入，讓沒有公告的狀態頁維持輕量
const renderMd = shallowRef<((s: string) => string) | null>(null);
watch(
  () => data.value?.incidents.length ?? 0,
  async (n) => {
    if (n > 0 && !renderMd.value) {
      const mod = await import('../markdown');
      renderMd.value = mod.renderMarkdown;
    }
  },
);

const STYLE: Record<Incident['style'], { cls: string; icon: Component; label: string }> = {
  info: { cls: 'inc-info', icon: Info, label: '公告' },
  warning: { cls: 'inc-warning', icon: TriangleAlert, label: '注意' },
  danger: { cls: 'inc-danger', icon: CircleX, label: '嚴重' },
};
</script>

<template>
  <div class="page">
    <header class="head">
      <h1>{{ data?.title || '服務狀態' }}</h1>
      <p v-if="data?.description" class="muted desc">{{ data.description }}</p>
    </header>

    <main>
      <p v-if="loading && !data" class="state faint">載入中…</p>

      <div v-else-if="error && !data" class="notice notice-error" role="alert">
        <CircleX aria-hidden="true" />
        <div>
          <div>無法取得服務狀態：{{ error }}</div>
          <button type="button" class="btn btn-sm retry" @click="load">重試</button>
        </div>
      </div>

      <template v-if="data && overall">
        <div v-if="error" class="notice notice-warn stale" role="status">
          <TriangleAlert aria-hidden="true" />
          <span>更新失敗，下方是 {{ formatDateTime(lastOk, tz) }} 的資料。</span>
        </div>

        <section class="overall" :class="overall.cls" aria-live="polite">
          <component :is="overall.icon" class="overall-icon" aria-hidden="true" :stroke-width="2.25" />
          <div>
            <h2 class="overall-text">{{ overall.text }}</h2>
            <p class="overall-sub faint num">最後更新 {{ formatDateTime(data.generatedAt, tz) }}</p>
          </div>
        </section>

        <section v-for="m in activeMaint" :key="`m${m.id}`" class="block maint-now s-maint">
          <div class="block-head">
            <Wrench class="block-icon" aria-hidden="true" />
            <h2>{{ m.title }}</h2>
            <span class="block-kind">維護中</span>
          </div>
          <p v-if="m.description" class="block-text">{{ m.description }}</p>
          <p class="block-meta faint num">
            <template v-if="m.window">開始 {{ formatDateTime(m.window.start, tz) }} · </template>
            {{ m.window?.end ? `預計結束 ${formatDateTime(m.window.end, tz)}` : '結束時間未定' }}
          </p>
        </section>

        <section
          v-for="inc in openIncidents"
          :key="`i${inc.id}`"
          class="block"
          :class="STYLE[inc.style].cls"
        >
          <div class="block-head">
            <component :is="STYLE[inc.style].icon" class="block-icon" aria-hidden="true" />
            <h2>{{ inc.title }}</h2>
            <span class="block-kind">{{ STYLE[inc.style].label }}{{ inc.pinned ? ' · 置頂' : '' }}</span>
          </div>
          <div v-if="renderMd" class="block-text prose" v-html="renderMd(inc.content)" />
          <p v-else class="block-text pre">{{ inc.content }}</p>
          <p class="block-meta faint num">
            發布 {{ formatDateTime(inc.createdAt, tz) }}
            <template v-if="inc.updatedAt > inc.createdAt + 60_000"> · 更新 {{ formatDateTime(inc.updatedAt, tz) }}</template>
          </p>
        </section>

        <section v-if="upcomingMaint.length" class="upcoming">
          <h2 class="section-title">即將維護</h2>
          <ul class="upcoming-list">
            <li v-for="m in upcomingMaint" :key="m.id">
              <div class="upcoming-when num">
                <template v-if="m.window">{{ formatWeekdayDateTime(m.window.start, tz) }}</template>
                <template v-else>時間未定</template>
              </div>
              <div>
                <div class="upcoming-title">{{ m.title }}</div>
                <p v-if="m.description" class="muted small">{{ m.description }}</p>
                <p class="faint small num">
                  {{ m.window?.end ? `預計結束 ${formatDateTime(m.window.end, tz)}` : '結束時間未定' }}
                </p>
              </div>
            </li>
          </ul>
        </section>

        <p v-if="!monitorCount" class="state faint">目前沒有公開的監測項目。</p>

        <section v-for="(g, gi) in data.groups" :key="gi" class="group">
          <h2 v-if="g.name" class="section-title">{{ g.name }}</h2>
          <ul class="monitors">
            <li v-for="m in g.monitors" :key="m.id" class="monitor">
              <div class="monitor-head">
                <h3 class="monitor-name">{{ m.name }}</h3>
                <StatusBadge :status="m.status" />
              </div>
              <p v-if="m.description" class="muted small">{{ m.description }}</p>
              <DailyBars :daily="m.daily" />
              <dl class="uptime num">
                <div>
                  <dt>24 小時</dt>
                  <dd>{{ formatPercent(m.uptime24h) }}</dd>
                </div>
                <div>
                  <dt>30 天</dt>
                  <dd>{{ formatPercent(m.uptime30d) }}</dd>
                </div>
                <div>
                  <dt>90 天</dt>
                  <dd>{{ formatPercent(m.uptime90d) }}</dd>
                </div>
              </dl>
            </li>
          </ul>
        </section>

        <section v-if="resolvedIncidents.length" class="resolved">
          <h2 class="section-title">最近已解決</h2>
          <ul class="resolved-list">
            <li v-for="inc in resolvedIncidents" :key="inc.id">
              <details>
                <summary>
                  <span class="resolved-title">{{ inc.title }}</span>
                  <span class="faint small num">已解決 {{ formatDateTime(inc.resolvedAt, tz) }}</span>
                </summary>
                <div v-if="renderMd" class="prose small resolved-body" v-html="renderMd(inc.content)" />
                <p v-else class="pre small resolved-body">{{ inc.content }}</p>
                <p class="faint small num">發布 {{ formatDateTime(inc.createdAt, tz) }}</p>
              </details>
            </li>
          </ul>
        </section>
      </template>
    </main>

    <footer v-if="data" class="foot faint">
      <p v-if="data.footer" class="pre">{{ data.footer }}</p>
      <p class="num">最後更新 {{ formatDateTime(data.generatedAt, tz, true) }} · 時區 {{ data.timezone }}</p>
    </footer>
  </div>
</template>

<style scoped>
.page {
  width: 100%;
  max-width: 860px;
  margin: 0 auto;
  padding: 48px 24px 40px;
}

main {
  display: grid;
  gap: 16px;
}

.head {
  margin-bottom: 28px;
}

h1 {
  font-size: var(--fs-2xl);
  letter-spacing: -0.01em;
}

.desc {
  margin-top: 6px;
  font-size: var(--fs-lg);
  max-width: 60ch;
}

.state {
  padding: 24px 0;
}

.retry {
  margin-top: 8px;
}

.stale {
  font-size: var(--fs-sm);
}

.small {
  font-size: var(--fs-sm);
}

.pre {
  white-space: pre-line;
}

/* 整體狀態：粗左線 + 淡底色，顏色和文字一起表達狀態 */
.overall {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px 20px;
  border: 1px solid color-mix(in srgb, var(--s) 30%, var(--line));
  border-left: 5px solid var(--s-bar);
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--s-bar) var(--tint), var(--surface));
}

.overall-icon {
  flex: none;
  width: 28px;
  height: 28px;
  color: var(--s);
}

.overall-text {
  font-size: var(--fs-xl);
  color: var(--ink);
}

.overall-sub {
  margin-top: 2px;
  font-size: var(--fs-sm);
}

.block {
  display: grid;
  gap: 8px;
  padding: 14px 18px 14px 16px;
  border: 1px solid var(--line);
  border-left: 3px solid var(--s-bar, var(--info));
  border-radius: var(--radius);
  background: var(--surface);
}

.inc-info { --s: var(--info); --s-bar: var(--info); }
.inc-warning { --s: var(--pending); --s-bar: var(--pending-bar); }
.inc-danger { --s: var(--down); --s-bar: var(--down-bar); }

.maint-now {
  background: color-mix(in srgb, var(--maint-bar) var(--tint), var(--surface));
}

.block-head {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.block-head h2 {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-lg);
}

.block-icon {
  flex: none;
  width: 18px;
  height: 18px;
  margin-top: 2px;
  color: var(--s);
}

.block-kind {
  flex: none;
  font-size: var(--fs-xs);
  font-weight: 600;
  color: var(--s);
  line-height: 24px;
}

.block-text {
  padding-left: 26px;
}

.block-meta {
  padding-left: 26px;
  font-size: var(--fs-xs);
}

.section-title {
  margin: 20px 0 10px;
  font-size: var(--fs-md);
  color: var(--ink-2);
  font-weight: 600;
}

.upcoming-list,
.monitors,
.resolved-list {
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
}

.upcoming-list li {
  display: grid;
  grid-template-columns: 9.5em 1fr;
  gap: 4px 16px;
  padding: 12px 16px;
}

.upcoming-list li + li,
.monitor + .monitor,
.resolved-list li + li {
  border-top: 1px solid var(--line);
}

.upcoming-when {
  color: var(--maint);
  font-weight: 600;
  font-size: var(--fs-sm);
  padding-top: 1px;
}

.upcoming-title {
  font-weight: 600;
}

.group .section-title:first-child {
  margin-top: 20px;
}

.group:not(:has(.section-title)) {
  margin-top: 12px;
}

.monitor {
  display: grid;
  gap: 10px;
  padding: 16px 18px;
}

.monitor-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.monitor-name {
  min-width: 0;
  font-size: var(--fs-md);
  font-weight: 600;
  overflow-wrap: anywhere;
}

.uptime {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 20px;
  margin: -2px 0 0;
  font-size: var(--fs-sm);
}

.uptime div {
  display: flex;
  gap: 6px;
}

.uptime dt {
  color: var(--ink-3);
}

.uptime dd {
  margin: 0;
  font-weight: 600;
}

.resolved-list li {
  padding: 0;
}

.resolved-list details {
  padding: 10px 16px;
}

.resolved-list summary {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 2px 12px;
  cursor: pointer;
}

.resolved-title {
  font-weight: 550;
}

.resolved-body {
  margin: 8px 0 4px;
  color: var(--ink-2);
}

.foot {
  display: grid;
  gap: 4px;
  margin-top: 40px;
  padding-top: 16px;
  border-top: 1px solid var(--line);
  font-size: var(--fs-sm);
}

@media (max-width: 640px) {
  .page {
    padding: 28px 16px 32px;
  }
  h1 {
    font-size: var(--fs-xl);
  }
  .desc {
    font-size: var(--fs-md);
  }
  .overall {
    padding: 14px 16px;
  }
  .overall-text {
    font-size: var(--fs-lg);
  }
  .monitor {
    padding: 14px;
  }
  .block-text,
  .block-meta {
    padding-left: 0;
  }
  .upcoming-list li {
    grid-template-columns: 1fr;
  }
}
</style>
