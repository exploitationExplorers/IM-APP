import { request } from '@/utils/request'

export interface CreateFeedbackInput {
  contact?: string
  content: string
  imageFileIds?: string[]
}

export interface FeedbackResult {
  id: string
  createdAt: string
}

export async function createFeedback(input: CreateFeedbackInput): Promise<FeedbackResult> {
  return request<FeedbackResult>({
    url: '/feedbacks',
    method: 'POST',
    data: {
      contact: input.contact || '',
      content: input.content,
      imageFileIds: input.imageFileIds || [],
    },
  })
}
