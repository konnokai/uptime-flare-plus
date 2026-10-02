<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { CircleCheck, Pencil, Pin, Plus, Trash } from '@lucide/vue';
import type { Incident, IncidentInput, IncidentStyle } from '../../../shared/types';
import { api, errorMessage, isAuthError } from '../../api';
import { confirm } from '../../confirm';
import { formatDateTime } from '../../format';
import { renderMarkdown } from '../../markdown';
import ErrorNotice from '../../components/ErrorNotice.vue';
import { session } from './session';

const list = ref<Incident[]>([]);
const loaded = ref(false);
const loadError = ref('');
const authError = ref(false);
const rowError = ref('');

async function load() {
  try {
    list.value = await api.get<Incident[]>('/api/admin/incidents');
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

const STYLES: { value: IncidentStyle; label: string; cls: string }[] = [
  { value: 'info', label: '一般', cls: 'st-info' },
  { value: 'warning', label: '注意', cls: 'st-warning' },
  { value: 'danger', label: '嚴重', cls: 'st-danger' },
];
const styleOf = (s: IncidentStyle) => STYLES.find((x) => x.value === s)!;

const sorted = computed(() =>
  [...list.value].sort((a, b) => {
    const ar = a.resolvedAt != null;
    const br = b.resolvedAt != null;
    if (ar !== br) return ar ? 1 : -1;
    if (!ar && a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.createdAt - a.createdAt;
  }),
);

const editing = ref<number | null>(null);
const isNew = computed(() => editing.value === 0);
const current = computed(() => list.value.find((i) => i.id === editing.value) ?? null);
const form = reactive<IncidentInput>({ title: '', content: '', style: 'info', pinned: false });
const errors = reactive<{ title?: string; content?: string }>({});
const saving = ref(false);
const saveError = ref('');

const preview = computed(() => (form.content.trim() ? renderMarkdown(form.content) : ''));

function open(i?: Incident) {
  editing.value = i?.id ?? 0;
  Object.assign(form, {
    title: i?.title ?? '',
    content: i?.content ?? '',
    style: i?.style ?? 'info',
    pinned: i?.pinned ?? false,
  });
  delete errors.title;
  delete errors.content;
  saveError.value = '';
  requestAnimationFrame(() => document.getElementById('inc-title')?.focus());
}

async function save() {
  delete errors.title;
  delete errors.content;
  saveError.value = '';
  if (!form.title.trim()) errors.title = '請填標題';
  if (!form.content.trim()) errors.content = '請填內容';
  if (errors.title || errors.content) return;
  const input: IncidentInput = { ...form, title: form.title.trim() };
  saving.value = true;
  try {
    if (isNew.value) await api.post<Incident>('/api/admin/incidents', input);
    else await api.put<Incident>(`/api/admin/incidents/${editing.value}`, input);
    await load();
    editing.value = null;
  } catch (err) {
    saveError.value = errorMessage(err);
  } finally {
    saving.value = false;
  }
}

async function resolve(i: Incident) {
  const ok = await confirm({
    title: `把「${i.title}」標記為已解決？`,
    message: '狀態頁會把它移到「最近已解決」。',
    confirmText: '標記已解決',
  });
  if (!ok) return;
  rowError.value = '';
  try {
    await api.post<Incident>(`/api/admin/incidents/${i.id}/resolve`);
    await load();
  } catch (err) {
    rowError.value = errorMessage(err);
  }
}

async function remove(i: Incident) {
  const ok = await confirm({ title: `刪除「${i.title}」？`, message: '刪除後無法復原。', confirmText: '刪除', danger: true });
  if (!ok) return;
  rowError.value = '';
  try {
    await api.del<{ ok: true }>(`/api/admin/incidents/${i.id}`);
    if (editing.value === i.id) editing.value = null;
    await load();
  } catch (err) {
    rowError.value = errorMessage(err);
  }
}
</script>

<template>
  <div class="crud">
    <div class="page-head">
      <div>
        <h1>事件公告</h1>
        <p class="muted small">發布在狀態頁上方，支援 Markdown。</p>
      </div>
      <button type="button" class="btn btn-primary" @click="open()"><Plus aria-hidden="true" />新增公告</button>
    </div>

    <ErrorNotice v-if="loadError" :message="loadError" :auth="authError" />

    <div class="layout wide" :class="{ editing: editing !== null }">
      <section class="list" aria-label="公告清單">
        <ErrorNotice v-if="rowError" :message="rowError" />
        <p v-if="!loaded" class="faint">載入中…</p>
        <p v-else-if="!list.length && !loadError" class="empty">還沒有公告。</p>
        <ul v-else class="rows">
          <li
            v-for="i in sorted"
            :key="i.id"
            class="row"
            :class="[styleOf(i.style).cls, { current: editing === i.id, off: i.resolvedAt != null }]"
          >
            <div class="row-main">
              <div class="row-title">
                <Pin v-if="i.pinned && i.resolvedAt == null" class="pin" aria-label="置頂" />
                <span class="name">{{ i.title }}</span>
                <span class="sev">{{ styleOf(i.style).label }}</span>
                <span v-if="i.resolvedAt != null" class="flag faint">已解決</span>
              </div>
              <div class="small faint num">
                發布 {{ formatDateTime(i.createdAt, tz) }}
                <template v-if="i.updatedAt > i.createdAt + 60_000"> · 更新 {{ formatDateTime(i.updatedAt, tz) }}</template>
                <template v-if="i.resolvedAt != null"> · 解決 {{ formatDateTime(i.resolvedAt, tz) }}</template>
              </div>
            </div>
            <div class="row-actions">
              <button v-if="i.resolvedAt == null" type="button" class="btn btn-sm" @click="resolve(i)">
                <CircleCheck aria-hidden="true" />標記已解決
              </button>
              <button type="button" class="btn btn-sm" @click="open(i)"><Pencil aria-hidden="true" />編輯</button>
              <button type="button" class="btn btn-sm btn-ghost btn-danger" :aria-label="`刪除 ${i.title}`" @click="remove(i)">
                <Trash aria-hidden="true" />
              </button>
            </div>
          </li>
        </ul>
      </section>

      <section v-if="editing !== null" class="editor" aria-labelledby="inc-editor-title">
        <h2 id="inc-editor-title">{{ isNew ? '新增公告' : '編輯公告' }}</h2>
        <form class="form" novalidate @submit.prevent="save">
          <div class="field">
            <label for="inc-title" class="req">標題</label>
            <input id="inc-title" v-model="form.title" class="input" :aria-invalid="!!errors.title" />
            <p v-if="errors.title" class="field-error">{{ errors.title }}</p>
          </div>
          <fieldset class="field">
            <legend>嚴重程度</legend>
            <div class="styles">
              <label v-for="s in STYLES" :key="s.value" class="style-opt" :class="[s.cls, { on: form.style === s.value }]">
                <input v-model="form.style" type="radio" :value="s.value" class="visually-hidden" />
                <span>{{ s.label }}</span>
              </label>
            </div>
          </fieldset>
          <label class="check"><input v-model="form.pinned" type="checkbox" /><span>置頂<small>排在其他未解決公告前面</small></span></label>
          <div class="field">
            <label for="inc-content" class="req">內容（Markdown）</label>
            <textarea
              id="inc-content"
              v-model="form.content"
              class="textarea mono"
              rows="8"
              :aria-invalid="!!errors.content"
              placeholder="**影響範圍**：登入功能&#10;&#10;我們正在處理，預計 30 分鐘內修復。"
            />
            <p v-if="errors.content" class="field-error">{{ errors.content }}</p>
          </div>
          <div class="field">
            <span class="label">預覽</span>
            <div class="preview" :class="styleOf(form.style).cls">
              <strong class="preview-title">{{ form.title || '（標題）' }}</strong>
              <div v-if="preview" class="prose small" v-html="preview" />
              <p v-else class="faint small">輸入內容後會顯示在這裡。</p>
            </div>
          </div>

          <ErrorNotice v-if="saveError" :message="saveError" />
          <div class="form-actions">
            <button type="submit" class="btn btn-primary" :disabled="saving">
              {{ saving ? '儲存中…' : isNew ? '發布' : '更新' }}
            </button>
            <button v-if="current && current.resolvedAt == null" type="button" class="btn" @click="resolve(current)">
              標記已解決
            </button>
            <button v-if="current" type="button" class="btn btn-danger" @click="remove(current)">刪除</button>
            <button type="button" class="btn btn-ghost" @click="editing = null">取消</button>
          </div>
        </form>
      </section>
    </div>
  </div>
</template>

<style scoped>
.st-info { --sev: var(--info); }
.st-warning { --sev: var(--pending); --sev-bar: var(--pending-bar); }
.st-danger { --sev: var(--down); --sev-bar: var(--down-bar); }

.row {
  box-shadow: inset 3px 0 0 var(--sev-bar, var(--sev));
}

.row.off {
  box-shadow: none;
}

.row.current {
  box-shadow: inset 3px 0 0 var(--ink);
}

.sev {
  font-size: var(--fs-xs);
  font-weight: 600;
  color: var(--sev);
}

.pin {
  width: 14px;
  height: 14px;
  color: var(--ink-2);
}

.layout.wide.editing {
  grid-template-columns: minmax(0, 1fr) minmax(360px, 520px);
}

@media (max-width: 1100px) {
  .layout.wide.editing {
    grid-template-columns: minmax(0, 1fr);
  }
}

.styles {
  display: flex;
  gap: 6px;
}

.style-opt {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 0 14px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  font-size: var(--fs-sm);
  cursor: pointer;
}

.style-opt::before {
  content: "";
  width: 8px;
  height: 8px;
  border-radius: 2px;
  background: var(--sev-bar, var(--sev));
}

.style-opt.on {
  border-color: var(--sev);
  box-shadow: inset 0 0 0 1px var(--sev);
  font-weight: 600;
}

.style-opt:has(input:focus-visible) {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

.preview {
  display: grid;
  gap: 6px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-left: 3px solid var(--sev-bar, var(--sev));
  border-radius: var(--radius);
  background: var(--bg);
}

.preview-title {
  font-size: var(--fs-md);
}
</style>
