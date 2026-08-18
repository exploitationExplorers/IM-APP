import { computed, shallowRef } from "vue";
import { defineStore } from "pinia";
import type { Auth, Me } from "@/api/interface";

export interface AdminProfile {
  name: string;
  role: string;
  username: string;
}

const TOKEN_KEY = "im-system-token";
const REFRESH_TOKEN_KEY = "im-system-refresh-token";
const USER_KEY = "im-system-user";
const PERMISSIONS_KEY = "im-system-permissions";

function readProfile(): AdminProfile {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) {
    return { name: "运营管理员", role: "超级管理员", username: "" };
  }
  try {
    return JSON.parse(raw) as AdminProfile;
  } catch {
    return { name: raw, role: "超级管理员", username: "" };
  }
}

function readPermissions(): string[] {
  const raw = localStorage.getItem(PERMISSIONS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export const useAuthStore = defineStore("im-auth", () => {
  const token = shallowRef(localStorage.getItem(TOKEN_KEY) ?? "");
  const refreshToken = shallowRef(localStorage.getItem(REFRESH_TOKEN_KEY) ?? "");
  const profile = shallowRef<AdminProfile>(readProfile());
  const admin = shallowRef<Auth.AdminInfo | null>(null);
  const permissions = shallowRef<string[]>(readPermissions());
  const isLoggedIn = computed(() => token.value.length > 0);

  function setSession(payload: Auth.ResLogin): void {
    if (payload.token) {
      token.value = payload.token;
      localStorage.setItem(TOKEN_KEY, payload.token);
    }
    if (payload.refreshToken) {
      refreshToken.value = payload.refreshToken;
      localStorage.setItem(REFRESH_TOKEN_KEY, payload.refreshToken);
    }
    if (payload.admin) {
      admin.value = payload.admin;
      const name = payload.admin.nickname || payload.admin.username || "运营管理员";
      const role = payload.admin.roleNames?.[0] || "管理员";
      profile.value = {
        name,
        role,
        username: payload.admin.username
      };
      localStorage.setItem(USER_KEY, JSON.stringify(profile.value));
    }
  }

  function setMe(payload: Me.ResMeResult): void {
    if (payload.admin) {
      admin.value = payload.admin;
      const name = payload.admin.nickname || payload.admin.username || "运营管理员";
      const role = payload.admin.roleNames?.[0] || "管理员";
      profile.value = {
        name,
        role,
        username: payload.admin.username
      };
      localStorage.setItem(USER_KEY, JSON.stringify(profile.value));
    }
    if (Array.isArray(payload.permissions)) {
      permissions.value = payload.permissions;
      localStorage.setItem(PERMISSIONS_KEY, JSON.stringify(payload.permissions));
    }
  }

  function logout(): void {
    token.value = "";
    refreshToken.value = "";
    profile.value = { name: "运营管理员", role: "超级管理员", username: "" };
    admin.value = null;
    permissions.value = [];
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(PERMISSIONS_KEY);
  }

  return { token, refreshToken, profile, admin, permissions, isLoggedIn, setSession, setMe, logout };
});
