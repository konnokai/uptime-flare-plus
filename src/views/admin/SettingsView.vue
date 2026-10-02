<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { CircleCheck } from '@lucide/vue';
import type { Settings } from '../../../shared/types';
import { api, errorMessage, isAuthError } from '../../api';
import { isValidTimeZone } from '../../format';
import { timeZoneOptions } from '../../timezones';
import ErrorNotice from '../../components/ErrorNotice.vue';
import { session } from './session';

const form = reactive({
  title: '',
  description: '',
  footer: '',
  timezone: 'Asia/Taipei',
  heartbeatRetentionDays: 30 as number | '',
  statsRetentionDays: 365 as number | '',
});
const errors = reactive<Record<string, string>>({});
const loaded = ref(false);
const loadError = ref('');
const authError = ref(false);
const saving = ref(false);
const saveError = ref('');
const savedAt = ref<number | null>(null);

function fill(s: Settings) {
  Object.assign(form, s);
}

onMounted(async () => {
  try {
    fill(await api.get<Settings>('/api/admin/settings'));
  } catch (err) {
    loadError.value = errorMessage(err);
    authError.value = isAuthError(err);
  } finally {
    loaded.value = true;
  }
});

function intIn(v: number | '', min: number, max: number) {
  return v !== '' && Number.isInteger(v) && v >= min && v <= max;
}

async function save() {
  for (const k of Object.keys(errors)) delete errors[k];
  saveError.value = '';
  savedAt.value = null;
  if (!form.title.trim()) errors.title = '請填標題';
  if (!isValidTimeZone(form.timezone.trim())) errors.timezone = '不是有效的 IANA 時區，例：Asia/Taipei';
  if (!intIn(form.heartbeatRetentionDays, 1, 3650)) errors.heartbeatRetentionDays = '請填 1–3650 的整數';
  if (!intIn(form.statsRetentionDays, 1, 3650)) errors.statsRetentionDays = '請填 1–3650 的整數';
  if (Object.keys(errors).length) return;

  const input: Settings = {
    title: form.title.trim(),
    description: form.description.trim(),
    footer: form.footer,
    timezone: form.timezone.trim(),
    heartbeatRetentionDays: form.heartbeatRetentionDays as number,
    statsRetentionDays: form.statsRetentionDays as number,
  };
  saving.value = true;
  try {
    const saved = await api.put<Settings>('/api/admin/settings', input);
    fill(saved);
    session.timezone = saved.timezone;
    session.settingsTimezone = saved.timezone;
    savedAt.value = Date.now();
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
      <h1>設定</h1>
    </div>

    <ErrorNotice v-if="loadError" :message="loadError" :auth="authError" />
    <p v-else-if="!loaded" class="faint">載入中…</p>

    <form v-else class="form settings" novalidate @submit.prevent="save" @input="savedAt = null">
      <section class="form-section first">
        <h3>狀態頁</h3>
        <div class="field">
          <label for="s-title" class="req">狀態頁標題</label>
          <input id="s-title" v-model="form.title" class="input" :aria-invalid="!!errors.title" />
          <p v-if="errors.title" class="field-error">{{ errors.title }}</p>
        </div>
        <div class="field">
          <label for="s-desc">說明</label>
          <input id="s-desc" v-model="form.description" class="input" placeholder="顯示在標題下方" />
        </div>
        <div class="field">
          <label for="s-footer">頁尾文字</label>
          <textarea id="s-footer" v-model="form.footer" class="textarea" rows="2" placeholder="純文字，例如聯絡方式" />
        </div>
        <div class="field">
          <label for="s-tz" class="req">時區</label>
          <input id="s-tz" v-model="form.timezone" class="input mono" list="s-tz-list" spellcheck="false" :aria-invalid="!!errors.timezone" />
          <datalist id="s-tz-list">
            <option v-for="z in timeZoneOptions()" :key="z" :value="z" />
          </datalist>
          <p v-if="errors.timezone" class="field-error">{{ errors.timezone }}</p>
          <p v-else class="help">狀態頁的時間顯示和每日統計的切日都用這個時區。</p>
        </div>
      </section>

      <section class="form-section">
        <h3>資料保留</h3>
        <div class="form-row">
          <div class="field">
            <label for="s-hb">心跳保留天數</label>
            <input id="s-hb" v-model.number="form.heartbeatRetentionDays" type="number" min="1" class="input" :aria-invalid="!!errors.heartbeatRetentionDays" />
            <p v-if="errors.heartbeatRetentionDays" class="field-error">{{ errors.heartbeatRetentionDays }}</p>
            <p v-else class="help">每一次檢查的紀錄，預設 30 天</p>
          </div>
          <div class="field">
            <label for="s-stats">統計保留天數</label>
            <input id="s-stats" v-model.number="form.statsRetentionDays" type="number" min="1" class="input" :aria-invalid="!!errors.statsRetentionDays" />
            <p v-if="errors.statsRetentionDays" class="field-error">{{ errors.statsRetentionDays }}</p>
            <p v-else class="help">每日可用率統計，預設 365 天</p>
          </div>
        </div>
      </section>

      <ErrorNotice v-if="saveError" :message="saveError" />
      <div class="form-actions">
        <button type="submit" class="btn btn-primary" :disabled="saving">{{ saving ? '儲存中…' : '儲存設定' }}</button>
        <span v-if="savedAt" class="saved s-up" role="status"><CircleCheck aria-hidden="true" />已儲存</span>
      </div>
    </form>
  </div>
</template>

<style scoped>
.settings {
  max-width: 640px;
}

.form-section.first {
  padding-top: 0;
  border-top: 0;
}

.saved {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--s);
  font-size: var(--fs-sm);
  font-weight: 600;
}

.saved svg {
  width: 16px;
  height: 16px;
}
</style>
