export { resetMockState, delay, getMockState } from './store'
export { mockWs } from './ws'
export * from './handlers/auth'
export * from './handlers/user'
export * from './handlers/contact'
export * from './handlers/chat'
export * from './handlers/group'

/** @deprecated 请使用 mock/store 与 mock/handlers */
export {
  SEED_USERS,
  DEMO_PASSWORD,
} from './seed/user'
