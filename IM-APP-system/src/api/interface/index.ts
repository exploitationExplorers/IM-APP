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
