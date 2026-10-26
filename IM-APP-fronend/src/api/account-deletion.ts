import { request } from '@/utils/request'

/**
 * 账号注销接口（iOS 上架合规：Apple 5.1.1(v) 要求 App 内可删除账号及关联数据）。
 *
 * 流程：GET /me/deletion-preview（前置检查）→ 发送短信 → DELETE /me（执行注销）。
 * 短信发送直接复用 src/api/auth.ts 的 sendSmsCode，scene 用 'delete_account'。
 */

/** 注销的前置阻碍项；存在 blockers 时不允许提交注销 */
export interface AccountDeletionBlocker {
  code: string
  message: string
  /** 建议动作：transfer（转让群主）| dismiss（解散群） */
  action: string
  groupId?: string
  groupPublicId?: string
  groupName?: string
}

/** 注销影响范围快照 */
export interface AccountDeletionSummary {
  friendCount: number
  groupCount: number
  ownedGroupCount: number
  favoriteCount: number
  fileCount: number
}

export interface AccountDeletionPreview {
  canDelete: boolean
  blockers: AccountDeletionBlocker[]
  summary: AccountDeletionSummary
  /** 二级确认要求的输入文本，必须原样提交给后端 */
  confirmPhrase: string
  verificationMethod: string
}

export interface DeleteAccountResult {
  ok: boolean
  deletedAt: string
  /** 审计记录 ID，供申诉核对 */
  recordId: string
  /** IM 侧清理结果：done|failed|skipped。failed 不代表注销失败 */
  imCleanup: string
}

export async function fetchDeletionPreview(): Promise<AccountDeletionPreview> {
  return request<AccountDeletionPreview>({
    url: '/me/deletion-preview',
    method: 'GET',
  })
}

export async function deleteAccount(input: {
  phone: string
  code: string
  countryCode?: string
  /** 必须等于 preview 返回的 confirmPhrase */
  acknowledge: string
}): Promise<DeleteAccountResult> {
  return request<DeleteAccountResult>({
    url: '/me',
    method: 'DELETE',
    data: {
      phone: input.phone,
      code: input.code,
      countryCode: input.countryCode,
      acknowledge: input.acknowledge,
    },
  })
}
