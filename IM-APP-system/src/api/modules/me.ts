import http from "@/api";
import type { Me } from "@/api/interface";

const ME_BASE = "/admin/v1/me";

export const getMeApi = () => {
  return http.get<Me.ResMeResult>(ME_BASE, undefined, { loading: false });
};

export const getMyMfaApi = () => {
  return http.get<Me.ResMfaStatus>(`${ME_BASE}/mfa`, undefined, { loading: false });
};

export const setupMyMfaApi = (body: Me.ReqMfaCodeForm) => {
  return http.post<{ ok: boolean }>(`${ME_BASE}/mfa/setup`, body, { loading: false });
};

export const disableMyMfaApi = (body: Me.ReqMfaCodeForm) => {
  return http.post<{ ok: boolean }>(`${ME_BASE}/mfa/disable`, body, { loading: false });
};

export const changeMyPasswordApi = (body: Me.ReqPasswordChangeForm) => {
  return http.put<{ ok: boolean }>(`${ME_BASE}/password`, body, { loading: false });
};

