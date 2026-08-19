import { computed, shallowRef } from "vue";
import { defineStore } from "pinia";
import type { Auth, Me } from "@/api/interface";

export interface AdminProfile {
  id: string;
  name: string;
  role: string;
  username: string;
}

const TOKEN_KEY = "im-system-token";
const REFRESH_TOKEN_KEY = "im-system-refresh-token";
const USER_KEY = "im-system-user";
const PERMISSIONS_KEY = "im-system-permissions";

function decodeAdminIdFromToken(token: string): string {
  const parts = token.split(".");
  if (parts.length < 2) return "";
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    const payload = JSON.parse(atob(padded)) as { aid?: string; sub?: string; adminId?: string };
    return String(payload.aid || payload.sub || payload.adminId || "").trim();
  } catch {
    return "";
  }
}

function readProfile(): AdminProfile {
  const raw = localStorage.getItem(USER_KEY);
  const token = localStorage.getItem(TOKEN_KEY) ?? "";
  if (!raw) {
    return {
      id: decodeAdminIdFromToken(token),
      name: "运营管理员",
      role: "超级管理员",
      username: "",
    };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<AdminProfile>;
    return {
      id: String(parsed.id || "").trim() || decodeAdminIdFromToken(token),
      name: parsed.name || "运营管理员",
      role: parsed.role || "超级管理员",
      username: parsed.username || "",
    };
  } catch {
    return { id: decodeAdminIdFromToken(token), name: raw, role: "超级管理员", username: "" };
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
  const adminId = computed(() => {
    return (
      admin.value?.id?.trim() || profile.value.id?.trim() || decodeAdminIdFromToken(token.value)
    );
  });

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
      const id =
        String(payload.admin.id || "").trim() ||
        decodeAdminIdFromToken(payload.token || token.value);
      profile.value = {
        id,
        name,
        role,
        username: payload.admin.username,
      };
      localStorage.setItem(USER_KEY, JSON.stringify(profile.value));
    }
  }

  function setMe(payload: Me.ResMeResult): void {
    if (payload.admin) {
      admin.value = payload.admin;
      const name = payload.admin.nickname || payload.admin.username || "运营管理员";
      const role = payload.admin.roleNames?.[0] || "管理员";
      const id = String(payload.admin.id || "").trim() || decodeAdminIdFromToken(token.value);
      profile.value = {
        id,
        name,
        role,
        username: payload.admin.username,
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
    profile.value = { id: "", name: "运营管理员", role: "超级管理员", username: "" };
    admin.value = null;
    permissions.value = [];
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(PERMISSIONS_KEY);
  }

  return {
    token,
    refreshToken,
    profile,
    admin,
    adminId,
    permissions,
    isLoggedIn,
    setSession,
    setMe,
    logout,
  };
});
