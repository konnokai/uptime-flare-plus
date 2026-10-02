import { createRouter, createWebHistory } from 'vue-router';
import StatusPage from './views/StatusPage.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'status', component: StatusPage },
    {
      path: '/admin',
      component: () => import('./views/admin/AdminLayout.vue'),
      children: [
        { path: '', redirect: '/admin/monitors' },
        {
          path: 'monitors',
          component: () => import('./views/admin/MonitorsLayout.vue'),
          meta: { title: '監測項目' },
          children: [
            { path: '', name: 'monitors', component: () => import('./views/admin/MonitorEmpty.vue') },
            {
              path: 'new',
              name: 'monitor-new',
              component: () => import('./views/admin/MonitorForm.vue'),
              meta: { title: '新增監測' },
            },
            {
              path: ':id(\\d+)',
              name: 'monitor',
              component: () => import('./views/admin/MonitorDetail.vue'),
            },
            {
              path: ':id(\\d+)/edit',
              name: 'monitor-edit',
              component: () => import('./views/admin/MonitorForm.vue'),
              meta: { title: '編輯監測' },
            },
          ],
        },
        {
          path: 'notifications',
          component: () => import('./views/admin/NotificationsView.vue'),
          meta: { title: '通知' },
        },
        {
          path: 'maintenances',
          component: () => import('./views/admin/MaintenancesView.vue'),
          meta: { title: '維護時段' },
        },
        {
          path: 'incidents',
          component: () => import('./views/admin/IncidentsView.vue'),
          meta: { title: '事件公告' },
        },
        {
          path: 'settings',
          component: () => import('./views/admin/SettingsView.vue'),
          meta: { title: '設定' },
        },
      ],
    },
    { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('./views/NotFound.vue') },
  ],
  scrollBehavior(to, from, saved) {
    if (saved) return saved;
    // 監測清單和詳細頁同畫面，切換項目時不要跳回頂端
    if (to.path.startsWith('/admin/monitors') && from.path.startsWith('/admin/monitors')) return false;
    return { top: 0 };
  },
});

router.afterEach((to) => {
  const title = to.meta.title as string | undefined;
  if (to.path.startsWith('/admin')) document.title = `${title ?? '管理'} · 管理後台`;
});
