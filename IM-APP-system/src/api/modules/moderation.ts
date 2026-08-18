import http from "@/api";
import type { AdminPage, Moderation } from "@/api/interface";

const MODERATION_BASE = "/admin/v1/moderation";

export const getModerationHits = (params: Moderation.ReqHitsParams = {}) => {
  return http.get<AdminPage<Moderation.HitItem>>(`${MODERATION_BASE}/hits`, params);
};
