import { reconnectOpenIM } from '@/utils/openim'

export async function reselectLine(): Promise<void> {
  await reconnectOpenIM()
}
