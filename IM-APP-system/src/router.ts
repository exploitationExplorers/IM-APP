import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
import { useAuthStore } from "./stores/auth";

const routes: RouteRecordRaw[] = [
  { path: "/", redirect: "/home" },
  {
    path: "/login",
    component: () => import("./views/LoginView.vue"),
    meta: { public: true, title: "登录" },
  },
  {
    path: "/",
    component: () => import("./layouts/AppShell.vue"),
    children: [
      {
        path: "home",
        component: () => import("./views/HomeView.vue"),
        meta: { title: "首页" },
      },
      {
        path: "app/users",
        component: () => import("./views/AppUserManagementView.vue"),
        meta: { title: "用户管理" },
      },
      {
        path: "app/groups",
        component: () => import("./views/GroupManagementView.vue"),
        meta: { title: "群组管理" },
      },
      {
        path: "system/users",
        component: () => import("./views/UserManagementView.vue"),
        meta: { title: "平台用户管理" },
      },
      {
        path: "system/roles",
        component: () => import("./views/RolePermissionView.vue"),
        meta: { title: "角色权限" },
      },
      {
        path: "system/logs",
        component: () => import("./views/OperationLogsView.vue"),
        meta: { title: "操作日志" },
      },
      {
        path: "forward-group-send",
        component: () => import("./views/forwardGroupSend/ForwardGroupSendView.vue"),
        meta: { title: "转发和群发管理" },
      },
      {
        path: "sms-operation-config",
        component: () => import("./views/smsOperationConfig/SmsOperationConfigView.vue"),
        meta: { title: "短信和运营配置" },
      },
      {
        path: "runtime-observe/exports",
        component: () => import("./views/runtimeObserve/ExportTasksView.vue"),
        meta: { title: "导出任务" },
      },
    ],
  },
  { path: "/:pathMatch(.*)*", redirect: "/home" },
];

const router = createRouter({ history: createWebHistory(), routes });

router.beforeEach((to) => {
  const auth = useAuthStore();
  document.title = `${String(to.meta.title ?? "IM-APP 管理系统")} | IM-APP 管理系统`;
  if (!to.meta.public && !auth.isLoggedIn) return "/login";
  if (to.path === "/login" && auth.isLoggedIn) return "/home";
  return true;
});

export default router;
