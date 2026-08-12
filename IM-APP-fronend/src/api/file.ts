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

export async function completeUpload(
  fileId: string,
  input: CompleteUploadInput = {},
): Promise<FileObject> {
  return request<FileObject>({
    url: `/files/uploads/${fileId}/complete`,
    method: 'POST',
    data: input,
  })
}

export async function getFileInfo(fileId: string): Promise<FileObject> {
  return request<FileObject>({
    url: `/files/${fileId}`,
    method: 'GET',
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
