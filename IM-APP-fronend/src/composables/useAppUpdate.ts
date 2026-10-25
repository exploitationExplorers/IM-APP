// 使用条件编译移除整个分发实现，确保商店资源中不包含安装更新的代码。
// #ifdef APP-STORE
import * as storeUpdate from './useStoreUpdate'
// #endif
// #ifndef APP-STORE
import * as legacyUpdate from './useLegacyAppUpdate'
// #endif

let updater: typeof import('./useStoreUpdate')
// #ifdef APP-STORE
updater = storeUpdate
// #endif
// #ifndef APP-STORE
updater = legacyUpdate
// #endif

export const checkAndPromptAppUpdate = updater.checkAndPromptAppUpdate
export const readLocalAppVersion = updater.readLocalAppVersion
