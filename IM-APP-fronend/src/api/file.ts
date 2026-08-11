import { APP_CONFIG } from '@/config'
import { request } from '@/utils/request'
import { mockPresignFile } from '@/mock/handlers/file'

export interface PresignResult {
  uploadUrl: string
  fileUrl: string
  objectKey: string
  expiresIn: number
  devMode?: boolean
}

export async function presignFile(filename: string, contentType?: string): Promise<PresignResult> {
  if (APP_CONFIG.useMock) return mockPresignFile(filename, contentType)
  return request<PresignResult>({
    url: '/files/presign',
    method: 'POST',
    data: { filename, contentType },
  })
}
