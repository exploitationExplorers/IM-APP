import { computed, shallowRef } from "vue";
import { defineStore } from "pinia";
import type { Auth } from "@/api/interface";

export interface AdminProfile {
  name: string;
  role: string;
  username: string;
}

const TOKEN_KEY = "im-system-token";
const REFRESH_TOKEN_KEY = "im-system-refresh-token";
const USER_KEY = "im-system-user";

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

export const useAuthStore = defineStore("im-auth", () => {
  const token = shallowRef(localStorage.getItem(TOKEN_KEY) ?? "");
  const refreshToken = shallowRef(localStorage.getItem(REFRESH_TOKEN_KEY) ?? "");
  const profile = shallowRef<AdminProfile>(readProfile());
  const isLoggedIn = computed(() => token.value.length > 0);

  function setSession(payload: Auth.ResLogin): void {
    token.value = payload.token;
    refreshToken.value = payload.refreshToken;
    const name = payload.admin.nickname || payload.admin.username || "运营管理员";
    const role = payload.admin.roleNames?.[0] || "管理员";
    profile.value = {
      name,
      role,
      username: payload.admin.username
    };
    localStorage.setItem(TOKEN_KEY, payload.token);
    localStorage.setItem(REFRESH_TOKEN_KEY, payload.refreshToken);
    localStorage.setItem(USER_KEY, JSON.stringify(profile.value));
  }

  function logout(): void {
    token.value = "";
    refreshToken.value = "";
    profile.value = { name: "运营管理员", role: "超级管理员", username: "" };
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  return { token, refreshToken, profile, isLoggedIn, setSession, logout };
});
