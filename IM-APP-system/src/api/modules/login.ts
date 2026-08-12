import http from "@/api";
import { PORT1 } from "@/api/config/servicePort";
import { Login } from "@/api/interface/index";

/**
 * @description 用户登录
 * @param params Login.ReqLoginForm
 * @returns Promise<Login.ResLogin>
 */
export const loginApi = (params: Login.ReqLoginForm) => {
  return http.post<Login.ResLogin>(PORT1 + `/login`, params, { loading: false });
};

/**
 * @description 获取菜单列表
 * @returns Promise<Menu.MenuOptions[]>
 */
export const getAuthMenuListApi = () => {
  return http.get<any[]>(PORT1 + `/menu/list`, {}, { loading: false });
};

/**
 * @description 获取按钮权限
 * @returns Promise<Login.ResAuthButtons>
 */
export const getAuthButtonListApi = () => {
  return http.get<Login.ResAuthButtons>(PORT1 + `/auth/buttons`, {}, { loading: false });
};

/**
 * @description 用户退出登录
 */
export const logoutApi = () => {
  return http.post(PORT1 + `/logout`);
};
