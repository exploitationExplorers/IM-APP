import type { MessageItem } from 'openim-uniapp-polyfill'
import type { ChatMessage } from '@/types'

/** OpenIM 通知类消息从 1000 起，普通聊天气泡在 100–199 */
export function isIMNotification(contentType: number): boolean {
  return contentType >= 1000
}

/** 与 OpenIM MessageType 群通知枚举对齐 */
const GroupNotice = {
  Created: 1501,
  InfoSet: 1502,
  MemberQuit: 1504,
  OwnerTransferred: 1507,
  MemberKicked: 1508,
  MemberInvited: 1509,
  MemberEnter: 1510,
  Dismissed: 1511,
  MemberMuted: 1512,
  MemberCancelMuted: 1513,
  GroupMuted: 1514,
  GroupCancelMuted: 1515,
  MemberSetAdmin: 1517,
  MemberSetOrdinary: 1518,
  Announcement: 1519,
  NameSet: 1520,
} as const

/** 好友关系通知；OpenIM 导入好友时通常下发 1204，SDK 接受申请时可能下发 1201。 */
const FriendNotice = {
  ApplicationApproved: 1201,
  Added: 1204,
} as const

export const FRIEND_CONNECTED_TEXT = '你们已成为好友，现在可以开始聊天了'

interface NoticeUser {
  userID?: string
  nickname?: string
}

interface NoticeDetail {
  opUser?: NoticeUser
  quitUser?: NoticeUser
  entrantUser?: NoticeUser
  mutedUser?: NoticeUser
  group?: { groupID?: string; groupName?: string }
  kickedUserList?: NoticeUser[]
  invitedUserList?: NoticeUser[]
  memberList?: NoticeUser[]
  groupMemberList?: NoticeUser[]
}

function parseDetail(item: MessageItem): NoticeDetail {
  const extra = item as MessageItem & { notificationElem?: { detail?: string } }
  const raw = extra.notificationElem?.detail || item.content || ''
  if (!raw || raw[0] !== '{') return {}
  try {
    return JSON.parse(raw) as NoticeDetail
  } catch {
    return {}
  }
}

function isOpenIMAdmin(user?: NoticeUser): boolean {
  const id = user?.userID?.trim() || ''
  const nickname = user?.nickname?.trim() || ''
  return id === 'imAdmin' || nickname === 'imAdmin'
}

function nameOf(user?: NoticeUser, fallback = ''): string {
  if (isOpenIMAdmin(user)) return fallback || '群主'
  const nickname = user?.nickname?.trim()
  if (nickname) return nickname
  return fallback
}

/** OpenIM 管理账号会出现在系统通知里，展示时换成群主昵称。 */
export function replaceOpenIMAdminLabel(text: string, ownerName = '群主'): string {
  if (!text.includes('imAdmin')) return text
  const alias = ownerName.trim() || '群主'
  return text.replace(/imAdmin/g, alias)
}

function namesOf(list?: NoticeUser[]): string {
  if (!list?.length) return ''
  return list.map((u) => nameOf(u, '成员')).join('、')
}

/**
 * OpenIM 的 set_group_info_ex 重试可能生成多条不同消息 ID、但语义完全相同的
 * 群改名通知。签名包含群、操作者和目标群名，因此真正改成不同名称时不会误合并。
 */
export function imNotificationEventKey(item: MessageItem): string {
  if (isFriendConnectedNotice(item.contentType)) {
    const users = [item.sendID || '', item.recvID || ''].filter(Boolean).sort()
    return `friend-connected:${users.join(':')}`
  }
  if (isGroupMembershipNotice(item.contentType)) {
    return `group-member:${item.groupID || ''}:${item.clientMsgID}`
  }
  if (isGroupMuteNotice(item.contentType)) {
    return `group-mute:${item.groupID || ''}:${item.clientMsgID}`
  }
  if (isGroupAnnouncementNotice(item.contentType)) {
    return `group-announce:${item.groupID || ''}`
  }
  if (item.contentType !== GroupNotice.NameSet) return ''
  const detail = parseDetail(item)
  const groupID = detail.group?.groupID || item.groupID || ''
  const operatorID = detail.opUser?.userID || item.sendID || ''
  const groupName = detail.group?.groupName?.trim() || ''
  return `group-name:${groupID}:${operatorID}:${groupName}`
}

export function isFriendConnectedNotice(contentType: number): boolean {
  return (
    contentType === FriendNotice.ApplicationApproved ||
    contentType === FriendNotice.Added
  )
}

export function isGroupMembershipNotice(contentType: number): boolean {
  return (
    contentType === GroupNotice.MemberQuit ||
    contentType === GroupNotice.MemberKicked ||
    contentType === GroupNotice.MemberInvited ||
    contentType === GroupNotice.MemberEnter
  )
}

export function isGroupAnnouncementNotice(contentType: number): boolean {
  return contentType === GroupNotice.Announcement
}

/**
 * 把 OpenIM 通知类 contentType 映射成简短字符串，用于 ChatMessage.notificationKind 字段，
 * 方便 chat-room 等页面针对特定通知触发副作用（如 Dismissed → 自动返回上一页）。
 */
export function notificationKindOf(contentType: number): string {
  switch (contentType) {
    case GroupNotice.Dismissed:
      return 'dissolved'
    case GroupNotice.GroupMuted:
      return 'group-muted'
    case GroupNotice.GroupCancelMuted:
      return 'group-cancel-muted'
    default:
      return ''
  }
}

/** 禁言/解禁通知（单成员或全员）：房间页据此即时刷新成员禁言状态与输入区 */
export function isGroupMuteNotice(contentType: number): boolean {
  return (
    contentType === GroupNotice.MemberMuted ||
    contentType === GroupNotice.MemberCancelMuted ||
    contentType === GroupNotice.GroupMuted ||
    contentType === GroupNotice.GroupCancelMuted
  )
}

/**
 * 只折叠连续、签名相同的群改名通知。普通聊天消息会切断折叠；A→B→A 这类
 * 真实改名序列的签名也不同，不会被吞掉。
 */
export function collapseRepeatedGroupNameNotices(messages: ChatMessage[]): ChatMessage[] {
  let previousKey = ''
  return messages.filter((message) => {
    const key =
      message.systemEventKey?.startsWith('group-name:') ||
      message.systemEventKey?.startsWith('friend-connected:')
      ? message.systemEventKey
      : ''
    if (!key) {
      previousKey = ''
      return true
    }
    if (key === previousKey) return false
    previousKey = key
    return true
  })
}

/**
 * 把 OpenIM 群通知转成参考站样式的居中提示。
 * 全体禁言示例：`chuxin2: [全体禁言]`
 * 解析不出可读文案时返回空，调用方应隐藏且不响铃。
 */
export function formatIMNotification(item: MessageItem): string {
  if (!isIMNotification(item.contentType)) return ''
  if (isFriendConnectedNotice(item.contentType)) return FRIEND_CONNECTED_TEXT
  const detail = parseDetail(item)
  const op = nameOf(detail.opUser, item.senderNickname || '')
  switch (item.contentType as number) {
    case GroupNotice.GroupMuted:
      return op ? `${op}: [全体禁言]` : '[全体禁言]'
    case GroupNotice.GroupCancelMuted:
      return op ? `${op}: [取消全体禁言]` : '[取消全体禁言]'
    case GroupNotice.MemberMuted: {
      const target = nameOf(detail.mutedUser, '成员')
      return op ? `${op} 禁言了 ${target}` : `${target} 被禁言`
    }
    case GroupNotice.MemberCancelMuted: {
      const target = nameOf(detail.mutedUser, '成员')
      return op ? `${op} 取消了 ${target} 的禁言` : `${target} 被取消禁言`
    }
    case GroupNotice.MemberEnter: {
      const who = nameOf(detail.entrantUser, namesOf(detail.memberList) || '成员')
      return `${who} 加入了群聊`
    }
    case GroupNotice.MemberQuit: {
      const who = nameOf(detail.quitUser, '成员')
      return `${who} 退出了群聊`
    }
    case GroupNotice.MemberKicked: {
      const targets = namesOf(detail.kickedUserList) || '成员'
      return op ? `${op}把${targets}移除群聊` : `${targets}被移除群聊`
    }
    case GroupNotice.MemberInvited: {
      const targets = namesOf(detail.invitedUserList) || '成员'
      if (isOpenIMAdmin(detail.opUser)) {
        return `${targets} 加入了群聊`
      }
      return op ? `${op} 邀请 ${targets} 加入群聊` : `${targets} 加入了群聊`
    }
    case GroupNotice.MemberSetAdmin: {
      const targets = namesOf(detail.groupMemberList || detail.memberList) || '成员'
      return op ? `${op} 将 ${targets} 设为管理员` : `${targets} 成为管理员`
    }
    case GroupNotice.MemberSetOrdinary: {
      const targets = namesOf(detail.groupMemberList || detail.memberList) || '成员'
      return op ? `${op} 将 ${targets} 取消管理员` : `${targets} 被取消管理员`
    }
    case GroupNotice.NameSet:
      return op ? `${op} 修改了群名称` : '群名称已修改'
    case GroupNotice.Announcement:
      return op ? `${op} 修改了群公告` : '群公告已更新'
    case GroupNotice.Dismissed:
      return op ? `${op} 解散了群聊` : '群聊已解散'
    case GroupNotice.OwnerTransferred: {
      const targets = namesOf(detail.groupMemberList || detail.memberList)
      return op ? `${op} 将群主转让给 ${targets || '新群主'}` : '群主已转让'
    }
    case GroupNotice.Created:
      return '新群创建成功，一起来聊天吧'
    default:
      // 改「禁止互加好友」等资料同步通知，参考站聊天里不展示
      return ''
  }
}

/** 会话列表预览是否表明群已解散（PC 宽屏进房前拦截用） */
export function isDissolvedGroupConversationPreview(lastMessage?: string): boolean {
  const text = (lastMessage || '').trim()
  if (!text) return false
  return text.includes('解散了群聊') || text.includes('群聊已解散')
}

/** 业务 API / 进房校验：群已解散、已退出或无权访问 */
export function isGroupUnavailableError(message?: string): boolean {
  const text = (message || '').trim()
  if (!text) return false
  return (
    text.includes('群不存在') ||
    text.includes('无权访问') ||
    text.includes('你已退出该群聊') ||
    text.includes('群聊已解散') ||
    text.includes('GROUP_UNAVAILABLE')
  )
}

/** 群不可用时的统一提示（PC 对齐参考站文案） */
export function notifyGroupUnavailable(desktop = true) {
  uni.showToast({
    title: desktop ? '这个聊天已不存在' : '该群已解散',
    icon: 'none',
    duration: 2000,
  })
}
