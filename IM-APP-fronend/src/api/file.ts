import { request } from '@/utils/request'

export interface PresignResult {
  uploadUrl: string
  fileUrl: string
  objectKey: string
  expiresIn: number
  devMode?: boolean
}

export async function presignFile(filename: string, contentType?: string): Promise<PresignResult> {
  return request<PresignResult>({
    url: '/files/presign',
    method: 'POST',
    data: { filename, contentType },
  })
}
