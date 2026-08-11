type MockEventHandler = (data: unknown) => void

const listeners = new Map<string, Set<MockEventHandler>>()

export const mockWs = {
  on(event: string, handler: MockEventHandler) {
    if (!listeners.has(event)) listeners.set(event, new Set())
    listeners.get(event)!.add(handler)
  },

  off(event: string, handler: MockEventHandler) {
    listeners.get(event)?.delete(handler)
  },

  emit(event: string, data: unknown) {
    listeners.get(event)?.forEach((h) => h(data))
  },

  clear() {
    listeners.clear()
  },
}
