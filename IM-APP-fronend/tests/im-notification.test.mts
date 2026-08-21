import assert from 'node:assert/strict'
import test from 'node:test'

import {
  collapseRepeatedGroupNameNotices,
  formatIMNotification,
  imNotificationEventKey,
} from '../src/utils/im-notification.ts'
import { mergeReceivedFriendRequests } from '../src/utils/friend-request.ts'

function message(id: string, systemEventKey?: string) {
  return {
    id,
    conversationId: 'sg_group-1',
    senderId: 'imAdmin',
    type: systemEventKey ? 'system' : 'text',
    content: systemEventKey ? '管理员 修改了群名称' : 'hello',
    createdAt: '2026-08-16T00:00:00.000Z',
    systemEventKey,
  } as const
}

test('群改名通知签名区分目标名称', () => {
  const base = {
    contentType: 1520,
    groupID: 'group-1',
    sendID: 'imAdmin',
  }
  const first = imNotificationEventKey({
    ...base,
    content: JSON.stringify({
      opUser: { userID: 'imAdmin' },
      group: { groupID: 'group-1', groupName: '研发群' },
    }),
  } as never)
  const second = imNotificationEventKey({
    ...base,
    content: JSON.stringify({
      opUser: { userID: 'imAdmin' },
      group: { groupID: 'group-1', groupName: '产品群' },
    }),
  } as never)

  assert.notEqual(first, second)
})

test('只折叠连续且语义相同的群改名通知', () => {
  const repeated = 'group-name:group-1:imAdmin:研发群'
  const renamedAgain = 'group-name:group-1:imAdmin:产品群'
  const result = collapseRepeatedGroupNameNotices([
    message('1', repeated),
    message('2', repeated),
    message('3', repeated),
    message('4'),
    message('5', repeated),
    message('6', renamedAgain),
  ])

  assert.deepEqual(result.map((item) => item.id), ['1', '4', '5', '6'])
})

test('禁言/全员禁言通知生成 group-mute 事件 key', () => {
  const base = { groupID: 'group-1', sendID: 'imAdmin', clientMsgID: 'msg-1' }
  // 1512 成员禁言 / 1514 全员禁言
  assert.equal(
    imNotificationEventKey({ ...base, contentType: 1512 } as never),
    'group-mute:group-1:msg-1',
  )
  assert.equal(
    imNotificationEventKey({ ...base, contentType: 1514 } as never),
    'group-mute:group-1:msg-1',
  )
  // 1513 解除成员禁言 / 1515 取消全员禁言
  assert.equal(
    imNotificationEventKey({ ...base, contentType: 1513 } as never),
    'group-mute:group-1:msg-1',
  )
  assert.equal(
    imNotificationEventKey({ ...base, contentType: 1515 } as never),
    'group-mute:group-1:msg-1',
  )
})

test('普通聊天消息没有事件 key', () => {
  assert.equal(
    imNotificationEventKey({
      contentType: 101,
      groupID: 'group-1',
      clientMsgID: 'msg-2',
    } as never),
    '',
  )
})

test('好友添加通知在会话列表和聊天房间显示默认提示', () => {
  const approved = {
    contentType: 1201,
    clientMsgID: 'friend-approved',
    sendID: 'user-b',
    recvID: 'user-a',
  } as never
  const added = {
    contentType: 1204,
    clientMsgID: 'friend-added',
    sendID: 'user-a',
    recvID: 'user-b',
  } as never

  assert.equal(formatIMNotification(approved), '你们已成为好友，现在可以开始聊天了')
  assert.equal(formatIMNotification(added), '你们已成为好友，现在可以开始聊天了')
  assert.equal(imNotificationEventKey(approved), imNotificationEventKey(added))
})

test('同一申请人的多条待处理记录只保留最新一条', () => {
  const user = { id: 'user-a', nickname: 'A', avatar: '' }
  const result = mergeReceivedFriendRequests([
    { id: 'old', fromUser: user, message: '旧申请', status: 'pending', createdAt: '2026-08-20T00:00:00Z' },
    { id: 'new', fromUser: user, message: '新申请', status: 'pending', createdAt: '2026-08-21T00:00:00Z' },
    { id: 'done', fromUser: { ...user, id: 'user-b' }, message: '', status: 'accepted', createdAt: '2026-08-21T01:00:00Z' },
  ])

  assert.deepEqual(result.map((item) => item.id), ['new'])
})
