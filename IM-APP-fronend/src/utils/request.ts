import { APP_CONFIG } from '@/config'
import type { ApiResponse } from '@/types'

const TOKEN_KEY = 'im_token'

export function getToken(): string {
  return uni.getStorageSync(TOKEN_KEY) || ''
}

export function setToken(token: string) {
  uni.setStorageSync(TOKEN_KEY, token)
}

export function clearToken() {
  uni.removeStorageSync(TOKEN_KEY)
}

interface RequestOptions {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  data?: Record<string, unknown> | unknown
  auth?: boolean
  header?: Record<string, string>
}

export async function request<T>(options: RequestOptions): Promise<T> {
  const { url, method = 'GET', data, auth = true, header = {} } = options
  const token = getToken()

  return new Promise((resolve, reject) => {
    uni.request({
      url: url.startsWith('http') ? url : `${APP_CONFIG.apiBaseUrl}${url}`,
      method,
      data: data as UniApp.RequestOptions['data'],
      header: {
        'Content-Type': 'application/json',
        ...(auth && token ? { Authorization: `Bearer ${token}` } : {}),
        ...header,
      },
      success: (res) => {
        const body = res.data as ApiResponse<T>
        if (res.statusCode === 401) {
          clearToken()
          uni.reLaunch({ url: '/pages/auth/sign-in' })
          reject(new Error('未登录或登录已过期'))
          return
        }
        if (res.statusCode >= 200 && res.statusCode < 300 && body && body.code === 0) {
          resolve(body.data)
          return
        }
        const msg = body?.message || `请求失败(${res.statusCode})`
        reject(new Error(msg))
      },
      fail: (err) => {
        reject(new Error(err.errMsg || '网络异常'))
      },
    })
  })
}
