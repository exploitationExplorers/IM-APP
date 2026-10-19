import type { MessageMenuItem } from '@/components/ImMessageActionMenu.vue'
import type { ChatMessage } from '@/types'

export type BuildMenuItemsInput = {
  message: ChatMessage
  mine: boolean
  isGroup: boolean
  canManage: boolean
  canRevoke: boolean
  senderInGroup: boolean
  muted: boolean
  pinnedClientMsgId?: string
}

function pushMediaItems(items: MessageMenuItem[], message: ChatMessage) {
  if (message.type === 'text') {
    items.push({ key: 'copy', label: '复制' }, { key: 'selectText', label: '选择文字' })
  }
  if (message.type === 'image') {
    items.push({ key: 'save', label: '保存图片' }, { key: 'sticker', label: '加入表情包' })
  }
  if (message.type === 'video') items.push({ key: 'save', label: '保存视频' })
}

function pushManageWideItems(
  items: MessageMenuItem[],
  input: Pick<BuildMenuItemsInput, 'mine' | 'canManage' | 'senderInGroup'>,
) {
  if (input.mine || !input.canManage) return
  if (input.senderInGroup) {
    items.push({ key: 'kickAndDelete', label: '移除并删除其消息', wide: true })
    items.push({ key: 'kick', label: '仅移除该成员', wide: true })
    return
  }
  items.push({ key: 'purgeMessages', label: '删除其全部消息', wide: true })
}

/** 气泡长按菜单项（顺序对齐参考站） */
export function buildMessageMenuItems(input: BuildMenuItemsInput): MessageMenuItem[] {
  const { message, mine, isGroup, canManage, canRevoke: revokeOk, muted } = input
  const items: MessageMenuItem[] = []

  if (mine && message.status === 'failed') items.push({ key: 'retry', label: '重新发送' })
  if (revokeOk) items.push({ key: 'revoke', label: '撤回' })
  items.push({ key: 'forward', label: '转发' }, { key: 'quote', label: '引用' })
  pushMediaItems(items, message)
  items.push({ key: 'favorite', label: '收藏' })
  items.push({
    key: 'pin',
    label: input.pinnedClientMsgId === message.id ? '取消置顶' : '置顶',
  })
  if (!mine && isGroup) {
    items.push({ key: 'report', label: '检举' }, { key: 'at', label: '@TA' })
  }
  if (!mine && canManage) {
    items.push(muted ? { key: 'unmute', label: '解除禁言' } : { key: 'mute', label: '禁言' })
  }
  items.push({ key: 'delete', label: '删除' }, { key: 'multi', label: '多选' })
  if (items.length % 2 === 1) items.push({ key: '_spacer', label: '', spacer: true })
  pushManageWideItems(items, input)
  return items
}

const FAVORITE_TYPE_MAP: Record<string, 'text' | 'file' | 'image' | 'video' | 'voice'> = {
  file: 'file',
  image: 'image',
  video: 'video',
  voice: 'voice',
}

export function favoritePayloadOf(message: ChatMessage): {
  type: 'text' | 'file' | 'image' | 'video' | 'voice'
  content: string
} {
  if (message.type === 'card') {
    try {
      const card = JSON.parse(message.content) as { nickname?: string }
      return { type: 'text', content: `[名片] ${card.nickname || ''}`.trim() }
    } catch {
      return { type: 'text', content: '[名片]' }
    }
  }
  const type = FAVORITE_TYPE_MAP[message.type] || 'text'
  const content =
    message.type === 'image' && message.sourceUrl ? message.sourceUrl : message.content
  return { type, content }
}
