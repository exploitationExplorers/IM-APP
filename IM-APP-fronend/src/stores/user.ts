import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { UserInfo } from '@/types'
import { loginByPassword, loginBySms, registerBySms, fetchProfile } from '@/api/auth'
import { updateProfile } from '@/api/user'
import { clearToken, getToken, setToken } from '@/utils/request'
import { wsClient } from '@/utils/websocket'
import { APP_CONFIG } from '@/config'
import { mutateMockState } from '@/mock/store'

export const useUserStore = defineStore('user', () => {
  const token = ref(getToken())
  const profile = ref<UserInfo | null>(null)

  const isLoggedIn = computed(() => !!token.value)

  function afterLogin(res: { token: string; user: UserInfo }) {
    token.value = res.token
    profile.value = res.user
    setToken(res.token)
    if (APP_CONFIG.useMock) {
      mutateMockState((s) => {
        s.currentUserId = res.user.id
      })
    } else {
      wsClient.connect()
    }
  }

  async function loginPassword(phone: string, password: string) {
    const res = await loginByPassword(phone, password)
    afterLogin(res)
  }

  async function loginSms(phone: string, code: string) {
    const res = await loginBySms(phone, code)
    afterLogin(res)
  }

  async function register(phone: string, code: string, countryCode?: string) {
    const res = await registerBySms(phone, code, countryCode)
    afterLogin(res)
  }

  async function loadProfile() {
    if (!token.value) return
    profile.value = await fetchProfile()
  }

  async function saveProfile(input: { nickname?: string; avatar?: string; bio?: string }) {
    profile.value = await updateProfile(input)
  }

  function logout() {
    token.value = ''
    profile.value = null
    clearToken()
    wsClient.disconnect()
    uni.reLaunch({ url: '/pages/auth/sign-in' })
  }

  function bootstrap() {
    if (!APP_CONFIG.useMock && token.value.startsWith('mock_token_')) {
      token.value = ''
      profile.value = null
      clearToken()
      return
    }
    if (token.value) {
      if (APP_CONFIG.useMock) {
        const phone = token.value.replace('mock_token_', '')
        mutateMockState((s) => {
          const user = s.users.find((u) => u.phone === phone)
          if (user) s.currentUserId = user.id
        })
        loadProfile().catch(() => undefined)
      } else {
        wsClient.connect()
        loadProfile().catch(() => undefined)
      }
    }
  }

  return {
    token,
    profile,
    isLoggedIn,
    loginPassword,
    loginSms,
    register,
    loadProfile,
    saveProfile,
    logout,
    bootstrap,
  }
})
