import http from "@/api";
import { PORT1 } from "@/api/config/servicePort";
import { Login } from "@/api/interface/index";

export { loginApi, refreshTokenApi } from "./auth";

export const getAuthMenuListApi = () => {
  return http.get<any[]>(PORT1 + `/menu/list`, {}, { loading: false });
};

export const getAuthButtonListApi = () => {
  return http.get<Login.ResAuthButtons>(PORT1 + `/auth/buttons`, {}, { loading: false });
};

export const logoutApi = () => {
  return http.post(PORT1 + `/logout`);
};
