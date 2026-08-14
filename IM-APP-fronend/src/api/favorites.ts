import { request } from "@/utils/request";

export type FavoriteType =
  | "text"
  | "emoji"
  | "image"
  | "video"
  | "file"
  | "voice";

export enum FavoriteListType {
  All = 0,
  Text = 1,
  Media = 2,
  File = 3,
  Voice = 4,
}

export interface FavoriteItem {
  id: string;
  messageId: string;
  type: FavoriteType;
  content: string;
  senderId: string;
  conversationId: string;
  createdAt: string;
}

export interface FetchFavoritesParams {
  type?: FavoriteListType;
  page?: number;
  size?: number;
}

/** 收藏消息 */
export async function createFavorite(messageId: string): Promise<FavoriteItem> {
  return request<FavoriteItem>({
    url: "/favorites",
    method: "POST",
    data: { messageId },
  });
}

/** 获取收藏列表 */
export async function fetchFavorites(
  params: FetchFavoritesParams = {},
): Promise<FavoriteItem[]> {
  return request<FavoriteItem[]>({
    url: "/favorites/list",
    method: "POST",
    data: params,
  });
}

/** 删除收藏消息 */
export async function deleteFavorite(favoriteId: string): Promise<void> {
  await request<null>({
    url: `/favorites/${favoriteId}`,
    method: "DELETE",
  });
}
