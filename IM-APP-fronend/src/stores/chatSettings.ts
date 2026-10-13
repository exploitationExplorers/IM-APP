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

function readStoredSettings(): ChatSettingsState | null {
  try {
    const raw = uni.getStorageSync(STORAGE_KEY)
    // App 端 getStorageSync 有时直接吐对象（已反序列化），不能只认 string
    if (typeof raw === 'string') return safeParse<ChatSettingsState>(raw)
    if (raw && typeof raw === 'object') return raw as ChatSettingsState
  } catch {
    /* storage 偶发不可用 */
  }
  return null
}

function applyParsed(
  parsed: ChatSettingsState,
  target: {
    enterToSend: { value: boolean }
    noDisturb: { value: boolean }
    message: { value: boolean }
    voice: { value: boolean }
    sound: { value: boolean }
    vibration: { value: boolean }
    notificationPermissionAsked: { value: boolean }
  },
) {
  if (typeof parsed.enterToSend === 'boolean') target.enterToSend.value = parsed.enterToSend
  if (typeof parsed.noDisturb === 'boolean') target.noDisturb.value = parsed.noDisturb
  if (typeof parsed.message === 'boolean') target.message.value = parsed.message
  if (typeof parsed.voice === 'boolean') target.voice.value = parsed.voice
  if (typeof parsed.sound === 'boolean') target.sound.value = parsed.sound
  if (typeof parsed.vibration === 'boolean') target.vibration.value = parsed.vibration
  if (typeof parsed.notificationPermissionAsked === 'boolean') {
    target.notificationPermissionAsked.value = parsed.notificationPermissionAsked
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

  function hydrate(_force = false) {
    const parsed = readStoredSettings()
    if (!parsed) {
      try {
        const backup = uni.getStorageSync(`${STORAGE_KEY}_json`)
        const fromBackup =
          typeof backup === 'string' ? safeParse<ChatSettingsState>(backup) : null
        if (fromBackup) {
          applyParsed(fromBackup, {
            enterToSend,
            noDisturb,
            message,
            voice,
            sound,
            vibration,
            notificationPermissionAsked,
          })
        }
      } catch {
        /* ignore */
      }
      return
    }
    applyParsed(parsed, {
      enterToSend,
      noDisturb,
      message,
      voice,
      sound,
      vibration,
      notificationPermissionAsked,
    })
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
    try {
      // 存对象：App/H5 都稳；再补一份 JSON 字符串给只认 string 的环境
      uni.setStorageSync(STORAGE_KEY, payload)
      try {
        uni.setStorageSync(`${STORAGE_KEY}_json`, JSON.stringify(payload))
      } catch {
        /* 备份失败不影响主存储 */
      }
    } catch (e) {
      console.warn('[chatSettings] persist failed', e)
    }
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

  // 启动：主 key → json 备份
  const primary = readStoredSettings()
  if (primary) {
    applyParsed(primary, {
      enterToSend,
      noDisturb,
      message,
      voice,
      sound,
      vibration,
      notificationPermissionAsked,
    })
  } else {
    try {
      const backup = uni.getStorageSync(`${STORAGE_KEY}_json`)
      const parsed = typeof backup === 'string' ? safeParse<ChatSettingsState>(backup) : null
      if (parsed) {
        applyParsed(parsed, {
          enterToSend,
          noDisturb,
          message,
          voice,
          sound,
          vibration,
          notificationPermissionAsked,
        })
      }
    } catch {
      /* ignore */
    }
  }

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
