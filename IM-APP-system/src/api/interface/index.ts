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

  export interface ReqMfaVerifyForm {
    challengeToken: string;
    code: string;
  }

  export interface ReqRefreshForm {
    refreshToken: string;
  }

  export interface ReqLogoutForm {
    refreshToken: string;
  }

  export interface ReqLogoutAllForm {
    idempotencyKey?: string;
    reason: string;
    ticketNo?: string;
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
    admin?: AdminInfo;
    mfaChallenge?: string;
    refreshToken?: string;
    token?: string;
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

export namespace Me {
  export interface ResMeResult {
    admin?: Auth.AdminInfo;
    permissions?: string[];
  }

  export interface ResMfaStatus {
    enabled: boolean;
    secret?: string;
  }

  export interface ReqMfaCodeForm {
    code: string;
  }

  export interface ReqPasswordChangeForm {
    oldPassword: string;
    newPassword: string;
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

export namespace Audit {
  export interface AdminLoginLogsRequest {
    /**
     * 页码（默认1）
     */
    page?: number;
    /**
     * 每页条数（默认20，最大100）
     */
    size?: number;
    [property: string]: any;
  }

  export interface AdminLoginLogsResponse {
    /**
     * 0=成功
     */
    code: number;
    data: AdminLoginLogsData;
    message: string;
    requestId: string;
    [property: string]: any;
  }

  export interface AdminLoginLogsData {
    items: AdminLoginLogsLoginLog[];
    page: number;
    pageSize: number;
    total: number;
    [property: string]: any;
  }

  export interface AdminLoginLogsLoginLog {
    /**
     * 管理员 ID（可空）
     */
    adminId?: string;
    /**
     * 管理员昵称
     */
    adminName?: string;
    /**
     * 时间
     */
    createdAt?: string;
    /**
     * 失败原因
     */
    failReason?: string;
    /**
     * 日志 ID
     */
    id?: number;
    /**
     * IP
     */
    ip?: string;
    /**
     * 请求 ID
     */
    requestId?: string;
    /**
     * 是否成功
     */
    success?: boolean;
    /**
     * User-Agent
     */
    userAgent?: string;
    [property: string]: any;
  }

  export interface AuditLogDetailRequest {
    /**
     * 资源 ID（UUID）
     */
    id: number;
    [property: string]: any;
  }

  export interface AuditLogDetailResponse {
    /**
     * 0=成功
     */
    code: number;
    data: AuditLogDetailRequest;
    message: string;
    requestId: string;
    [property: string]: any;
  }

  export interface AuditLogsRequest {
    /**
     * 关键字（按管理员/动作/资源ID/IP匹配）
     */
    keyword?: string;
    /**
     * 页码（默认1）
     */
    page?: number;
    /**
     * 资源类型筛选
     */
    resource?: string;
    /**
     * 结果：success|denied|failed（可选值：success=成功, denied=权限拒绝, failed=失败）
     */
    result?: Result;
    /**
     * 每页条数（默认20，最大100）
     */
    size?: number;
    [property: string]: any;
  }

  export interface AuditLogsResponse {
    /**
     * 0=成功
     */
    code: number;
    data: AuditLogsData;
    message: string;
    requestId: string;
    [property: string]: any;
  }

  export interface AuditLogsData {
    items: AuditLogsAuditLog[];
    page: number;
    pageSize: number;
    total: number;
    [property: string]: any;
  }

  /**
   * AuditLog
   */
  export interface AuditLogsAuditLog {
    /**
     * 操作
     */
    action?: string;
    /**
     * 管理员 ID（可空）
     */
    adminId?: string;
    /**
     * 管理员昵称
     */
    adminName?: string;
    /**
     * 变更后
     */
    afterValue?: string;
    /**
     * 变更前
     */
    beforeValue?: string;
    /**
     * 时间
     */
    createdAt?: string;
    /**
     * 审计 ID
     */
    id?: number;
    /**
     * IP
     */
    ip?: string;
    /**
     * 操作原因
     */
    reason?: string;
    /**
     * 请求 ID
     */
    requestId?: string;
    /**
     * 资源类型
     */
    resource?: string;
    /**
     * 资源 ID
     */
    resourceId?: string;
    /**
     * success|denied|failed（可选值：success=成功, denied=权限拒绝, failed=失败）
     */
    result?: AuditLogsResult;
    /**
     * User-Agent
     */
    userAgent?: string;
    [property: string]: any;
  }

  /**
   * success|denied|failed（可选值：success=成功, denied=权限拒绝, failed=失败）
   */
  export enum AuditLogsResult {
    Denied = "denied",
    Failed = "failed",
    Success = "success",
  }
}
