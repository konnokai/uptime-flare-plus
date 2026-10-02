import { reactive } from 'vue';
import type { Settings } from '../../../shared/types';
import { api, errorMessage, isAuthError } from '../../api';
import { browserTimeZone } from '../../format';

export const session = reactive({
  email: '',
  /** 後台的時間用設定的時區顯示，和每日統計的切日方式一致 */
  timezone: browserTimeZone,
  /** 設定裡的時區；讀不到時是空字串 */
  settingsTimezone: '',
  authError: '',
  loaded: false,
});

let pending: Promise<void> | null = null;

export function loadSession(): Promise<void> {
  pending ??= (async () => {
    const [me, settings] = await Promise.allSettled([
      api.get<{ email: string }>('/api/admin/me'),
      api.get<Settings>('/api/admin/settings'),
    ]);
    if (me.status === 'fulfilled') {
      session.email = me.value.email;
    } else if (isAuthError(me.reason)) {
      session.authError = errorMessage(me.reason);
    }
    if (settings.status === 'fulfilled' && settings.value.timezone) {
      session.timezone = settings.value.timezone;
      session.settingsTimezone = settings.value.timezone;
    }
    session.loaded = true;
  })();
  return pending;
}
