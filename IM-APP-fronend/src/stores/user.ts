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
  setRefreshToken,
  setToken,
} from '@/utils/request'
import { initOpenIM, logoutOpenIM } from '@/utils/openim'
import { useChatStore } from '@/stores/chat'

export const useUserStore = defineStore('user', () => {
  const token = ref(getToken())
  const refreshToken = ref(getRefreshToken())
  const profile = ref<UserInfo | null>(null)

  const isLoggedIn = computed(() => !!token.value)

  function afterLogin(res: AuthResult) {
    token.value = res.accessToken
    refreshToken.value = res.refreshToken
    profile.value = res.user
    setToken(res.accessToken)
    setRefreshToken(res.refreshToken)
    // IM 登录失败不应挡住业务登录，进聊天页时还会再试一次
    initOpenIM().catch(() => undefined)
  }

  async function loginPassword(phone: string, password: string, countryCode?: string) {
    const res = await loginByPassword(phone, password, countryCode)
    afterLogin(res)
  }

  async function loginSms(phone: string, code: string, countryCode?: string) {
    const res = await loginBySms(phone, code, countryCode)
    afterLogin(res)
  }

  async function register(
    phone: string,
    code: string,
    password: string,
    countryCode?: string,
  ) {
    const res = await registerBySms(phone, code, password, countryCode)
    afterLogin(res)
  }

  async function loadProfile() {
    if (!token.value) return
    profile.value = await fetchProfile()
  }

  async function saveProfile(input: UpdateProfileInput) {
    profile.value = await updateProfile(input)
  }

  async function tryRefreshToken() {
    const res = await refreshAuthToken()
    token.value = res.accessToken
    refreshToken.value = res.refreshToken
    setToken(res.accessToken)
    setRefreshToken(res.refreshToken)
  }

  async function logout() {
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
    useChatStore().reset()
    await logoutOpenIM().catch(() => undefined)
    uni.reLaunch({ url: '/pages/auth/sign-in' })
  }

  function bootstrap() {
    if (token.value.startsWith('mock_token_')) {
      token.value = ''
      refreshToken.value = ''
      profile.value = null
      clearToken()
      return
    }
    if (token.value) {
      initOpenIM().catch(() => undefined)
      loadProfile().catch(() => undefined)
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
