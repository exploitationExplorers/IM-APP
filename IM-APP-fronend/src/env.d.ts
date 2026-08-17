/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  /** 设为 'false' 关闭 OpenIM 聊天（排查用），默认启用 */
  readonly VITE_OPENIM_ENABLED?: string
  readonly VITE_DEFAULT_AVATAR_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module 'qrcode' {
  interface QRCodeToDataURLOptions {
    width?: number
    margin?: number
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H'
    color?: {
      dark?: string
      light?: string
    }
  }

  interface QRCodeModules {
    size: number
    get(row: number, col: number): number
  }

  interface QRCodeCreateResult {
    modules: QRCodeModules
  }

  const QRCode: {
    create(text: string, options?: QRCodeToDataURLOptions): QRCodeCreateResult
    toDataURL(text: string, options?: QRCodeToDataURLOptions): Promise<string>
  }

  export default QRCode
}

interface PlusNativeObjBitmap {
  loadBase64Data(data: string, success: () => void, fail: (err: unknown) => void): void
  save(
    path: string,
    options: Record<string, unknown>,
    success: () => void,
    fail: (err: unknown) => void,
  ): void
  clear(): void
}

interface PlusIoDirectoryEntry {
  fullPath: string
  getDirectory(
    path: string,
    options: { create?: boolean; exclusive?: boolean },
    success: (entry: PlusIoDirectoryEntry) => void,
    fail: (err: unknown) => void,
  ): void
}

interface PlusIoFileSystem {
  root: PlusIoDirectoryEntry
}

interface PlusIo {
  PRIVATE_DOC: number
  convertLocalFileSystemURL(path: string): string
  requestFileSystem(
    type: number,
    success: (fs: PlusIoFileSystem) => void,
    fail?: (err: unknown) => void,
  ): void
}

interface PlusNative {
  nativeObj?: {
    Bitmap?: new (id: string) => PlusNativeObjBitmap
  }
  io?: PlusIo
  barcode?: {
    scan: (
      path: string,
      success: (type: number, result: string) => void,
      error?: (error: unknown) => void,
    ) => void
  }
  os?: {
    name?: string
    version?: string
  }
  android?: {
    requestPermissions?: (
      permissions: string[],
      successCallback: (result: {
        granted?: string[]
        deniedPresent?: string[]
        deniedAlways?: string[]
      }) => void,
      errorCallback?: (err: unknown) => void,
    ) => void
  }
}

declare const plus: PlusNative | undefined
