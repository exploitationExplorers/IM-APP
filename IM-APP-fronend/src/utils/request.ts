import { APP_CONFIG } from '@/config'
import type { ApiResponse } from '@/types'
import { getDeviceId } from '@/utils/device'

const TOKEN_KEY = 'im_token'
const REFRESH_TOKEN_KEY = 'im_refresh_token'

export function getToken(): string {
  return uni.getStorageSync(TOKEN_KEY) || ''
}

export function setToken(token: string) {
  uni.setStorageSync(TOKEN_KEY, token)
}

export function getRefreshToken(): string {
  return uni.getStorageSync(REFRESH_TOKEN_KEY) || ''
}

export function setRefreshToken(token: string) {
  uni.setStorageSync(REFRESH_TOKEN_KEY, token)
}

export function clearToken() {
  uni.removeStorageSync(TOKEN_KEY)
  uni.removeStorageSync(REFRESH_TOKEN_KEY)
}

interface RequestOptions {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  data?: Record<string, unknown> | unknown
  auth?: boolean
  header?: Record<string, string>
}

interface TokenPair {
  accessToken: string
  refreshToken: string
}

interface RawResponse<T> {
  statusCode: number
  body: ApiResponse<T>
}

let refreshingTokenPromise: Promise<string> | null = null

function isRefreshEndpoint(url: string): boolean {
  return url === '/auth/token/refresh' || url.endsWith('/auth/token/refresh')
}

function rawRequest<T>(options: RequestOptions, tokenOverride?: string): Promise<RawResponse<T>> {
  const { url, method = 'GET', data, auth = true, header = {} } = options
  const token = tokenOverride ?? getToken()
  return new Promise((resolve, reject) => {
    uni.request({
      url: url.startsWith('http') ? url : `${APP_CONFIG.apiBaseUrl}${url}`,
      method: method as UniApp.RequestOptions['method'],
      data: data as UniApp.RequestOptions['data'],
      header: {
        'Content-Type': 'application/json',
        ...(auth && token ? { Authorization: `Bearer ${token}` } : {}),
        ...header,
      },
      success: (res) => {
        resolve({
          statusCode: res.statusCode,
          body: res.data as ApiResponse<T>,
        })
      },
      fail: (err) => {
        reject(new Error(err.errMsg || '网络异常'))
      },
    })
  })
}

async function refreshAccessToken(): Promise<string> {
  const refreshToken = getRefreshToken()
  if (!refreshToken) throw new Error('未登录或登录已过期')
  if (!refreshingTokenPromise) {
    refreshingTokenPromise = rawRequest<TokenPair>(
      {
        url: '/auth/token/refresh',
        method: 'POST',
        auth: false,
        data: {
          refreshToken,
          deviceId: getDeviceId(),
        },
      },
      '',
    )
      .then(({ statusCode, body }) => {
        if (statusCode >= 200 && statusCode < 300 && body?.code === 0 && body.data?.accessToken) {
          setToken(body.data.accessToken)
          setRefreshToken(body.data.refreshToken)
          return body.data.accessToken
        }
        throw new Error(body?.message || `刷新登录失败(${statusCode})`)
      })
      .finally(() => {
        refreshingTokenPromise = null
      })
  }
  return refreshingTokenPromise
}

export async function request<T>(options: RequestOptions, retried = false): Promise<T> {
  const response = await rawRequest<T>(options)
  const { statusCode, body } = response
  const canRefresh =
    options.auth !== false && !retried && !isRefreshEndpoint(options.url) && !!getRefreshToken()

  if (statusCode === 401 && canRefresh) {
    try {
      const token = await refreshAccessToken()
      const retriedRes = await rawRequest<T>(options, token)
      if (
        retriedRes.statusCode >= 200 &&
        retriedRes.statusCode < 300 &&
        retriedRes.body &&
        retriedRes.body.code === 0
      ) {
        return retriedRes.body.data
      }
      if (retriedRes.statusCode === 401) {
        clearToken()
        uni.reLaunch({ url: '/pages/auth/sign-in' })
        throw new Error('未登录或登录已过期')
      }
      throw new Error(retriedRes.body?.message || `请求失败(${retriedRes.statusCode})`)
    } catch {
      clearToken()
      uni.reLaunch({ url: '/pages/auth/sign-in' })
      throw new Error('未登录或登录已过期')
    }
  }

  if (statusCode === 401) {
    clearToken()
    uni.reLaunch({ url: '/pages/auth/sign-in' })
    throw new Error('未登录或登录已过期')
  }
  if (statusCode >= 200 && statusCode < 300 && body && body.code === 0) {
    return body.data
  }
  throw new Error(body?.message || `请求失败(${statusCode})`)
}
