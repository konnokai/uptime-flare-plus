<script setup lang="ts">
import { computed, inject, ref, shallowRef, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { ArrowLeft, ExternalLink, Pause, Pencil, Play, RefreshCw, Trash } from '@lucide/vue';
import type { Heartbeat, Monitor, MonitorStats } from '../../../shared/types';
import { api, errorMessage, isAuthError } from '../../api';
import { confirm } from '../../confirm';
import { formatDateTime, formatLatency, formatPercent, formatRelative } from '../../format';
import { usePolling } from '../../polling';
import CopyButton from '../../components/CopyButton.vue';
import DailyBars from '../../components/DailyBars.vue';
import ErrorNotice from '../../components/ErrorNotice.vue';
import LatencyChart from '../../components/LatencyChart.vue';
import StatusBadge from '../../components/StatusBadge.vue';
import { monitorsKey } from './monitorsContext';
import { session } from './session';

const route = useRoute();
const router = useRouter();
const ctx = inject(monitorsKey)!;

const id = computed(() => Number(route.params.id));
const monitor = shallowRef<Monitor | null>(null);
const stats = shallowRef<MonitorStats | null>(null);
const beats = shallowRef<Heartbeat[]>([]);
const events = shallowRef<Heartbeat[]>([]);
const error = ref('');
const authError = ref(false);
const actionError = ref('');
const busy = ref(false);
const loadingMore = ref(false);
const noMore = ref(false);

const tz = computed(() => session.timezone);
const base = computed(() => `/api/admin/monitors/${id.value}`);

async function load() {
  const target = id.value;
  try {
    const [m, s, h, e] = await Promise.all([
      api.get<Monitor>(base.value),
      api.get<MonitorStats>(`${base.value}/stats`),
      api.get<Heartbeat[]>(`${base.value}/heartbeats?limit=100`),
      api.get<Heartbeat[]>(`${base.value}/events?limit=50`),
    ]);
    // 切換項目時，舊請求晚回來不能蓋掉新資料
    if (target !== id.value) return;
    monitor.value = m;
    stats.value = s;
    // 保留使用者用「載入更早」拿到的舊資料
    const oldest = h[h.length - 1]?.ts ?? Infinity;
    beats.value = [...h, ...beats.value.filter((b) => b.ts < oldest)];
    events.value = e;
    error.value = '';
    authError.value = false;
  } catch (err) {
    if (target !== id.value) return;
    error.value = errorMessage(err);
    authError.value = isAuthError(err);
  }
}

watch(
  id,
  () => {
    monitor.value = null;
    stats.value = null;
    beats.value = [];
    events.value = [];
    error.value = '';
    actionError.value = '';
    noMore.value = false;
    void load();
  },
  { immediate: true },
);

usePolling(load, 30_000, false);

watch(monitor, (m) => {
  if (m) document.title = `${m.name} · 管理後台`;
});

const current = computed(() => beats.value[0] ?? null);
const chartBeats = computed(() => beats.value.slice(0, 100));
const pushUrl = computed(() =>
  monitor.value?.pushToken ? `${location.origin}/api/push/${monitor.value.pushToken}` : '',
);

async function loadMore() {
  const last = beats.value[beats.value.length - 1];
  if (!last) return;
  loadingMore.value = true;
  try {
    const more = await api.get<Heartbeat[]>(`${base.value}/heartbeats?limit=100&before=${last.ts}`);
    if (!more.length) noMore.value = true;
    beats.value = [...beats.value, ...more];
  } catch (err) {
    actionError.value = errorMessage(err);
  } finally {
    loadingMore.value = false;
  }
}

async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
  busy.value = true;
  actionError.value = '';
  try {
    return await fn();
  } catch (err) {
    actionError.value = errorMessage(err);
    return undefined;
  } finally {
    busy.value = false;
  }
}

async function togglePause() {
  const m = monitor.value;
  if (!m) return;
  const res = await run(() => api.post<Monitor>(`${base.value}/${m.active ? 'pause' : 'resume'}`));
  if (res) {
    monitor.value = res;
    void ctx.refresh();
  }
}

async function remove() {
  const m = monitor.value;
  if (!m) return;
  const ok = await confirm({
    title: `刪除「${m.name}」？`,
    message: '所有心跳紀錄和統計會一起刪除，無法復原。',
    confirmText: '刪除',
    danger: true,
  });
  if (!ok) return;
  const res = await run(() => api.del<{ ok: true }>(base.value));
  if (res) {
    await ctx.refresh();
    void router.push('/admin/monitors');
  }
}

async function regenerate() {
  const ok = await confirm({
    title: '重新產生 push token？',
    message: '舊的 push URL 會立刻失效，要記得更新呼叫端。',
    confirmText: '重新產生',
    danger: true,
  });
  if (!ok) return;
  const res = await run(() => api.post<Monitor>(`${base.value}/regenerate-token`));
  if (res) monitor.value = res;
}

function codes(m: Monitor) {
  return m.acceptedCodes.join(', ');
}
</script>

<template>
  <div class="detail">
    <RouterLink to="/admin/monitors" class="back">
      <ArrowLeft aria-hidden="true" />返回清單
    </RouterLink>

    <ErrorNotice v-if="error && !monitor" :message="error" :auth="authError" />
    <p v-else-if="!monitor" class="faint">載入中…</p>

    <template v-if="monitor">
      <header class="head">
        <div class="title-row">
          <h1>{{ monitor.name }}</h1>
          <span class="tag">{{ monitor.type === 'http' ? 'HTTP' : 'Push' }}</span>
        </div>
        <p v-if="monitor.description" class="muted">{{ monitor.description }}</p>
        <p v-if="monitor.type === 'http'" class="target mono">
          <span class="faint">{{ monitor.method }}</span>
          <a :href="monitor.url" target="_blank" rel="noopener noreferrer">
            {{ monitor.url }}<ExternalLink aria-hidden="true" class="ext" />
          </a>
        </p>
        <p v-if="monitor.groupName" class="faint small">群組：{{ monitor.groupName }}</p>

        <div class="actions">
          <RouterLink :to="`/admin/monitors/${monitor.id}/edit`" class="btn">
            <Pencil aria-hidden="true" />編輯
          </RouterLink>
          <button type="button" class="btn" :disabled="busy" @click="togglePause">
            <template v-if="monitor.active"><Pause aria-hidden="true" />暫停</template>
            <template v-else><Play aria-hidden="true" />恢復</template>
          </button>
          <button type="button" class="btn btn-danger" :disabled="busy" @click="remove">
            <Trash aria-hidden="true" />刪除
          </button>
        </div>
        <ErrorNotice v-if="actionError" :message="actionError" />
        <ErrorNotice v-if="error" :message="`更新失敗：${error}`" :auth="authError" />
      </header>

      <dl class="stats">
        <div class="stat">
          <dt>目前狀態</dt>
          <dd>
            <StatusBadge :status="current?.status" :paused="!monitor.active" />
            <span class="stat-sub faint">{{ current ? formatRelative(current.ts) : '尚無心跳' }}</span>
          </dd>
        </div>
        <div class="stat">
          <dt>24 小時</dt>
          <dd class="num">{{ formatPercent(stats?.uptime24h) }}</dd>
        </div>
        <div class="stat">
          <dt>30 天</dt>
          <dd class="num">{{ formatPercent(stats?.uptime30d) }}</dd>
        </div>
        <div class="stat">
          <dt>90 天</dt>
          <dd class="num">{{ formatPercent(stats?.uptime90d) }}</dd>
        </div>
        <div class="stat">
          <dt>平均延遲（24 小時）</dt>
          <dd class="num">{{ formatLatency(stats?.avgLatency24h) }}</dd>
        </div>
      </dl>

      <section v-if="monitor.type === 'push'" class="section">
        <h2>Push 設定</h2>
        <p class="muted small">
          服務要在每 {{ monitor.intervalS }} 秒內呼叫一次這個 URL，逾時就判定為 down。
        </p>
        <div v-if="pushUrl" class="push">
          <div class="push-row">
            <code class="push-url">{{ pushUrl }}</code>
            <CopyButton :text="pushUrl" />
          </div>
          <p class="small muted">範例：</p>
          <div class="push-row">
            <code class="push-url">curl "{{ pushUrl }}?status=up&amp;msg=OK&amp;ping="</code>
            <CopyButton :text="`curl &quot;${pushUrl}?status=up&msg=OK&ping=&quot;`" />
          </div>
          <p class="small faint">status 可用 up 或 down；ping 填延遲毫秒數，可省略。</p>
        </div>
        <p v-else class="small faint">還沒有 push token。</p>
        <div>
          <button type="button" class="btn btn-sm" :disabled="busy" @click="regenerate">
            <RefreshCw aria-hidden="true" />重新產生 token
          </button>
        </div>
      </section>

      <section class="section">
        <h2>延遲 <span class="h-sub faint">最近 {{ chartBeats.length }} 次</span></h2>
        <LatencyChart :beats="chartBeats" :time-zone="tz" />
      </section>

      <section v-if="stats" class="section">
        <h2>每日可用率 <span class="h-sub faint">90 天</span></h2>
        <DailyBars :daily="stats.daily" />
      </section>

      <section class="section">
        <h2>設定摘要</h2>
        <dl class="config small">
          <div><dt>檢查間隔</dt><dd>{{ monitor.intervalS }} 秒</dd></div>
          <div><dt>重試</dt><dd>{{ monitor.retries }} 次，間隔 {{ monitor.retryIntervalS }} 秒</dd></div>
          <div>
            <dt>重送通知</dt>
            <dd>{{ monitor.resendInterval ? `連續 down ${monitor.resendInterval} 次再通知` : '不重送' }}</dd>
          </div>
          <template v-if="monitor.type === 'http'">
            <div><dt>逾時</dt><dd>{{ monitor.timeoutS }} 秒</dd></div>
            <div><dt>接受的狀態碼</dt><dd class="mono">{{ codes(monitor) }}</dd></div>
            <div v-if="monitor.keyword">
              <dt>關鍵字</dt>
              <dd><code>{{ monitor.keyword }}</code>{{ monitor.invertKeyword ? '（不可出現）' : '' }}</dd>
            </div>
          </template>
          <div v-if="monitor.upsideDown"><dt>反向模式</dt><dd>開啟</dd></div>
          <div><dt>狀態頁</dt><dd>{{ monitor.isPublic ? '公開' : '不顯示' }}</dd></div>
          <div><dt>通知管道</dt><dd>{{ monitor.notificationIds.length }} 個</dd></div>
        </dl>
      </section>

      <section class="section">
        <h2>狀態變化</h2>
        <p v-if="!events.length" class="faint small">還沒有狀態變化。</p>
        <div v-else class="table-wrap">
          <table class="table">
            <thead>
              <tr><th>時間</th><th>狀態</th><th>訊息</th></tr>
            </thead>
            <tbody>
              <tr v-for="e in events" :key="e.id">
                <td class="num nowrap">{{ formatDateTime(e.ts, tz, true) }}</td>
                <td><StatusBadge :status="e.status" /></td>
                <td class="msg">{{ e.msg || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="section">
        <h2>心跳紀錄</h2>
        <p v-if="!beats.length" class="faint small">還沒有心跳。</p>
        <div v-else class="table-wrap">
          <table class="table">
            <thead>
              <tr><th>時間</th><th>狀態</th><th>延遲</th><th>訊息</th></tr>
            </thead>
            <tbody>
              <tr v-for="b in beats" :key="b.id">
                <td class="num nowrap">{{ formatDateTime(b.ts, tz, true) }}</td>
                <td><StatusBadge :status="b.status" /></td>
                <td class="num nowrap">{{ formatLatency(b.latencyMs) }}</td>
                <td class="msg">{{ b.msg || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="beats.length >= 100 && !noMore">
          <button type="button" class="btn btn-sm" :disabled="loadingMore" @click="loadMore">
            {{ loadingMore ? '載入中…' : '載入更早的紀錄' }}
          </button>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.detail {
  display: grid;
  gap: 24px;
  min-width: 0;
}

.back {
  display: none;
  align-items: center;
  gap: 4px;
  width: fit-content;
  color: var(--ink-2);
  font-size: var(--fs-sm);
  text-decoration: none;
}

.back svg {
  width: 16px;
  height: 16px;
}

@media (max-width: 1100px) {
  .back {
    display: inline-flex;
  }
}

.head {
  display: grid;
  gap: 8px;
}

.title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

h1 {
  font-size: var(--fs-2xl);
  overflow-wrap: anywhere;
}

.target {
  display: flex;
  gap: 8px;
  min-width: 0;
  font-size: var(--fs-sm);
}

.target a {
  min-width: 0;
  overflow-wrap: anywhere;
}

.ext {
  width: 13px;
  height: 13px;
  margin-left: 4px;
  vertical-align: -1px;
}

.small {
  font-size: var(--fs-sm);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 6px;
}

.stats {
  display: grid;
  grid-template-columns: 1.4fr repeat(4, 1fr);
  margin: 0;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
}

.stat {
  display: grid;
  align-content: start;
  gap: 6px;
  padding: 14px 16px;
  min-width: 0;
}

.stat + .stat {
  border-left: 1px solid var(--line);
}

.stat dt {
  font-size: var(--fs-xs);
  color: var(--ink-3);
}

.stat dd {
  display: grid;
  gap: 4px;
  margin: 0;
  font-size: var(--fs-lg);
  font-weight: 650;
}

.stat-sub {
  font-size: var(--fs-xs);
  font-weight: 400;
}

.section {
  display: grid;
  gap: 10px;
  min-width: 0;
}

h2 {
  font-size: var(--fs-md);
}

.h-sub {
  margin-left: 6px;
  font-size: var(--fs-sm);
  font-weight: 400;
}

.push {
  display: grid;
  gap: 6px;
}

.push-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.push-url {
  flex: 1;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface);
  font-size: var(--fs-sm);
  overflow-wrap: anywhere;
}

.config {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 8px 24px;
  margin: 0;
}

.config div {
  display: grid;
  gap: 1px;
}

.config dt {
  color: var(--ink-3);
  font-size: var(--fs-xs);
}

.config dd {
  margin: 0;
}

.nowrap {
  white-space: nowrap;
}

@media (max-width: 720px) {
  h1 {
    font-size: var(--fs-xl);
  }
  .stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  /* 第一格（目前狀態）占滿一列，其餘兩兩一列 */
  .stat {
    border-top: 1px solid var(--line);
  }
  .stat + .stat {
    border-left: 0;
  }
  .stat:first-child {
    grid-column: 1 / -1;
    border-top: 0;
  }
  .stat:nth-child(odd):not(:first-child) {
    border-left: 1px solid var(--line);
  }
  .push-row {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
