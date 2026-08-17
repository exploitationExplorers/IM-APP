<script setup lang="ts">
import { onMounted, reactive, shallowRef, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { CirclePlus, Delete, Search } from "@element-plus/icons-vue";
import UserEditorDrawer, { type AdminDraft } from "../components/users/UserEditorDrawer.vue";
import {
  createAdmin,
  listAdmins,
  listRoles,
  patchAdmin,
  resetAdminMfa,
  updateAdminStatus,
  type Rbac,
} from "../api/modules/rbac";

interface AdminFilters {
  keyword: string;
}

const filters = reactive<AdminFilters>({ keyword: "" });
const currentPage = shallowRef(1);
const pageSize = shallowRef(10);
const total = shallowRef(0);
const loading = shallowRef(false);
const drawerVisible = shallowRef(false);
const selectedAdmin = shallowRef<Rbac.AdminAccount | null>(null);
const admins = shallowRef<Rbac.AdminAccount[]>([]);
const roleOptions = shallowRef<Rbac.Role[]>([]);

function formatTime(value?: string): string {
  if (!value) return "-";
  return value
    .replace("T", " ")
    .replace(/\.\d+/, "")
    .replace(/\+08:00$/, "");
}

function displayName(admin: Rbac.AdminAccount): string {
  return admin.nickname?.trim() || admin.username || "-";
}

async function loadRoles(): Promise<void> {
  try {
    const res = await listRoles();
    roleOptions.value = res.data ?? [];
  } catch {
    roleOptions.value = [];
  }
}

async function loadAdmins(): Promise<void> {
  loading.value = true;
  try {
    const res = await listAdmins({
      page: currentPage.value,
      size: pageSize.value,
      keyword: filters.keyword.trim() || undefined,
    });
    const data = res.data;
    admins.value = data?.items ?? [];
    total.value = data?.total ?? 0;
  } catch {
    admins.value = [];
    total.value = 0;
  } finally {
    loading.value = false;
  }
}

function queryAdmins(): void {
  currentPage.value = 1;
  void loadAdmins();
}

function resetFilters(): void {
  filters.keyword = "";
  currentPage.value = 1;
  void loadAdmins();
}

function openCreateDrawer(): void {
  selectedAdmin.value = null;
  drawerVisible.value = true;
}

function openEditDrawer(admin: Rbac.AdminAccount): void {
  selectedAdmin.value = admin;
  drawerVisible.value = true;
}

async function saveAdmin(draft: AdminDraft): Promise<void> {
  try {
    if (selectedAdmin.value) {
      const body: Rbac.PatchAdminBody = {
        nickname: draft.nickname,
        roleIds: draft.roleIds,
        status: draft.status,
      };
      if (draft.password) body.password = draft.password;
      await patchAdmin(selectedAdmin.value.id, body);
      ElMessage.success("管理员更新成功");
    } else {
      await createAdmin({
        username: draft.username,
        password: draft.password,
        nickname: draft.nickname || undefined,
        roleIds: draft.roleIds,
        status: draft.status,
      });
      ElMessage.success("管理员创建成功");
    }
    await loadAdmins();
  } catch {
    // 错误已由拦截器提示
  }
}

async function toggleStatus(admin: Rbac.AdminAccount): Promise<void> {
  const nextStatus: Rbac.Status = admin.status === "active" ? "disabled" : "active";
  const action = nextStatus === "active" ? "启用" : "停用";
  try {
    await ElMessageBox.confirm(
      `${action}「${displayName(admin)}」？停用后其全部会话将立即失效。`,
      `${action}管理员`,
      { type: "warning", confirmButtonText: "确定", cancelButtonText: "取消" },
    );
    await updateAdminStatus(admin.id, { status: nextStatus });
    ElMessage.success(`管理员${action}成功`);
    await loadAdmins();
  } catch {
    // 取消或失败
  }
}

async function handleResetMfa(admin: Rbac.AdminAccount): Promise<void> {
  try {
    const { value } = await ElMessageBox.prompt(
      `重置「${displayName(admin)}」的 MFA？可填写操作原因。`,
      "重置 MFA",
      {
        confirmButtonText: "确定",
        cancelButtonText: "取消",
        inputPlaceholder: "操作原因（可选）",
        inputValue: "",
      },
    );
    await resetAdminMfa(admin.id, { reason: value?.trim() || undefined });
    ElMessage.success("MFA 已重置");
    await loadAdmins();
  } catch {
    // 取消或失败
  }
}

watch([currentPage, pageSize], () => {
  void loadAdmins();
});

onMounted(() => {
  void loadRoles();
  void loadAdmins();
});
</script>

<template>
  <div class="table-box">
    <section class="card table-search">
      <el-form :model="filters" @submit.prevent="queryAdmins">
        <div class="search-grid">
          <div class="search-item">
            <el-form-item>
              <el-input
                v-model="filters.keyword"
                clearable
                placeholder="用户名/昵称"
                :prefix-icon="Search"
                @keyup.enter="queryAdmins"
                @clear="queryAdmins"
              />
            </el-form-item>
          </div>
          <div class="search-item" />
          <div class="search-item" />
          <div class="search-operation">
            <el-button type="primary" :icon="Search" @click="queryAdmins">搜索</el-button>
            <el-button :icon="Delete" @click="resetFilters">重置</el-button>
          </div>
        </div>
      </el-form>
    </section>

    <section class="card table-main">
      <div class="table-header">
        <div class="header-button-lf">
          <el-button type="primary" :icon="CirclePlus" @click="openCreateDrawer">
            新增管理员
          </el-button>
        </div>
      </div>

      <el-table v-loading="loading" :data="admins" style="width: 100%">
        <el-table-column label="管理员" min-width="200">
          <template #default="{ row }">
            <div class="user-cell">
              <span class="user-avatar">{{ displayName(row).slice(0, 1) }}</span>
              <div>
                <strong>{{ displayName(row) }}</strong>
                <span>{{ row.username }}</span>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="角色" min-width="180">
          <template #default="{ row }">
            <template v-if="row.roleNames?.length">
              <el-tag
                v-for="name in row.roleNames"
                :key="name"
                class="role-tag"
                effect="plain"
                round
              >
                {{ name }}
              </el-tag>
            </template>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" min-width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === 'active' ? 'success' : 'danger'" effect="light">
              {{ row.status === "active" ? "启用" : "停用" }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="MFA" min-width="90">
          <template #default="{ row }">
            <el-tag :type="row.mfaEnabled ? 'success' : 'info'" effect="plain">
              {{ row.mfaEnabled ? "已启用" : "未启用" }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="最近登录" min-width="170">
          <template #default="{ row }">
            {{ formatTime(row.lastLoginAt) }}
          </template>
        </el-table-column>
        <el-table-column label="创建时间" min-width="170">
          <template #default="{ row }">
            {{ formatTime(row.createdAt) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEditDrawer(row)">编辑</el-button>
            <el-button
              link
              :type="row.status === 'active' ? 'danger' : 'success'"
              @click="toggleStatus(row)"
            >
              {{ row.status === "active" ? "停用" : "启用" }}
            </el-button>
            <el-button link type="warning" @click="handleResetMfa(row)">重置 MFA</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="table-footer">
        <el-pagination
          background
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :page-sizes="[10, 25, 50, 100]"
          layout="total, sizes, prev, pager, next, jumper"
          :total="total"
        />
      </div>
    </section>

    <UserEditorDrawer
      v-model="drawerVisible"
      :admin="selectedAdmin"
      :role-options="roleOptions"
      @save="saveAdmin"
    />
  </div>
</template>

<style scoped lang="scss">
.table-box,
.table-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  width: 100%;
  height: 100%;
}

.table-search {
  padding: 18px 18px 0;
  margin-bottom: 10px;

  .search-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0 18px;
  }

  .search-item :deep(.el-form-item) {
    margin-bottom: 18px;
  }

  .search-item :deep(.el-form-item__content > *) {
    width: 100%;
  }

  .search-operation {
    display: flex;
    align-items: flex-start;
    justify-content: flex-end;
    gap: 12px;
    margin-bottom: 18px;

    .el-button {
      margin-left: 0;
    }
  }
}

.table-header {
  min-height: 40px;

  .header-button-lf {
    display: flex;
    flex-wrap: wrap;
    gap: 15px 12px;
    margin-bottom: 15px;

    .el-button:not(.el-input .el-button) {
      margin-left: 0;
    }
  }
}

.user-cell {
  display: flex;
  align-items: center;
  gap: 10px;

  div {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  strong {
    color: var(--el-text-color-primary);
    font-size: 14px;
  }

  div span {
    color: var(--el-text-color-secondary);
    font-size: 12px;
  }
}

.user-avatar {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  color: #08766f;
  background: #dff6f2;
  border-radius: 50%;
  font-size: 13px;
  font-weight: 700;
}

.role-tag {
  margin-right: 6px;
  margin-bottom: 4px;
}

:deep(.el-table) {
  flex: 1;

  .el-table__header th {
    height: 45px;
    font-size: 15px;
    font-weight: bold;
    color: var(--el-text-color-primary);
    background: var(--el-fill-color-light);
  }

  .el-table__row {
    height: 45px;
    font-size: 14px;
  }
}

.table-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-height: 64px;
}

@media (max-width: 1100px) {
  .table-search .search-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .table-search .search-operation {
    justify-content: flex-start;
  }
}

@media (max-width: 700px) {
  .table-search .search-grid {
    grid-template-columns: 1fr;
  }

  .table-search .search-operation {
    justify-content: flex-start;
  }

  .table-footer {
    justify-content: center;
  }
}
</style>
