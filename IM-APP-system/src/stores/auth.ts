import { computed, shallowRef } from "vue";
import { defineStore } from "pinia";

export interface AdminProfile {
  name: string;
  role: string;
}

const TOKEN_KEY = "im-system-token";
const USER_KEY = "im-system-user";

export const useAuthStore = defineStore("im-auth", () => {
  const token = shallowRef(localStorage.getItem(TOKEN_KEY) ?? "");
  const profile = shallowRef<AdminProfile>({
    name: localStorage.getItem(USER_KEY) ?? "运营管理员",
    role: "超级管理员",
  });
  const isLoggedIn = computed(() => token.value.length > 0);

  function login(username: string): void {
    const name = username.trim() || "运营管理员";
    token.value = `im-${Date.now()}`;
    profile.value = { name, role: "超级管理员" };
    localStorage.setItem(TOKEN_KEY, token.value);
    localStorage.setItem(USER_KEY, name);
  }

  function logout(): void {
    token.value = "";
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  return { token, profile, isLoggedIn, login, logout };
});
