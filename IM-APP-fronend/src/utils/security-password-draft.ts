export type SecurityPasswordMode = 'set' | 'change'

export interface SecurityPasswordDraft {
  mode: SecurityPasswordMode
  oldPassword?: string
}

let draft: SecurityPasswordDraft | null = null

export function setSecurityPasswordDraft(next: SecurityPasswordDraft) {
  draft = { ...next }
}

export function takeSecurityPasswordDraft(): SecurityPasswordDraft | null {
  const current = draft
  draft = null
  return current
}
