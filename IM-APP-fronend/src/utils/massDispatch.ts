/**
 * 群发助手真实发送通道。
 *
 * 目标（联系人/群/标签）统一解析成 OpenIM 会话后逐个发送：
 * - 联系人：业务 ID → /im/peers 解析 → 单聊会话
 * - 群：业务 ID → /im/groups 解析 → 群聊会话
 * - 标签：从联系人 store 展开为成员联系人后按联系人发送
 *
 * 单个目标失败不中断整体，最终由调用方汇总展示。
 */
import { SessionType } from 'openim-uniapp-polyfill'
import { resolveIMGroup, resolveIMPeer } from '@/api/im'
import { useContactStore } from '@/stores/contact'
import type { MassContent, MassTarget } from '@/stores/massSend'
import {
  ensureIMLogin,
  getOneConversation,
  sendFileMessage,
  sendImageMessage,
  sendTextMessage,
  sendVoiceMessage,
  targetOf,
  type IMTarget,
} from '@/utils/openim'

export interface MassDispatchFailure {
  id: string
  name: string
  reason: string
}

export interface MassDispatchResult {
  /** 成功发送的目标数（标签按展开后的联系人计） */
  sent: number
  failed: MassDispatchFailure[]
}

/** 这些 denyReason 由 SDK 在发送时拦截并标失败，这里不必提前拒绝 */
const DENY_BUT_STILL_TRY = new Set(['blocked', 'group_muted', 'member_muted'])

async function targetOfContact(businessId: string): Promise<IMTarget> {
  const peer = await resolveIMPeer(businessId)
  if (!peer.canChat && !DENY_BUT_STILL_TRY.has(peer.denyReason)) {
    throw new Error(peer.denyReason || '当前无法发送')
  }
  const conv = await getOneConversation(peer.imUserId, SessionType.Single)
  return targetOf(conv)
}

async function targetOfGroup(businessId: string): Promise<IMTarget> {
  const group = await resolveIMGroup(businessId)
  if (!group.canChat && !DENY_BUT_STILL_TRY.has(group.denyReason)) {
    throw new Error(group.denyReason || '当前无法发送')
  }
  const conv = await getOneConversation(group.imGroupId, SessionType.Group)
  return targetOf(conv)
}

/** 标签目标展开为该标签下的联系人（含备注标签 tagNames 兼容） */
function contactsOfTag(tagName: string): MassTarget[] {
  const name = tagName.replace(/^t_/, '')
  const list = useContactStore().contacts
  const matched = list.filter((c) => {
    const names = new Set<string>([(c.tags || []).map((t) => t.name), c.tagNames || []].flat())
    return names.has(name)
  })
  return matched.map((c) => ({
    id: c.id,
    type: 'contact' as const,
    name: c.remark || c.nickname,
    avatar: c.avatar,
  }))
}

async function sendContentTo(target: IMTarget, content: MassContent): Promise<void> {
  switch (content.type) {
    case 'text':
      await sendTextMessage(target, content.text || '')
      return
    case 'image':
      for (const img of content.images || []) {
        await sendImageMessage(target, img)
      }
      return
    case 'audio':
      await sendVoiceMessage(target, content.audioPath || '', content.audioDuration || 0)
      return
    case 'file':
      await sendFileMessage(target, content.filePath || '', content.fileName || '')
      return
    default:
      throw new Error('暂不支持的内容类型')
  }
}

/** 标签展开为联系人；其余目标原样返回。空标签记入失败 */
function expandTargets(targets: MassTarget[], failed: MassDispatchFailure[]): MassTarget[] {
  const out: MassTarget[] = []
  for (const raw of targets) {
    if (raw.type !== 'tag') {
      out.push(raw)
      continue
    }
    const members = contactsOfTag(raw.id)
    if (!members.length) {
      failed.push({ id: raw.id, name: raw.name, reason: '该标签下暂无联系人' })
      continue
    }
    out.push(...members)
  }
  return out
}

async function sendToTarget(
  t: MassTarget,
  content: MassContent,
): Promise<void> {
  const target = t.type === 'group' ? await targetOfGroup(t.id) : await targetOfContact(t.id)
  await sendContentTo(target, content)
}

/**
 * 把一条群发内容发送给全部目标。
 * 串行发送：避免瞬间打满 SDK 上传队列；目标数多时耗时与数量线性相关。
 */
export async function dispatchMassContent(
  targets: MassTarget[],
  content: MassContent,
): Promise<MassDispatchResult> {
  await ensureIMLogin()

  const result: MassDispatchResult = { sent: 0, failed: [] }
  // 标签展开后可能重复命中同一联系人，按目标键去重
  const seen = new Set<string>()

  for (const t of expandTargets(targets, result.failed)) {
    const key = `${t.type}:${t.id}`
    if (seen.has(key)) continue
    seen.add(key)
    try {
      await sendToTarget(t, content)
      result.sent += 1
    } catch (e) {
      result.failed.push({ id: t.id, name: t.name, reason: friendlyReason(e) })
    }
  }
  return result
}

function friendlyReason(e: unknown): string {
  const raw = (e as Error)?.message || '发送失败'
  const map: Array<[RegExp, string]> = [
    [/1000?4|not found|查不到|不存在/i, '对方账号不存在或已注销'],
    [/not (a )?friend|非好友|1006?6/i, '已不是好友'],
    [/muted|禁言/i, '已在群内被禁言'],
    [/black|blocked/i, '无法发送给该用户'],
  ]
  for (const [re, text] of map) {
    if (re.test(raw)) return text
  }
  return raw.length > 24 ? '发送失败' : raw
}
