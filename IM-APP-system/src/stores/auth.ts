import { computed, shallowRef } from "vue";
import { defineStore } from "pinia";
import type { Auth } from "@/api/interface";

export interface AdminProfile {
  id: string;
  name: string;
  role: string;
  username: string;
}

const TOKEN_KEY = "im-system-token";
const REFRESH_TOKEN_KEY = "im-system-refresh-token";
const USER_KEY = "im-system-user";

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

function readProfile(token = ""): AdminProfile {
  const raw = localStorage.getItem(USER_KEY);
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
    return {
      id: decodeAdminIdFromToken(token),
      name: raw,
      role: "超级管理员",
      username: "",
    };
  }
}

export const useAuthStore = defineStore("im-auth", () => {
  const token = shallowRef(localStorage.getItem(TOKEN_KEY) ?? "");
  const refreshToken = shallowRef(localStorage.getItem(REFRESH_TOKEN_KEY) ?? "");
  const profile = shallowRef<AdminProfile>(readProfile(token.value));
  const isLoggedIn = computed(() => token.value.length > 0);
  const adminId = computed(() => {
    return profile.value.id?.trim() || decodeAdminIdFromToken(token.value);
  });

  if (token.value && profile.value.id) {
    localStorage.setItem(USER_KEY, JSON.stringify(profile.value));
  }

  function persistProfile(next: AdminProfile): void {
    profile.value = next;
    localStorage.setItem(USER_KEY, JSON.stringify(next));
  }

  function setSession(payload: Auth.ResLogin): void {
    token.value = payload.token;
    refreshToken.value = payload.refreshToken;
    const name = payload.admin.nickname || payload.admin.username || "运营管理员";
    const role = payload.admin.roleNames?.[0] || "管理员";
    const id =
      String(payload.admin.id || "").trim() || decodeAdminIdFromToken(payload.token);
    persistProfile({
      id,
      name,
      role,
      username: payload.admin.username,
    });
    localStorage.setItem(TOKEN_KEY, payload.token);
    localStorage.setItem(REFRESH_TOKEN_KEY, payload.refreshToken);
  }

  function logout(): void {
    token.value = "";
    refreshToken.value = "";
    profile.value = { id: "", name: "运营管理员", role: "超级管理员", username: "" };
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  return { token, refreshToken, profile, adminId, isLoggedIn, setSession, logout };
});
