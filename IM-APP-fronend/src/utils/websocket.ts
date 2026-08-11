import { APP_CONFIG } from '@/config'
import { getToken } from '@/utils/request'

type MessageHandler = (payload: unknown) => void

class WebsocketClient {
  private socketTask: UniApp.SocketTask | null = null
  private handlers = new Map<string, Set<MessageHandler>>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private manuallyClosed = false

  connect() {
    if (APP_CONFIG.useMock) return
    const token = getToken()
    if (!token) return

    this.manuallyClosed = false
    this.socketTask = uni.connectSocket({
      url: `${APP_CONFIG.wsBaseUrl}?token=${encodeURIComponent(token)}`,
      complete: () => undefined,
    })

    this.socketTask.onOpen(() => {
      this.startHeartbeat()
    })

    this.socketTask.onMessage((res) => {
      try {
        const msg = JSON.parse(String(res.data)) as { event: string; data: unknown }
        const set = this.handlers.get(msg.event)
        set?.forEach((fn) => fn(msg.data))
        const all = this.handlers.get('*')
        all?.forEach((fn) => fn(msg))
      } catch {
        // ignore malformed
      }
    })

    this.socketTask.onClose(() => {
      this.stopHeartbeat()
      if (!this.manuallyClosed) this.scheduleReconnect()
    })

    this.socketTask.onError(() => {
      this.stopHeartbeat()
      if (!this.manuallyClosed) this.scheduleReconnect()
    })
  }

  disconnect() {
    this.manuallyClosed = true
    this.stopHeartbeat()
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.socketTask?.close({})
    this.socketTask = null
  }

  on(event: string, handler: MessageHandler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set())
    this.handlers.get(event)!.add(handler)
    return () => this.handlers.get(event)?.delete(handler)
  }

  send(event: string, data: unknown) {
    if (!this.socketTask) return
    this.socketTask.send({
      data: JSON.stringify({ event, data }),
    })
  }

  private startHeartbeat() {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      this.send('ping', { t: Date.now() })
    }, 25000)
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(() => this.connect(), 3000)
  }
}

export const wsClient = new WebsocketClient()
