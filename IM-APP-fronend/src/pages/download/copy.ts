export type DownloadLang = 'zh-cn' | 'zh-tw' | 'en-us' | 'vi-vn'

export interface DownloadCopy {
  enthusiastic: string
  analysis: string
  share1: string
  share2: string
  download: string
  openLite: string
  passion: string
  flight: string
  commentator: string
  story: string
  fans: string
  topics: string
  ai: string
  neverMiss: string
  title: string
  noPackage: string
  downloadFail: string
}

export const DOWNLOAD_LANGS: { code: DownloadLang; name: string }[] = [
  { code: 'zh-cn', name: '简体中文' },
  { code: 'zh-tw', name: '繁體中文' },
  { code: 'en-us', name: 'English' },
  { code: 'vi-vn', name: 'Tiếng Việt' },
]

export const DOWNLOAD_COPY: Record<DownloadLang, DownloadCopy> = {
  'zh-cn': {
    enthusiastic: '热情互动',
    analysis: '深度分析',
    share1: '共享体育动态的',
    share2: '社交平台APP',
    download: '立即下载',
    openLite: '开启聊天快捷版',
    passion: '一起分享体育激情',
    flight: '下载后开启飞机模式安装',
    commentator: '专业主播场边讲评',
    story: '为您深入解析动作背后的故事',
    fans: '与世界各地的体育爱好者联系',
    topics: '分享热爱运动的无尽话题',
    ai: '专属您的AI助手',
    neverMiss: '确保您永远不会错过任何比赛',
    title: '66聊天 - 共享体育动态的社交聊天APP',
    noPackage: '安装包暂未发布',
    downloadFail: '下载失败',
  },
  'zh-tw': {
    enthusiastic: '熱情互動',
    analysis: '深度分析',
    share1: '共享體育動態的',
    share2: '社群平台APP',
    download: '立即下載',
    openLite: '開啟聊天快捷版',
    passion: '一起分享體育激情',
    flight: '下載後開啟飛機模式安裝',
    commentator: '專業主播場邊講評',
    story: '為您深入解析動作背後的故事',
    fans: '與世界各地的運動愛好者聯繫',
    topics: '分享熱愛運動的無盡話題',
    ai: '專屬您的AI助手',
    neverMiss: '確保您永遠不會錯過任何比賽',
    title: '66聊天 - 共享體育動態的社交聊天APP',
    noPackage: '安裝包暫未發布',
    downloadFail: '下載失敗',
  },
  'en-us': {
    enthusiastic: 'Enthusiastic Interaction',
    analysis: 'In-depth Analysis',
    share1: 'Sports Updates Sharing App',
    share2: '',
    download: 'Download',
    openLite: '66Chat-Lite（Web)',
    passion: 'Share the passion together',
    flight: 'Turn on airplane mode to install',
    commentator: 'Professional commentator analysis',
    story: 'Provide in-depth action story analysis',
    fans: 'Connect with global sports fans',
    topics: 'Share endless sports topics',
    ai: 'Your own AI assistant',
    neverMiss: 'Make sure you never miss a game',
    title: '66 Chat App Official Website - 66 Chat App - 66 Download',
    noPackage: 'Install package is not published yet',
    downloadFail: 'Download failed',
  },
  'vi-vn': {
    enthusiastic: 'Tương tác nhiệt tình',
    analysis: 'Phân tích sâu',
    share1: 'Ứng dụng chia sẻ cập nhật thể thao',
    share2: '',
    download: 'Tải xuống',
    openLite: 'Kích hoạt phiên bản đơn giản',
    passion: 'Cùng nhau chia sẻ niềm đam mê thể thao',
    flight: 'Bật chế độ máy bay để cài đặt',
    commentator: 'Bình luận viên chuyên nghiệp bình luận trực tiếp.',
    story: 'Phân tích nguyên nhân hành động của bạn.',
    fans: 'Kết nối với người hâm mộ thể thao toàn cầu.',
    topics: 'Chia sẻ về đam mê thể thao liên tục.',
    ai: 'trở thành trợ lý AI của riêng bạn',
    neverMiss: 'Đảm bảo bạn không bao giờ bỏ lỡ bất kỳ trận đấu nào',
    title: 'Trang web chính thức của ứng dụng trò chuyện 66 - Ứng dụng trò chuyện 66 - Tải xuống 66',
    noPackage: 'Gói cài đặt chưa được phát hành',
    downloadFail: 'Tải xuống thất bại',
  },
}

const LANG_KEY = 'im_download_lang'

export function detectDownloadLang(): DownloadLang {
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(LANG_KEY)
      if (saved && saved in DOWNLOAD_COPY) return saved as DownloadLang
    }
  } catch {
    /* 隐私模式可能禁掉 localStorage */
  }
  if (typeof navigator === 'undefined') return 'zh-cn'
  const lang = navigator.language.toLowerCase()
  if (lang === 'zh-tw' || lang === 'zh-hk' || lang === 'zh-mo') return 'zh-tw'
  if (lang.startsWith('zh')) return 'zh-cn'
  if (lang.startsWith('vi')) return 'vi-vn'
  if (lang.startsWith('en')) return 'en-us'
  return 'zh-cn'
}

export function saveDownloadLang(lang: DownloadLang) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(LANG_KEY, lang)
  } catch {
    /* ignore */
  }
}
