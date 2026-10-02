import type { Component } from 'vue';
import { CircleAlert, CircleCheck, CircleDashed, CirclePause, CircleX, Wrench } from '@lucide/vue';
import type { Status } from '../shared/types';

export type StatusKey = 'up' | 'down' | 'pending' | 'maint' | 'none' | 'paused';

interface StatusMeta {
  label: string;
  cls: string;
  icon: Component;
}

const META: Record<StatusKey, StatusMeta> = {
  up: { label: '正常', cls: 's-up', icon: CircleCheck },
  down: { label: '中斷', cls: 's-down', icon: CircleX },
  pending: { label: '待確認', cls: 's-pending', icon: CircleAlert },
  maint: { label: '維護中', cls: 's-maint', icon: Wrench },
  none: { label: '無資料', cls: 's-none', icon: CircleDashed },
  paused: { label: '已暫停', cls: 's-none', icon: CirclePause },
};

export function statusKey(s: Status | null | undefined): StatusKey {
  switch (s) {
    case 0:
      return 'down';
    case 1:
      return 'up';
    case 2:
      return 'pending';
    case 3:
      return 'maint';
    default:
      return 'none';
  }
}

export function statusMeta(s: Status | null | undefined, paused = false): StatusMeta {
  return META[paused ? 'paused' : statusKey(s)];
}

export function statusLabel(s: Status | null | undefined): string {
  return META[statusKey(s)].label;
}

export function statusClass(s: Status | null | undefined): string {
  return META[statusKey(s)].cls;
}
