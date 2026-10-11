import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { GroupInfo, GroupMember, GroupSettingsInput } from '@/types'
import {
  createGroup,
  dismissGroup,
  fetchGroupDetail,
  fetchAllGroupMembers,
  joinGroup,
  leaveGroup,
  updateGroupMyNickname,
  updateGroupSettings,
  updateMemberRole,
} from '@/api/group'

export const useGroupStore = defineStore('group', () => {
  const currentGroup = ref<GroupInfo | null>(null)
  const members = ref<GroupMember[]>([])

  /** 只拉群资料：详情页首屏靠它出画面，不必等全量成员翻页 */
  async function loadGroupDetail(groupId: string) {
    currentGroup.value = await fetchGroupDetail(groupId)
    return currentGroup.value
  }

  /** 全量成员按 100/页游标串行翻页，群越大越慢，页面应尽量不阻塞在它上面 */
  async function loadMembers(groupId: string) {
    members.value = await fetchAllGroupMembers(groupId)
    return members.value
  }

  /** 群资料 + 全量成员。两者无依赖，并行拉取，别再串行等 */
  async function loadDetail(groupId: string) {
    const [detail] = await Promise.all([
      loadGroupDetail(groupId),
      loadMembers(groupId),
    ])
    return detail
  }

  async function create(name: string, memberIds: string[]) {
    const g = await createGroup(name, memberIds)
    currentGroup.value = g
    return g
  }

  async function join(groupId: string) {
    currentGroup.value = await joinGroup(groupId)
    return currentGroup.value
  }

  async function updateSettings(groupId: string, input: GroupSettingsInput) {
    const updated = await updateGroupSettings(groupId, input)
    currentGroup.value = updated
    return updated
  }

  async function setMemberRole(groupId: string, userId: string, role: 'admin' | 'member') {
    await updateMemberRole(groupId, userId, role)
    members.value = await fetchAllGroupMembers(groupId)
  }

  async function dismiss(groupId: string) {
    await dismissGroup(groupId)
    currentGroup.value = null
    members.value = []
  }

  async function updateMyNickname(groupId: string, nickname: string) {
    await updateGroupMyNickname(groupId, nickname)
    await loadDetail(groupId)
  }

  async function leave(groupId: string) {
    await leaveGroup(groupId)
    currentGroup.value = null
    members.value = []
  }

  function reset() {
    currentGroup.value = null
    members.value = []
  }

  return {
    currentGroup,
    members,
    loadDetail,
    loadGroupDetail,
    loadMembers,
    create,
    join,
    updateSettings,
    updateMyNickname,
    setMemberRole,
    leave,
    dismiss,
    reset,
  }
})
