<script setup lang="ts">
import { computed, onMounted, reactive, shallowRef } from "vue";
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from "element-plus";
import { Plus, RefreshLeft, Search } from "@element-plus/icons-vue";

import { CountrySms, getAdminCountriesApi, postAdminCreateCountryApi, putAdminCountryStatusApi } from "@/api/modules/countrySms";

const tableLoading = shallowRef(false);
const countries = shallowRef<CountrySms.CountryItem[]>([]);

const filters = reactive<{ keyword: string }>({ keyword: "" });

const filteredCountries = computed(() => {
  const keyword = filters.keyword.trim().toLowerCase();
  if (!keyword) return countries.value;
  return countries.value.filter((item) => {
    return (
      item.cnName?.toLowerCase().includes(keyword) ||
      item.enName?.toLowerCase().includes(keyword) ||
      item.code?.toLowerCase().includes(keyword) ||
      item.dialCode?.toLowerCase().includes(keyword)
    );
  });
});

async function fetchCountries(): Promise<void> {
  tableLoading.value = true;
  try {
    const res = await getAdminCountriesApi();
    countries.value = res.data ?? [];
  } catch {
    countries.value = [];
  } finally {
    tableLoading.value = false;
  }
}

function resetFilters(): void {
  filters.keyword = "";
}

const createVisible = shallowRef(false);
const createLoading = shallowRef(false);
const createFormRef = shallowRef<FormInstance>();

const createForm = reactive<CountrySms.ReqCreateCountryBody>({
  cnName: "",
  enName: "",
  code: "",
  dialCode: "",
  enabled: true,
  phoneRule: "",
  sortOrder: 0,
});

const createRules: FormRules<CountrySms.ReqCreateCountryBody> = {
  cnName: [{ required: true, message: "请输入中文名", trigger: "blur" }],
  code: [{ required: true, message: "请输入国家码（如 CN）", trigger: "blur" }],
  dialCode: [{ required: true, message: "请输入区号（如 +86）", trigger: "blur" }],
};

function openCreateDialog(): void {
  createForm.cnName = "";
  createForm.enName = "";
  createForm.code = "";
  createForm.dialCode = "";
  createForm.enabled = true;
  createForm.phoneRule = "";
  createForm.sortOrder = 0;
  createVisible.value = true;
}

async function submitCreate(): Promise<void> {
  const form = createFormRef.value;
  if (!form) return;
  await form.validate();

  createLoading.value = true;
  try {
    await postAdminCreateCountryApi({
      ...createForm,
      code: createForm.code.trim(),
      dialCode: createForm.dialCode.trim(),
      cnName: createForm.cnName.trim(),
      enName: createForm.enName.trim(),
      phoneRule: createForm.phoneRule.trim(),
    });
    ElMessage.success("新增成功");
    createVisible.value = false;
    fetchCountries();
  } catch {
    // ignored
  } finally {
    createLoading.value = false;
  }
}

const toggleLoadingCodes = shallowRef(new Set<string>());

async function toggleCountryStatus(row: CountrySms.CountryItem, nextEnabled: boolean): Promise<void> {
  const code = row.code;
  if (!code) return;
  if (toggleLoadingCodes.value.has(code)) return;

  row.enabled = nextEnabled;

  try {
    const actionText = nextEnabled ? "启用" : "停用";
    const { value: reason } = await ElMessageBox.prompt(`请输入${actionText}原因`, `${actionText}国家注册`, {
      confirmButtonText: "确定",
      cancelButtonText: "取消",
      inputPlaceholder: "请输入原因",
      inputValidator: (val: string) => {
        if (!val || !val.trim()) return "原因不能为空";
        return true;
      },
    });

    toggleLoadingCodes.value = new Set(toggleLoadingCodes.value).add(code);
    await putAdminCountryStatusApi(code, { enabled: nextEnabled, reason: reason.trim() });
    ElMessage.success(`${actionText}成功`);
    fetchCountries();
  } catch {
    row.enabled = !nextEnabled;
  } finally {
    const next = new Set(toggleLoadingCodes.value);
    next.delete(code);
    toggleLoadingCodes.value = next;
  }
}

function isToggleLoading(code: string): boolean {
  return toggleLoadingCodes.value.has(code);
}

onMounted(() => {
  fetchCountries();
});
</script>

<template>
  <div class="table-box">
    <section class="card table-search">
      <el-form :model="filters" @submit.prevent>
        <div class="search-grid">
          <div class="search-item">
            <el-form-item>
              <el-input
                v-model="filters.keyword"
                clearable
                placeholder="搜索：中文名/英文名/国家码/区号"
                :prefix-icon="Search"
              />
            </el-form-item>
          </div>
          <div class="search-operation">
            <el-button :icon="RefreshLeft" @click="resetFilters">重置</el-button>
          </div>
        </div>
      </el-form>
    </section>

    <section class="card table-main">
      <div class="table-header">
        <div class="header-button-lf">
          <el-button type="primary" :icon="Plus" @click="openCreateDialog">新增国家/地区</el-button>
        </div>
        <div class="header-button-ri">
          <el-button :icon="RefreshLeft" @click="fetchCountries">刷新</el-button>
        </div>
      </div>

      <el-table v-loading="tableLoading" :data="filteredCountries" style="width: 100%">
        <el-table-column prop="cnName" label="中文名" min-width="140" />
        <el-table-column prop="enName" label="英文名" min-width="140" />
        <el-table-column prop="code" label="国家码" min-width="110">
          <template #default="{ row }">
            <span class="mono-text">{{ row.code || "—" }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="dialCode" label="区号" min-width="110">
          <template #default="{ row }">
            <span class="mono-text">{{ row.dialCode || "—" }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="phoneRule" label="号码规则" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="mono-text">{{ row.phoneRule || "—" }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="sortOrder" label="排序" width="90" />
        <el-table-column label="注册启用" width="130" fixed="right">
          <template #default="{ row }">
            <el-switch
              :model-value="row.enabled"
              :loading="isToggleLoading(row.code)"
              @change="(val: boolean) => toggleCountryStatus(row, val)"
            />
          </template>
        </el-table-column>
      </el-table>
    </section>

    <el-dialog v-model="createVisible" title="新增国家/地区" width="520px" destroy-on-close>
      <el-form ref="createFormRef" :model="createForm" :rules="createRules" label-width="110px">
        <el-form-item label="中文名" prop="cnName">
          <el-input v-model="createForm.cnName" placeholder="如：中国大陆" maxlength="50" show-word-limit />
        </el-form-item>
        <el-form-item label="英文名" prop="enName">
          <el-input v-model="createForm.enName" placeholder="如：China" maxlength="50" show-word-limit />
        </el-form-item>
        <el-form-item label="国家码" prop="code">
          <el-input v-model="createForm.code" placeholder="如：CN" maxlength="8" show-word-limit />
        </el-form-item>
        <el-form-item label="区号" prop="dialCode">
          <el-input v-model="createForm.dialCode" placeholder="如：+86" maxlength="12" show-word-limit />
        </el-form-item>
        <el-form-item label="是否启用" prop="enabled">
          <el-switch v-model="createForm.enabled" />
        </el-form-item>
        <el-form-item label="号码规则" prop="phoneRule">
          <el-input v-model="createForm.phoneRule" placeholder="可选：手机号校验规则/正则" maxlength="200" show-word-limit />
        </el-form-item>
        <el-form-item label="排序" prop="sortOrder">
          <el-input-number v-model="createForm.sortOrder" :min="0" :max="999999" controls-position="right" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="createLoading" @click="submitCreate">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped lang="scss">
.mono-text {
  font-family: ui-monospace, sfmono-regular, menlo, monaco, consolas, "Liberation Mono", "Courier New", monospace;
}
</style>

