<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { confirmState, settleConfirm } from '../confirm';

const dialog = ref<HTMLDialogElement | null>(null);
const cancelBtn = ref<HTMLButtonElement | null>(null);

watch(
  () => confirmState.open,
  async (open) => {
    const el = dialog.value;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      await nextTick();
      // 危險操作預設把焦點放在「取消」，避免誤按 Enter
      cancelBtn.value?.focus();
    } else if (!open && el.open) {
      el.close();
    }
  },
);

function onClose() {
  if (confirmState.open) settleConfirm(false);
}

function onBackdrop(e: MouseEvent) {
  if (e.target === dialog.value) settleConfirm(false);
}
</script>

<template>
  <dialog
    ref="dialog"
    class="confirm"
    aria-labelledby="confirm-title"
    @close="onClose"
    @click="onBackdrop"
  >
    <div class="confirm-body">
      <h2 id="confirm-title">{{ confirmState.title }}</h2>
      <p v-if="confirmState.message" class="muted">{{ confirmState.message }}</p>
      <div class="confirm-actions">
        <button ref="cancelBtn" type="button" class="btn" @click="settleConfirm(false)">取消</button>
        <button
          type="button"
          class="btn"
          :class="confirmState.danger ? 'btn-danger-solid' : 'btn-primary'"
          @click="settleConfirm(true)"
        >
          {{ confirmState.confirmText ?? '確定' }}
        </button>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.confirm {
  width: min(420px, calc(100vw - 32px));
  padding: 0;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink);
  box-shadow: 0 12px 32px -12px rgb(0 0 0 / 0.35);
}

.confirm::backdrop {
  background: rgb(20 21 23 / 0.45);
}

.confirm-body {
  display: grid;
  gap: 10px;
  padding: 20px;
}

h2 {
  font-size: var(--fs-lg);
}

p {
  font-size: var(--fs-md);
  white-space: pre-line;
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}
</style>
