import { assembleChatMessageActions } from './chatMessageActions/assemble'
import type { ChatMessageActionsOpts, MemberMeta } from './chatMessageActions/types'

export type { MemberMeta, ChatMessageActionsOpts }

/** 聊天气泡长按菜单 / 多选 / 成员管控。实现见 chatMessageActions/ */
export function useChatMessageActions(opts: ChatMessageActionsOpts) {
  return assembleChatMessageActions(opts)
}
