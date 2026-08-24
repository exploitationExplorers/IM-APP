import { request } from '@/utils/request'

export interface StickerItem {
  id: string
  fileId?: string
  url: string
  createdAt: string
}

export interface FetchStickersParams {
  page?: number
  size?: number
}

/** 表情列表 */
export async function fetchStickers(params: FetchStickersParams = {}): Promise<StickerItem[]> {
  return request<StickerItem[]>({
    url: '/stickers',
    method: 'GET',
    data: {
      page: params.page ?? 1,
      size: params.size ?? 100,
    },
  })
}

/** 用已上传 fileId 登记表情 */
export async function createSticker(fileId: string): Promise<StickerItem> {
  return request<StickerItem>({
    url: '/stickers',
    method: 'POST',
    data: { fileId },
  })
}

/** 批量删除表情 */
export async function deleteStickers(stickerIds: string[]): Promise<void> {
  await request<{ ok: boolean }>({
    url: '/stickers/delete',
    method: 'POST',
    data: { stickerIds },
  })
}
