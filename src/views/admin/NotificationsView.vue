<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { CircleCheck, Pencil, Plus, Send, Trash } from '@lucide/vue';
import type { NotificationChannel, NotificationInput } from '../../../shared/types';
import { api, errorMessage, isAuthError } from '../../api';
import { confirm } from '../../confirm';
import ErrorNotice from '../../components/ErrorNotice.vue';

const list = ref<NotificationChannel[]>([]);
const loaded = ref(false);
const loadError = ref('');
const authError = ref(false);

async function load() {
  try {
    list.value = await api.get<NotificationChannel[]>('/api/admin/notifications');
    loadError.value = '';
  } catch (err) {
    loadError.value = errorMessage(err);
    authError.value = isAuthError(err);
  } finally {
    loaded.value = true;
  }
}

onMounted(load);

/** null = 關閉表單，0 = 新增 */
const editing = ref<number | null>(null);
const form = reactive({ name: '', webhookUrl: '', username: '', isDefault: false, active: true, applyToAll: false });
const errors = reactive<{ name?: string; webhookUrl?: string }>({});
const saving = ref(false);
const saveError = ref('');
const testState = ref<{ ok: boolean; msg: string } | null>(null);
const testing = ref(false);

const isNew = computed(() => editing.value === 0);

function open(c?: NotificationChannel) {
  editing.value = c?.id ?? 0;
  Object.assign(form, {
    name: c?.name ?? '',
    webhookUrl: c?.webhookUrl ?? '',
    username: c?.username ?? '',
    isDefault: c?.isDefault ?? false,
    active: c?.active ?? true,
    applyToAll: false,
  });
  delete errors.name;
  delete errors.webhookUrl;
  saveError.value = '';
  testState.value = null;
  // 手機上表單在清單上方，打開時捲過去
  requestAnimationFrame(() => document.getElementById('n-name')?.focus());
}

function close() {
  editing.value = null;
}

function checkUrl(): boolean {
  delete errors.webhookUrl;
  const v = form.webhookUrl.trim();
  if (!v) {
    errors.webhookUrl = '請填 Webhook URL';
    return false;
  }
  try {
    const u = new URL(v);
    if (u.protocol !== 'https:') {
      errors.webhookUrl = '要用 https:// 開頭';
      return false;
    }
  } catch {
    errors.webhookUrl = 'URL 格式不正確';
    return false;
  }
  return true;
}

async function save() {
  saveError.value = '';
  delete errors.name;
  if (!form.name.trim()) errors.name = '請填名稱';
  const urlOk = checkUrl();
  if (errors.name || !urlOk) return;

  const input: NotificationInput = {
    name: form.name.trim(),
    type: 'discord',
    webhookUrl: form.webhookUrl.trim(),
    username: form.username.trim(),
    isDefault: form.isDefault,
    active: form.active,
  };
  if (isNew.value) input.applyToAll = form.applyToAll;

  saving.value = true;
  try {
    if (isNew.value) await api.post<NotificationChannel>('/api/admin/notifications', input);
    else await api.put<NotificationChannel>(`/api/admin/notifications/${editing.value}`, input);
    await load();
    close();
  } catch (err) {
    saveError.value = errorMessage(err);
  } finally {
    saving.value = false;
  }
}

async function sendTest() {
  testState.value = null;
  if (!checkUrl()) return;
  testing.value = true;
  try {
    await api.post<{ ok: true }>('/api/admin/notifications/test', {
      webhookUrl: form.webhookUrl.trim(),
      username: form.username.trim(),
    });
    testState.value = { ok: true, msg: '測試訊息已送出，請到 Discord 頻道確認。' };
  } catch (err) {
    testState.value = { ok: false, msg: `送出失敗：${errorMessage(err)}` };
  } finally {
    testing.value = false;
  }
}

const rowError = ref('');

async function remove(c: NotificationChannel) {
  const ok = await confirm({
    title: `刪除「${c.name}」？`,
    message: '使用這個管道的監測項目會停止透過它通知。',
    confirmText: '刪除',
    danger: true,
  });
  if (!ok) return;
  rowError.value = '';
  try {
    await api.del<{ ok: true }>(`/api/admin/notifications/${c.id}`);
    if (editing.value === c.id) close();
    await load();
  } catch (err) {
    rowError.value = errorMessage(err);
  }
}

function mask(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    const last = parts.pop() ?? '';
    const shown = last.length > 6 ? `${last.slice(0, 4)}••••` : '••••';
    return `${u.host}/${[...parts, shown].join('/')}`;
  } catch {
    return url.length > 16 ? `${url.slice(0, 12)}••••` : '••••';
  }
}
</script>

<template>
  <div class="crud">
    <div class="page-head">
      <div>
        <h1>通知</h1>
        <p class="muted small">監測狀態改變時，透過 Discord Webhook 發訊息。</p>
      </div>
      <button type="button" class="btn btn-primary" @click="open()"><Plus aria-hidden="true" />新增通知</button>
    </div>

    <ErrorNotice v-if="loadError" :message="loadError" :auth="authError" />

    <div class="layout" :class="{ editing: editing !== null }">
      <section class="list" aria-label="通知清單">
        <ErrorNotice v-if="rowError" :message="rowError" />
        <p v-if="!loaded" class="faint">載入中…</p>
        <p v-else-if="!list.length && !loadError" class="empty">還沒有通知管道。</p>
        <ul v-else class="rows">
          <li v-for="c in list" :key="c.id" class="row" :class="{ current: editing === c.id, off: !c.active }">
            <div class="row-main">
              <div class="row-title">
                <span class="name">{{ c.name }}</span>
                <span class="tag">Discord</span>
                <span v-if="c.isDefault" class="flag">預設</span>
                <span v-if="!c.active" class="flag faint">已停用</span>
              </div>
              <div class="mono faint small url">{{ mask(c.webhookUrl) }}</div>
              <div v-if="c.username" class="small muted">顯示名稱：{{ c.username }}</div>
            </div>
            <div class="row-actions">
              <button type="button" class="btn btn-sm" @click="open(c)"><Pencil aria-hidden="true" />編輯</button>
              <button type="button" class="btn btn-sm btn-ghost btn-danger" :aria-label="`刪除 ${c.name}`" @click="remove(c)">
                <Trash aria-hidden="true" />
              </button>
            </div>
          </li>
        </ul>
      </section>

      <section v-if="editing !== null" class="editor" aria-labelledby="n-editor-title">
        <h2 id="n-editor-title">{{ isNew ? '新增通知' : '編輯通知' }}</h2>
        <form class="form" novalidate @submit.prevent="save">
          <div class="field">
            <label for="n-name" class="req">名稱</label>
            <input id="n-name" v-model="form.name" class="input" placeholder="例：維運頻道" :aria-invalid="!!errors.name" />
            <p v-if="errors.name" class="field-error">{{ errors.name }}</p>
          </div>
          <div class="field">
            <label for="n-url" class="req">Discord Webhook URL</label>
            <input
              id="n-url"
              v-model="form.webhookUrl"
              type="url"
              class="input mono"
              autocomplete="off"
              spellcheck="false"
              placeholder="https://discord.com/api/webhooks/…"
              :aria-invalid="!!errors.webhookUrl"
            />
            <p v-if="errors.webhookUrl" class="field-error">{{ errors.webhookUrl }}</p>
            <p v-else class="help">在 Discord 頻道設定 → 整合 → Webhook 建立。</p>
          </div>
          <div class="field">
            <label for="n-user">顯示名稱</label>
            <input id="n-user" v-model="form.username" class="input" placeholder="留空 = 用 Webhook 預設名稱" />
          </div>
          <div class="checks">
            <label class="check">
              <input v-model="form.isDefault" type="checkbox" /><span>預設啟用<small>新監測項目預設勾選</small></span>
            </label>
            <label class="check"><input v-model="form.active" type="checkbox" /><span>啟用</span></label>
            <label v-if="isNew" class="check">
              <input v-model="form.applyToAll" type="checkbox" /><span>套用到所有現有監測</span>
            </label>
          </div>

          <div class="test">
            <button type="button" class="btn btn-sm" :disabled="testing" @click="sendTest">
              <Send aria-hidden="true" />{{ testing ? '送出中…' : '送出測試訊息' }}
            </button>
            <p v-if="testState" class="small test-result" :class="testState.ok ? 's-up' : 's-down'" role="status">
              <CircleCheck v-if="testState.ok" aria-hidden="true" />{{ testState.msg }}
            </p>
          </div>

          <ErrorNotice v-if="saveError" :message="saveError" />
          <div class="form-actions">
            <button type="submit" class="btn btn-primary" :disabled="saving">
              {{ saving ? '儲存中…' : isNew ? '新增' : '儲存' }}
            </button>
            <button type="button" class="btn" @click="close">取消</button>
          </div>
        </form>
      </section>
    </div>
  </div>
</template>

<style scoped>
.url {
  overflow-wrap: anywhere;
}

.test {
  display: grid;
  justify-items: start;
  gap: 6px;
}

.test-result {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  color: var(--s);
}

.test-result svg {
  flex: none;
  width: 16px;
  height: 16px;
  margin-top: 2px;
}
</style>
