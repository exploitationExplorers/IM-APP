import http from "@/api";
import type {
  AdminPage,
  Auth,
  Groups,
  Moderation,
  Reports,
  SensitiveWords,
  Sms,
  Audit,
} from "@/api/interface";

const AUTH_BASE = "/admin/v1/auth";
const HEALTH_BASE = "/admin/v1/health";
const META_BASE = "/admin/v1/meta";
const SMS_BASE = "/admin/v1/sms";
const MODERATION_BASE = "/admin/v1/moderation";
const SENSITIVE_WORDS_BASE = "/admin/v1/sensitive-words";
const REPORTS_BASE = "/admin/v1/reports";
const GROUPS_BASE = "/admin/v1/groups";
const AUDIT_LOG_BASE = "/admin/v1/audit-logs";
const ADMIN_LOGIN_LOG_BASE = "/admin/v1/admin-login-logs";

export const loginApi = (params: Auth.ReqLoginForm) => {
  return http.post<Auth.ResLogin>(`${AUTH_BASE}/login`, params, { loading: false, cancel: false });
};

export const refreshTokenApi = (params: Auth.ReqRefreshForm) => {
  return http.post<Auth.ResLogin>(`${AUTH_BASE}/token/refresh`, params, {
    loading: false,
    cancel: false,
  });
};

export const getAdminHealth = () => {
  return http.get<Auth.ResHealth>(HEALTH_BASE, {}, { loading: false, cancel: false });
};

export const getAdminMeta = () => {
  return http.get<Auth.ResMeta>(
    META_BASE,
    {},
    {
      loading: false,
      cancel: false,
      skipAuthRefresh: true,
    },
  );
};

export const getSmsProvidersHealth = () => {
  return http.get<Sms.ProviderHealthItem[]>(`${SMS_BASE}/providers/health`, {}, { loading: false });
};

export const getModerationHits = (params: Moderation.ReqHitsParams = {}) => {
  return http.get<AdminPage<Moderation.HitItem>>(`${MODERATION_BASE}/hits`, params);
};

export const getModerationProfiles = (params: Moderation.ReqProfilesParams = {}) => {
  return http.get<AdminPage<Moderation.ProfileItem>>(`${MODERATION_BASE}/profiles`, params);
};

export const rejectModerationProfile = (userId: string, body: Moderation.ReqRejectProfile) => {
  return http.post<Moderation.ActionResult>(
    `${MODERATION_BASE}/profiles/${encodeURIComponent(userId)}/reject`,
    body,
  );
};

export const approveModerationProfile = (userId: string, body: Moderation.ReqApproveProfile) => {
  return http.post<Moderation.ActionResult>(
    `${MODERATION_BASE}/profiles/${encodeURIComponent(userId)}/approve`,
    body,
  );
};

export const restoreModerationProfile = (userId: string, body: Moderation.ReqRestoreProfile) => {
  return http.post<Moderation.ActionResult>(
    `${MODERATION_BASE}/profiles/${encodeURIComponent(userId)}/restore`,
    body,
  );
};

export const getSensitiveWords = (params: SensitiveWords.ReqListParams = {}) => {
  return http.get<SensitiveWords.WordItem[]>(SENSITIVE_WORDS_BASE, params);
};

export const createSensitiveWord = (body: SensitiveWords.ReqCreateWord) => {
  return http.post(SENSITIVE_WORDS_BASE, body);
};

export const importSensitiveWords = (body: SensitiveWords.ReqImportWords) => {
  return http.post(`${SENSITIVE_WORDS_BASE}/import`, body);
};

export const updateSensitiveWord = (id: string, body: SensitiveWords.ReqUpdateWord) => {
  return http.put(`${SENSITIVE_WORDS_BASE}/${encodeURIComponent(id)}`, body);
};

export const updateSensitiveWordStatus = (id: string, body: SensitiveWords.ReqUpdateWordStatus) => {
  return http.put(`${SENSITIVE_WORDS_BASE}/${encodeURIComponent(id)}/status`, body);
};

export const getReports = (params: Reports.ReqListParams = {}) => {
  return http.get<AdminPage<Reports.ReportItem>>(REPORTS_BASE, params);
};

export const getReportDetail = (id: string) => {
  return http.get<Reports.ReportDetail>(`${REPORTS_BASE}/${encodeURIComponent(id)}`);
};

export const getReportActions = (id: string) => {
  return http.get<Reports.ReportAction[]>(`${REPORTS_BASE}/${encodeURIComponent(id)}/actions`);
};

export const assignReport = (id: string, body: Reports.ReqAssignReport) => {
  return http.post<Reports.ActionResult>(`${REPORTS_BASE}/${encodeURIComponent(id)}/assign`, body);
};

export const addReportNote = (id: string, body: Reports.ReqAddReportNote) => {
  return http.post<Reports.ActionResult>(`${REPORTS_BASE}/${encodeURIComponent(id)}/notes`, body);
};

export const rejectReport = (id: string, body: Reports.ReqRejectReport) => {
  return http.post<Reports.ActionResult>(`${REPORTS_BASE}/${encodeURIComponent(id)}/reject`, body);
};

export const resolveReport = (id: string, body: Reports.ReqResolveReport) => {
  return http.post<Reports.ActionResult>(`${REPORTS_BASE}/${encodeURIComponent(id)}/resolve`, body);
};

export const startReport = (id: string, body: Reports.ReqStartReport) => {
  return http.post<Reports.ActionResult>(`${REPORTS_BASE}/${encodeURIComponent(id)}/start`, body);
};

export const reopenReport = (id: string, body: Reports.ReqReopenReport) => {
  return http.post<Reports.ActionResult>(`${REPORTS_BASE}/${encodeURIComponent(id)}/reopen`, body);
};

export const getGroups = (params: Groups.ReqListParams = {}) => {
  return http.get<AdminPage<Groups.GroupItem>>(GROUPS_BASE, params);
};

export const getGroupDetail = (id: string) => {
  return http.get<Groups.GroupDetail>(`${GROUPS_BASE}/${encodeURIComponent(id)}`);
};

export const getGroupStatusLogs = (
  id: string,
  params: { page?: number; size?: number } = {},
) => {
  return http.get<AdminPage<Groups.GroupStatusLogItem>>(
    `${GROUPS_BASE}/${encodeURIComponent(id)}/status-logs`,
    params,
  );
};

export const dissolveGroup = (id: string, body: Groups.ReqDissolveGroup) => {
  return http.post<Groups.ActionResult>(`${GROUPS_BASE}/${encodeURIComponent(id)}/dissolve`, body);
};

export const muteGroupAll = (id: string, body: Groups.ReqMuteAllGroup) => {
  return http.put<Groups.ActionResult>(`${GROUPS_BASE}/${encodeURIComponent(id)}/mute-all`, body);
};

export const getGroupRecallLogs = (id: string, params: Groups.ReqRecallLogsParams = {}) => {
  return http.get<AdminPage<Groups.RecallLogItem>>(
    `${GROUPS_BASE}/${encodeURIComponent(id)}/recall-logs`,
    params,
  );
};

export const getGroupReports = (id: string, params: Groups.ReqGroupReportsParams = {}) => {
  return http.get<AdminPage<Reports.ReportItem>>(
    `${GROUPS_BASE}/${encodeURIComponent(id)}/reports`,
    params,
  );
};

/** 管理员登录日志 */
export const getAdminLoginLogs = (body: Audit.AdminLoginLogsRequest) => {
  return http.get<Audit.AdminLoginLogsResponse>(`${ADMIN_LOGIN_LOG_BASE}`, body);
};

/** 管理操作审计日志 */
export const getAuditLogs = (body: Audit.AuditLogsRequest) => {
  return http.get<Audit.AuditLogsResponse>(`${AUDIT_LOG_BASE}`, body);
};

/** 审计日志详情 */
export const getAuditLogDetail = (id: string) => {
  return http.get<Audit.AuditLogDetailResponse>(`${AUDIT_LOG_BASE}/${encodeURIComponent(id)}`);
};
