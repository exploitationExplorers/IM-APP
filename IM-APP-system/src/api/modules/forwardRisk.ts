import http from "@/api";
import type { AdminPage } from "@/api/interface";

export namespace AdminForwardRisk {
  export type ForwardTaskStatus = "pending" | "processing" | "success" | "failed" | "cancelled";
  export type ForwardTargetStatus = "pending" | "success" | "failed" | "skipped" | "cancelled";

  export interface ForwardSettings {
    defaultDailyLimit: number;
    defaultHourlyLimit: number;
    defaultSingleTargets: number;
    maxSingleTargets: number;
  }

  export interface ReqForwardTasksParams {
    page?: number;
    size?: number;
    status?: ForwardTaskStatus;
  }

  export interface ForwardTask {
    id: string;
    userId: string;
    contentSummary: string;
    contentType: string;
    createdAt: string;
    finishedAt?: string | null;
    targetCount: number;
    successCount: number;
    failedCount: number;
    skippedCount: number;
    riskLevel: string;
    status: ForwardTaskStatus;
  }

  export interface ReqForwardTaskTargetsParams {
    page?: number;
    size?: number;
    status?: ForwardTargetStatus;
  }

  export interface ForwardTarget {
    id: string;
    userId: string;
    nickname: string;
    messageId: string;
    status: ForwardTargetStatus;
    attempts: number;
    failCode?: string | null;
    finishedAt?: string | null;
  }

  export interface ForwardTaskFailureStat {
    failCode?: string | null;
    count?: number | null;
    reason?: string | null;
    message?: string | null;
  }

  export interface ReqForwardTaskActionBody {
    reason: string;
  }

  export interface ResCancelForwardTask {
    ok: boolean;
  }

  export interface ResRetryFailedTargets {
    retried: number;
  }

  export interface ReqUpdateForwardSettingsBody {
    reason: string;
    settings: ForwardSettings;
  }
}

const FORWARD_TASKS_BASE = "/admin/v1/forward-tasks";
const FORWARD_SETTINGS_BASE = "/admin/v1/forward-settings";

export const getAdminForwardTasksApi = (params?: AdminForwardRisk.ReqForwardTasksParams) => {
  return http.get<AdminPage<AdminForwardRisk.ForwardTask>>(FORWARD_TASKS_BASE, params, { loading: false });
};

export const getAdminForwardTaskDetailApi = (id: string) => {
  return http.get<AdminForwardRisk.ForwardTask>(`${FORWARD_TASKS_BASE}/${id}`, undefined, { loading: false });
};

export const getAdminForwardTaskTargetsApi = (id: string, params?: AdminForwardRisk.ReqForwardTaskTargetsParams) => {
  return http.get<AdminPage<AdminForwardRisk.ForwardTarget>>(`${FORWARD_TASKS_BASE}/${id}/targets`, params, { loading: false });
};

export const getAdminForwardTaskFailuresApi = (id: string) => {
  return http.get<AdminForwardRisk.ForwardTaskFailureStat[]>(`${FORWARD_TASKS_BASE}/${id}/failures`, undefined, { loading: false });
};

export const postAdminCancelForwardTaskApi = (id: string, params: AdminForwardRisk.ReqForwardTaskActionBody) => {
  return http.post<AdminForwardRisk.ResCancelForwardTask>(`${FORWARD_TASKS_BASE}/${id}/cancel`, params, { loading: false });
};

export const postAdminRetryFailedForwardTargetsApi = (id: string, params: AdminForwardRisk.ReqForwardTaskActionBody) => {
  return http.post<AdminForwardRisk.ResRetryFailedTargets>(`${FORWARD_TASKS_BASE}/${id}/retry-failed`, params, { loading: false });
};

export const getAdminForwardSettingsApi = () => {
  return http.get<AdminForwardRisk.ForwardSettings>(FORWARD_SETTINGS_BASE, undefined, { loading: false });
};

export const putAdminForwardSettingsApi = (body: AdminForwardRisk.ReqUpdateForwardSettingsBody) => {
  return http.put<null>(FORWARD_SETTINGS_BASE, body, { loading: false });
};
