import http from "@/api";
import type { AdminPage } from "@/api/interface";

export namespace AdminGroups {
  export interface GroupMember {
    userId: string;
    nickname?: string;
    role?: "member" | "owner";
    joinedAt?: string;
    mutedUntil?: string | null;
  }

  export interface ReqMemberAddFriendBody {
    enabled: boolean;
    reason: string;
  }

  export interface ReqRecallMessageBody {
    idempotencyKey?: string;
    reason: string;
    ticketNo?: string;
  }

  export interface ReqUpdateMemberLimitBody {
    groupId: string;
    maxMembers: number;
    reason: string;
  }
}

const GROUPS_BASE = "/admin/v1/groups";

export const putGroupMemberAddFriendApi = (id: string, body: AdminGroups.ReqMemberAddFriendBody) => {
  return http.put<{ ok: boolean }>(`${GROUPS_BASE}/${id}/member-add-friend`, body, { loading: false });
};

export const getGroupMembersApi = (id: string, params: { page?: number; size?: number; keyword?: string } = {}) => {
  return http.get<AdminPage<AdminGroups.GroupMember>>(`${GROUPS_BASE}/${id}/members`, params, { loading: false });
};

export const postGroupMemberLimitApi = (body: AdminGroups.ReqUpdateMemberLimitBody) => {
  return http.post<{ ok: boolean }>("/admin/v1/group-member-limits/update", body, { loading: false });
};

export const postGroupRecallMessageApi = (id: string, messageId: string, body: AdminGroups.ReqRecallMessageBody) => {
  return http.post<{ ok: boolean }>(`${GROUPS_BASE}/${id}/messages/${messageId}/recall`, body, { loading: false });
};

