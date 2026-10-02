import type { InjectionKey, Ref } from 'vue';
import type { MonitorSummary } from '../../../shared/types';

export interface MonitorsContext {
  list: Ref<MonitorSummary[]>;
  refresh: () => Promise<void>;
}

export const monitorsKey: InjectionKey<MonitorsContext> = Symbol('monitors');
