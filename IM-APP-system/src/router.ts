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
        meta: { title: "工作台", icon: "House" },
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
        path: "app/reports",
        component: () => import("./views/ReportManagementView.vue"),
        meta: { title: "举报处置" },
      },
      {
        path: "sensitive-words",
        component: () => import("./views/smsOperationConfig/SmsOperationConfigView.vue"),
        meta: { title: "敏感词审核", defaultTab: "sensitiveWord" },
      },
      {
        path: "system/users",
        component: () => import("./views/UserManagementView.vue"),
        meta: { title: "管理员" },
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
        redirect: "/forward-risk",
      },
      {
        path: "forward-risk",
        component: () => import("./views/forwardRisk/ForwardRiskView.vue"),
        meta: { title: "转发风控", activeMenu: "/forward-risk" },
      },
      {
        path: "messages/send-records",
        component: () => import("./views/messageAudit/MessageAuditView.vue"),
        meta: { title: "消息发送记录", activeMenu: "/messages/send-records" },
      },
      {
        path: "app-config/app-versions",
        component: () => import("./views/appConfig/AppVersionsView.vue"),
        meta: { title: "APP配置-APP版本", icon: "Iphone" },
      },
      {
        path: "app-config/legal-documents",
        component: () => import("./views/appConfig/LegalDocumentsView.vue"),
        meta: { title: "APP配置-协议文档", icon: "Tickets" },
      },
      {
        path: "app-config/report-reasons",
        component: () => import("./views/appConfig/ReportReasonsView.vue"),
        meta: { title: "APP配置-举报原因", icon: "Warning" },
      },
      {
        path: "app-config/system-limits",
        component: () => import("./views/appConfig/SystemLimitsView.vue"),
        meta: { title: "APP配置-系统限制", icon: "Setting" },
      },
      {
        path: "sms-operation-config",
        component: () => import("./views/smsOperationConfig/SmsOperationConfigView.vue"),
        meta: { title: "短信和运营配置" },
      },
      {
        path: "audit-log/admin-login-log",
        component: () => import("./views/auditLog/AdminLoginLogView.vue"),
        meta: { title: "管理员登录日志" },
      },
      {
        path: "audit-log/admin-audit-log",
        component: () => import("./views/auditLog/AdminAuditLogView.vue"),
        meta: { title: "管理操作审计日志" },
      },
      {
        path: "country-sms/countries",
        component: () => import("./views/countrySms/CountriesView.vue"),
        meta: { title: "国家短信-国家/地区" },
      },
      {
        path: "country-sms/sms-logs",
        component: () => import("./views/countrySms/SmsLogsView.vue"),
        meta: { title: "国家短信-短信发送日志" },
      },
      {
        path: "country-sms/sms-logs/:id",
        component: () => import("./views/countrySms/SmsLogDetailView.vue"),
        meta: { title: "国家短信-短信日志详情", activeMenu: "/country-sms/sms-logs" },
      },
      {
        path: "country-sms/sms-statistics",
        component: () => import("./views/countrySms/SmsStatisticsView.vue"),
        meta: { title: "国家短信-送达统计" },
      },
      {
        path: "runtime-observe/exports",
        component: () => import("./views/runtimeObserve/ExportTasksView.vue"),
        meta: { title: "导出任务" },
      },
      {
        path: "runtime-observe/errors",
        component: () => import("./views/runtimeObserve/SystemErrorsView.vue"),
        meta: { title: "运行错误" },
      },
      {
        path: "other/features",
        component: () => import("./views/other/FeaturesView.vue"),
        meta: { title: "功能开关" },
      },
      {
        path: "auth-mine",
        component: () => import("./views/authMine/AuthMineView.vue"),
        meta: { title: "认证与我的" },
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
