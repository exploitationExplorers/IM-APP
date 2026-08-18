import http from "@/api";

export namespace AdminDashboard {
  export interface DashboardOverview {
    users: number;
    activeToday: number;
    messagesToday: number;
    pendingReports: number;
    forwardTasks: number;
    smsSentToday: number;
    groups: number;
  }

  export type DashboardTodoType = "report" | "forward_risk" | "sms_failed" | "system_alert";

  export interface DashboardTodo {
    createdAt: string;
    id: string;
    targetId?: string;
    title: string;
    type: DashboardTodoType;
  }

  export interface DashboardTrend {
    active: number;
    date: string;
    forwards: number;
    messages: number;
    registrations: number;
    reports: number;
  }

  export interface ReqDashboardTrendsParams {
    days?: number;
  }
}

const DASHBOARD_BASE = "/admin/v1/dashboard";

export const getAdminDashboardOverviewApi = () => {
  return http.get<AdminDashboard.DashboardOverview>(`${DASHBOARD_BASE}/overview`, undefined, { loading: false });
};

export const getAdminDashboardTodosApi = () => {
  return http.get<AdminDashboard.DashboardTodo[]>(`${DASHBOARD_BASE}/todos`, undefined, { loading: false });
};

export const getAdminDashboardTrendsApi = (params: AdminDashboard.ReqDashboardTrendsParams = {}) => {
  return http.get<AdminDashboard.DashboardTrend[]>(`${DASHBOARD_BASE}/trends`, params, { loading: false });
};

