export type UserStatus = "active" | "disabled";

export interface SystemUser {
  id: number;
  name: string;
  account: string;
  email: string;
  role: string;
  status: UserStatus;
  lastActiveAt: string;
  createdAt: string;
}

export interface UserDraft {
  name: string;
  account: string;
  email: string;
  role: string;
  status: UserStatus;
}

export interface OperationLog {
  id: number;
  operator: string;
  action: string;
  target: string;
  ip: string;
  result: "成功" | "失败";
  createdAt: string;
}
