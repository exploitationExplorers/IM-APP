import http from "@/api";
import type { AdminPage } from "@/api/interface";

export namespace AdminUsers {
  export interface ReqUsersParams {
    page?: number;
    pageSize?: number;
    keyword?: string;
    searchType?: string;
    status?: string;
  }

  export interface UserItem {
    id: string;
    publicId: string;
    phoneMasked: string;
    countryCode: string;
    nickname: string;
    avatar: string;
    status: string;
    loginBanned: boolean;
    messageBanned: boolean;
    friendCount: number;
    groupCount: number;
    reportCount: number;
    createdAt: string;
    lastActiveAt?: string;
  }

  export interface UserDetail {
    id: string;
    publicId: string;
    phoneMasked: string;
    countryCode: string;
    nickname: string;
    avatar: string;
    status: string;
    loginBanned: boolean;
    messageBanned: boolean;
    friendCount: number;
    groupCount: number;
    reportCount: number;
    createdAt: string;
    lastActiveAt?: string;
    bio?: string;
  }

  export interface ReqForwardTasksParams {
    page?: number;
    pageSize?: number;
  }

  export type ForwardTaskItem = Record<string, any>;

  export interface ReqGroupsParams {
    page?: number;
    pageSize?: number;
  }

  export type GroupItem = Record<string, any>;

  export interface ReqReportsParams {
    page?: number;
    pageSize?: number;
  }

  export type ReportItem = Record<string, any>;

  export interface ReqBanUserBody {
    banned: boolean;
    idempotencyKey?: string;
    reason: string;
    ticketNo?: string;
    until?: string;
  }

  export interface ReqLoginRestrictionBody {
    banned: boolean;
    reason: string;
    until?: string;
  }

  export interface ReqMessageRestrictionBody {
    banned: boolean;
    reason: string;
    until?: string;
  }

  export interface ReqRevokeSessionsBody {
    reason: string;
  }

  export interface ReqPhoneRevealBody {
    reason: string;
    ticketNo: string;
  }

  export interface ResPhoneRevealData {
    phone?: string;
    phoneNumber?: string;
    mobile?: string;
    countryCode?: string;
  }

  export interface ForwardLimitConfig {
    enabled: boolean;
    dailyLimit: number;
    hourlyLimit: number;
    singleTargets: number;
  }

  export interface ReqForwardLimitUpdateBody extends Partial<ForwardLimitConfig> {
    reason: string;
  }
}

const USERS_BASE = "/admin/v1/users";

export const getAdminUsersApi = (params?: AdminUsers.ReqUsersParams) => {
  return http.get<AdminPage<AdminUsers.UserItem>>(USERS_BASE, params, { loading: false });
};

export const getAdminUserDetailApi = (id: string) => {
  return http.get<AdminUsers.UserDetail>(`${USERS_BASE}/${id}`, undefined, { loading: false });
};

export const getAdminUserForwardTasksApi = (id: string, params?: AdminUsers.ReqForwardTasksParams) => {
  return http.get<AdminPage<AdminUsers.ForwardTaskItem>>(`${USERS_BASE}/${id}/forward-tasks`, params, { loading: false });
};

export const getAdminUserGroupsApi = (id: string, params?: AdminUsers.ReqGroupsParams) => {
  return http.get<any>(`${USERS_BASE}/${id}/groups`, params, { loading: false });
};

export const getAdminUserReportsApi = (id: string, params?: AdminUsers.ReqReportsParams) => {
  return http.get<AdminPage<AdminUsers.ReportItem>>(`${USERS_BASE}/${id}/reports`, params, { loading: false });
};

export const putAdminUserBanApi = (id: string, body: AdminUsers.ReqBanUserBody) => {
  return http.put<null>(`${USERS_BASE}/${id}/ban`, body, { loading: false });
};

export const putAdminUserLoginRestrictionApi = (id: string, body: AdminUsers.ReqLoginRestrictionBody) => {
  return http.put<null>(`${USERS_BASE}/${id}/login-restriction`, body, { loading: false });
};

export const putAdminUserMessageRestrictionApi = (id: string, body: AdminUsers.ReqMessageRestrictionBody) => {
  return http.put<null>(`${USERS_BASE}/${id}/message-restriction`, body, { loading: false });
};

export const postAdminUserRevokeSessionsApi = (id: string, body: AdminUsers.ReqRevokeSessionsBody) => {
  return http.post<null>(`${USERS_BASE}/${id}/sessions/revoke`, body, { loading: false });
};

export const postAdminUserPhoneRevealApi = (id: string, body: AdminUsers.ReqPhoneRevealBody) => {
  return http.post<AdminUsers.ResPhoneRevealData | string>(`${USERS_BASE}/${id}/phone/reveal`, body, { loading: false });
};

const FORWARD_LIMITS_BASE = "/admin/v1/forward-limits/users";

export const getAdminUserForwardLimitApi = (userId: string) => {
  return http.get<AdminUsers.ForwardLimitConfig | null>(`${FORWARD_LIMITS_BASE}/${userId}`, undefined, { loading: false });
};

export const putAdminUserForwardLimitApi = (userId: string, body: AdminUsers.ReqForwardLimitUpdateBody) => {
  return http.put<null>(`${FORWARD_LIMITS_BASE}/${userId}`, body, { loading: false });
};

