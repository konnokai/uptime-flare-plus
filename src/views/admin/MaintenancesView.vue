<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { Pencil, Plus, Search, Trash } from '@lucide/vue';
import type {
  Maintenance,
  MaintenanceInput,
  MaintenanceStrategy,
  MaintenanceWithState,
  MonitorSummary,
} from '../../../shared/types';
import { api, errorMessage, isAuthError } from '../../api';
import { confirm } from '../../confirm';
import { browserTimeZone, formatDateTime, isValidTimeZone, localInputToMs, msToLocalInput } from '../../format';
import { timeZoneOptions } from '../../timezones';
import ErrorNotice from '../../components/ErrorNotice.vue';
import { session } from './session';

const list = ref<MaintenanceWithState[]>([]);
const monitors = ref<MonitorSummary[]>([]);
const loaded = ref(false);
const loadError = ref('');
const authError = ref(false);
const rowError = ref('');

async function load() {
  try {
    const [m, mons] = await Promise.all([
      api.get<MaintenanceWithState[]>('/api/admin/maintenances'),
      api.get<MonitorSummary[]>('/api/admin/monitors'),
    ]);
    list.value = m;
    monitors.value = mons;
    loadError.value = '';
  } catch (err) {
    loadError.value = errorMessage(err);
    authError.value = isAuthError(err);
  } finally {
    loaded.value = true;
  }
}

onMounted(load);

const tz = computed(() => session.timezone);
const STRATEGY: Record<MaintenanceStrategy, string> = { manual: '手動', single: '單次', weekly: '每週' };
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

const sorted = computed(() =>
  [...list.value].sort(
    (a, b) =>
      Number(b.inProgress) - Number(a.inProgress) ||
      Number(b.active) - Number(a.active) ||
      (a.window?.start ?? Infinity) - (b.window?.start ?? Infinity),
  ),
);

function schedule(m: Maintenance): string {
  if (m.strategy === 'manual') return '手動開關，啟用期間一直算維護中';
  if (m.strategy === 'single') return `${formatDateTime(m.startAt, tz.value)} – ${formatDateTime(m.endAt, tz.value)}`;
  const days = [...m.weekdays].sort().map((d) => WEEKDAYS[d]).join('、');
  return `每週${days} ${m.startTime}–${m.endTime}（${m.timezone}）`;
}

function stateText(m: MaintenanceWithState): string {
  if (!m.active) return '已停用';
  if (m.inProgress) return m.window?.end ? `進行中，到 ${formatDateTime(m.window.end, tz.value)}` : '進行中，結束時間未定';
  if (m.window) return `下一次 ${formatDateTime(m.window.start, tz.value)}`;
  return '沒有排定的時段';
}

function toInput(m: Maintenance): MaintenanceInput {
  return {
    title: m.title,
    description: m.description,
    strategy: m.strategy,
    active: m.active,
    startAt: m.startAt,
    endAt: m.endAt,
    weekdays: [...m.weekdays],
    startTime: m.startTime,
    endTime: m.endTime,
    timezone: m.timezone,
    monitorIds: [...m.monitorIds],
  };
}

const toggling = ref<number | null>(null);

async function toggleActive(m: MaintenanceWithState) {
  toggling.value = m.id;
  rowError.value = '';
  try {
    await api.put<Maintenance>(`/api/admin/maintenances/${m.id}`, { ...toInput(m), active: !m.active });
    await load();
  } catch (err) {
    rowError.value = errorMessage(err);
  } finally {
    toggling.value = null;
  }
}

async function remove(m: MaintenanceWithState) {
  const ok = await confirm({ title: `刪除「${m.title}」？`, confirmText: '刪除', danger: true });
  if (!ok) return;
  rowError.value = '';
  try {
    await api.del<{ ok: true }>(`/api/admin/maintenances/${m.id}`);
    if (editing.value === m.id) editing.value = null;
    await load();
  } catch (err) {
    rowError.value = errorMessage(err);
  }
}

/* ---------- 表單 ---------- */

const editing = ref<number | null>(null);
const isNew = computed(() => editing.value === 0);
const form = reactive({
  title: '',
  description: '',
  strategy: 'manual' as MaintenanceStrategy,
  active: true,
  start: '',
  end: '',
  weekdays: [] as number[],
  startTime: '02:00',
  endTime: '04:00',
  timezone: 'Asia/Taipei',
  monitorIds: [] as number[],
});
const errors = reactive<Record<string, string>>({});
const saving = ref(false);
const saveError = ref('');
const monitorQuery = ref('');

function open(m?: MaintenanceWithState) {
  editing.value = m?.id ?? 0;
  Object.assign(form, {
    title: m?.title ?? '',
    description: m?.description ?? '',
    strategy: m?.strategy ?? 'single',
    active: m?.active ?? true,
    start: msToLocalInput(m?.startAt ?? null),
    end: msToLocalInput(m?.endAt ?? null),
    weekdays: m ? [...m.weekdays] : [],
    startTime: m?.startTime ?? '02:00',
    endTime: m?.endTime ?? '04:00',
    timezone: m?.timezone || session.settingsTimezone || 'Asia/Taipei',
    monitorIds: m ? [...m.monitorIds] : [],
  });
  for (const k of Object.keys(errors)) delete errors[k];
  saveError.value = '';
  monitorQuery.value = '';
  requestAnimationFrame(() => document.getElementById('mt-title')?.focus());
}

function toggleDay(d: number, on: boolean) {
  const set = new Set(form.weekdays);
  if (on) set.add(d);
  else set.delete(d);
  form.weekdays = [...set].sort();
}

function toggleMonitor(id: number, on: boolean) {
  const set = new Set(form.monitorIds);
  if (on) set.add(id);
  else set.delete(id);
  form.monitorIds = [...set];
}

const filteredMonitors = computed(() => {
  const q = monitorQuery.value.trim().toLowerCase();
  return monitors.value
    .filter((m) => !q || m.name.toLowerCase().includes(q) || m.groupName.toLowerCase().includes(q))
    .sort((a, b) => a.groupName.localeCompare(b.groupName, 'zh-TW') || a.name.localeCompare(b.name, 'zh-TW'));
});

function selectShown(on: boolean) {
  const set = new Set(form.monitorIds);
  for (const m of filteredMonitors.value) {
    if (on) set.add(m.id);
    else set.delete(m.id);
  }
  form.monitorIds = [...set];
}

const crossesMidnight = computed(() => form.startTime && form.endTime && form.endTime <= form.startTime);

async function save() {
  for (const k of Object.keys(errors)) delete errors[k];
  saveError.value = '';
  if (!form.title.trim()) errors.title = '請填標題';

  let startAt: number | null = null;
  let endAt: number | null = null;
  if (form.strategy === 'single') {
    startAt = localInputToMs(form.start);
    endAt = localInputToMs(form.end);
    if (startAt == null) errors.start = '請選開始時間';
    if (endAt == null) errors.end = '請選結束時間';
    else if (startAt != null && endAt <= startAt) errors.end = '結束要晚於開始';
  }
  if (form.strategy === 'weekly') {
    if (!form.weekdays.length) errors.weekdays = '至少選一天';
    const re = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!re.test(form.startTime)) errors.startTime = '格式 HH:MM';
    if (!re.test(form.endTime)) errors.endTime = '格式 HH:MM';
    else if (form.endTime === form.startTime) errors.endTime = '開始和結束不能相同';
    if (!isValidTimeZone(form.timezone.trim())) errors.timezone = '不是有效的 IANA 時區，例：Asia/Taipei';
  }
  if (Object.keys(errors).length) return;

  const input: MaintenanceInput = {
    title: form.title.trim(),
    description: form.description.trim(),
    strategy: form.strategy,
    active: form.active,
    startAt,
    endAt,
    weekdays: form.strategy === 'weekly' ? [...form.weekdays] : [],
    startTime: form.startTime || '00:00',
    endTime: form.endTime || '00:00',
    timezone: form.timezone.trim() || 'Asia/Taipei',
    monitorIds: [...form.monitorIds],
  };

  saving.value = true;
  try {
    if (isNew.value) await api.post<Maintenance>('/api/admin/maintenances', input);
    else await api.put<Maintenance>(`/api/admin/maintenances/${editing.value}`, input);
    await load();
    editing.value = null;
  } catch (err) {
    saveError.value = errorMessage(err);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="crud">
    <div class="page-head">
      <div>
        <h1>維護時段</h1>
        <p class="muted small">維護期間的監測項目在狀態頁顯示「維護中」，也不會發中斷通知。</p>
      </div>
      <button type="button" class="btn btn-primary" @click="open()"><Plus aria-hidden="true" />新增維護</button>
    </div>

    <ErrorNotice v-if="loadError" :message="loadError" :auth="authError" />

    <div class="layout" :class="{ editing: editing !== null }">
      <section class="list" aria-label="維護時段清單">
        <ErrorNotice v-if="rowError" :message="rowError" />
        <p v-if="!loaded" class="faint">載入中…</p>
        <p v-else-if="!list.length && !loadError" class="empty">還沒有維護時段。</p>
        <ul v-else class="rows">
          <li
            v-for="m in sorted"
            :key="m.id"
            class="row"
            :class="{ current: editing === m.id, off: !m.active, 's-maint': m.inProgress }"
          >
            <div class="row-main">
              <div class="row-title">
                <span class="name">{{ m.title }}</span>
                <span class="tag">{{ STRATEGY[m.strategy] }}</span>
              </div>
              <div class="small state" :class="{ now: m.inProgress && m.active }">{{ stateText(m) }}</div>
              <div class="small faint num">{{ schedule(m) }}</div>
              <div class="small faint">影響 {{ m.monitorIds.length }} 個監測項目</div>
            </div>
            <div class="row-actions">
              <label class="check switch">
                <input
                  type="checkbox"
                  :checked="m.active"
                  :disabled="toggling === m.id"
                  @change="toggleActive(m)"
                /><span>啟用</span>
              </label>
              <button type="button" class="btn btn-sm" @click="open(m)"><Pencil aria-hidden="true" />編輯</button>
              <button type="button" class="btn btn-sm btn-ghost btn-danger" :aria-label="`刪除 ${m.title}`" @click="remove(m)">
                <Trash aria-hidden="true" />
              </button>
            </div>
          </li>
        </ul>
      </section>

      <section v-if="editing !== null" class="editor" aria-labelledby="mt-editor-title">
        <h2 id="mt-editor-title">{{ isNew ? '新增維護' : '編輯維護' }}</h2>
        <form class="form" novalidate @submit.prevent="save">
          <div class="field">
            <label for="mt-title" class="req">標題</label>
            <input id="mt-title" v-model="form.title" class="input" :aria-invalid="!!errors.title" />
            <p v-if="errors.title" class="field-error">{{ errors.title }}</p>
          </div>
          <div class="field">
            <label for="mt-desc">說明</label>
            <textarea id="mt-desc" v-model="form.description" class="textarea" rows="3" placeholder="顯示在狀態頁" />
          </div>

          <fieldset class="field">
            <legend>排程方式</legend>
            <div class="strategies">
              <label class="check"><input v-model="form.strategy" type="radio" value="manual" /><span>手動<small>啟用就開始，停用才結束</small></span></label>
              <label class="check"><input v-model="form.strategy" type="radio" value="single" /><span>單次<small>指定開始和結束時間</small></span></label>
              <label class="check"><input v-model="form.strategy" type="radio" value="weekly" /><span>每週<small>每週固定時段重複</small></span></label>
            </div>
          </fieldset>

          <template v-if="form.strategy === 'single'">
            <p class="help">時間用這台電腦的時區（{{ browserTimeZone }}）。</p>
            <div class="form-row">
              <div class="field">
                <label for="mt-start" class="req">開始</label>
                <input id="mt-start" v-model="form.start" type="datetime-local" class="input" :aria-invalid="!!errors.start" />
                <p v-if="errors.start" class="field-error">{{ errors.start }}</p>
              </div>
              <div class="field">
                <label for="mt-end" class="req">結束</label>
                <input id="mt-end" v-model="form.end" type="datetime-local" class="input" :aria-invalid="!!errors.end" />
                <p v-if="errors.end" class="field-error">{{ errors.end }}</p>
              </div>
            </div>
          </template>

          <template v-if="form.strategy === 'weekly'">
            <fieldset class="field">
              <legend class="req">星期</legend>
              <div class="days">
                <label v-for="(d, i) in WEEKDAYS" :key="i" class="day" :class="{ on: form.weekdays.includes(i) }">
                  <input
                    type="checkbox"
                    class="visually-hidden"
                    :checked="form.weekdays.includes(i)"
                    @change="toggleDay(i, ($event.target as HTMLInputElement).checked)"
                  />
                  <span>{{ d }}</span>
                </label>
              </div>
              <p v-if="errors.weekdays" class="field-error">{{ errors.weekdays }}</p>
            </fieldset>
            <div class="form-row">
              <div class="field">
                <label for="mt-st" class="req">開始時間</label>
                <input id="mt-st" v-model="form.startTime" type="time" class="input" :aria-invalid="!!errors.startTime" />
                <p v-if="errors.startTime" class="field-error">{{ errors.startTime }}</p>
              </div>
              <div class="field">
                <label for="mt-et" class="req">結束時間</label>
                <input id="mt-et" v-model="form.endTime" type="time" class="input" :aria-invalid="!!errors.endTime" />
                <p v-if="errors.endTime" class="field-error">{{ errors.endTime }}</p>
              </div>
            </div>
            <p class="help">
              結束早於開始代表跨午夜。<template v-if="crossesMidnight">目前設定會從 {{ form.startTime }} 到隔天 {{ form.endTime }}。</template>
            </p>
            <div class="field">
              <label for="mt-tz" class="req">時區</label>
              <input
                id="mt-tz"
                v-model="form.timezone"
                class="input mono"
                list="mt-tz-list"
                spellcheck="false"
                :aria-invalid="!!errors.timezone"
              />
              <datalist id="mt-tz-list">
                <option v-for="z in timeZoneOptions()" :key="z" :value="z" />
              </datalist>
              <p v-if="errors.timezone" class="field-error">{{ errors.timezone }}</p>
              <p v-else class="help">IANA 時區名稱，例：Asia/Taipei</p>
            </div>
          </template>

          <label class="check"><input v-model="form.active" type="checkbox" /><span>啟用</span></label>

          <fieldset class="field">
            <legend>影響的監測項目 <span class="faint num">（已選 {{ form.monitorIds.length }}）</span></legend>
            <div class="mon-tools">
              <label class="mon-search">
                <Search aria-hidden="true" />
                <span class="visually-hidden">搜尋監測項目</span>
                <input v-model="monitorQuery" type="search" class="input" placeholder="搜尋" />
              </label>
              <button type="button" class="btn btn-sm" @click="selectShown(true)">全選</button>
              <button type="button" class="btn btn-sm" @click="selectShown(false)">清除</button>
            </div>
            <div class="mon-list">
              <p v-if="!filteredMonitors.length" class="faint small pad">沒有符合的項目</p>
              <label v-for="m in filteredMonitors" :key="m.id" class="check">
                <input
                  type="checkbox"
                  :checked="form.monitorIds.includes(m.id)"
                  @change="toggleMonitor(m.id, ($event.target as HTMLInputElement).checked)"
                /><span>{{ m.name }}<small v-if="m.groupName">{{ m.groupName }}</small></span>
              </label>
            </div>
          </fieldset>

          <ErrorNotice v-if="saveError" :message="saveError" />
          <div class="form-actions">
            <button type="submit" class="btn btn-primary" :disabled="saving">
              {{ saving ? '儲存中…' : isNew ? '新增' : '儲存' }}
            </button>
            <button type="button" class="btn" @click="editing = null">取消</button>
          </div>
        </form>
      </section>
    </div>
  </div>
</template>

<style scoped>
.state {
  color: var(--ink-2);
}

.state.now {
  color: var(--maint);
  font-weight: 600;
}

.row.s-maint {
  box-shadow: inset 3px 0 0 var(--maint-bar);
}

.switch {
  align-items: center;
  margin-right: 6px;
  font-size: var(--fs-sm);
}

.switch input {
  margin: 0;
}

.row-actions {
  align-items: center;
}

.strategies {
  display: grid;
  gap: 8px;
}

.days {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.day {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--surface);
  cursor: pointer;
  user-select: none;
}

.day.on {
  border-color: var(--ink);
  background: var(--ink);
  color: var(--bg);
  font-weight: 600;
}

.day:has(input:focus-visible) {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

.mon-tools {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}

.mon-search {
  position: relative;
  flex: 1;
}

.mon-search svg {
  position: absolute;
  top: 50%;
  left: 9px;
  width: 15px;
  height: 15px;
  color: var(--ink-3);
  transform: translateY(-50%);
}

.mon-search .input {
  min-height: 30px;
  padding: 4px 8px 4px 30px;
  font-size: var(--fs-sm);
}

.mon-list {
  display: grid;
  gap: 8px;
  max-height: 240px;
  overflow-y: auto;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
}

.pad {
  padding: 4px;
}
</style>
