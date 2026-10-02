import { shallowReactive } from 'vue';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmText?: string;
  danger?: boolean;
}

interface ConfirmState extends ConfirmOptions {
  open: boolean;
  resolve: ((ok: boolean) => void) | null;
}

export const confirmState = shallowReactive<ConfirmState>({
  open: false,
  title: '',
  resolve: null,
});

/** 用法：if (!(await confirm({ title: '刪除？' }))) return; */
export function confirm(opts: ConfirmOptions): Promise<boolean> {
  confirmState.resolve?.(false);
  return new Promise((resolve) => {
    Object.assign(confirmState, {
      message: undefined,
      confirmText: undefined,
      danger: false,
      ...opts,
      open: true,
      resolve,
    });
  });
}

export function settleConfirm(ok: boolean) {
  const r = confirmState.resolve;
  confirmState.open = false;
  confirmState.resolve = null;
  r?.(ok);
}
