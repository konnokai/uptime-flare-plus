import { onBeforeUnmount, onMounted } from 'vue';

/**
 * 定時呼叫 fn。分頁在背景時暫停，切回來若已超過間隔就立刻補一次，
 * 免得使用者回來看到的是舊資料。
 */
export function usePolling(fn: () => unknown, intervalMs: number, immediate = true) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let last = 0;

  const run = () => {
    last = Date.now();
    void fn();
  };

  const tick = () => {
    if (document.visibilityState === 'visible') run();
  };

  const onVisible = () => {
    if (document.visibilityState === 'visible' && Date.now() - last >= intervalMs) run();
  };

  onMounted(() => {
    if (immediate) run();
    timer = setInterval(tick, intervalMs);
    document.addEventListener('visibilitychange', onVisible);
  });

  onBeforeUnmount(() => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
  });

  return { refresh: run };
}
