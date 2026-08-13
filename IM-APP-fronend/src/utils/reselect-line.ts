import { wsClient } from '@/utils/websocket'

export async function reselectLine(): Promise<void> {
  wsClient.disconnect()
  await new Promise<void>((resolve) => setTimeout(resolve, 400))
  wsClient.connect()
}
