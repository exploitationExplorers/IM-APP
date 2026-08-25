<script setup lang="ts">
import ImConfirmDialog from '@/components/ImConfirmDialog.vue'
import { useImConfirmDialog } from '@/composables/useImConfirm'

const { state, onConfirm, onCancel } = useImConfirmDialog()
</script>

<template>
  <ImConfirmDialog
    :visible="state.visible"
    :title="state.title"
    :content="state.content"
    :cancel-text="state.cancelText"
    :confirm-text="state.confirmText"
    :show-cancel="state.showCancel"
    @confirm="onConfirm"
    @cancel="onCancel"
  />
</template>
