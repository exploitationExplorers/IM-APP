/**
 * 子路径部署支持。
 * 当 viron 通过 nginx 反代挂在子路径（如 /opt）时，前端的所有资源 / API / WebSocket 请求
 * 都必须带上该前缀，否则会打到站点根路径，与同域其他应用冲突。
 *
 * WEB_BASE 直接取自 vite.config.ts 的 base 配置：
 *  - web 部署：/opt/  -> WEB_BASE = /opt
 *  - 桌面端：./       -> WEB_BASE = "."，withBase 退化为原样返回
 */
export const WEB_BASE = import.meta.env.BASE_URL.replace(/\/+$/, "");

export function withBase(path: string): string {
  return WEB_BASE.startsWith(".") || !path.startsWith("/") ? path : `${WEB_BASE}${path}`;
}
