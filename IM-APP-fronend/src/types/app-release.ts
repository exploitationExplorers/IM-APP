export type AppUpdateType = 'none' | 'wgt' | 'native'

export interface AppReleaseCheckResult {
  hasUpdate: boolean
  updateType: AppUpdateType
  versionName: string
  versionCode: number
  minNativeVersion: number
  downloadUrl: string
  changelog: string
  forceUpdate: boolean
}

export interface AppReleaseLocalVersion {
  platform: 'android' | 'ios'
  nativeVersion: number
  wgtVersion: number
  versionName: string
}
