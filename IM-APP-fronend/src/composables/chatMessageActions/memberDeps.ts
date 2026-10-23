export type ConfirmFn = (
  content: string,
  confirmText?: string,
  cancelText?: string,
) => Promise<boolean>
