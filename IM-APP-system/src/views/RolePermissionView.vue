<script setup lang="ts">
import { computed, onMounted, reactive, shallowRef } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { CirclePlus, Delete, Search } from "@element-plus/icons-vue";
import {
  createRole,
  deleteRole,
  listPermissions,
  listRoles,
  updateRole,
  type Rbac,
} from "../api/modules/rbac";

interface PermissionGroup {
  label: string;
  permissions: Rbac.Permission[];
}

interface RoleDraft {
  name: string;
  code: string;
  description: string;
  status: Rbac.Status;
  permissions: string[];
}

interface RoleFilters {
  keyword: string;
  status: "all" | Rbac.Status;
}

const filters = reactive<RoleFilters>({ keyword: "", status: "all" });
const currentPage = shallowRef(1);
const pageSize = shallowRef(10);
const loading = shallowRef(false);
const drawerVisible = shallowRef(false);
const saving = shallowRef(false);
const selectedRole = shallowRef<Rbac.Role | null>(null);
const roles = shallowRef<Rbac.Role[]>([]);
const permissionCatalog = shallowRef<Rbac.Permission[]>([]);

const drawerDraft = reactive<RoleDraft>({
  name: "",
  code: "",
  description: "",
  status: "active",
  permissions: [],
});

const drawerTitle = computed(() => (selectedRole.value ? "编辑角色" : "新增角色"));

const permissionGroups = computed<PermissionGroup[]>(() => {
  const map = new Map<string, Rbac.Permission[]>();
  for (const item of permissionCatalog.value) {
    const label = item.module?.trim() || "其它";
    const list = map.get(label) ?? [];
    list.push(item);
    map.set(label, list);
  }
  return [...map.entries()].map(([label, permissions]) => ({ label, permissions }));
});

const filteredRoles = computed(() => {
  const keyword = filters.keyword.trim().toLowerCase();
  return roles.value.filter((role) => {
    const matchesKeyword =
      !keyword ||
      [role.name, role.code, role.description ?? ""].some((value) =>
        value.toLowerCase().includes(keyword),
      );
    const matchesStatus = filters.status === "all" || role.status === filters.status;
    return matchesKeyword && matchesStatus;
  });
});

const pageRoles = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  return filteredRoles.value.slice(start, start + pageSize.value);
});

function formatTime(value?: string): string {
  if (!value) return "-";
  return value
    .replace("T", " ")
    .replace(/\.\d+/, "")
    .replace(/\+08:00$/, "");
}

function queryRoles(): void {
  currentPage.value = 1;
}

function resetFilters(): void {
  filters.keyword = "";
  filters.status = "all";
  currentPage.value = 1;
}

async function loadPermissions(): Promise<void> {
  try {
    const res = await listPermissions();
    permissionCatalog.value = res.data ?? [];
  } catch {
    permissionCatalog.value = [];
  }
}

async function loadRoles(): Promise<void> {
  loading.value = true;
  try {
    const res = await listRoles();
    roles.value = res.data ?? [];
  } catch {
    roles.value = [];
  } finally {
    loading.value = false;
  }
}

function openCreateDrawer(): void {
  selectedRole.value = null;
  drawerVisible.value = true;
}

function openEditDrawer(role: Rbac.Role): void {
  selectedRole.value = role;
  drawerVisible.value = true;
}

function handleDrawerOpen(): void {
  if (selectedRole.value) {
    Object.assign(drawerDraft, {
      name: selectedRole.value.name,
      code: selectedRole.value.code,
      description: selectedRole.value.description ?? "",
      status: selectedRole.value.status === "disabled" ? "disabled" : "active",
      permissions: [...(selectedRole.value.permissions ?? [])],
    });
  } else {
    Object.assign(drawerDraft, {
      name: "",
      code: "",
      description: "",
      status: "active",
      permissions: [],
    });
  }
}

async function handleSave(): Promise<void> {
  const name = drawerDraft.name.trim();
  const code = drawerDraft.code.trim();
  if (!name) {
    ElMessage.warning("请输入角色名称");
    return;
  }
  if (!selectedRole.value && !code) {
    ElMessage.warning("请输入角色编码");
    return;
  }

  saving.value = true;
  try {
    if (selectedRole.value) {
      await updateRole(selectedRole.value.id, {
        name,
        description: drawerDraft.description.trim() || undefined,
        permissions: drawerDraft.permissions,
        status: drawerDraft.status,
      });
      ElMessage.success("角色更新成功");
    } else {
      await createRole({
        code,
        name,
        description: drawerDraft.description.trim() || undefined,
        permissions: drawerDraft.permissions,
      });
      ElMessage.success("角色创建成功");
    }
    drawerVisible.value = false;
    await loadRoles();
  } catch {
    // 拦截器已提示
  } finally {
    saving.value = false;
  }
}

async function removeRole(role: Rbac.Role): Promise<void> {
  if (role.code === "super_admin") {
    ElMessage.warning("超级管理员角色不可删除");
    return;
  }
  try {
    await ElMessageBox.confirm(`确认删除角色「${role.name}」？删除后不可恢复。`, "删除角色", {
      type: "warning",
      confirmButtonText: "确定",
      cancelButtonText: "取消",
    });
    await deleteRole(role.id);
    ElMessage.success("角色删除成功");
    await loadRoles();
  } catch {
    // 取消或失败
  }
}

async function toggleStatus(role: Rbac.Role): Promise<void> {
  if (role.code === "super_admin") {
    ElMessage.warning("超级管理员角色状态不可修改");
    return;
  }
  const nextStatus: Rbac.Status = role.status === "active" ? "disabled" : "active";
  const action = nextStatus === "active" ? "启用" : "停用";
  try {
    await ElMessageBox.confirm(`确认${action}角色「${role.name}」？`, `${action}角色`, {
      type: "warning",
      confirmButtonText: "确定",
      cancelButtonText: "取消",
    });
    await updateRole(role.id, { status: nextStatus });
    ElMessage.success(`角色${action}成功`);
    await loadRoles();
  } catch {
    // 取消或失败
  }
}

function handleCheckAll(checked: boolean | string | number, group: PermissionGroup): void {
  const codes = group.permissions.map((p) => p.code);
  if (checked) {
    const set = new Set(drawerDraft.permissions);
    codes.forEach((code) => set.add(code));
    drawerDraft.permissions = [...set];
  } else {
    drawerDraft.permissions = drawerDraft.permissions.filter((code) => !codes.includes(code));
  }
}

function isGroupAllChecked(group: PermissionGroup): boolean {
  return (
    group.permissions.length > 0 &&
    group.permissions.every((p) => drawerDraft.permissions.includes(p.code))
  );
}

function isGroupIndeterminate(group: PermissionGroup): boolean {
  const checked = group.permissions.filter((p) => drawerDraft.permissions.includes(p.code));
  return checked.length > 0 && checked.length < group.permissions.length;
}

onMounted(() => {
  void loadPermissions();
  void loadRoles();
});
</script>

<template>
  <div class="table-box">
    <section class="card table-search">
      <el-form :model="filters" @submit.prevent="queryRoles">
        <div class="search-grid">
          <div class="search-item">
            <el-form-item>
              <el-input
                v-model="filters.keyword"
                clearable
                placeholder="角色名称/编码/描述"
                :prefix-icon="Search"
                @keyup.enter="queryRoles"
              />
            </el-form-item>
          </div>
          <div class="search-item">
            <el-form-item>
              <el-select v-model="filters.status" placeholder="状态" clearable>
                <el-option label="全部状态" value="all" />
                <el-option label="启用" value="active" />
                <el-option label="停用" value="disabled" />
              </el-select>
            </el-form-item>
          </div>
          <div class="search-item" />
          <div class="search-operation">
            <el-button type="primary" :icon="Search" @click="queryRoles">搜索</el-button>
            <el-button :icon="Delete" @click="resetFilters">重置</el-button>
          </div>
        </div>
      </el-form>
    </section>

    <section class="card table-main">
      <div class="table-header">
        <div class="header-button-lf">
          <el-button type="primary" :icon="CirclePlus" @click="openCreateDrawer">新增角色</el-button>
        </div>
      </div>

      <el-table v-loading="loading" :data="pageRoles" style="width: 100%">
        <el-table-column prop="name" label="角色名称" min-width="140">
          <template #default="{ row }">
            <div class="role-name-cell">
              <strong>{{ row.name }}</strong>
              <el-tag
                v-if="row.code === 'super_admin'"
                type="warning"
                size="small"
                effect="plain"
              >
                内置
              </el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="code" label="角色编码" min-width="140" />
        <el-table-column prop="description" label="描述" min-width="240" show-overflow-tooltip />
        <el-table-column prop="userCount" label="管理员数" min-width="100" align="center" />
        <el-table-column label="状态" min-width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === 'active' ? 'success' : 'danger'" effect="light">
              {{ row.status === "active" ? "启用" : "停用" }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" min-width="170">
          <template #default="{ row }">
            {{ formatTime(row.createdAt) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEditDrawer(row)">编辑</el-button>
            <el-button
              link
              :type="row.status === 'active' ? 'danger' : 'success'"
              :disabled="row.code === 'super_admin'"
              @click="toggleStatus(row)"
            >
              {{ row.status === "active" ? "停用" : "启用" }}
            </el-button>
            <el-button
              link
              type="danger"
              :disabled="row.code === 'super_admin'"
              @click="removeRole(row)"
            >
              删除
            </el-button>
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
          :total="filteredRoles.length"
        />
      </div>
    </section>

    <el-drawer
      v-model="drawerVisible"
      :title="drawerTitle"
      size="480px"
      @open="handleDrawerOpen"
    >
      <el-form :model="drawerDraft" label-width="80px">
        <el-form-item label="角色名称">
          <el-input v-model="drawerDraft.name" placeholder="请输入角色名称" />
        </el-form-item>
        <el-form-item label="角色编码">
          <el-input
            v-model="drawerDraft.code"
            placeholder="如 operator"
            :disabled="!!selectedRole"
          />
        </el-form-item>
        <el-form-item label="描述">
          <el-input
            v-model="drawerDraft.description"
            type="textarea"
            :rows="2"
            placeholder="请输入角色描述"
          />
        </el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="drawerDraft.status" :disabled="selectedRole?.code === 'super_admin'">
            <el-radio value="active">启用</el-radio>
            <el-radio value="disabled">停用</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="权限分配">
          <div v-if="permissionGroups.length" class="permission-groups">
            <div
              v-for="group in permissionGroups"
              :key="group.label"
              class="permission-group"
            >
              <div class="permission-group-header">
                <el-checkbox
                  :model-value="isGroupAllChecked(group)"
                  :indeterminate="isGroupIndeterminate(group)"
                  @change="(val: boolean | string | number) => handleCheckAll(val, group)"
                >
                  {{ group.label }}
                </el-checkbox>
              </div>
              <el-checkbox-group v-model="drawerDraft.permissions" class="permission-items">
                <el-checkbox
                  v-for="perm in group.permissions"
                  :key="perm.code"
                  :value="perm.code"
                >
                  {{ perm.name || perm.code }}
                </el-checkbox>
              </el-checkbox-group>
            </div>
          </div>
          <el-empty v-else description="暂无权限字典" :image-size="64" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="drawerVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">确定</el-button>
      </template>
    </el-drawer>
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

.role-name-cell {
  display: flex;
  align-items: center;
  gap: 8px;
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

.permission-groups {
  display: flex;
  flex-direction: column;
  width: 100%;
  gap: 16px;
}

.permission-group {
  padding: 12px 14px;
  background: var(--el-fill-color-lighter);
  border-radius: 6px;
}

.permission-group-header {
  margin-bottom: 8px;
  font-weight: 600;
}

.permission-items {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  padding-left: 24px;
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
