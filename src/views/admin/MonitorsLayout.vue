<script setup lang="ts">
import { computed, provide, ref } from 'vue';
import { RouterLink, RouterView, useRoute } from 'vue-router';
import { Plus, Search } from '@lucide/vue';
import type { MonitorSummary } from '../../../shared/types';
import { api, errorMessage, isAuthError } from '../../api';
import { formatPercent } from '../../format';
import { usePolling } from '../../polling';
import BeatStrip from '../../components/BeatStrip.vue';
import ErrorNotice from '../../components/ErrorNotice.vue';
import StatusBadge from '../../components/StatusBadge.vue';
import { monitorsKey } from './monitorsContext';
import { session } from './session';

const list = ref<MonitorSummary[]>([]);
const loaded = ref(false);
const error = ref('');
const authError = ref(false);

async function refresh() {
  try {
    list.value = await api.get<MonitorSummary[]>('/api/admin/monitors');
    error.value = '';
    authError.value = false;
  } catch (err) {
    error.value = errorMessage(err);
    authError.value = isAuthError(err);
  } finally {
    loaded.value = true;
  }
}

provide(monitorsKey, { list, refresh });
usePolling(refresh, 30_000);

const route = useRoute();
const showingDetail = computed(() => route.name !== 'monitors');

type Filter = 'all' | 'down' | 'up' | 'paused';
const query = ref('');
const filter = ref<Filter>('all');

const counts = computed(() => {
  const c = { all: list.value.length, up: 0, down: 0, paused: 0 };
  for (const m of list.value) {
    if (!m.active) c.paused++;
    else if (m.lastStatus === 0) c.down++;
    else if (m.lastStatus === 1) c.up++;
  }
  return c;
});

const groups = computed(() => {
  const q = query.value.trim().toLowerCase();
  const rows = list.value
    .filter((m) => {
      if (filter.value === 'paused') return !m.active;
      if (filter.value === 'down') return m.active && m.lastStatus === 0;
      if (filter.value === 'up') return m.active && m.lastStatus === 1;
      return true;
    })
    .filter((m) => !q || [m.name, m.url, m.groupName, m.description].some((s) => s?.toLowerCase().includes(q)))
    .sort(
      (a, b) =>
        // 未分組放最後
        Number(!a.groupName) - Number(!b.groupName) ||
        a.groupName.localeCompare(b.groupName, 'zh-TW') ||
        a.sortOrder - b.sortOrder ||
        a.name.localeCompare(b.name, 'zh-TW'),
    );
  const map = new Map<string, MonitorSummary[]>();
  for (const m of rows) {
    const arr = map.get(m.groupName) ?? [];
    arr.push(m);
    map.set(m.groupName, arr);
  }
  return [...map.entries()].map(([name, items]) => ({ name, items }));
});

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'down', label: '中斷' },
  { value: 'up', label: '正常' },
  { value: 'paused', label: '已暫停' },
];
</script>

<template>
  <div class="monitors" :class="{ 'has-detail': showingDetail }">
    <section class="list-pane" aria-label="監測項目清單">
      <div class="list-head">
        <h1>監測項目</h1>
        <RouterLink to="/admin/monitors/new" class="btn btn-primary">
          <Plus aria-hidden="true" />新增監測
        </RouterLink>
      </div>

      <div class="tools">
        <label class="search">
          <Search aria-hidden="true" />
          <span class="visually-hidden">搜尋監測項目</span>
          <input v-model="query" type="search" class="input" placeholder="搜尋名稱、URL、群組" />
        </label>
        <div class="filters" role="group" aria-label="篩選狀態">
          <button
            v-for="f in FILTERS"
            :key="f.value"
            type="button"
            class="filter"
            :aria-pressed="filter === f.value"
            @click="filter = f.value"
          >
            {{ f.label }} <span class="num faint">{{ counts[f.value] }}</span>
          </button>
        </div>
      </div>

      <ErrorNotice v-if="error" :message="error" :auth="authError" />

      <p v-if="!loaded" class="faint pad">載入中…</p>
      <div v-else-if="!list.length && !error" class="empty-list">
        <p>還沒有監測項目。</p>
        <RouterLink to="/admin/monitors/new" class="btn">新增第一個監測</RouterLink>
      </div>
      <p v-else-if="!groups.length && !error" class="faint pad">沒有符合條件的項目。</p>

      <div v-for="g in groups" :key="g.name" class="group">
        <h2 v-if="g.name || groups.length > 1" class="group-name">{{ g.name || '未分組' }}</h2>
        <ul class="items">
          <li v-for="m in g.items" :key="m.id">
            <RouterLink
              :to="`/admin/monitors/${m.id}`"
              class="item"
              :class="{ paused: !m.active, current: route.params.id === String(m.id) }"
            >
              <div class="item-row">
                <StatusBadge :status="m.lastStatus" :paused="!m.active" icon-only />
                <span class="item-name">{{ m.name }}</span>
                <span class="item-uptime num">{{ formatPercent(m.uptime24h) }}</span>
              </div>
              <div class="item-row item-sub">
                <span class="tag">{{ m.type === 'http' ? 'HTTP' : 'Push' }}</span>
                <span v-if="!m.active" class="paused-label">已暫停</span>
                <BeatStrip v-else class="item-strip" :beats="m.recent" :slots="24" :height="14" :time-zone="session.timezone" />
              </div>
            </RouterLink>
          </li>
        </ul>
      </div>
    </section>

    <section class="detail-pane">
      <RouterView />
    </section>
  </div>
</template>

<style scoped>
.monitors {
  display: grid;
  grid-template-columns: minmax(280px, 340px) minmax(0, 1fr);
  gap: 28px;
  align-items: start;
}

.list-pane {
  display: grid;
  gap: 12px;
  position: sticky;
  top: 20px;
  max-height: calc(100dvh - 40px);
  overflow-y: auto;
  padding-right: 4px;
}

.list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

h1 {
  font-size: var(--fs-xl);
}

.tools {
  display: grid;
  gap: 8px;
}

.search {
  position: relative;
  display: block;
}

.search svg {
  position: absolute;
  top: 50%;
  left: 10px;
  width: 16px;
  height: 16px;
  color: var(--ink-3);
  transform: translateY(-50%);
  pointer-events: none;
}

.search .input {
  padding-left: 34px;
}

.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface-2);
}

.filter {
  flex: 1;
  min-height: 30px;
  padding: 0 8px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink-2);
  font: inherit;
  font-size: var(--fs-sm);
  white-space: nowrap;
  cursor: pointer;
}

.filter[aria-pressed="true"] {
  background: var(--surface);
  color: var(--ink);
  font-weight: 600;
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.08);
}

.pad {
  padding: 12px 4px;
}

.empty-list {
  display: grid;
  justify-items: start;
  gap: 10px;
  padding: 16px;
  border: 1px dashed var(--line-strong);
  border-radius: var(--radius);
}

.group {
  display: grid;
  gap: 6px;
}

.group-name {
  padding: 6px 4px 0;
  font-size: var(--fs-xs);
  font-weight: 600;
  color: var(--ink-3);
}

.items {
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  overflow: hidden;
}

.items li + li {
  border-top: 1px solid var(--line);
}

.item {
  display: grid;
  gap: 6px;
  padding: 10px 12px;
  color: inherit;
  text-decoration: none;
}

.item:hover {
  background: var(--surface-2);
}

.item.current {
  background: color-mix(in srgb, var(--ink) 7%, var(--surface));
  box-shadow: inset 3px 0 0 var(--ink);
}

.item.paused .item-name,
.item.paused .item-uptime {
  color: var(--ink-3);
}

.item.paused .tag {
  opacity: 0.7;
}

.item-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.item-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-uptime {
  flex: none;
  font-size: var(--fs-sm);
  color: var(--ink-2);
}

.item-sub {
  padding-left: 24px;
}

.item-strip {
  flex: 1;
  justify-content: flex-end;
}

.paused-label {
  font-size: var(--fs-xs);
  color: var(--ink-3);
}

.detail-pane {
  min-width: 0;
}

@media (max-width: 1100px) {
  .monitors {
    grid-template-columns: minmax(0, 1fr);
  }
  .list-pane {
    position: static;
    max-height: none;
    overflow: visible;
    padding-right: 0;
  }
  .monitors.has-detail .list-pane {
    display: none;
  }
  .monitors:not(.has-detail) .detail-pane {
    display: none;
  }
}
</style>
