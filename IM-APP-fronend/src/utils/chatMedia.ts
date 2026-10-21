/**
 * 聊天媒体工具入口：按职责拆到 chatMedia*.ts，这里只做再导出，
 * 保持历史 import `@/utils/chatMedia` 不变，并压过 max-lines。
 */
export type { VideoMeta } from '@/utils/chatMediaVideo'
export type { FileMeta } from '@/utils/chatMediaFile'

export {
  isRemoteMediaUrl,
  looksLikeLocalFilePath,
  preferRemoteMediaUrl,
  h5PublicMediaUrl,
  listThumbnailUrl,
  previewThumbnailUrl,
  avatarThumbnailUrl,
  toAbsFileUrl,
  playableMediaUrl,
  imagePreviewUrlOf,
  installH5MediaProxy,
} from '@/utils/chatMediaUrl'

export {
  formatVideoDuration,
  videoSnapshotTime,
  parseVideoMeta,
  isUsableVideoPoster,
  mergeVideoContent,
  videoPlayUrlFromContent,
  videoPosterUrlFromContent,
  captureVideoPosterFromUrl,
  downloadRemoteVideoForCover,
} from '@/utils/chatMediaVideo'

export {
  requestAndroidSaveAlbumPermission,
  saveVideoToDevice,
  saveImageToDevice,
  previewImagesWithSave,
} from '@/utils/chatMediaSave'

export { ensurePlayableAudioPath } from '@/utils/chatMediaAudio'

export { parseFileContent, openChatFile } from '@/utils/chatMediaFile'
