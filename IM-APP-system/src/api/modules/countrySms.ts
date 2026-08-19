import http from "@/api";
import type { AdminPage } from "@/api/interface";

export namespace CountrySms {
  export interface CountryItem {
    cnName: string;
    code: string;
    dialCode: string;
    enName: string;
    enabled: boolean;
    phoneRule: string;
    sortOrder: number;
  }

  export interface ReqCreateCountryBody {
    cnName: string;
    code: string;
    dialCode: string;
    enName: string;
    enabled: boolean;
    phoneRule: string;
    sortOrder: number;
  }

  export interface ReqUpdateCountryStatusBody {
    enabled: boolean;
    reason: string;
  }

  export interface ResOk {
    ok: boolean;
  }

  export type SmsLogStatus = "sent" | "success" | "failed" | "pending";

  export interface SmsLogItem {
    countryCode: string;
    createdAt: string;
    errorCode: string;
    id: number;
    phoneMasked: string;
    provider: string;
    scene: string;
    status: SmsLogStatus;
  }

  export interface ReqSmsLogsParams {
    page?: number;
    size?: number;
    keyword?: string;
    status?: SmsLogStatus;
  }

  export type SmsLogDetail = Record<string, unknown> & SmsLogItem;

  export interface SmsStatisticsByDateItem {
    date: string;
    failed: number;
    success: number;
    total: number;
  }

  export interface SmsStatisticsData {
    byDate: SmsStatisticsByDateItem[];
    deliveredRate: number;
    failed: number;
    success: number;
    total: number;
  }

  export interface ReqSmsStatisticsParams {
    days?: number;
  }
}

const COUNTRIES_BASE = "/admin/v1/countries";
const SMS_LOGS_BASE = "/admin/v1/sms/logs";
const SMS_STATISTICS_BASE = "/admin/v1/sms/statistics";

export const getAdminCountriesApi = () => {
  return http.get<CountrySms.CountryItem[]>(COUNTRIES_BASE, undefined, { loading: false });
};

export const postAdminCreateCountryApi = (body: CountrySms.ReqCreateCountryBody) => {
  return http.post<CountrySms.ResOk>(COUNTRIES_BASE, body, { loading: false });
};

export const putAdminCountryStatusApi = (countryCode: string, body: CountrySms.ReqUpdateCountryStatusBody) => {
  return http.put<CountrySms.ResOk>(`${COUNTRIES_BASE}/${encodeURIComponent(countryCode)}/status`, body, { loading: false });
};

export const getAdminSmsLogsApi = (params: CountrySms.ReqSmsLogsParams = {}) => {
  return http.get<AdminPage<CountrySms.SmsLogItem>>(SMS_LOGS_BASE, params, { loading: false });
};

export const getAdminSmsLogDetailApi = (id: string | number) => {
  return http.get<CountrySms.SmsLogDetail>(`${SMS_LOGS_BASE}/${encodeURIComponent(String(id))}`, undefined, { loading: false });
};

export const getAdminSmsStatisticsApi = (params: CountrySms.ReqSmsStatisticsParams = {}) => {
  return http.get<CountrySms.SmsStatisticsData>(SMS_STATISTICS_BASE, params, { loading: false });
};

