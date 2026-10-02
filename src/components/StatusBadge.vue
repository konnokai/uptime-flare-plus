<script setup lang="ts">
import { computed } from 'vue';
import type { Status } from '../../shared/types';
import { statusMeta } from '../status';

const props = withDefaults(
  defineProps<{
    status: Status | null | undefined;
    paused?: boolean;
    /** 只顯示圖示，文字放在 visually-hidden */
    iconOnly?: boolean;
  }>(),
  { paused: false, iconOnly: false },
);

const meta = computed(() => statusMeta(props.status, props.paused));
</script>

<template>
  <span class="badge" :class="meta.cls" :title="iconOnly ? meta.label : undefined">
    <component :is="meta.icon" class="badge-icon" aria-hidden="true" :stroke-width="2.25" />
    <span :class="{ 'visually-hidden': iconOnly }">{{ meta.label }}</span>
  </span>
</template>

<style scoped>
.badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--s);
  font-size: var(--fs-sm);
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
}

.badge-icon {
  flex: none;
  width: 16px;
  height: 16px;
}
</style>
