import http from "@/api";

export namespace AdminFeatures {
  export interface FeaturesConfig {
    mfa: boolean;
    report: boolean;
  }

  export interface ReqUpdateFeaturesBody {
    mfa?: boolean;
    report?: boolean;
    reason: string;
  }
}

const FEATURES_BASE = "/admin/v1/features";

export const getAdminFeaturesApi = () => {
  return http.get<AdminFeatures.FeaturesConfig>(FEATURES_BASE, undefined, { loading: false });
};

export const putAdminFeaturesApi = (body: AdminFeatures.ReqUpdateFeaturesBody) => {
  return http.put<null>(FEATURES_BASE, body, { loading: false });
};

