import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { AuthResult, UserInfo } from '@/types'
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
import { wsClient } from '@/utils/websocket'

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
    wsClient.connect()
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

  async function saveProfile(input: { nickname?: string; avatar?: string; bio?: string }) {
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
    wsClient.disconnect()
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
      wsClient.connect()
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
