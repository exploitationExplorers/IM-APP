import http from "@/api";

export namespace AppConfig {
  export type OkResult = { ok: boolean };

  export type Platform = "android" | "ios";
  export type AppVersionStatus = "draft" | "published";

  export interface AppVersion {
    id: string;
    version: string;
    platform: Platform;
    status: AppVersionStatus;
    forceUpgrade?: boolean;
    downloadUrl?: string;
    description?: string;
    createdAt?: string;
  }

  export interface ReqCreateAppVersionBody {
    version: string;
    platform: Platform;
    description?: string;
    downloadUrl?: string;
    forceUpgrade?: boolean;
  }

  export interface ReqUpdateAppVersionBody {
    description?: string;
    downloadUrl?: string;
    forceUpgrade?: boolean;
  }

  export interface ReqUpdateAppVersionStatusBody {
    reason: string;
    status: AppVersionStatus;
  }

  export type LegalDocumentType = "user_agreement" | "privacy_policy";
  export type LegalDocumentStatus = "draft" | "published";

  export interface LegalDocument {
    id: string;
    type: LegalDocumentType;
    title: string;
    version: string;
    language?: string;
    contentUrl?: string;
    status: LegalDocumentStatus;
    publishedAt?: string | null;
  }

  export interface ReqCreateLegalDocumentBody {
    contentUrl: string;
    language?: string;
    reason: string;
    title: string;
    type: LegalDocumentType;
    version: string;
  }

  export interface ResCreateLegalDocumentData {
    id: string;
  }

  export interface ReqPublishLegalDocumentBody {
    idempotencyKey?: string;
    reason: string;
    ticketNo?: string;
  }

  export type ReportReasonStatus = "active" | "disabled";
  export type ReportReasonTargetType = "user" | "group" | "message";

  export interface ReportReason {
    id: string;
    language?: string;
    reason?: string;
    sortOrder?: number;
    status: ReportReasonStatus;
    targetType: ReportReasonTargetType;
  }

  export interface ReqCreateReportReasonBody {
    language?: string;
    reason: string;
    sortOrder?: number;
    status?: ReportReasonStatus;
    targetType?: ReportReasonTargetType;
  }

  export interface ReqUpdateReportReasonBody {
    language?: string;
    reason?: string;
    sortOrder?: number;
    targetType?: ReportReasonTargetType;
  }

  export interface ReqUpdateReportReasonStatusBody {
    status: ReportReasonStatus;
  }

  export interface SystemLimits {
    maxFileSizeMb?: number;
    maxForwardTargets?: number;
    maxGroupMembers?: number;
    maxNicknameLen?: number;
    recallWindowSec?: number;
  }

  export interface ReqSaveSystemLimitsDraftBody {
    limits: SystemLimits;
    reason: string;
  }

  export interface ReqPublishSystemLimitsBody {
    reason: string;
  }
}

const APP_VERSIONS_BASE = "/admin/v1/app-versions";
const LEGAL_DOCS_BASE = "/admin/v1/legal-documents";
const REPORT_REASONS_BASE = "/admin/v1/report-reasons";
const SYSTEM_LIMITS_BASE = "/admin/v1/system-limits";

export const getAppVersionsApi = () => {
  return http.get<AppConfig.AppVersion[]>(APP_VERSIONS_BASE, undefined, { loading: false });
};

export const postAppVersionApi = (body: AppConfig.ReqCreateAppVersionBody) => {
  return http.post<AppConfig.OkResult>(APP_VERSIONS_BASE, body, { loading: false });
};

export const putAppVersionApi = (id: string, body: AppConfig.ReqUpdateAppVersionBody) => {
  return http.put<AppConfig.OkResult>(`${APP_VERSIONS_BASE}/${id}`, body, { loading: false });
};

export const putAppVersionStatusApi = (id: string, body: AppConfig.ReqUpdateAppVersionStatusBody) => {
  return http.put<AppConfig.OkResult>(`${APP_VERSIONS_BASE}/${id}/status`, body, { loading: false });
};

export const getLegalDocumentsApi = () => {
  return http.get<AppConfig.LegalDocument[]>(LEGAL_DOCS_BASE, undefined, { loading: false });
};

export const postLegalDocumentApi = (body: AppConfig.ReqCreateLegalDocumentBody) => {
  return http.post<AppConfig.ResCreateLegalDocumentData>(LEGAL_DOCS_BASE, body, { loading: false });
};

export const postLegalDocumentPublishApi = (id: string, body: AppConfig.ReqPublishLegalDocumentBody) => {
  return http.post<AppConfig.OkResult>(`${LEGAL_DOCS_BASE}/${id}/publish`, body, { loading: false });
};

export const getReportReasonsApi = () => {
  return http.get<AppConfig.ReportReason[]>(REPORT_REASONS_BASE, undefined, { loading: false });
};

export const postReportReasonApi = (body: AppConfig.ReqCreateReportReasonBody) => {
  return http.post<AppConfig.OkResult>(REPORT_REASONS_BASE, body, { loading: false });
};

export const putReportReasonApi = (id: string, body: AppConfig.ReqUpdateReportReasonBody) => {
  return http.put<AppConfig.OkResult>(`${REPORT_REASONS_BASE}/${id}`, body, { loading: false });
};

export const putReportReasonStatusApi = (id: string, body: AppConfig.ReqUpdateReportReasonStatusBody) => {
  return http.put<AppConfig.OkResult>(`${REPORT_REASONS_BASE}/${id}/status`, body, { loading: false });
};

export const getSystemLimitsApi = () => {
  return http.get<AppConfig.SystemLimits>(SYSTEM_LIMITS_BASE, undefined, { loading: false });
};

export const putSystemLimitsDraftApi = (body: AppConfig.ReqSaveSystemLimitsDraftBody) => {
  return http.put<AppConfig.OkResult>(SYSTEM_LIMITS_BASE, body, { loading: false });
};

export const postSystemLimitsPublishApi = (body: AppConfig.ReqPublishSystemLimitsBody) => {
  return http.post<AppConfig.OkResult>(`${SYSTEM_LIMITS_BASE}/publish`, body, { loading: false });
};

