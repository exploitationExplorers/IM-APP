import axios, {
  AxiosError,
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig
} from "axios";
import { ElMessage } from "element-plus";

import { Auth, ResultData } from "@/api/interface";
import { showFullScreenLoading, tryHideFullScreenLoading } from "@/components/Loading/fullScreen";
import { LOGIN_URL } from "@/config";
import { ResultEnum } from "@/enums/httpEnum";
import router from "@/router";
import { useAuthStore } from "@/stores/auth";

import { AxiosCanceler } from "./helper/axiosCancel";
import { checkStatus } from "./helper/checkStatus";

export interface CustomAxiosRequestConfig extends InternalAxiosRequestConfig {
  loading?: boolean;
  cancel?: boolean;
  _retry?: boolean;
}

const config = {
  baseURL: import.meta.env.VITE_API_URL as string,
  timeout: ResultEnum.TIMEOUT as number,
  withCredentials: false
};

const axiosCanceler = new AxiosCanceler();

let refreshPromise: Promise<string> | null = null;

function isAuthEndpoint(url = ""): boolean {
  return url.includes("/auth/login") || url.includes("/auth/token/refresh");
}

function pickMessage(data: { message?: string; msg?: string } | undefined, fallback: string): string {
  return data?.message || data?.msg || fallback;
}

async function refreshAccessToken(): Promise<string> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const authStore = useAuthStore();
    const currentRefresh = authStore.refreshToken;
    if (!currentRefresh) {
      throw new Error("missing refresh token");
    }

    const response = await axios.post<ResultData<Auth.ResLogin>>(
      `${config.baseURL}/admin/v1/auth/token/refresh`,
      { refreshToken: currentRefresh },
      { timeout: ResultEnum.TIMEOUT as number }
    );

    const body = response.data;
    if (body.code !== ResultEnum.SUCCESS || !body.data?.token) {
      throw new Error(pickMessage(body, "登录已过期"));
    }

    authStore.setSession(body.data);
    return body.data.token;
  })().finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

function forceLogout(message: string): void {
  const authStore = useAuthStore();
  authStore.logout();
  router.replace(LOGIN_URL);
  ElMessage.error(message);
}

class RequestHttp {
  service: AxiosInstance;
  public constructor(axiosConfig: AxiosRequestConfig) {
    this.service = axios.create(axiosConfig);

    this.service.interceptors.request.use(
      (requestConfig: CustomAxiosRequestConfig) => {
        const authStore = useAuthStore();
        requestConfig.cancel ??= true;
        if (requestConfig.cancel) axiosCanceler.addPending(requestConfig);
        requestConfig.loading ??= true;
        if (requestConfig.loading) showFullScreenLoading();
        if (authStore.token && requestConfig.headers && typeof requestConfig.headers.set === "function") {
          requestConfig.headers.set("Authorization", `Bearer ${authStore.token}`);
        }
        return requestConfig;
      },
      (error: AxiosError) => Promise.reject(error)
    );

    this.service.interceptors.response.use(
      (response: AxiosResponse & { config: CustomAxiosRequestConfig }) => {
        const { data, config: requestConfig } = response;
        axiosCanceler.removePending(requestConfig);
        if (requestConfig.loading) tryHideFullScreenLoading();

        if (data?.code === ResultEnum.OVERDUE) {
          forceLogout(pickMessage(data, "登录失效！请您重新登录"));
          return Promise.reject(data);
        }

        if (typeof data?.code === "number" && data.code !== ResultEnum.SUCCESS) {
          ElMessage.error(pickMessage(data, "请求失败"));
          return Promise.reject(data);
        }

        return data;
      },
      async (error: AxiosError<ResultData>) => {
        const { response } = error;
        const requestConfig = error.config as CustomAxiosRequestConfig | undefined;
        tryHideFullScreenLoading();

        if (requestConfig) axiosCanceler.removePending(requestConfig);

        if (error.message.includes("timeout")) ElMessage.error("请求超时！请您稍后重试");
        if (error.message.includes("Network Error")) ElMessage.error("网络错误！请您稍后重试");

        if (
          response?.status === 401 &&
          requestConfig &&
          !requestConfig._retry &&
          !isAuthEndpoint(requestConfig.url)
        ) {
          try {
            requestConfig._retry = true;
            const newToken = await refreshAccessToken();
            if (requestConfig.headers && typeof requestConfig.headers.set === "function") {
              requestConfig.headers.set("Authorization", `Bearer ${newToken}`);
            }
            return this.service.request(requestConfig);
          } catch {
            forceLogout("登录失效！请您重新登录");
            return Promise.reject(error);
          }
        }

        if (response?.status === 401) {
          forceLogout(pickMessage(response.data, "登录失效！请您重新登录"));
          return Promise.reject(error);
        }

        if (response) {
          const bizMessage = pickMessage(response.data, "");
          if (bizMessage) ElMessage.error(bizMessage);
          else checkStatus(response.status);
        }

        if (!window.navigator.onLine) router.replace("/500");
        return Promise.reject(error);
      }
    );
  }

  get<T>(url: string, params?: object, _object = {}): Promise<ResultData<T>> {
    return this.service.get(url, { params, ..._object });
  }
  post<T>(url: string, params?: object | string, _object = {}): Promise<ResultData<T>> {
    return this.service.post(url, params, _object);
  }
  put<T>(url: string, params?: object, _object = {}): Promise<ResultData<T>> {
    return this.service.put(url, params, _object);
  }
  delete<T>(url: string, params?: any, _object = {}): Promise<ResultData<T>> {
    return this.service.delete(url, { params, ..._object });
  }
  download(url: string, params?: object, _object = {}): Promise<BlobPart> {
    return this.service.post(url, params, { ..._object, responseType: "blob" });
  }
}

export default new RequestHttp(config);
