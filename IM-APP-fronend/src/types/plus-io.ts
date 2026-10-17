/** App 端 plus.io / plus.gallery 回调。替代裸 Function，方便两端字段对齐。 */
export interface PlusFileEntry {
  toURL?: () => string
  toLocalURL?: () => string
  fullPath?: string
  file?: (
    success: (file: { size?: number; slice?: (start: number, end: number) => unknown }) => void,
    fail?: () => void,
  ) => void
  copyTo?: (
    parent: unknown,
    newName: string,
    success: (copied: { fullPath?: string; toLocalURL?: () => string }) => void,
    fail?: () => void,
  ) => void
}

export type PlusResolveLocalFile = (
  url: string,
  success: (entry: PlusFileEntry) => void,
  fail?: (err?: unknown) => void,
) => void

export type PlusGallerySave = (
  path: string,
  success: () => void,
  fail?: (err: { message?: string } | string) => void,
) => void
