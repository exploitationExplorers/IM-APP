export const H5_PREVIEW_DEFAULT_URL = "https://www.ke58.com";

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
