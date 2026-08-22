import http from "@/api";
import type { AdminPage } from "@/api/interface";

export namespace AdminMessageAudit {
  export type PeerType = "c2c" | "group";
  export type FailureSource = "client" | "before_hook";

  export interface ReqMessagesParams {
    page?: number;
    size?: number;
    contentType?: number;
    senderKeyword?: string;
    peerType?: PeerType | "";
    from?: string;
    to?: string;
  }

  export interface MessageRecord {
    createdAt: string;
    sendTime: number;
    clientMsgId: string;
    senderImId: string;
    senderNickname: string;
    receiverImId: string;
    receiverNickname: string;
    groupImId: string;
    groupName: string;
    contentType: number;
    peerType: PeerType;
  }

  export interface ReqFailuresParams {
    page?: number;
    size?: number;
    contentType?: number;
    failCode?: string;
    senderKeyword?: string;
    source?: FailureSource | "";
    from?: string;
    to?: string;
  }

  export interface MessageFailure {
    id: number;
    createdAt: string;
    occurredAt: string;
    clientMsgId: string;
    senderId: string;
    senderImId: string;
    senderNickname: string;
    peerType: PeerType;
    targetId: string;
    targetImId: string;
    targetName: string;
    contentType: number;
    source: FailureSource;
    stage: string;
    failCode: string;
    failMessage: string;
    platform: string;
    appVersion: string;
  }
}

const MESSAGES_BASE = "/admin/v1/messages";

export const getAdminMessagesApi = (params?: AdminMessageAudit.ReqMessagesParams) => {
  return http.get<AdminPage<AdminMessageAudit.MessageRecord>>(MESSAGES_BASE, params, { loading: false });
};

export const getAdminMessageFailuresApi = (params?: AdminMessageAudit.ReqFailuresParams) => {
  return http.get<AdminPage<AdminMessageAudit.MessageFailure>>(`${MESSAGES_BASE}/failures`, params, { loading: false });
};
