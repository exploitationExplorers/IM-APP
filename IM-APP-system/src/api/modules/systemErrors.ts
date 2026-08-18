import http from "@/api";
import type { AdminPage } from "@/api/interface";

export namespace SystemErrors {
  export interface ReqSystemErrorListParams {
    page?: number;
    size?: number;
  }

  export interface ErrorEvent {
    id: number;
    fingerprint: string;
    service: string;
    level: string;
    message: string;
    count: number;
    firstAt: string;
    lastAt: string;
  }
}

const SYSTEM_ERRORS_BASE = "/admin/v1/system/errors";

export const getSystemErrorListApi = (params: SystemErrors.ReqSystemErrorListParams = {}) => {
  return http.get<AdminPage<SystemErrors.ErrorEvent>>(SYSTEM_ERRORS_BASE, params, { loading: false });
};

export const getSystemErrorDetailApi = (id: number) => {
  return http.get<SystemErrors.ErrorEvent>(`${SYSTEM_ERRORS_BASE}/${id}`, undefined, { loading: false });
};
