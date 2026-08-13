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
