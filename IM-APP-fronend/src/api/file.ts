import { request } from '@/utils/request'
import type {
  CompleteUploadInput,
  CreateUploadInput,
  FileObject,
  PresignResult,
  UploadInitResult,
} from '@/types'

export async function createUploadTask(input: CreateUploadInput): Promise<UploadInitResult> {
  return request<UploadInitResult>({
    url: '/files/uploads',
    method: 'POST',
    data: input,
  })
}

/** 完成上传：后端为 POST /files/uploads/complete，fileId 放 body */
export async function completeUpload(
  fileId: string,
  input: CompleteUploadInput = {},
): Promise<FileObject> {
  return request<FileObject>({
    url: '/files/uploads/complete',
    method: 'POST',
    data: { fileId, ...input },
  })
}

/** 查询已完成文件：后端为 GET /files?fileId= */
export async function getFileInfo(fileId: string): Promise<FileObject> {
  return request<FileObject>({
    url: '/files',
    method: 'GET',
    data: { fileId },
  })
}

/** @deprecated 旧版直传 presign，新上传请用 createUploadTask */
export async function presignFile(filename: string, contentType?: string): Promise<PresignResult> {
  return request<PresignResult>({
    url: '/files/presign',
    method: 'POST',
    data: { filename, contentType },
  })
}
