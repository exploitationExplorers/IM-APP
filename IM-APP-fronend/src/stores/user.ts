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
import { updateProfile } from '@/api/user'
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
import { syncPushRegistration, unregisterPushRegistration } from '@/utils/push-register'
import { useChatStore } from '@/stores/chat'
import { useChatSettingsStore } from '@/stores/chatSettings'
import { useContactStore } from '@/stores/contact'
import { useGroupStore } from '@/stores/group'
import { useMassSendStore } from '@/stores/massSend'

export const useUserStore = defineStore('user', () => {
  const token = ref(getToken())
  const refreshToken = ref(getRefreshToken())
  const profile = ref<UserInfo | null>(null)

  const isLoggedIn = computed(() => !!token.value)

  function afterLogin(res: AuthResult, phone: string, countryCode?: string) {
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
    afterLogin(res, phone, countryCode)
  }

  async function loginSms(phone: string, code: string, countryCode?: string) {
    const res = await loginBySms(phone, code, countryCode)
    afterLogin(res, phone, countryCode)
  }

  async function register(
    phone: string,
    code: string,
    password: string,
    countryCode?: string,
  ) {
    const res = await registerBySms(phone, code, password, countryCode)
    afterLogin(res, phone, countryCode)
  }

  async function loadProfile() {
    if (!token.value) return
    profile.value = applyLoginPhone(await fetchProfile())
  }

  async function saveProfile(input: UpdateProfileInput) {
    profile.value = applyLoginPhone(await updateProfile(input))
  }

  async function tryRefreshToken() {
    const res = await refreshAuthToken()
    token.value = res.accessToken
    refreshToken.value = res.refreshToken
    setToken(res.accessToken)
    setRefreshToken(res.refreshToken)
    // 异步落盘 + 回读校验，避免 App 杀进程后 token 丢失
    void persistTokenAsync(res.accessToken).then(() => {
      if (getToken() !== res.accessToken) setToken(res.accessToken)
    })
    void persistRefreshTokenAsync(res.refreshToken).then(() => {
      if (getRefreshToken() !== res.refreshToken) setRefreshToken(res.refreshToken)
    })
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
    clearLoginPhone()
    clearToken()
    useChatStore().reset()
    useContactStore().reset()
    useGroupStore().reset()
    useMassSendStore().resetAll()
    await logoutOpenIM().catch(() => undefined)
    uni.reLaunch({ url: '/pages/auth/sign-in' })
  }

  /** 登录 SDK 后立刻挂上收消息监听，不能等到用户点开会话列表才订阅 */
  function startIMSession() {
    initOpenIM()
      .then(() => useChatStore().loadConversations())
      .catch(() => undefined)
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
    tryRefreshToken,
    logout,
    bootstrap,
  }
})
