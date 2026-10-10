import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { AuthResult, UpdateProfileInput, UserInfo } from '@/types'
import {
  loginByPassword,
  loginBySms,
  registerBySms,
  fetchProfile,
  logoutCurrentDevice,
  refreshAuthToken,
} from '@/api/auth'
import { updateMyPublicId, updateProfile } from '@/api/user'
import {
  clearToken,
  getRefreshToken,
  getToken,
  persistRefreshTokenAsync,
  persistTokenAsync,
  setRefreshToken,
  setToken,
} from '@/utils/request'
import { initOpenIM, logoutOpenIM } from '@/utils/openim'
import { applyLoginPhone, clearLoginPhone, saveLoginPhone } from '@/utils/login-phone'
import { clearSessionStorage } from '@/utils/app-cache'
import { clearFriendRequestBadge } from '@/utils/friend-request-badge'
import { syncPushRegistration, unregisterPushRegistration } from '@/utils/push-register'
import { useChatStore } from '@/stores/chat'
import { useChatSettingsStore } from '@/stores/chatSettings'
import { useContactStore } from '@/stores/contact'
import { useGroupStore } from '@/stores/group'
import { useMassSendStore } from '@/stores/massSend'
import { perfColdStartDone } from '@/utils/perf'

export const useUserStore = defineStore('user', () => {
  const token = ref(getToken())
  const refreshToken = ref(getRefreshToken())
  const profile = ref<UserInfo | null>(null)

  const isLoggedIn = computed(() => !!token.value)

  /** 冷启动补救读取进行中的 promise，多个守卫并发时共用一次，避免重复读 storage */
  let restorePromise: Promise<boolean> | null = null

  /** 拿到 token 后的统一收尾：拉起 IM 会话并补拉用户资料 */
  function applyRestoredToken(stored: string) {
    token.value = stored
    const storedRefresh = getRefreshToken()
    if (storedRefresh) refreshToken.value = storedRefresh
    startIMSession()
    loadProfile().catch(() => undefined)
  }

  /**
   * 冷启动时 uni.getStorageSync 有初始化竞态，第一次读可能返回空
   * （见 bootstrap 里的说明）。storage 里明明有 token 却被判成未登录，
   * 就会被 auth guard 踢去登录页 —— 表现就是「重启后非得重新登录」。
   *
   * 这里按递增间隔补救读取几次；读到就恢复登录态。返回是否已登录。
   * 已登录时同步 resolve，不产生任何等待。
   */
  function restoreSessionIfNeeded(): Promise<boolean> {
    if (token.value) return Promise.resolve(true)
    // #ifdef H5
    // H5 的 localStorage 同步读写不存在竞态，不需要补救读取
    return Promise.resolve(false)
    // #endif
    // 已有在飞的补救读取就复用它，避免多个守卫各读一轮
    if (restorePromise === null) {
      const delays = [120, 400, 900]
      const task = (async () => {
        for (const ms of delays) {
          await new Promise((r) => setTimeout(r, ms))
          if (token.value) return true
          const stored = getToken()
          if (!stored) continue
          applyRestoredToken(stored)
          return true
        }
        return !!token.value
      })().catch(() => false)
      restorePromise = task
      void task.finally(() => {
        restorePromise = null
      })
    }
    return restorePromise ?? Promise.resolve(false)
  }

  async function afterLogin(res: AuthResult, phone: string, countryCode?: string) {
    useChatStore().reset()
    useContactStore().reset()
    useGroupStore().reset()
    useMassSendStore().resetAll()
    await logoutOpenIM().catch(() => undefined)

    saveLoginPhone(countryCode || '+86', phone)
    token.value = res.accessToken
    refreshToken.value = res.refreshToken
    profile.value = applyLoginPhone(res.user)
    setToken(res.accessToken)
    setRefreshToken(res.refreshToken)
    // App 端强杀进程可能丢失未落盘的 storage：异步落盘 + 回读校验。
    // 这里不能 await，否则会阻塞跳转；但 fire-and-forget 已能保证 App 启动后 token 已在 storage。
    void persistTokenAsync(res.accessToken).then(() => {
      if (getToken() !== res.accessToken) setToken(res.accessToken)
    })
    void persistRefreshTokenAsync(res.refreshToken).then(() => {
      if (getRefreshToken() !== res.refreshToken) setRefreshToken(res.refreshToken)
    })
    // IM 登录失败不应挡住业务登录，进聊天页时还会再试一次
    startIMSession()
    const settings = useChatSettingsStore()
    if (settings.notificationPermissionAsked && settings.message) {
      void syncPushRegistration()
    }
  }

  async function loginPassword(phone: string, password: string, countryCode?: string) {
    const res = await loginByPassword(phone, password, countryCode)
    await afterLogin(res, phone, countryCode)
  }

  async function loginSms(phone: string, code: string, countryCode?: string) {
    const res = await loginBySms(phone, code, countryCode)
    await afterLogin(res, phone, countryCode)
  }

  async function register(
    phone: string,
    code: string,
    password: string,
    countryCode?: string,
  ) {
    const res = await registerBySms(phone, code, password, countryCode)
    await afterLogin(res, phone, countryCode)
  }

  async function loadProfile() {
    if (!token.value) return
    profile.value = applyLoginPhone(await fetchProfile())
  }

  async function saveProfile(input: UpdateProfileInput) {
    profile.value = applyLoginPhone(await updateProfile(input))
  }

  /**
   * 设置聊天号。规则与「只能改一次」都由服务端把关 —— 这里不预判，
   * 直接等后端返回，把它的提示语原样报给用户。
   */
  async function savePublicId(publicId: string) {
    profile.value = applyLoginPhone(await updateMyPublicId(publicId))
  }

  async function tryRefreshToken() {
    const res = await refreshAuthToken()
    token.value = res.accessToken
    refreshToken.value = res.refreshToken
    setToken(res.accessToken)
    setRefreshToken(res.refreshToken)
    void persistTokenAsync(res.accessToken).then(() => {
      if (getToken() !== res.accessToken) setToken(res.accessToken)
    })
    void persistRefreshTokenAsync(res.refreshToken).then(() => {
      if (getRefreshToken() !== res.refreshToken) setRefreshToken(res.refreshToken)
    })
  }

  /** 401 时清内存会话，不跳转（跳转由 request 层统一处理） */
  function invalidateSession() {
    token.value = ''
    refreshToken.value = ''
    profile.value = null
    clearToken()
    clearFriendRequestBadge()
    useContactStore().reset()
  }

  async function logout() {
    await unregisterPushRegistration().catch(() => undefined)
    try {
      if (refreshToken.value) {
        await logoutCurrentDevice()
      }
    } catch {
      // 本地清理优先，忽略服务端撤销失败
    }
    token.value = ''
    refreshToken.value = ''
    profile.value = null
    clearToken()
    clearFriendRequestBadge()
    clearSessionStorage()
    useChatStore().reset()
    useContactStore().reset()
    useGroupStore().reset()
    useMassSendStore().resetAll()
    await logoutOpenIM().catch(() => undefined)
    uni.reLaunch({ url: '/pages/auth/sign-in' })
  }

  /** 登录 SDK 后立刻挂上收消息监听，不能等到用户点开会话列表才订阅 */
  function startIMSession() {
    const run = () => {
      initOpenIM()
        .then(() => useChatStore().loadConversations())
        .catch(() => undefined)
    }
    // H5 空闲时预初始化 OpenIM WASM，避免阻塞首屏渲染
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => run(), { timeout: 2000 })
    } else {
      setTimeout(run, 0)
    }
    scheduleFriendRequestSync()
  }

  /** App 冷启动时 token / 网络栈可能略晚就绪，多次拉取避免角标一直为 0 */
  function scheduleFriendRequestSync() {
    const run = () => {
      if (!getToken()) return
      void useContactStore().loadFriendRequests().catch(() => undefined)
    }
    run()
    try {
      if (uni.getSystemInfoSync().uniPlatform === 'app') {
        setTimeout(run, 400)
        setTimeout(run, 1500)
      }
    } catch {
      /* ignore */
    }
  }

  function bootstrap() {
    if (token.value.startsWith('mock_token_')) {
      token.value = ''
      refreshToken.value = ''
      profile.value = null
      clearLoginPhone()
      clearToken()
      return
    }
    // App 端 uni.getStorageSync 在 onLaunch 第一次读可能返回空（runtime 初始化竞态），
    // 二次读 storage 兜底，确保 storage 真有 token 时不漏掉。
    if (!token.value) {
      const stored = getToken()
      if (stored) token.value = stored
      const storedRefresh = getRefreshToken()
      if (storedRefresh) refreshToken.value = storedRefresh
    }
    if (token.value) {
      startIMSession()
      loadProfile().catch(() => undefined)
      const settings = useChatSettingsStore()
      if (settings.notificationPermissionAsked && settings.message) {
        void syncPushRegistration()
      }
    }
    perfColdStartDone()
  }

  return {
    token,
    refreshToken,
    profile,
    isLoggedIn,
    loginPassword,
    loginSms,
    register,
    loadProfile,
    saveProfile,
    savePublicId,
    tryRefreshToken,
    invalidateSession,
    logout,
    bootstrap,
    restoreSessionIfNeeded,
  }
})
