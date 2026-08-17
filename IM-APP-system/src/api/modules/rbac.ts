import http from "@/api";

export namespace Rbac {
  export type Status = "active" | "disabled";

  export interface PageResult<T> {
    items: T[];
    page: number;
    pageSize: number;
    total: number;
  }

  export interface AdminAccount {
    id: string;
    username: string;
    nickname?: string;
    status?: Status;
    roleIds?: string[];
    roleNames?: string[];
    mfaEnabled?: boolean;
    lastLoginAt?: string;
    createdAt?: string;
  }

  export interface ListAdminsParams {
    page?: number;
    size?: number;
    keyword?: string;
  }

  export interface CreateAdminBody {
    username: string;
    password: string;
    nickname?: string;
    roleIds?: string[];
    status?: Status;
  }

  export interface PatchAdminBody {
    nickname?: string;
    password?: string;
    roleIds?: string[];
    status?: Status;
  }

  export interface AdminStatusBody {
    status: Status;
    reason?: string;
  }

  export interface MfaResetBody {
    reason?: string;
  }

  export interface Permission {
    id?: string;
    code: string;
    name?: string;
    module?: string;
    description?: string;
  }

  export interface Role {
    id: string;
    code: string;
    name: string;
    description?: string;
    permissions?: string[];
    status?: Status;
    userCount?: number;
    createdAt?: string;
  }

  export interface CreateRoleBody {
    code: string;
    name: string;
    description?: string;
    permissions?: string[];
  }

  export interface UpdateRoleBody {
    name?: string;
    description?: string;
    permissions?: string[];
    status?: Status;
  }
}

const ADMINS_BASE = "/admin/v1/admins";
const ROLES_BASE = "/admin/v1/roles";
const PERMISSIONS_BASE = "/admin/v1/permissions";

export const listAdmins = (params: Rbac.ListAdminsParams) => {
  return http.get<Rbac.PageResult<Rbac.AdminAccount>>(ADMINS_BASE, params, { loading: false });
};

export const createAdmin = (body: Rbac.CreateAdminBody) => {
  return http.post<{ ok: boolean }>(ADMINS_BASE, body, { loading: false });
};

export const patchAdmin = (id: string, body: Rbac.PatchAdminBody) => {
  return http.patch<{ ok: boolean }>(`${ADMINS_BASE}/${encodeURIComponent(id)}`, body, {
    loading: false,
  });
};

export const updateAdminStatus = (id: string, body: Rbac.AdminStatusBody) => {
  return http.put<{ ok: boolean }>(`${ADMINS_BASE}/${encodeURIComponent(id)}/status`, body, {
    loading: false,
  });
};

export const resetAdminMfa = (id: string, body: Rbac.MfaResetBody = {}) => {
  return http.post<{ ok: boolean }>(
    `${ADMINS_BASE}/${encodeURIComponent(id)}/mfa/reset`,
    body,
    { loading: false },
  );
};

export const listPermissions = () => {
  return http.get<Rbac.Permission[]>(PERMISSIONS_BASE, {}, { loading: false });
};

export const listRoles = () => {
  return http.get<Rbac.Role[]>(ROLES_BASE, {}, { loading: false });
};

export const createRole = (body: Rbac.CreateRoleBody) => {
  return http.post<{ id: string }>(ROLES_BASE, body, { loading: false });
};

export const updateRole = (id: string, body: Rbac.UpdateRoleBody) => {
  return http.put<{ ok: boolean }>(`${ROLES_BASE}/${encodeURIComponent(id)}`, body, {
    loading: false,
  });
};

export const deleteRole = (id: string, body: { reason?: string } = {}) => {
  return http.delete<{ ok: boolean }>(`${ROLES_BASE}/${encodeURIComponent(id)}`, {}, {
    loading: false,
    data: body,
  });
};
