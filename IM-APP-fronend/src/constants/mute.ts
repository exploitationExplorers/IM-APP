/** 群禁言时长档位：聊天窗口长按菜单与群成员页共用；上限与后端 30 天（2592000s）一致 */
export const MUTE_OPTIONS = [
  { label: '10分钟', seconds: 10 * 60 },
  { label: '1小时', seconds: 60 * 60 },
  { label: '12小时', seconds: 12 * 60 * 60 },
  { label: '1天', seconds: 24 * 60 * 60 },
  { label: '7天', seconds: 7 * 24 * 60 * 60 },
  { label: '30天', seconds: 30 * 24 * 60 * 60 },
] as const
