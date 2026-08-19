import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { GroupInfo, GroupMember, GroupSettingsInput } from '@/types'
import {
  createGroup,
  dismissGroup,
  fetchGroupDetail,
  fetchGroupMembers,
  joinGroup,
  leaveGroup,
  updateGroupMyNickname,
  updateGroupSettings,
  updateMemberRole,
} from '@/api/group'

export const useGroupStore = defineStore('group', () => {
  const currentGroup = ref<GroupInfo | null>(null)
  const members = ref<GroupMember[]>([])

  async function loadDetail(groupId: string) {
    currentGroup.value = await fetchGroupDetail(groupId)
    members.value = await fetchGroupMembers(groupId)
    return currentGroup.value
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
    members.value = await fetchGroupMembers(groupId)
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
