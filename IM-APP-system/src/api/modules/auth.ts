import http from "@/api";
import type { Auth } from "@/api/interface";

const AUTH_BASE = "/admin/v1/auth";

export const loginApi = (params: Auth.ReqLoginForm) => {
  return http.post<Auth.ResLogin>(`${AUTH_BASE}/login`, params, { loading: false, cancel: false });
};

export const refreshTokenApi = (params: Auth.ReqRefreshForm) => {
  return http.post<Auth.ResLogin>(`${AUTH_BASE}/token/refresh`, params, {
    loading: false,
    cancel: false
  });
};
