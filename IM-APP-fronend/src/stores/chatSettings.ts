import { defineStore } from 'pinia'
import { ref } from 'vue'

type ChatSettingsState = {
  enterToSend: boolean
  /** 全局消息免打扰：开启后所有会话（含私聊）都不响提示音 */
  noDisturb: boolean
  /** 应用未打开时的新消息通知开关（用于系统通知栏，与提示音解耦） */
  message: boolean
  /** 语音/视频邀请提醒 */
  voice: boolean
  /** 应用打开时是否播放提示音 */
  sound: boolean
  /** 应用打开时是否震动（仅 Android 有效） */
  vibration: boolean
  /** 是否已经弹出过参考站同款的通知授权询问（确认或取消都算问过） */
  notificationPermissionAsked: boolean
}

const STORAGE_KEY = 'im_chat_settings_v1'

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export const useChatSettingsStore = defineStore('chatSettings', () => {
  const enterToSend = ref(false)
  const noDisturb = ref(false)
  const message = ref(true)
  const voice = ref(true)
  const sound = ref(true)
  const vibration = ref(false)
  const notificationPermissionAsked = ref(false)

  let hydrated = false
  function hydrate() {
    if (hydrated) return
    hydrated = true
    const raw = uni.getStorageSync(STORAGE_KEY)
    const parsed = safeParse<ChatSettingsState>(typeof raw === 'string' ? raw : null)
    if (!parsed) return
    if (typeof parsed.enterToSend === 'boolean') enterToSend.value = parsed.enterToSend
    if (typeof parsed.noDisturb === 'boolean') noDisturb.value = parsed.noDisturb
    if (typeof parsed.message === 'boolean') message.value = parsed.message
    if (typeof parsed.voice === 'boolean') voice.value = parsed.voice
    if (typeof parsed.sound === 'boolean') sound.value = parsed.sound
    if (typeof parsed.vibration === 'boolean') vibration.value = parsed.vibration
    if (typeof parsed.notificationPermissionAsked === 'boolean') {
      notificationPermissionAsked.value = parsed.notificationPermissionAsked
    }
  }

  function persist() {
    const payload: ChatSettingsState = {
      enterToSend: enterToSend.value,
      noDisturb: noDisturb.value,
      message: message.value,
      voice: voice.value,
      sound: sound.value,
      vibration: vibration.value,
      notificationPermissionAsked: notificationPermissionAsked.value,
    }
    uni.setStorageSync(STORAGE_KEY, JSON.stringify(payload))
  }

  function setEnterToSend(v: boolean) {
    enterToSend.value = v
    persist()
  }

  function setNoDisturb(v: boolean) {
    noDisturb.value = v
    persist()
  }

  function setMessage(v: boolean) {
    message.value = v
    persist()
  }

  function setVoice(v: boolean) {
    voice.value = v
    persist()
  }

  function setSound(v: boolean) {
    sound.value = v
    persist()
  }

  function setVibration(v: boolean) {
    vibration.value = v
    persist()
  }

  function setNotificationPermissionAsked(v: boolean) {
    notificationPermissionAsked.value = v
    persist()
  }

  hydrate()

  return {
    enterToSend,
    noDisturb,
    message,
    voice,
    sound,
    vibration,
    notificationPermissionAsked,
    hydrate,
    persist,
    setEnterToSend,
    setNoDisturb,
    setMessage,
    setVoice,
    setSound,
    setVibration,
    setNotificationPermissionAsked,
  }
})
