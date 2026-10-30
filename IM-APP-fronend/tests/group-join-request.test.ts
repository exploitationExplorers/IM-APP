import { describe, expect, it } from 'vitest'
import {
  parseGroupJoinRequestBusinessNotification,
  parseGroupJoinRequestPayload,
} from '@/utils/groupJoinRequest'

describe('parseGroupJoinRequestPayload', () => {
  it('解析 H5 custom message 的 camelCase 通知', () => {
    expect(
      parseGroupJoinRequestPayload({
        businessKey: 'group_join_request',
        requestId: 'request-1',
        groupId: 'qun_review',
        groupName: '审核群',
        applicantId: 'user-1',
        applicantNickname: '申请人',
        applicantAvatar: 'https://cdn.example/avatar.png',
      }),
    ).toEqual({
      requestId: 'request-1',
      groupId: 'qun_review',
      groupName: '审核群',
      applicantId: 'user-1',
      applicantNickname: '申请人',
      applicantAvatar: 'https://cdn.example/avatar.png',
    })
  })

  it('兼容 App 原生桥的 PascalCase 字段', () => {
    expect(
      parseGroupJoinRequestPayload({
        BusinessKey: 'group_join_request',
        RequestId: 'request-2',
        GroupId: 'qun_review',
        GroupName: '审核群',
        ApplicantId: 'user-2',
        ApplicantNickname: '申请人B',
        ApplicantAvatar: '',
      }),
    ).toMatchObject({
      requestId: 'request-2',
      applicantId: 'user-2',
      applicantNickname: '申请人B',
    })
  })

  it('兼容归一化后缺少 businessKey 的消息内容', () => {
    expect(
      parseGroupJoinRequestPayload({
        requestId: 'request-3',
        groupId: 'qun_review',
        groupName: '审核群',
        applicantId: 'user-3',
        applicantNickname: '申请人C',
        applicantAvatar: '',
      }),
    ).toMatchObject({
      requestId: 'request-3',
      groupId: 'qun_review',
      applicantId: 'user-3',
      applicantNickname: '申请人C',
    })
  })

  it('拒绝其他业务消息和缺少关键字段的 payload', () => {
    expect(
      parseGroupJoinRequestPayload({
        businessKey: 'group_invite',
        requestId: 'request-1',
        groupId: 'qun_review',
      }),
    ).toBeNull()
    expect(
      parseGroupJoinRequestPayload({
        businessKey: 'group_join_request',
        groupId: 'qun_review',
      }),
    ).toBeNull()
  })

  it('解析业务通知中的群会话 ID', () => {
    expect(
      parseGroupJoinRequestBusinessNotification({
        key: 'group_join_request',
        data: JSON.stringify({
          requestId: 'request-4',
          groupId: 'qun_review',
          groupConversationId: 'sg_22222222222242228222222222222222',
          groupName: '审核群',
          applicantId: 'user-4',
          applicantNickname: '申请人D',
          applicantAvatar: '',
        }),
      }),
    ).toMatchObject({
      requestId: 'request-4',
      groupConversationId: 'sg_22222222222242228222222222222222',
    })
  })

  it('拒绝缺少群会话 ID 的业务通知', () => {
    expect(
      parseGroupJoinRequestBusinessNotification({
        key: 'group_join_request',
        data: JSON.stringify({
          requestId: 'request-5',
          groupId: 'qun_review',
        }),
      }),
    ).toBeNull()
  })
})
