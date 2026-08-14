<script setup lang="ts">
import { computed, reactive, shallowRef } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { CirclePlus, Delete, Download, Search, Upload } from "@element-plus/icons-vue";
import UserEditorDrawer from "../components/users/UserEditorDrawer.vue";
import type { SystemUser, UserDraft, UserStatus } from "../types/system";

interface UserFilters {
  keyword: string;
  status: "all" | UserStatus;
  role: string;
}

const filters = reactive<UserFilters>({ keyword: "", status: "all", role: "" });
const currentPage = shallowRef(1);
const pageSize = shallowRef(10);
const drawerVisible = shallowRef(false);
const selectedUser = shallowRef<SystemUser | null>(null);

const users = shallowRef<SystemUser[]>([
  {
    id: 1,
    name: "陈安",
    account: "chen.an",
    email: "chen.an@imapp.io",
    role: "超级管理员",
    status: "active",
    lastActiveAt: "2026-08-12 10:41",
    createdAt: "2026-03-08",
  },
  {
    id: 2,
    name: "林诺",
    account: "lin.nuo",
    email: "lin.nuo@imapp.io",
    role: "运营管理员",
    status: "active",
    lastActiveAt: "2026-08-12 09:36",
    createdAt: "2026-03-13",
  },
  {
    id: 3,
    name: "周米娅",
    account: "zhou.miya",
    email: "zhou.miya@imapp.io",
    role: "普通成员",
    status: "active",
    lastActiveAt: "2026-08-11 20:17",
    createdAt: "2026-04-02",
  },
  {
    id: 4,
    name: "王磊",
    account: "wang.lei",
    email: "wang.lei@imapp.io",
    role: "普通成员",
    status: "disabled",
    lastActiveAt: "2026-08-06 14:28",
    createdAt: "2026-04-15",
  },
  {
    id: 5,
    name: "黄怡",
    account: "huang.yi",
    email: "huang.yi@imapp.io",
    role: "运营管理员",
    status: "active",
    lastActiveAt: "2026-08-12 08:55",
    createdAt: "2026-05-20",
  },
]);

const filteredUsers = computed(() => {
  const keyword = filters.keyword.trim().toLowerCase();
  return users.value.filter((user) => {
    const matchesKeyword =
      !keyword ||
      [user.name, user.account, user.email].some((value) => value.toLowerCase().includes(keyword));
    const matchesStatus = filters.status === "all" || user.status === filters.status;
    const matchesRole = !filters.role || user.role === filters.role;
    return matchesKeyword && matchesStatus && matchesRole;
  });
});

const pageUsers = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  return filteredUsers.value.slice(start, start + pageSize.value);
});

function queryUsers(): void {
  currentPage.value = 1;
}

function resetFilters(): void {
  filters.keyword = "";
  filters.status = "all";
  filters.role = "";
  currentPage.value = 1;
}

function openCreateDrawer(): void {
  selectedUser.value = null;
  drawerVisible.value = true;
}

function openEditDrawer(user: SystemUser): void {
  selectedUser.value = user;
  drawerVisible.value = true;
}

function saveUser(draft: UserDraft): void {
  if (selectedUser.value) {
    users.value = users.value.map((user) =>
      user.id === selectedUser.value?.id ? { ...user, ...draft } : user,
    );
    ElMessage.success("用户更新成功");
    return;
  }
  const newUser: SystemUser = {
    id: Math.max(...users.value.map((user) => user.id), 0) + 1,
    ...draft,
    lastActiveAt: "暂无记录",
    createdAt: new Date().toISOString().slice(0, 10),
  };
  users.value = [newUser, ...users.value];
  ElMessage.success("用户创建成功");
}

async function toggleStatus(user: SystemUser): Promise<void> {
  const nextStatus: UserStatus = user.status === "active" ? "disabled" : "active";
  const action = nextStatus === "active" ? "启用" : "停用";
  try {
    await ElMessageBox.confirm(`${action}${user.name}的账号？`, `${action}用户`, {
      type: "warning",
      confirmButtonText: "确定",
      cancelButtonText: "取消",
    });
    users.value = users.value.map((item) =>
      item.id === user.id ? { ...item, status: nextStatus } : item,
    );
    ElMessage.success(`用户${action}成功`);
  } catch {
    // The confirmation was dismissed.
  }
}

function exportUsers(): void {
  ElMessage.success("用户数据导出任务已提交");
}
</script>

<template>
  <div class="table-box">
    <section class="card table-search">
      <el-form :model="filters" @submit.prevent="queryUsers">
        <div class="search-grid">
          <div class="search-item">
            <el-form-item>
              <el-input
                v-model="filters.keyword"
                clearable
                placeholder="用户姓名/账号/邮箱"
                :prefix-icon="Search"
                @keyup.enter="queryUsers"
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
          <div class="search-item">
            <el-form-item>
              <el-select v-model="filters.role" placeholder="角色" clearable>
                <el-option label="全部角色" value="" />
                <el-option label="超级管理员" value="超级管理员" />
                <el-option label="运营管理员" value="运营管理员" />
                <el-option label="普通成员" value="普通成员" />
              </el-select>
            </el-form-item>
          </div>
          <div class="search-operation">
            <el-button type="primary" :icon="Search" @click="queryUsers">搜索</el-button>
            <el-button :icon="Delete" @click="resetFilters">重置</el-button>
          </div>
        </div>
      </el-form>
    </section>

    <section class="card table-main">
      <div class="table-header">
        <div class="header-button-lf">
          <el-button type="primary" :icon="CirclePlus" @click="openCreateDrawer"
            >新增用户</el-button
          >
        </div>
      </div>

      <el-table :data="pageUsers" style="width: 100%">
        <el-table-column label="用户" min-width="220">
          <template #default="{ row }">
            <div class="user-cell">
              <span class="user-avatar">{{ row.name.slice(0, 1) }}</span>
              <div>
                <strong>{{ row.name }}</strong>
                <span>{{ row.account }}</span>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="email" label="邮箱" min-width="220" />
        <el-table-column prop="role" label="角色" min-width="160">
          <template #default="{ row }">
            <el-tag effect="plain" round>{{ row.role }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="用户状态" min-width="120">
          <template #default="{ row }">
            <el-tag :type="row.status === 'active' ? 'success' : 'danger'" effect="light">{{
              row.status === "active" ? "启用" : "停用"
            }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="lastActiveAt" label="最近活跃" min-width="170" />
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEditDrawer(row)">编辑</el-button>
            <el-button
              link
              :type="row.status === 'active' ? 'danger' : 'success'"
              @click="toggleStatus(row)"
              >{{ row.status === "active" ? "停用" : "启用" }}</el-button
            >
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
          :total="filteredUsers.length"
        />
      </div>
    </section>

    <UserEditorDrawer v-model="drawerVisible" :user="selectedUser" @save="saveUser" />
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
