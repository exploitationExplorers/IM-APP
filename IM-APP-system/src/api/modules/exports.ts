import http from "@/api";
import type { AdminPage } from "@/api/interface";

export namespace AdminExports {
  export interface ReqExportTasksParams {
    page?: number;
    size?: number;
  }

  export interface ExportTaskItem {
    id: string;
    resource: string;
    status: string;
    filters?: string;
    fileUrl?: string;
    createdAt?: string;
    finishedAt?: string;
    expireAt?: string;
  }

  export interface ReqCreateExportTaskBody {
    resource: string;
    filters?: string;
  }

  export interface ResCreateExportTaskData {
    id: string;
  }
}

const EXPORTS_BASE = "/admin/v1/exports";

export const getAdminExportTasksApi = (params: AdminExports.ReqExportTasksParams = {}) => {
  return http.get<AdminPage<AdminExports.ExportTaskItem>>(EXPORTS_BASE, params, { loading: false });
};

export const postAdminCreateExportTaskApi = (body: AdminExports.ReqCreateExportTaskBody) => {
  return http.post<AdminExports.ResCreateExportTaskData>(EXPORTS_BASE, body, { loading: false });
};
