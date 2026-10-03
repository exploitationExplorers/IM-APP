export { H5_PREVIEW_DEFAULT_URL } from "../shared/preview-embed";

/** 与 IM-APP-fronend `DESKTOP_BREAKPOINT` 对齐：iframe 宽度 ≥ 该值走 PC 三栏布局 */
export const H5_PREVIEW_DESKTOP_BREAKPOINT = 960;

export type H5PreviewMode = "pc" | "mobile";

export interface H5PreviewDevicePreset {
  id: string;
  label: string;
  width: number;
  height: number;
}

export const H5_PREVIEW_DEVICE_PRESETS: readonly H5PreviewDevicePreset[] = [
  { id: "iphone-se", label: "iPhone SE", width: 375, height: 667 },
  { id: "iphone-14", label: "iPhone 14", width: 390, height: 844 },
  { id: "iphone-14-pro-max", label: "iPhone 14 Pro Max", width: 430, height: 932 },
] as const;
