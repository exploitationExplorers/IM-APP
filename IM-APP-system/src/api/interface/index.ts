export interface Result {
  code: number;
  message?: string;
  msg?: string;
  requestId?: string;
}

export interface ResultData<T = any> extends Result {
  data: T;
}

export interface ResPage<T> {
  list: T[];
  pageNum: number;
  pageSize: number;
  total: number;
}

export interface AdminPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ReqPage {
  pageNum: number;
  pageSize: number;
}

export namespace Upload {
  export interface ResFileUrl {
    fileUrl: string;
  }
}

export namespace Auth {
  export interface ReqLoginForm {
    username: string;
    password: string;
  }

  export interface ReqRefreshForm {
    refreshToken: string;
  }

  export interface AdminInfo {
    id: string;
    username: string;
    nickname: string;
    status: string;
    roleNames: string[];
    mfaEnabled?: boolean;
    lastLoginAt?: string;
    createdAt?: string;
  }

  export interface ResLogin {
    token: string;
    refreshToken: string;
    admin: AdminInfo;
  }

  export interface ResHealth {
    status?: string;
  }

  export interface ResMeta {
    version?: string;
    commit?: string;
    buildTime?: string;
    features?: Record<string, unknown>;
  }
}

export namespace Sms {
  export interface ProviderHealthItem {
    provider?: string;
    healthy?: boolean;
    latencyMs?: number;
  }
}

export namespace Login {
  export interface ReqLoginForm {
    username: string;
    password: string;
  }
  export interface ResLogin {
    access_token: string;
  }
  export interface ResAuthButtons {
    [key: string]: string[];
  }
}

export namespace SensitiveWords {
  export interface ReqListParams {
    page?: number;
    size?: number;
    keyword?: string;
  }

  export interface WordItem {
    id: string;
    word: string;
    category: string;
    status: string;
    createdAt: string;
  }

  export interface ReqCreateWord {
    word: string;
    category?: string;
  }

  export interface ReqImportWords {
    words: string[];
    reason: string;
    category?: string;
  }

  export interface ReqUpdateWord {
    word?: string;
    category?: string;
    status?: string;
  }

  export interface ReqUpdateWordStatus {
    status: string;
  }
}

export namespace Moderation {
  export interface ReqHitsParams {
    page?: number;
    size?: number;
  }

  export interface HitItem {
    id: number;
    userId: string;
    field: string;
    content: string;
    matchedWord: string;
    category: string;
    disposition: string;
    createdAt: string;
  }

  export interface ReqProfilesParams {
    page?: number;
    size?: number;
    status?: string;
  }

  export interface ProfileItem {
    id: number;
    userId: string;
    field: string;
    oldValue: string;
    newValue: string;
    status: string;
    reason?: string;
    handledAt?: string;
  }

  export interface ReqRejectProfile {
    field: string;
    reason: string;
  }

  export interface ReqApproveProfile {
    field: string;
    reason: string;
  }

  export interface ReqRestoreProfile {
    field: string;
    reason: string;
  }

  export interface ActionResult {
    ok: boolean;
  }
}

export namespace Reports {
  export interface ReqListParams {
    page?: number;
    size?: number;
    keyword?: string;
    status?: string;
  }

  export interface ReportItem {
    id: string;
    reportNo: string;
    reporterId: string;
    targetType: string;
    targetId: string;
    reasonText: string;
    description: string;
    status: string;
    assigneeId?: string;
    conclusion?: string;
    actionTaken?: string;
    createdAt: string;
    updatedAt: string;
  }

  export interface ReportFile {
    id: string;
    fileUrl: string;
    contentType: string;
    messageId?: string;
  }

  export interface ReportNote {
    id: number;
    adminId: string;
    content: string;
    createdAt: string;
  }

  export interface ReportDetail extends ReportItem {
    files?: ReportFile[];
    notes?: ReportNote[];
  }

  export interface ReportAction {
    id: number;
    adminId: string;
    action: string;
    beforeStatus: string;
    afterStatus: string;
    detail: string;
    createdAt: string;
  }

  export interface ReqAssignReport {
    assigneeId: string;
    reason: string;
  }

  export interface ReqAddReportNote {
    content: string;
  }

  export interface ReqRejectReport {
    reason: string;
    conclusion?: string;
    disposeActions?: string[];
    idempotencyKey?: string;
    ticketNo?: string;
  }

  export interface ReqResolveReport {
    reason: string;
    conclusion?: string;
    disposeActions?: string[];
    idempotencyKey?: string;
    ticketNo?: string;
  }

  export interface ReqStartReport {
    reason: string;
    idempotencyKey?: string;
    ticketNo?: string;
  }

  export interface ReqReopenReport {
    reason: string;
    conclusion?: string;
    disposeActions?: string[];
    idempotencyKey?: string;
    ticketNo?: string;
  }

  export interface ActionResult {
    ok: boolean;
  }
}

export namespace Groups {
  export interface ReqListParams {
    page?: number;
    size?: number;
    keyword?: string;
    status?: string;
  }

  export interface GroupItem {
    id: string;
    name: string;
    avatar: string;
    ownerId: string;
    ownerName: string;
    memberCount: number;
    status: string;
    allMuted: boolean;
    createdAt: string;
  }

  export interface GroupDetail extends GroupItem {
    allowMemberAddFriend?: boolean;
    announcement?: string;
    joinMode?: string;
  }

  export interface ReqDissolveGroup {
    reason: string;
    idempotencyKey?: string;
    ticketNo?: string;
  }

  export interface ReqMuteAllGroup {
    muted: boolean;
    reason: string;
  }

  export interface ReqRecallLogsParams {
    page?: number;
    size?: number;
  }

  export interface ReqGroupReportsParams {
    page?: number;
    size?: number;
  }

  export interface RecallLogItem {
    id: number;
    groupId: string;
    messageId: string;
    operatorName: string;
    operatorType: string;
    reason: string;
    createdAt: string;
  }

  export interface ActionResult {
    ok: boolean;
  }
}

export namespace User {
  export interface ReqUserParams extends ReqPage {
    username: string;
    gender: number;
    idCard: string;
    email: string;
    address: string;
    createTime: string[];
    status: number;
  }
  export interface ResUserList {
    id: string;
    username: string;
    gender: number;
    user: { detail: { age: number } };
    idCard: string;
    email: string;
    address: string;
    createTime: string;
    status: number;
    avatar: string;
    photo: any[];
    children?: ResUserList[];
  }
  export interface ResStatus {
    userLabel: string;
    userValue: number;
  }
  export interface ResGender {
    genderLabel: string;
    genderValue: number;
  }
  export interface ResDepartment {
    id: string;
    name: string;
    children?: ResDepartment[];
  }
  export interface ResRole {
    id: string;
    name: string;
    children?: ResDepartment[];
  }
}
