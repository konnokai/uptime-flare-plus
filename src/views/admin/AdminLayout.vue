<script setup lang="ts">
import { ref, watch } from 'vue';
import { RouterLink, RouterView, useRoute } from 'vue-router';
import { Activity, ArrowUpRight, Bell, CalendarClock, Megaphone, Menu, Settings, X } from '@lucide/vue';
import ErrorNotice from '../../components/ErrorNotice.vue';
import { loadSession, session } from './session';
import './crud.css';

void loadSession();

const NAV = [
  { to: '/admin/monitors', label: '監測項目', icon: Activity },
  { to: '/admin/notifications', label: '通知', icon: Bell },
  { to: '/admin/maintenances', label: '維護時段', icon: CalendarClock },
  { to: '/admin/incidents', label: '事件公告', icon: Megaphone },
  { to: '/admin/settings', label: '設定', icon: Settings },
];

const route = useRoute();
const menuOpen = ref(false);

watch(
  () => route.path,
  () => (menuOpen.value = false),
);
</script>

<template>
  <div class="admin">
    <aside class="side">
      <div class="side-top">
        <RouterLink to="/admin/monitors" class="brand">
          <img src="/favicon.svg" alt="" width="22" height="22" />
          <span>管理後台</span>
        </RouterLink>
        <button
          type="button"
          class="btn btn-ghost btn-icon menu-btn"
          :aria-expanded="menuOpen"
          aria-controls="admin-nav"
          :aria-label="menuOpen ? '關閉選單' : '開啟選單'"
          @click="menuOpen = !menuOpen"
        >
          <X v-if="menuOpen" aria-hidden="true" />
          <Menu v-else aria-hidden="true" />
        </button>
      </div>

      <nav id="admin-nav" class="nav" :class="{ open: menuOpen }" aria-label="管理選單">
        <RouterLink v-for="n in NAV" :key="n.to" :to="n.to" class="nav-link">
          <component :is="n.icon" aria-hidden="true" />
          <span>{{ n.label }}</span>
        </RouterLink>
        <a href="/" class="nav-link nav-public" target="_blank" rel="noopener">
          <ArrowUpRight aria-hidden="true" />
          <span>查看狀態頁</span>
        </a>
        <div class="who">
          <span class="faint">登入身分</span>
          <span class="who-email" :title="session.email">{{ session.email || (session.loaded ? '未知' : '…') }}</span>
        </div>
      </nav>
    </aside>

    <main class="content">
      <ErrorNotice v-if="session.authError" :message="session.authError" auth />
      <RouterView v-else />
    </main>
  </div>
</template>

<style scoped>
.admin {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  min-height: 100vh;
  min-height: 100dvh;
}

.side {
  position: sticky;
  top: 0;
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  padding: 18px 12px;
  border-right: 1px solid var(--line);
  background: var(--surface-2);
}

.side-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px 18px;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-weight: 650;
  text-decoration: none;
}

.brand img {
  border-radius: 5px;
  /* 深色模式下圖示底色和側欄太接近，補一圈細框 */
  box-shadow: 0 0 0 1px var(--line-strong);
}

.menu-btn {
  display: none;
}

.nav {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}

.nav-link {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 38px;
  padding: 0 10px;
  border-radius: var(--radius);
  color: var(--ink-2);
  font-size: var(--fs-md);
  text-decoration: none;
}

.nav-link svg {
  flex: none;
  width: 18px;
  height: 18px;
}

.nav-link:hover {
  background: color-mix(in srgb, var(--ink) 6%, transparent);
  color: var(--ink);
}

.nav-link.router-link-active {
  background: var(--surface);
  color: var(--ink);
  font-weight: 600;
  box-shadow: inset 3px 0 0 var(--ink);
}

.nav-public {
  margin-top: 12px;
  font-size: var(--fs-sm);
}

.who {
  display: grid;
  gap: 2px;
  margin-top: auto;
  padding: 12px 10px 0;
  border-top: 1px solid var(--line);
  font-size: var(--fs-xs);
}

.who-email {
  overflow: hidden;
  color: var(--ink-2);
  font-size: var(--fs-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.content {
  min-width: 0;
  padding: 28px 32px 48px;
}

@media (max-width: 860px) {
  .admin {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto 1fr;
  }
  .side {
    position: sticky;
    z-index: 10;
    height: auto;
    padding: 8px 12px;
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }
  .side-top {
    padding: 0 4px;
  }
  .menu-btn {
    display: inline-flex;
  }
  .nav {
    display: none;
    padding: 8px 0 4px;
  }
  .nav.open {
    display: flex;
  }
  .who {
    margin-top: 8px;
  }
  .content {
    padding: 20px 16px 40px;
  }
}
</style>
