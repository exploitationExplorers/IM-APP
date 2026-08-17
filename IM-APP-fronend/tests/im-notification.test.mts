import assert from 'node:assert/strict'
import test from 'node:test'

import {
  collapseRepeatedGroupNameNotices,
  imNotificationEventKey,
} from '../src/utils/im-notification.ts'

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
