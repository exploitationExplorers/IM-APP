import { APP_CONFIG } from '@/config'
import type { ApiResponse } from '@/types'
import { getDeviceId } from '@/utils/device'

const TOKEN_KEY = 'im_token'
const REFRESH_TOKEN_KEY = 'im_refresh_token'
/** 网页多开：每个标签页一份登录态。退出登录时不能把整份删掉。 */
export const AUTH_SLOTS_KEY = 'im_auth_slots'
const TAB_ID_KEY = 'im_tab_id'
const SLOT_TTL_MS = 30 * 24 * 60 * 60 * 1000

interface AuthSlot {
  access: string
  refresh: string
  at: number
}

/**
 * 网页每个标签页一个 id，放在 sessionStorage 里。
 * 刷新、谷歌回收后台标签后再打开，这个 id 还在；新开的标签页没有，就可以登另一个号。
 * App 只有一个窗口，继续用原来的单钥匙。
 */
function currentTabId(): string {
  // #ifdef H5
  if (typeof sessionStorage === 'undefined') return ''
  let id = sessionStorage.getItem(TAB_ID_KEY) || ''
  if (!id) {
    id = `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    sessionStorage.setItem(TAB_ID_KEY, id)
  }
  return id
  // #endif
  return ''
}

function readSlots(): Record<string, AuthSlot> {
  try {
    const raw = uni.getStorageSync(AUTH_SLOTS_KEY)
    const text = typeof raw === 'string' ? raw : ''
    if (!text) return {}
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const slots: Record<string, AuthSlot> = {}
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue
      const slot = value as Partial<AuthSlot>
      if (typeof slot.access !== 'string' || typeof slot.refresh !== 'string') continue
      slots[id] = { access: slot.access, refresh: slot.refresh, at: Number(slot.at) || 0 }
    }
    return slots
  } catch {
    return {}
  }
}

function writeSlots(slots: Record<string, AuthSlot>) {
  const now = Date.now()
  const kept: Record<string, AuthSlot> = {}
  for (const [id, slot] of Object.entries(slots)) {
    if (slot.at && now - slot.at > SLOT_TTL_MS) continue
    kept[id] = slot
  }
  if (!Object.keys(kept).length) {
    uni.removeStorageSync(AUTH_SLOTS_KEY)
    return
  }
  uni.setStorageSync(AUTH_SLOTS_KEY, JSON.stringify(kept))
}

function readLegacy(): AuthSlot | null {
  const access = String(uni.getStorageSync(TOKEN_KEY) || '')
  const refresh = String(uni.getStorageSync(REFRESH_TOKEN_KEY) || '')
  if (!access && !refresh) return null
  return { access, refresh, at: Date.now() }
}

function clearLegacy() {
  uni.removeStorageSync(TOKEN_KEY)
  uni.removeStorageSync(REFRESH_TOKEN_KEY)
}

/** 当前标签页的登录态。旧的单钥匙只让第一个还没分槽的标签页接走，避免两个号串了。 */
function slotOfThisTab(): AuthSlot | null {
  const tab = currentTabId()
  if (!tab) return null
  const slots = readSlots()
  if (slots[tab]) return slots[tab]
  const legacy = readLegacy()
  if (!legacy || Object.keys(slots).length > 0) return null
  slots[tab] = legacy
  writeSlots(slots)
  clearLegacy()
  return slots[tab]
}

function updateSlot(patch: Partial<Pick<AuthSlot, 'access' | 'refresh'>>) {
  const tab = currentTabId()
  if (!tab) {
    if (patch.access !== undefined) uni.setStorageSync(TOKEN_KEY, patch.access)
    if (patch.refresh !== undefined) uni.setStorageSync(REFRESH_TOKEN_KEY, patch.refresh)
    return
  }
  const slots = readSlots()
  const prev = slots[tab] || { access: '', refresh: '', at: Date.now() }
  slots[tab] = {
    access: patch.access !== undefined ? patch.access : prev.access,
    refresh: patch.refresh !== undefined ? patch.refresh : prev.refresh,
    at: Date.now(),
  }
  writeSlots(slots)
  clearLegacy()
}

export function getToken(): string {
  const slot = slotOfThisTab()
  if (slot) return slot.access
  if (currentTabId()) return ''
  return String(uni.getStorageSync(TOKEN_KEY) || '')
}

export function setToken(token: string) {
  updateSlot({ access: token })
}

/**
 * App 端 setStorageSync 写完不一定立刻落盘，被强杀进程会导致 token 丢失。
 * 这里 异步落盘 + 主动回读校验，避免杀进程后 window bootstrap 拿到空 token。
 */
export async function persistTokenAsync(token: string): Promise<void> {
  setToken(token)
  // #ifndef H5
  if (typeof uni.setStorage === 'function') {
    await new Promise<void>((resolve) => {
      uni.setStorage({ key: TOKEN_KEY, data: token, success: () => resolve(), fail: () => resolve() })
    })
  }
  // #endif
}

export function getRefreshToken(): string {
  const slot = slotOfThisTab()
  if (slot) return slot.refresh
  if (currentTabId()) return ''
  return String(uni.getStorageSync(REFRESH_TOKEN_KEY) || '')
}

export function setRefreshToken(token: string) {
  updateSlot({ refresh: token })
}

export async function persistRefreshTokenAsync(token: string): Promise<void> {
  setRefreshToken(token)
  // #ifndef H5
  if (typeof uni.setStorage === 'function') {
    await new Promise<void>((resolve) => {
      uni.setStorage({
        key: REFRESH_TOKEN_KEY,
        data: token,
        success: () => resolve(),
        fail: () => resolve(),
      })
    })
  }
  // #endif
}

export function clearToken() {
  const tab = currentTabId()
  if (tab) {
    const slots = readSlots()
    delete slots[tab]
    writeSlots(slots)
    clearLegacy()
    return
  }
  uni.removeStorageSync(TOKEN_KEY)
  uni.removeStorageSync(REFRESH_TOKEN_KEY)
}

interface RequestOptions {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  data?: Record<string, unknown> | unknown
  auth?: boolean
  /** 显式传入 accessToken，避免 App 端 storage 读写竞态导致 Authorization 为空 */
  token?: string
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

function parseResponseBody<T>(raw: unknown): ApiResponse<T> {
  if (typeof raw === 'string') {
    try {
      return parseResponseBody<T>(JSON.parse(raw) as unknown)
    } catch {
      return { code: -1, message: '响应解析失败', data: undefined as T }
    }
  }
  if (raw && typeof raw === 'object' && 'code' in raw) {
    return raw as ApiResponse<T>
  }
  return { code: -1, message: '响应格式错误', data: undefined as T }
}

let refreshingTokenPromise: Promise<string> | null = null
let authExpiredHandler: (() => void) | null = null
let authRedirectScheduled = false

/** 401 时同步清空 Pinia 中的 token，避免内存残留导致无限重试 */
export function setAuthExpiredHandler(handler: () => void) {
  authExpiredHandler = handler
}

export function isAuthFailureError(err: unknown): boolean {
  const msg = (err as Error)?.message || ''
  return (
    msg.includes('未登录') ||
    msg.includes('登录已过期') ||
    msg.includes('刷新登录失败') ||
    msg.includes('请求失败(401)')
  )
}

function handleAuthExpired() {
  clearToken()
  authExpiredHandler?.()
  if (authRedirectScheduled) return
  authRedirectScheduled = true
  uni.reLaunch({
    url: '/pages/auth/sign-in',
    complete: () => {
      setTimeout(() => {
        authRedirectScheduled = false
      }, 2000)
    },
  })
}

function isRefreshEndpoint(url: string): boolean {
  return url === '/auth/token/refresh' || url.endsWith('/auth/token/refresh')
}

/** App 端 GET 的 data 偶发未拼进 query，显式序列化到 URL。不用 URLSearchParams：部分 App 运行时没有该 API。 */
function appendQueryParams(url: string, data?: Record<string, unknown> | unknown): string {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return url
  const parts: string[] = []
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (value === undefined || value === null || value === '') continue
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
  }
  if (!parts.length) return url
  const qs = parts.join('&')
  return url.includes('?') ? `${url}&${qs}` : `${url}?${qs}`
}

function rawRequest<T>(options: RequestOptions, tokenOverride?: string): Promise<RawResponse<T>> {
  const { url, method = 'GET', data, auth = true, header = {} } = options
  const token = tokenOverride ?? options.token ?? getToken()
  const baseUrl = url.startsWith('http') ? url : `${APP_CONFIG.apiBaseUrl}${url}`
  const requestUrl = method === 'GET' ? appendQueryParams(baseUrl, data) : baseUrl
  const requestData = method === 'GET' ? undefined : (data as UniApp.RequestOptions['data'])
  return new Promise((resolve, reject) => {
    uni.request({
      url: requestUrl,
      method: method as UniApp.RequestOptions['method'],
      data: requestData,
      header: {
        'Content-Type': 'application/json',
        ...(auth && token ? { Authorization: `Bearer ${token}` } : {}),
        ...header,
      },
      success: (res) => {
        resolve({
          statusCode: res.statusCode,
          body: parseResponseBody<T>(res.data),
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
          // 异步落盘 + 回读校验，确保 App 强杀进程后 token 仍在 storage
          void persistTokenAsync(body.data.accessToken).then(() => {
            if (getToken() !== body.data.accessToken) setToken(body.data.accessToken)
          })
          void persistRefreshTokenAsync(body.data.refreshToken).then(() => {
            if (getRefreshToken() !== body.data.refreshToken) setRefreshToken(body.data.refreshToken)
          })
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
        handleAuthExpired()
        throw new Error('未登录或登录已过期')
      }
      throw new Error(retriedRes.body?.message || `请求失败(${retriedRes.statusCode})`)
    } catch (e) {
      if (isAuthFailureError(e)) throw e
      handleAuthExpired()
      throw new Error('未登录或登录已过期')
    }
  }

  if (statusCode === 401) {
    handleAuthExpired()
    throw new Error('未登录或登录已过期')
  }
  if (statusCode >= 200 && statusCode < 300 && body && body.code === 0) {
    return body.data
  }
  throw new Error(body?.message || `请求失败(${statusCode})`)
}
