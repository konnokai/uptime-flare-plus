<script setup lang="ts">
import { computed, inject, nextTick, reactive, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { ArrowLeft } from '@lucide/vue';
import { HTTP_METHODS } from '../../../shared/types';
import type { HttpMethod, Monitor, MonitorInput, MonitorType, NotificationChannel } from '../../../shared/types';
import { api, errorMessage, isAuthError } from '../../api';
import ErrorNotice from '../../components/ErrorNotice.vue';
import { monitorsKey } from './monitorsContext';

const route = useRoute();
const router = useRouter();
const ctx = inject(monitorsKey)!;

const editId = computed(() => (route.name === 'monitor-edit' ? Number(route.params.id) : null));
const isEdit = computed(() => editId.value != null);

interface FormState {
  type: MonitorType;
  name: string;
  description: string;
  groupName: string;
  sortOrder: number | '';
  isPublic: boolean;
  active: boolean;
  intervalS: number | '';
  retries: number | '';
  retryIntervalS: number | '';
  resendInterval: number | '';
  upsideDown: boolean;
  url: string;
  method: HttpMethod;
  headersText: string;
  body: string;
  codesText: string;
  keyword: string;
  invertKeyword: boolean;
  timeoutS: number | '';
  maxRedirects: number | '';
  notificationIds: number[];
}

function defaults(): FormState {
  return {
    type: 'http',
    name: '',
    description: '',
    groupName: '',
    sortOrder: 0,
    isPublic: true,
    active: true,
    intervalS: 60,
    retries: 0,
    retryIntervalS: 60,
    resendInterval: 0,
    upsideDown: false,
    url: '',
    method: 'GET',
    headersText: '',
    body: '',
    codesText: '200-299',
    keyword: '',
    invertKeyword: false,
    timeoutS: 30,
    maxRedirects: 10,
    notificationIds: [],
  };
}

const form = reactive<FormState>(defaults());
const errors = reactive<Partial<Record<keyof FormState, string>>>({});
const serverError = ref('');
const loadError = ref('');
const authError = ref(false);
const saving = ref(false);
const loading = ref(false);
const channels = ref<NotificationChannel[]>([]);
const channelsLoaded = ref(false);
const channelsError = ref('');

function fill(m: Monitor) {
  Object.assign(form, {
    type: m.type,
    name: m.name,
    description: m.description,
    groupName: m.groupName,
    sortOrder: m.sortOrder,
    isPublic: m.isPublic,
    active: m.active,
    intervalS: m.intervalS,
    retries: m.retries,
    retryIntervalS: m.retryIntervalS,
    resendInterval: m.resendInterval,
    upsideDown: m.upsideDown,
    url: m.url,
    method: m.method,
    headersText: Object.keys(m.headers ?? {}).length ? JSON.stringify(m.headers, null, 2) : '',
    body: m.body,
    codesText: m.acceptedCodes.join(', '),
    keyword: m.keyword,
    invertKeyword: m.invertKeyword,
    timeoutS: m.timeoutS,
    maxRedirects: m.maxRedirects,
    notificationIds: [...m.notificationIds],
  } satisfies FormState);
}

async function init() {
  Object.assign(form, defaults());
  for (const k of Object.keys(errors) as (keyof FormState)[]) delete errors[k];
  serverError.value = '';
  loadError.value = '';
  loading.value = true;

  const channelsReq = api
    .get<NotificationChannel[]>('/api/admin/notifications')
    .then((list) => {
      channels.value = list;
      channelsLoaded.value = true;
      channelsError.value = '';
    })
    .catch((err) => {
      channelsLoaded.value = false;
      channelsError.value = errorMessage(err);
    });

  try {
    if (editId.value != null) {
      const m = await api.get<Monitor>(`/api/admin/monitors/${editId.value}`);
      fill(m);
      await channelsReq;
    } else {
      await channelsReq;
      form.notificationIds = channels.value.filter((c) => c.isDefault).map((c) => c.id);
    }
  } catch (err) {
    loadError.value = errorMessage(err);
    authError.value = isAuthError(err);
  } finally {
    loading.value = false;
  }
}

watch(editId, init, { immediate: true });

const hasBody = computed(() => form.method !== 'GET' && form.method !== 'HEAD');

function toggleChannel(id: number, on: boolean) {
  const set = new Set(form.notificationIds);
  if (on) set.add(id);
  else set.delete(id);
  form.notificationIds = [...set];
}

function int(v: number | '', min: number): number | null {
  if (v === '' || !Number.isInteger(v) || v < min) return null;
  return v;
}

function parseHeaders(text: string): Record<string, string> | null {
  if (!text.trim()) return {};
  try {
    const obj: unknown = JSON.parse(text);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v !== 'string') return null;
      out[k] = v;
    }
    return out;
  } catch {
    return null;
  }
}

function parseCodes(text: string): string[] | null {
  const parts = text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) return null;
  const re = /^[1-5]\d{2}(-[1-5]\d{2})?$/;
  return parts.every((p) => re.test(p)) ? parts : null;
}

function validate(): MonitorInput | null {
  for (const k of Object.keys(errors) as (keyof FormState)[]) delete errors[k];
  const f = form;

  if (!f.name.trim()) errors.name = '請填名稱';
  const interval = int(f.intervalS, 20);
  if (interval == null) errors.intervalS = '至少 20 秒的整數';
  const retries = int(f.retries, 0);
  if (retries == null) errors.retries = '請填 0 以上的整數';
  const retryInterval = int(f.retryIntervalS, 20);
  if (retryInterval == null) errors.retryIntervalS = '至少 20 秒的整數';
  const resend = int(f.resendInterval, 0);
  if (resend == null) errors.resendInterval = '請填 0 以上的整數';
  const sortOrder = f.sortOrder === '' ? 0 : Number.isInteger(f.sortOrder) ? f.sortOrder : null;
  if (sortOrder == null) errors.sortOrder = '請填整數';

  let headers: Record<string, string> = {};
  let codes: string[] = ['200-299'];
  let timeout = 30;
  let redirects = 10;

  if (f.type === 'http') {
    const url = f.url.trim();
    if (!url) errors.url = '請填 URL';
    else {
      try {
        const u = new URL(url);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') errors.url = '只支援 http:// 或 https://';
      } catch {
        errors.url = 'URL 格式不正確';
      }
    }
    const h = parseHeaders(f.headersText);
    if (h == null) errors.headersText = '要是 JSON 物件，值都要是字串，例如 {"Authorization": "Bearer xxx"}';
    else headers = h;
    const c = parseCodes(f.codesText);
    if (c == null) errors.codesText = '格式例：200-299, 301';
    else codes = c;
    const t = int(f.timeoutS, 1);
    if (t == null) errors.timeoutS = '請填 1 以上的整數';
    else if (interval != null && t >= interval) errors.timeoutS = '要小於檢查間隔';
    else timeout = t;
    const r = int(f.maxRedirects, 0);
    if (r == null) errors.maxRedirects = '請填 0 以上的整數';
    else redirects = r;
  }

  if (Object.keys(errors).length) return null;

  const input: MonitorInput = {
    name: f.name.trim(),
    type: f.type,
    active: f.active,
    intervalS: interval!,
    retryIntervalS: retryInterval!,
    retries: retries!,
    resendInterval: resend!,
    upsideDown: f.upsideDown,
    description: f.description.trim(),
    isPublic: f.isPublic,
    groupName: f.groupName.trim(),
    sortOrder: sortOrder!,
    url: f.type === 'http' ? f.url.trim() : '',
    method: f.method,
    headers,
    body: f.type === 'http' && hasBody.value ? f.body : '',
    acceptedCodes: codes,
    keyword: f.type === 'http' ? f.keyword : '',
    invertKeyword: f.type === 'http' ? f.invertKeyword : false,
    timeoutS: timeout,
    maxRedirects: redirects,
  };
  // 通知清單沒載入成功時不送，新增時讓後端套用預設通知，編輯時保留原設定
  if (channelsLoaded.value) input.notificationIds = [...f.notificationIds];
  return input;
}

async function submit() {
  serverError.value = '';
  const input = validate();
  if (!input) {
    serverError.value = '有欄位需要修正，請看標示紅字的地方。';
    await nextTick();
    document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    return;
  }
  saving.value = true;
  try {
    const saved = isEdit.value
      ? await api.put<Monitor>(`/api/admin/monitors/${editId.value}`, input)
      : await api.post<Monitor>('/api/admin/monitors', input);
    await ctx.refresh();
    void router.push(`/admin/monitors/${saved.id}`);
  } catch (err) {
    serverError.value = errorMessage(err);
  } finally {
    saving.value = false;
  }
}

const backTo = computed(() => (isEdit.value ? `/admin/monitors/${editId.value}` : '/admin/monitors'));
</script>

<template>
  <div class="wrap">
    <RouterLink :to="backTo" class="back"><ArrowLeft aria-hidden="true" />{{ isEdit ? '返回詳細資料' : '返回清單' }}</RouterLink>
    <h1>{{ isEdit ? '編輯監測' : '新增監測' }}</h1>

    <ErrorNotice v-if="loadError" :message="loadError" :auth="authError" />
    <p v-else-if="loading" class="faint">載入中…</p>

    <form v-else class="form" novalidate @submit.prevent="submit">
      <fieldset class="field">
        <legend>類型</legend>
        <div class="type-choice">
          <label class="type-opt" :class="{ on: form.type === 'http', locked: isEdit }">
            <input v-model="form.type" type="radio" value="http" :disabled="isEdit" />
            <span>
              <strong>HTTP</strong>
              <small>定時請求 URL，檢查狀態碼和關鍵字</small>
            </span>
          </label>
          <label class="type-opt" :class="{ on: form.type === 'push', locked: isEdit }">
            <input v-model="form.type" type="radio" value="push" :disabled="isEdit" />
            <span>
              <strong>Push</strong>
              <small>由服務主動回報，逾時沒回報就算 down</small>
            </span>
          </label>
        </div>
        <p v-if="isEdit" class="help">建立後不能更改類型。</p>
      </fieldset>

      <div class="field">
        <label for="m-name" class="req">名稱</label>
        <input id="m-name" v-model="form.name" class="input" maxlength="100" :aria-invalid="!!errors.name" />
        <p v-if="errors.name" class="field-error">{{ errors.name }}</p>
      </div>

      <div class="field">
        <label for="m-desc">說明</label>
        <input id="m-desc" v-model="form.description" class="input" placeholder="顯示在狀態頁名稱下方，可留空" />
      </div>

      <div class="form-row">
        <div class="field">
          <label for="m-group">群組名稱</label>
          <input id="m-group" v-model="form.groupName" class="input" list="m-group-list" placeholder="例：網站" />
          <datalist id="m-group-list">
            <option v-for="g in [...new Set(ctx.list.value.map((m) => m.groupName).filter(Boolean))]" :key="g" :value="g" />
          </datalist>
        </div>
        <div class="field">
          <label for="m-sort">排序</label>
          <input id="m-sort" v-model.number="form.sortOrder" type="number" step="1" class="input" :aria-invalid="!!errors.sortOrder" />
          <p v-if="errors.sortOrder" class="field-error">{{ errors.sortOrder }}</p>
          <p v-else class="help">數字小的排前面</p>
        </div>
      </div>

      <div class="checks">
        <label class="check"><input v-model="form.active" type="checkbox" /><span>啟用<small>關閉 = 暫停檢查</small></span></label>
        <label class="check"><input v-model="form.isPublic" type="checkbox" /><span>顯示在狀態頁</span></label>
      </div>

      <section v-if="form.type === 'http'" class="form-section">
        <h3>HTTP 請求</h3>
        <div class="url-row">
          <div class="field method">
            <label for="m-method">Method</label>
            <select id="m-method" v-model="form.method" class="select">
              <option v-for="m in HTTP_METHODS" :key="m" :value="m">{{ m }}</option>
            </select>
          </div>
          <div class="field grow">
            <label for="m-url" class="req">URL</label>
            <input
              id="m-url"
              v-model="form.url"
              type="url"
              class="input mono"
              placeholder="https://example.com/health"
              :aria-invalid="!!errors.url"
            />
            <p v-if="errors.url" class="field-error">{{ errors.url }}</p>
          </div>
        </div>

        <div class="field">
          <label for="m-headers">Headers</label>
          <textarea
            id="m-headers"
            v-model="form.headersText"
            class="textarea mono"
            rows="3"
            spellcheck="false"
            placeholder='{"Authorization": "Bearer xxx"}'
            :aria-invalid="!!errors.headersText"
          />
          <p v-if="errors.headersText" class="field-error">{{ errors.headersText }}</p>
          <p v-else class="help">JSON 物件，可留空</p>
        </div>

        <div v-if="hasBody" class="field">
          <label for="m-body">Body</label>
          <textarea id="m-body" v-model="form.body" class="textarea mono" rows="4" spellcheck="false" />
        </div>

        <div class="form-row">
          <div class="field">
            <label for="m-codes">接受的狀態碼</label>
            <input id="m-codes" v-model="form.codesText" class="input mono" :aria-invalid="!!errors.codesText" />
            <p v-if="errors.codesText" class="field-error">{{ errors.codesText }}</p>
            <p v-else class="help">用逗號分隔，例：200-299, 301</p>
          </div>
          <div class="field">
            <label for="m-timeout">逾時秒數</label>
            <input id="m-timeout" v-model.number="form.timeoutS" type="number" min="1" class="input" :aria-invalid="!!errors.timeoutS" />
            <p v-if="errors.timeoutS" class="field-error">{{ errors.timeoutS }}</p>
            <p v-else class="help">要小於檢查間隔</p>
          </div>
          <div class="field">
            <label for="m-redirects">最多轉址次數</label>
            <input id="m-redirects" v-model.number="form.maxRedirects" type="number" min="0" class="input" :aria-invalid="!!errors.maxRedirects" />
            <p v-if="errors.maxRedirects" class="field-error">{{ errors.maxRedirects }}</p>
            <p v-else class="help">0 = 不跟隨轉址</p>
          </div>
        </div>

        <div class="field">
          <label for="m-keyword">關鍵字</label>
          <input id="m-keyword" v-model="form.keyword" class="input" placeholder="回應內容要包含的文字，可留空" />
          <label v-if="form.keyword" class="check">
            <input v-model="form.invertKeyword" type="checkbox" /><span>反向關鍵字<small>勾選後，內容出現這個關鍵字反而算 down</small></span></label>
        </div>
      </section>

      <section v-else class="form-section">
        <h3>Push</h3>
        <p class="muted">服務要在每個間隔內呼叫 push URL，逾時就判定為 down。</p>
        <p class="help">{{ isEdit ? 'push URL 在詳細資料頁。' : '儲存後會產生 push URL，在詳細資料頁可以複製。' }}</p>
      </section>

      <section class="form-section">
        <h3>檢查頻率</h3>
        <div class="form-row">
          <div class="field">
            <label for="m-interval">檢查間隔秒數</label>
            <input id="m-interval" v-model.number="form.intervalS" type="number" min="20" class="input" :aria-invalid="!!errors.intervalS" />
            <p v-if="errors.intervalS" class="field-error">{{ errors.intervalS }}</p>
            <p v-else class="help">最少 20 秒</p>
          </div>
          <div class="field">
            <label for="m-retries">重試次數</label>
            <input id="m-retries" v-model.number="form.retries" type="number" min="0" class="input" :aria-invalid="!!errors.retries" />
            <p v-if="errors.retries" class="field-error">{{ errors.retries }}</p>
            <p v-else class="help">失敗後先標為待確認，重試都失敗才算 down</p>
          </div>
          <div class="field">
            <label for="m-retry-int">重試間隔秒數</label>
            <input id="m-retry-int" v-model.number="form.retryIntervalS" type="number" min="20" class="input" :aria-invalid="!!errors.retryIntervalS" />
            <p v-if="errors.retryIntervalS" class="field-error">{{ errors.retryIntervalS }}</p>
          </div>
        </div>
        <label class="check">
          <input v-model="form.upsideDown" type="checkbox" /><span>反向模式<small>服務連不上才算正常，連得上算 down</small></span></label>
      </section>

      <section class="form-section">
        <h3>通知</h3>
        <div class="field narrow">
          <label for="m-resend">重送通知間隔</label>
          <input id="m-resend" v-model.number="form.resendInterval" type="number" min="0" class="input" :aria-invalid="!!errors.resendInterval" />
          <p v-if="errors.resendInterval" class="field-error">{{ errors.resendInterval }}</p>
          <p v-else class="help">
            {{ form.resendInterval ? `連續 down ${form.resendInterval} 次後再通知一次` : '0 = 不重送，只在狀態改變時通知' }}
          </p>
        </div>
        <fieldset class="field">
          <legend>通知管道</legend>
          <ErrorNotice v-if="channelsError" :message="`無法載入通知管道：${channelsError}`" />
          <p v-else-if="!channels.length" class="help">
            還沒有通知管道。<RouterLink to="/admin/notifications">前往新增</RouterLink>
          </p>
          <div v-else class="channel-list">
            <label v-for="c in channels" :key="c.id" class="check">
              <input
                type="checkbox"
                :checked="form.notificationIds.includes(c.id)"
                @change="toggleChannel(c.id, ($event.target as HTMLInputElement).checked)"
              /><span>{{ c.name }}
              <small>{{ [c.active ? 'Discord' : 'Discord · 已停用', c.isDefault ? '預設' : ''].filter(Boolean).join(' · ') }}</small></span></label>
          </div>
        </fieldset>
      </section>

      <ErrorNotice v-if="serverError" :message="serverError" />

      <div class="form-actions">
        <button type="submit" class="btn btn-primary" :disabled="saving">
          {{ saving ? '儲存中…' : isEdit ? '儲存變更' : '建立監測' }}
        </button>
        <RouterLink :to="backTo" class="btn">取消</RouterLink>
      </div>
    </form>
  </div>
</template>

<style scoped>
.wrap {
  display: grid;
  gap: 16px;
  max-width: 760px;
}

.back {
  display: inline-flex;
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

h1 {
  font-size: var(--fs-xl);
}

.type-choice {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 8px;
}

.type-opt {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--surface);
  cursor: pointer;
}

.type-opt input {
  margin: 3px 0 0;
  accent-color: var(--ink);
}

.type-opt.on {
  border-color: var(--ink);
  box-shadow: inset 0 0 0 1px var(--ink);
}

.type-opt.locked {
  cursor: default;
}

.type-opt.locked:not(.on) {
  opacity: 0.5;
}

.type-opt span {
  display: grid;
  gap: 2px;
}

.type-opt small {
  color: var(--ink-2);
  font-size: var(--fs-sm);
}

.checks {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 28px;
}

.url-row {
  display: flex;
  gap: 12px;
}

.method {
  flex: none;
  width: 120px;
}

.grow {
  flex: 1;
}

.narrow {
  max-width: 280px;
}

.channel-list {
  display: grid;
  gap: 8px;
}

@media (max-width: 560px) {
  .url-row {
    flex-direction: column;
  }
  .method {
    width: 100%;
  }
}
</style>
