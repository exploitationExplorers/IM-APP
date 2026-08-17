// 请求响应参数（不包含data）
export interface Result {
  code: string;
  msg: string;
}

// 请求响应参数（包含data）
export interface ResultData<T = any> extends Result {
  data: T;
}

// 分页响应参数
export interface ResPage<T> {
  list: T[];
  pageNum: number;
  pageSize: number;
  total: number;
}

// 分页请求参数
export interface ReqPage {
  pageNum: number;
  pageSize: number;
}

// 文件上传模块
export namespace Upload {
  export interface ResFileUrl {
    fileUrl: string;
  }
}

// 登录模块
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

// 用户管理模块
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
