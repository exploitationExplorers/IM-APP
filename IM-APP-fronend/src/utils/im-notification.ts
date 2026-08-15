import type { MessageItem } from 'openim-uniapp-polyfill'

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

interface NoticeUser {
  userID?: string
  nickname?: string
}

interface NoticeDetail {
  opUser?: NoticeUser
  quitUser?: NoticeUser
  entrantUser?: NoticeUser
  mutedUser?: NoticeUser
  group?: { groupName?: string }
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

function nameOf(user?: NoticeUser, fallback = ''): string {
  const nickname = user?.nickname?.trim()
  if (nickname) return nickname
  return fallback
}

function namesOf(list?: NoticeUser[]): string {
  if (!list?.length) return ''
  return list.map((u) => nameOf(u, '成员')).join('、')
}

/**
 * 把 OpenIM 群通知转成参考站样式的居中提示。
 * 全体禁言示例：`chuxin2: [全体禁言]`
 * 解析不出可读文案时返回空，调用方应隐藏且不响铃。
 */
export function formatIMNotification(item: MessageItem): string {
  if (!isIMNotification(item.contentType)) return ''
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
      return op ? `${op} 将 ${targets} 移出群聊` : `${targets} 被移出群聊`
    }
    case GroupNotice.MemberInvited: {
      const targets = namesOf(detail.invitedUserList) || '成员'
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
