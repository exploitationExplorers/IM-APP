/** H5 / 管理后台预览嵌入地址；服务端 CSP frame-src 与前端 iframe src 共用，避免漂移。 */
export const H5_PREVIEW_DEFAULT_URL = "https://www.ke58.com";
export const ADMIN_PREVIEW_DEFAULT_URL = "https://admin.ke58.com/login";

export function previewFrameSrcDirectives(urls: readonly string[] = [H5_PREVIEW_DEFAULT_URL, ADMIN_PREVIEW_DEFAULT_URL]): string[] {
  const origins = new Set<string>(["'self'"]);
  for (const url of urls) {
    try {
      origins.add(new URL(url).origin);
    } catch {
      /* 非法 URL 忽略，避免拖垮 Helmet 启动 */
    }
  }
  return [...origins];
}
