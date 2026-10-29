<script lang="ts">
/** 模块级单例：同一时刻只允许一条语音在播，切到别的气泡先停掉前一条 */
let activeVoiceStopper: (() => void) | null = null

/** 跨气泡共享：原图尺寸缓存 + 测量限流，避免上滑时每条气泡各自打 getImageInfo */
const naturalSizeCache = new Map<string, { width: number; height: number }>()
const MEASURE_CONCURRENCY = 3
const measureQueue: Array<() => void> = []
let measureActive = 0

function pumpMeasureQueue() {
  while (measureActive < MEASURE_CONCURRENCY && measureQueue.length) {
    const job = measureQueue.shift()
    if (!job) return
    measureActive += 1
    job()
  }
}

/** App 进群时一屏图片一起下，手机会空很久。只放行最新的几张，下完再补后面的。 */
const IMAGE_LOAD_SLOTS = 3
let imageSlotsUsed = 0
type ImageLoadWaiter = { run: () => void; cancelled: boolean }
const imageLoadWaiters: ImageLoadWaiter[] = []
let imageLoadTimer: ReturnType<typeof setTimeout> | null = null

function scheduleImageLoads() {
  if (imageLoadTimer != null) return
  imageLoadTimer = setTimeout(() => {
    imageLoadTimer = null
    pumpImageLoads()
  }, 0)
}

function pumpImageLoads() {
  while (imageSlotsUsed < IMAGE_LOAD_SLOTS && imageLoadWaiters.length) {
    const waiter = imageLoadWaiters.pop()
    if (!waiter || waiter.cancelled) continue
    imageSlotsUsed += 1
    waiter.run()
  }
}

function acquireImageLoad(run: () => void): () => void {
  const waiter: ImageLoadWaiter = { run, cancelled: false }
  imageLoadWaiters.push(waiter)
  scheduleImageLoads()
  return () => {
    waiter.cancelled = true
  }
}

function releaseImageLoad() {
  imageSlotsUsed = Math.max(0, imageSlotsUsed - 1)
  scheduleImageLoads()
}
</script>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { APP_CONFIG } from '@/config'
import type {
  CardPayload,
  ChatMessage,
  GroupInvitePayload,
  GroupJoinRequestPayload,
  GroupRole,
  MessageQuote,
} from '@/types'
import { parseVideoMeta, formatVideoDuration, isRemoteMediaUrl, isUsableVideoPoster, looksLikeLocalFilePath, parseFileContent, openChatFile, playableMediaUrl, ensurePlayableAudioPath, previewImagesWithSave, toAbsFileUrl, avatarThumbnailUrl } from '@/utils/chatMedia'
import { forgetMediaCache, peekMediaCache, requestMediaCache } from '@/utils/mediaCache'
import { cacheableChatMediaUrl } from '@/utils/mediaCacheIdentity'
import { isAppPlatform } from '@/utils/platform'
import { useAvatarThumbnail } from '@/composables/useAvatarThumbnail'
import { formatMeridiemClock, looksLikeImageUrl, quoteSummaryOf, splitTextWithLinks } from '@/utils/format'
import { soundMetaOf } from '@/utils/openim'
import { parseGroupJoinRequestPayload } from '@/utils/groupJoinRequest'

const props = defineProps<{
  message: ChatMessage
  mine: boolean
  avatar: string
  fallbackAvatar?: string
  nickname?: string
  /** 群聊身份：群主/管理员在昵称旁挂头衔徽章；私聊与普通成员传 member 即不显示 */
  role?: GroupRole
  /** 本会话全部图片消息的地址：预览时可左右滑动切换，缺省只预览本条 */
  previewUrls?: string[]
  /** 已读回执：私聊=对方已读，群聊=至少一名其他成员已读；两者共用单双勾样式。 */
  readState?: 'read' | 'unread'
  /** 选择文字模式：关掉气泡长按菜单，交给系统选区局部复制 */
  textSelecting?: boolean
  /** 多选转发中：点图片应切换勾选，禁止进全屏预览（否则预览一关选择态就丢） */
  selecting?: boolean
}>()

/** 头像按缩略图、原图、默认头像三级回退，避免死链长期显示灰色占位。 */
const isH5 = uni.getSystemInfoSync().uniPlatform === 'web'
const defaultAvatar = props.fallbackAvatar || APP_CONFIG.defaultAvatarUrl
const { src: avatarSrc, onError: onAvatarError } = useAvatarThumbnail(
  () => {
    const sanitized = sanitizeDisplayUrl(props.avatar)
    return sanitized || props.fallbackAvatar || props.avatar
  },
  defaultAvatar,
)

function sanitizeDisplayUrl(url: string): string {
  const t = (url || '').trim()
  if (!t) return ''
  if (isRemoteMediaUrl(t) || t.startsWith('blob:') || t.startsWith('/static/')) return playableMediaUrl(t)
  // H5 浏览器无法加载 App 本地路径
  if (isH5 && looksLikeLocalFilePath(t)) return ''
  return t
}

const showNickname = computed(() => !props.mine && !!props.nickname)

/** 头衔徽章文案：与群成员列表同一套说法（群主 / 管理员），普通成员不显示 */
const roleBadgeText = computed(() => (props.role === 'owner' ? '群主' : props.role === 'admin' ? '管理员' : ''))

/** 昵称行：有昵称或自己带头衔时才占位；自己的消息微信式不显示昵称，只在带了头衔时露出徽章 */
const showNameRow = computed(() => showNickname.value || !!roleBadgeText.value)

const emit = defineEmits<{
  avatarClick: []
  avatarLongpress: []
  longpress: [event?: Event]
  cardView: [card: CardPayload]
  groupInviteApply: [invite: GroupInvitePayload]
  groupJoinRequestOpen: [request: GroupJoinRequestPayload]
  retry: [message: ChatMessage]
  playVideo: [message: ChatMessage]
  /** 点图片预览：由父级按需拼会话图片列表，避免每条气泡都绑 previewUrls */
  previewImage: [message: ChatMessage]
  /** 多选态点击媒体：外层 toggleSelect（uni-app 子节点 click 常不冒泡） */
  selectClick: []
  /** 点击引用块：跳转到被引用的原消息 */
  quoteClick: [clientMsgId: string]
}>()

function onQuoteClick() {
  const id = (props.message.quote?.clientMsgId || '').trim()
  if (!id) {
    uni.showToast({ title: '无法定位原消息', icon: 'none' })
    return
  }
  emit('quoteClick', id)
}

function copyNickname() {
  const name = (props.nickname || '').trim()
  if (!name) return
  uni.setClipboardData({
    data: name,
    success: () => uni.showToast({ title: '已复制昵称', icon: 'none' }),
  })
}

/** 长按头像后短时间内吞掉 click，避免又跳进资料页 */
let avatarLongpressLockUntil = 0

function onAvatarClick() {
  if (props.mine) return
  if (Date.now() < avatarLongpressLockUntil) return
  emit('avatarClick')
}

function onAvatarLongPress() {
  if (props.mine) return
  avatarLongpressLockUntil = Date.now() + 400
  emit('avatarLongpress')
}

/** 名片消息 content 为 JSON；解析失败时兜底成空名片，不影响其它类型渲染 */
const cardMeta = computed<CardPayload | null>(() => {
  if (props.message.type !== 'card') return null
  try {
    const parsed = JSON.parse(props.message.content) as Partial<CardPayload>
    return {
      userId: parsed.userId || '',
      nickname: parsed.nickname || '',
      avatar: parsed.avatar || '',
    }
  } catch {
    return { userId: '', nickname: '', avatar: '' }
  }
})

function onViewCard() {
  if (cardMeta.value) emit('cardView', cardMeta.value)
}

/** 入群邀请卡片 content */
const groupInviteMeta = computed<GroupInvitePayload | null>(() => {
  if (props.message.type !== 'groupInvite') return null
  try {
    const parsed = JSON.parse(props.message.content) as Partial<GroupInvitePayload>
    if (!parsed.token || !parsed.groupId) return null
    return {
      token: parsed.token,
      groupId: parsed.groupId,
      groupName: parsed.groupName || '群聊',
      groupAvatar: parsed.groupAvatar || '',
      memberCount: Number(parsed.memberCount) || 0,
    }
  } catch {
    return null
  }
})

const groupInviteTitle = computed(() => {
  const m = groupInviteMeta.value
  if (!m) return '群聊'
  const name = m.groupName || '群聊'
  return m.memberCount > 0 ? `${name} (${m.memberCount})` : name
})

/** H5 不能加载 App 本地路径；无远程头像时用默认群头像 */
const groupInviteAvatar = computed(() => {
  const url = (groupInviteMeta.value?.groupAvatar || '').trim()
  if (isRemoteMediaUrl(url)) return avatarThumbnailUrl(url)
  return APP_CONFIG.defaultGroupAvatarUrl
})
const cardAvatar = computed(() => avatarThumbnailUrl(cardMeta.value?.avatar || APP_CONFIG.defaultAvatarUrl))

function onApplyGroupInvite() {
  if (groupInviteMeta.value) emit('groupInviteApply', groupInviteMeta.value)
}

const groupJoinRequestMeta = computed<GroupJoinRequestPayload | null>(() => {
  if (props.message.type !== 'groupJoinRequest') return null
  return parseGroupJoinRequestPayload(props.message.content)
})

const groupJoinRequestAvatar = computed(() => {
  const url = (groupJoinRequestMeta.value?.applicantAvatar || '').trim()
  if (isRemoteMediaUrl(url)) return avatarThumbnailUrl(url)
  return APP_CONFIG.defaultAvatarUrl
})

function onOpenGroupJoinRequest() {
  if (groupJoinRequestMeta.value) emit('groupJoinRequestOpen', groupJoinRequestMeta.value)
}

function onLongPress(event?: Event) {
  if (props.textSelecting) return
  emit('longpress', event)
}

/** 发送失败：点击感叹号触发重发 */
function onRetry() {
  emit('retry', props.message)
}

/**
 * 点按图片：多选只通知外层勾选；缩略图未画出前拦截预览（避免点开空白/无效图）。
 */
function onImageBubbleClick() {
  if (props.selecting) {
    emit('selectClick')
    return
  }
  if (props.message.type !== 'image') return
  if (!canOpenImagePreview.value) return
  if (props.previewUrls?.length) {
    const urls = props.previewUrls.map((url) => toPlayableMediaUrl((url || '').trim())).filter(Boolean)
    const shown = imageDisplaySrc.value || toPlayableMediaUrl(props.message.content || '')
    const current = urls.includes(shown) ? shown : urls[0] || shown
    if (!current || !urls.length) return
    void previewImagesWithSave(urls, current)
    return
  }
  emit('previewImage', props.message)
}

/** 多选时点视频 = 勾选，不进播放 */
function onVideoClick() {
  if (props.selecting) {
    emit('selectClick')
    return
  }
  playVideo()
}

const videoMeta = computed(() => {
  if (props.message.type !== 'video') return { url: '', snapshotUrl: '', duration: 0 }
  return parseVideoMeta(props.message.content)
})

const videoPosterFailed = ref(false)
const fallbackPoster = ref('')

const videoUrl = computed(() => toPlayableMediaUrl(videoMeta.value.url))

const videoPoster = computed(() => {
  if (videoPosterFailed.value) return fallbackPoster.value
  const snap = videoMeta.value.snapshotUrl
  // 远程封面可直接展示；发送中本机截图也可展示。历史里的本地 snapshotPath 是死链，交给截帧兜底。
  if (isRemoteMediaUrl(snap) || snap.startsWith('blob:')) return toPlayableMediaUrl(snap)
  if (props.message.status === 'sending' && isUsableVideoPoster(snap)) return toPlayableMediaUrl(snap)
  return fallbackPoster.value
})

const videoDurationLabel = computed(() => {
  const d = videoMeta.value.duration
  return d > 0 ? formatVideoDuration(d) : ''
})

watch(
  () => videoMeta.value.snapshotUrl,
  () => {
    videoPosterFailed.value = false
  },
)

watch(
  [() => videoMeta.value.snapshotUrl, videoUrl, () => props.message.status],
  ([snapshot, url, status]) => {
    fallbackPoster.value = ''
    // 列表里禁止批量截帧：历史视频无封面时并发拉流会卡死上滑。
    // 发送中本机封面、远程 snapshot 照常展示；其余用占位，点播放再进详情页。
    if (!url) return
    if (isRemoteMediaUrl(snapshot) || snapshot.startsWith('blob:')) return
    if (status === 'sending' && isUsableVideoPoster(snapshot)) {
      fallbackPoster.value = toPlayableMediaUrl(snapshot)
    }
  },
  { immediate: true },
)

function onVideoPosterError() {
  if (cachedVideoSrc.value) {
    forgetMediaCache(videoPoster.value)
    cachedVideoSrc.value = ''
    return
  }
  videoPosterFailed.value = true
  // 不在列表里为失败封面拉整段视频截帧，避免滚动时打爆网络/主线程
}

function playVideo() {
  const url = videoUrl.value
  if (!url) {
    const sending = props.message.status === 'sending'
    uni.showToast({ title: sending ? '视频发送中' : '视频无法播放', icon: 'none' })
    return
  }
  emit('playVideo', props.message)
}

function onContextMenu(event: Event) {
  if (props.textSelecting) return
  event.preventDefault()
  emit('longpress', event)
}

/** 引用摘要展示：历史消息若误存了 URL/本地路径，这里再收敛成「图片」等 */
function quoteTextOf(quote: MessageQuote): string {
  return quoteSummaryOf('text', quote.content)
}

/** 引用左侧图：优先媒体地址；H5 过滤 App 本地路径 */
function quoteThumbSrc(quote: MessageQuote): string {
  const candidates = [
    quote.thumbUrl && looksLikeImageUrl(quote.thumbUrl) ? quote.thumbUrl : '',
    looksLikeImageUrl(quote.content) ? quote.content : '',
    (quote.content === '图片' || quote.content === '视频') && quote.thumbUrl ? quote.thumbUrl : '',
    quote.thumbUrl || '',
  ]
  for (const raw of candidates) {
    const t = (raw || '').trim()
    if (!t) continue
    if (isRemoteMediaUrl(t) || t.startsWith('blob:') || t.startsWith('/static/')) return t
    if (isH5 && looksLikeLocalFilePath(t)) continue
    if (!isH5) return t
  }
  return APP_CONFIG.defaultAvatarUrl
}

const parts = computed(() =>
  props.message.type === 'text' ? splitTextWithLinks(props.message.content) : [],
)

const voiceMeta = computed(() => {
  if (props.message.type !== 'voice') return null
  // 复用 openim.ts 的 soundMetaOf：OpenIM 发送后 content 是 SDK 原始结构
  //（{ uuid, soundPath, sourceUrl, duration, soundType }），远程地址在 sourceUrl；
  // 旧逻辑只取 content.path 取不到自己发的语音地址 → 播放失败。
  const meta = soundMetaOf(props.message as unknown as Record<string, unknown>)
  return { path: meta.path || '', duration: Number(meta.duration || 0) }
})

/** 占位阶段 content 是文件名；发送成功后是 { url, fileName }，旧消息只有 URL。 */
const fileName = computed(() => {
  if (props.message.type !== 'file') return ''
  return parseFileContent(props.message.content).fileName || '文件'
})

function openFile() {
  if (props.message.type !== 'file') return
  void openChatFile(props.message.content)
}

const timeText = computed(() => formatMeridiemClock(props.message.createdAt))

/** 时长格式对齐设计稿：12'' / 1'12''（微信式） */
function formatVoiceDuration(seconds: number) {
  const total = Math.max(0, Math.ceil(seconds))
  if (total < 60) return `${total}''`
  return `${Math.floor(total / 60)}'${String(total % 60).padStart(2, '0')}''`
}

/** 静态波形柱高：按消息 id 稳定取一组，同一条消息不随渲染跳动；中段（最高峰附近）多排 5 根高柱 */
const WAVE_PATTERNS = [
  [12, 24, 32, 20, 14, 28, 34, 34, 33, 32, 31, 30, 22, 16, 26, 18, 12],
  [20, 14, 28, 34, 33, 32, 31, 30, 29, 18, 12, 26, 30, 16, 22, 28, 14],
  [14, 22, 16, 30, 32, 33, 32, 31, 30, 29, 26, 12, 20, 32, 24, 14, 18],
]

const waveBars = computed(() => {
  const id = props.message.id || ''
  let sum = 0
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i)
  return WAVE_PATTERNS[sum % WAVE_PATTERNS.length]
})

/** 气泡宽度随时长伸缩：260rpx 起步（12 根柱的最小排布），每秒 +6rpx，封顶 440rpx */
const voiceBubbleStyle = computed(() => {
  const seconds = Math.max(1, Math.ceil(voiceMeta.value?.duration || 1))
  const width = Math.min(260 + seconds * 6, 440)
  return { width: `${width}rpx` }
})

const playing = ref(false)
/** 已播放进度：波柱按比例分成已播（高亮）/未播两段颜色 */
const playedBars = ref(0)
let stopVoiceFn: (() => void) | null = null
/** H5 语音播放器：整个页面共用一个 <audio>，切歌时 pause+重置，避免 iOS 上多实例/异步起播导致无声 */
let h5VoiceAudio: HTMLAudioElement | null = null
/** 进度轮询兜底：个别平台 onTimeUpdate 不回调，保证进度一定推进 */
let progressTimer: ReturnType<typeof setInterval> | null = null

function clearProgressTimer() {
  if (progressTimer) {
    clearInterval(progressTimer)
    progressTimer = null
  }
}

/** 进度换算：total 非法（NaN/Infinity/0）时退回消息自带时长，避免永远算出 0 */
function syncPlayedProgress(current: number, totalRaw: number) {
  const fallback = voiceMeta.value?.duration || 0
  const total = Number.isFinite(totalRaw) && totalRaw > 0 ? totalRaw : fallback
  if (!total) return
  const ratio = Math.min(1, Math.max(0, current / total))
  playedBars.value = Math.round(ratio * waveBars.value.length)
}

/** 下载语音期间再次点击 / 切到别的气泡时作废上一次准备，避免叠出两个播放器 */
let voicePlayToken = 0

function stopVoice() {
  voicePlayToken += 1
  stopVoiceFn?.()
  stopVoiceFn = null
  playing.value = false
  playedBars.value = 0
  clearProgressTimer()
}

type InnerAudio = {
  src: string
  volume?: number
  sessionCategory?: string
  obeyMuteSwitch?: boolean
  currentTime: number
  duration: number
  play: () => void
  stop: () => void
  destroy: () => void
  onEnded: (cb: () => void) => void
  onError: (cb: (e?: { errMsg?: string; errCode?: number }) => void) => void
  onStop: (cb: () => void) => void
  onPlay?: (cb: () => void) => void
  onTimeUpdate: (cb: () => void) => void
}

function createVoiceInnerAudio(): InnerAudio | null {
  const factory = (
    uni as unknown as { createInnerAudioContext?: () => InnerAudio }
  ).createInnerAudioContext
  if (typeof factory !== 'function') return null
  const inner = factory()
  try {
    // iOS 侧边静音键下也要出声
    inner.sessionCategory = 'playback'
  } catch {
    /* 旧基座无此属性 */
  }
  try {
    inner.obeyMuteSwitch = false
  } catch {
    /* Android 部分基座只读 */
  }
  try {
    inner.volume = 1
  } catch {
    /* ignore */
  }
  return inner
}

/**
 * 语音候选播放地址：不同 uni 基座对「绝对 file://」与「相对 _doc/...」的支持不一致（iOS 尤其明显，
 * 有的基座缺 convertLocalFileSystemURL，有的只认相对路径），单一形态很容易直接判死。
 * 逐个尝试直到真正出声，能显著提升一次点播成功率。
 */
function buildVoiceSrcCandidates(primary: string, raw: string): string[] {
  const list: string[] = []
  const push = (v?: string) => {
    const s = (v || '').trim()
    if (s && !list.includes(s)) list.push(s)
  }
  // primary 与 raw 都要展开：primary 常是下载后的本地相对路径，raw 常是远程 URL，
  // 只展开其中一个会漏掉真正可用的形态（iOS 曾因此少掉绝对 file:// 候选）。
  const expand = (v?: string) => {
    const s = (v || '').trim()
    if (!s) return
    push(s)
    if (/^_[a-z]+\//i.test(s)) {
      push(toAbsFileUrl(s))
      push(toPlayableMediaUrl(s))
    }
    if (s.startsWith('/') && !s.startsWith('//')) push(`file://${s}`)
    // 部分 iOS 基座对 file:// URL 解析有偏差，纯 POSIX 绝对路径有时反而能打开
    if (s.startsWith('file://')) push(s.slice('file://'.length))
  }
  expand(primary)
  expand(raw)
  return list
}

/**
 * 点按播放：再点一次停止；切到别的语音气泡时前一条自动停。
 * H5：页面级 <audio> 在点击手势内同步起播——iOS 自动播放策略要求 play() 必须发生在手势里，
 *     且 uni 的 H5 InnerAudio 忽略 autoplay，走它必然「波形在动却没声」。
 * App：远程语音先落地并按文件头补真实后缀，再交给 InnerAudio 同步 play()。
 */
async function playVoice() {
  const rawPath = voiceMeta.value?.path || ''
  if (!rawPath) {
    uni.showToast({ title: '语音地址无效', icon: 'none' })
    return
  }
  if (playing.value) {
    stopVoice()
    return
  }
  activeVoiceStopper?.()
  activeVoiceStopper = stopVoice
  const token = ++voicePlayToken

  // H5：同步起播，保住 iOS 用户手势；ensurePlayableAudioPath 在 H5 仅是地址归一化，无需 await
  if (isH5) {
    playVoiceH5(toPlayableMediaUrl(rawPath))
    return
  }

  let src = ''
  try {
    src = await ensurePlayableAudioPath(rawPath)
  } catch (e) {
    const reason = (e as Error)?.message || ''
    if (reason.includes('iOS')) {
      if (token === voicePlayToken) uni.showToast({ title: reason, icon: 'none' })
      return
    }
    src = toPlayableMediaUrl(rawPath)
  }
  if (token !== voicePlayToken) return
  if (!src) {
    uni.showToast({ title: '语音地址无效', icon: 'none' })
    return
  }

  const inner = createVoiceInnerAudio()
  if (inner) {
    const candidates = buildVoiceSrcCandidates(src, rawPath)
    let attempt = 0
    // 「出过声」只认播放进度：onPlay 在解码失败时也会先回调。
    // onStop 只有真出过声才复位：iOS 切换 src 时会补发一次 stop，误判会把气泡搞成「一点就停」。
    let closed = false
    let started = false
    let progressed = false
    const markProgress = () => {
      if (inner.currentTime > 0) progressed = true
    }
    const release = () => {
      closed = true
      try {
        inner.stop()
        inner.destroy()
      } catch {
        /* 已释放 */
      }
    }
    const finish = (failed: boolean) => {
      if (closed) return
      release()
      if (activeVoiceStopper === stopVoice) activeVoiceStopper = null
      stopVoiceFn = null
      playing.value = false
      playedBars.value = 0
      clearProgressTimer()
      if (failed) uni.showToast({ title: '语音播放失败', icon: 'none' })
    }
    const tryPlusAudioFallback = () => {
      // InnerAudio 候选全失败时，再用原生 plus.audio 搏一次（部分 iOS 基座更稳）
      try {
        const createPlayer = (
          plus as { audio?: { createPlayer?: (url: string) => { play: (ok?: () => void, err?: () => void) => void; stop: () => void; close?: () => void } } } | undefined
        )?.audio?.createPlayer
        if (typeof createPlayer !== 'function') {
          finish(true)
          return
        }
        const player = createPlayer(candidates[0] || src)
        const releasePlus = () => {
          try {
            player.stop()
            player.close?.()
          } catch {
            /* ignore */
          }
        }
        stopVoiceFn = () => {
          releasePlus()
          release()
        }
        player.play(
          () => {
            started = true
            progressed = true
          },
          () => finish(true),
        )
        progressTimer = setInterval(() => {
          if (closed) return
          // plus.audio 无统一 timeupdate，能起播即视为成功，靠 onEnded 复位由用户再点停
        }, 1000)
        setTimeout(() => {
          if (!closed && !progressed) finish(true)
        }, 8000)
      } catch {
        finish(true)
      }
    }
    const nextAttempt = () => {
      clearProgressTimer()
      if (closed) return
      if (attempt + 1 >= candidates.length) {
        tryPlusAudioFallback()
        return
      }
      attempt += 1
      try {
        inner.stop()
      } catch {
        /* ignore */
      }
      startPlayback()
    }
    const startPlayback = () => {
      const target = candidates[attempt]
      if (!target) {
        finish(true)
        return
      }
      started = false
      progressed = false
      inner.src = target
      // 必须在点击手势内同步 play()：uni 的 InnerAudio 忽略 autoplay 属性，600ms 后才 play 已脱离手势，
      // iOS 自动播放策略直接拦截 → App 侧落进 onError 报「语音播放失败」。
      try {
        inner.play()
      } catch {
        nextAttempt()
        return
      }
      // 兜底轮询：个别平台 onTimeUpdate 不回调；8s 仍无任何进度视为该地址不可用，换下一个候选
      const startedAt = Date.now()
      progressTimer = setInterval(() => {
        if (closed) return
        markProgress()
        syncPlayedProgress(inner.currentTime, inner.duration)
        if (!started && !progressed && Date.now() - startedAt > 8000) nextAttempt()
      }, 300)
    }
    inner.onPlay?.(() => {
      started = true
    })
    inner.onEnded(() => {
      markProgress()
      finish(!progressed && !started)
    })
    inner.onError(() => {
      markProgress()
      // 出过声就正常结束；否则该候选地址不可用，换下一个再试
      if (progressed) finish(false)
      else nextAttempt()
    })
    inner.onStop(() => {
      // iOS 在切换 src / 起播瞬间会补发一次 stop，不是用户停止；只有真出过声（有进度）才复位
      if (progressed) finish(false)
    })
    inner.onTimeUpdate(() => {
      markProgress()
      syncPlayedProgress(inner.currentTime, inner.duration)
    })
    playing.value = true
    stopVoiceFn = release
    activeVoiceStopper = stopVoice
    startPlayback()
    return
  }
  // createInnerAudioContext 不可用的异形平台兜底：退回页面级 <audio>
  if (typeof Audio !== 'undefined') {
    playVoiceH5(src)
  }
}

/**
 * H5 语音播放：复用同一个 <audio>，在点击手势内同步起播。
 * 关键点：
 * - uni 的 H5 InnerAudio 忽略 autoplay 属性，且 600ms 延时 play 会脱离手势 → iOS 静默无声；
 * - 切歌先 pause + currentTime = 0，避免多条同时响；
 * - play() 被浏览器拦截或解码失败时复位气泡并提示，不留「波形在动却没声」的静默态。
 */
function playVoiceH5(src: string) {
  if (!src) {
    uni.showToast({ title: '语音地址无效', icon: 'none' })
    return
  }
  if (!h5VoiceAudio) {
    h5VoiceAudio = new Audio()
    h5VoiceAudio.preload = 'auto'
  }
  const audio = h5VoiceAudio
  // 切歌：先停掉上一条，避免两条同时响
  try {
    audio.pause()
    audio.currentTime = 0
  } catch {
    /* ignore */
  }
  const resetBubble = () => {
    if (activeVoiceStopper === stopVoice) activeVoiceStopper = null
    stopVoiceFn = null
    playing.value = false
    playedBars.value = 0
    clearProgressTimer()
  }
  audio.onended = () => resetBubble()
  audio.ontimeupdate = () => syncPlayedProgress(audio.currentTime, audio.duration)
  audio.onerror = () => {
    resetBubble()
    uni.showToast({ title: '语音播放失败', icon: 'none' })
  }
  playing.value = true
  stopVoiceFn = () => {
    try {
      audio.pause()
      audio.currentTime = 0
    } catch {
      /* ignore */
    }
  }
  activeVoiceStopper = stopVoice
  try {
    audio.src = src
    // 手势内同步起播：await / setTimeout 之后的 play 会被 iOS 自动播放策略拦截
    const p = audio.play()
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        resetBubble()
        uni.showToast({ title: '语音播放失败', icon: 'none' })
      })
    }
  } catch {
    resetBubble()
    uni.showToast({ title: '语音播放失败', icon: 'none' })
  }
}

onUnmounted(() => {
  if (activeVoiceStopper === stopVoice) activeVoiceStopper = null
  stopVoice()
  imageDisposed = true
  cancelImageWait()
  finishImageSlot()
})

/** H5 的聊天 OSS 稳定入口是同源相对地址，必须允许直接交给浏览器加载。 */
function isDisplayableChatImageUrl(value: string): boolean {
  const url = value.trim()
  if (!url) return false
  if (isRemoteMediaUrl(url)) return true
  return (
    isH5 &&
    (url.startsWith('/object/') ||
      url.startsWith('/api/v1/public/oss-media?'))
  )
}

/** 归一化媒体地址：网络/blob 原样；H5 聊天入口保留同源相对地址；App 本地路径转 file://。 */
function toPlayableMediaUrl(path: string): string {
  if (!path) return ''
  if (isDisplayableChatImageUrl(path)) {
    return isRemoteMediaUrl(path) ? playableMediaUrl(path) : path
  }
  if (isH5) {
    // 浏览器禁止加载 file:// 与设备本地路径，返回空避免控制台报错
    return ''
  }
  if (path.startsWith('file://')) return path
  try {
    const converted = plus?.io?.convertLocalFileSystemURL?.(path)
    if (converted) return converted.startsWith('file://') ? converted : `file://${converted}`
  } catch {
    /* ignore */
  }
  return path.startsWith('/') ? `file://${path}` : path
}

/**
 * 图片气泡的候选地址。先缩略图，再缩略图兼容候选，加载失败才降级。
 * H5 也允许聊天 OSS 的同源相对入口；App 在没有远程地址时退回本地路径。
 */
const imageSrcCandidates = computed(() => {
  if (props.message.type !== 'image') return []
  const list: string[] = []
  const push = (value: string) => {
    const url = value.trim()
    if (!isDisplayableChatImageUrl(url)) return
    if (!list.includes(url)) list.push(url)
  }
  push(props.message.thumbUrl || '')
  push(props.message.content || '')
  for (const url of props.message.imageFallbacks || []) push(url)
  if (list.length) return list
  const raw = (props.message.content || '').trim()
  return !isH5 && raw ? [raw] : []
})

/**
 * 原图对象缺失或上传失败时，<image> 只会留一个空白框。
 * 这里记下降级到第几个候选，加载失败就顺次重试缩略图等备用地址。
 */
const imageFallbackIndex = ref(0)
const cachedImageSrc = ref('')
const cachedVideoSrc = ref('')
const holdImageForCache = ref(false)
const holdVideoForCache = ref(false)
let imageCacheToken = 0
let videoCacheToken = 0

watch(imageSrcCandidates, () => {
  imageFallbackIndex.value = 0
})

/**
 * 缓存在下载时先不给 <image> 远程地址，否则同一张图下两遍（WebView 一遍、缓存一遍），
 * 而且 /object/ 每次 302 到新签名地址，WebView 那一遍永远进不了 HTTP 缓存。
 * 缓存下载失败（late 且 path 为空）才退回远程地址。
 */
function bindCachedMedia(
  remote: string,
  token: number,
  current: () => number,
  apply: (path: string, hold: boolean, late: boolean) => void,
) {
  if (!isDisplayableChatImageUrl(remote)) {
    apply('', false, false)
    return
  }
  // H5 聊天入口是相对路径，但 302 后的签名地址不稳定，必须转成同源绝对地址进 IndexedDB。
  const cacheUrl = cacheableChatMediaUrl(remote)
  if (!cacheUrl || !/^https?:\/\//i.test(cacheUrl)) {
    apply(remote, false, false)
    return
  }
  const hit = peekMediaCache(cacheUrl)
  if (hit) {
    apply(hit, false, false)
    return
  }
  let settled = false
  const pending = requestMediaCache(cacheUrl, (path) => {
    settled = true
    if (current() === token) apply(path, false, true)
  })
  if (!settled) apply('', pending, false)
}

/** 图片气泡展示地址：H5 支持远程和聊天 OSS 同源相对入口 */
const imageDisplaySrc = computed(() => {
  const list = imageSrcCandidates.value
  const raw = list[imageFallbackIndex.value] || list[0] || ''
  return raw ? toPlayableMediaUrl(raw) : ''
})

/** App 上先占位，轮到这条再给 src，避免进群时几十张大图一起挤占网络 */
const imageSrcReady = ref(!isAppPlatform())
let imageSlotHeld = false
let cancelImageWait = () => {}
let imageSlotTimer: ReturnType<typeof setTimeout> | null = null
let imageDisposed = false

function finishImageSlot() {
  if (imageSlotTimer) {
    clearTimeout(imageSlotTimer)
    imageSlotTimer = null
  }
  if (!imageSlotHeld) return
  imageSlotHeld = false
  releaseImageLoad()
}

function beginImageLoad() {
  if (imageSrcReady.value || imageSlotHeld || imageDisposed || holdImageForCache.value) return
  if (cachedImageSrc.value) {
    imageSrcReady.value = true
    return
  }
  const src = imageDisplaySrc.value
  if (!src || !isDisplayableChatImageUrl(src) || !isAppPlatform()) {
    imageSrcReady.value = true
    return
  }
  cancelImageWait = acquireImageLoad(() => {
    if (imageDisposed) {
      releaseImageLoad()
      return
    }
    imageSlotHeld = true
    imageSrcReady.value = true
    imageSlotTimer = setTimeout(() => finishImageSlot(), 12000)
  })
}

const shownImageSrc = computed(() => {
  if (cachedImageSrc.value) return cachedImageSrc.value
  if (!imageSrcReady.value && isDisplayableChatImageUrl(imageDisplaySrc.value)) return ''
  return holdImageForCache.value ? '' : imageDisplaySrc.value
})

/** 缩略图是否已真正画出；未画出前转圈并禁止点开预览 */
const imagePainted = ref(false)
const imageLoadFailed = ref(false)
const imageBubbleLoading = computed(
  () => props.message.type === 'image' && !imagePainted.value && !imageLoadFailed.value,
)
const canOpenImagePreview = computed(
  () => imageLoadFailed.value || (!!shownImageSrc.value && imagePainted.value),
)

const shownVideoPoster = computed(() => {
  if (cachedVideoSrc.value) return cachedVideoSrc.value
  return holdVideoForCache.value ? '' : videoPoster.value
})

watch(
  imageDisplaySrc,
  (src) => {
    const token = ++imageCacheToken
    bindCachedMedia(src, token, () => imageCacheToken, (path, hold, late) => {
      cachedImageSrc.value = path
      holdImageForCache.value = hold
      if (late && !path) beginImageLoad()
    })
  },
  { immediate: true },
)

watch(imageDisplaySrc, () => beginImageLoad(), { immediate: true })

watch(shownImageSrc, () => {
  imagePainted.value = false
  imageLoadFailed.value = false
})

watch(
  videoPoster,
  (src) => {
    const token = ++videoCacheToken
    bindCachedMedia(src, token, () => videoCacheToken, (path, hold) => {
      cachedVideoSrc.value = path
      holdVideoForCache.value = hold
    })
  },
  { immediate: true },
)

function onImageLoad(event: unknown) {
  finishImageSlot()
  if (props.message.type === 'image') {
    imagePainted.value = true
    imageLoadFailed.value = false
  }
  if (knownMediaSize() || naturalSize.value) return
  const detail = (event as { detail?: { width?: number; height?: number } } | undefined)?.detail
  const width = Number(detail?.width) || 0
  const height = Number(detail?.height) || 0
  if (!width || !height) return
  const size = { width, height }
  const src = mediaSrc.value
  if (src) {
    if (naturalSizeCache.size > 500) naturalSizeCache.clear()
    naturalSizeCache.set(src, size)
  }
  naturalSize.value = size
  naturalSizeFailed.value = false
}

function onImageError() {
  if (cachedImageSrc.value) {
    forgetMediaCache(imageDisplaySrc.value)
    cachedImageSrc.value = ''
    beginImageLoad()
    return
  }
  if (imageFallbackIndex.value + 1 < imageSrcCandidates.value.length) {
    imageFallbackIndex.value += 1
    return
  }
  imageLoadFailed.value = true
  imagePainted.value = false
  finishImageSlot()
}

/**
 * 图片 / 视频封面的展示尺寸。
 *
 * 盒子按原图比例缩进上限框。显示用 aspectFit（微信气泡同款）：
 * 比例对得上时铺满，对不上时留边，不会把像素拉变形。
 * 不要再用 scaleToFill，也不要在 CSS 里另写死 width / max-height，
 * 否则安卓、鸿蒙会只改一边，竖图被拉扁。
 */
const MEDIA_BOX = { width: 280, height: 360 }
/** 尺寸没量出来前的占位框（4:3，与图片占位一致） */
const MEDIA_BOX_FALLBACK = { width: 280, height: 210 }

/**
 * rpx → px。内联 :style 里的 rpx 在 H5 不保证被转换（静态 CSS 才会转），
 * 所以 JS 算出来的尺寸一律先转成 px 再绑，避免图片尺寸被浏览器当成非法值丢掉。
 */
function toPx(rpx: number): string {
  return `${uni.upx2px(rpx)}px`
}

const naturalSize = ref<{ width: number; height: number } | null>(null)
/** 量尺寸失败（图片本身还能显示）：展示退化成 contain，避免用错比例把图裁掉 */
const naturalSizeFailed = ref(false)

/** 当前气泡要展示的媒体：图片消息是本体，视频消息是封面 */
const mediaSrc = computed(() => {
  if (props.message.type === 'image') return shownImageSrc.value
  if (props.message.type === 'video') return shownVideoPoster.value
  return ''
})

function knownMediaSize(): { width: number; height: number } | null {
  const width = Number(props.message.width) || 0
  const height = Number(props.message.height) || 0
  if (width > 0 && height > 0) return { width, height }
  return null
}

/**
 * 量原图尺寸。消息里已经带了宽高就直接用，不再 getImageInfo。
 * App 对网络图的 getImageInfo 会先把整张图下载到临时目录，和 <image> 各下一次。
 */
function measureMediaSize(src: string) {
  const known = knownMediaSize()
  if (known) {
    naturalSize.value = known
    naturalSizeFailed.value = false
    return
  }
  naturalSizeFailed.value = false
  if (!src) {
    naturalSize.value = null
    return
  }
  const cached = naturalSizeCache.get(src)
  if (cached) {
    naturalSize.value = cached
    return
  }
  naturalSize.value = null
  // 网络图的尺寸等 @load。App 的 getImageInfo 会把整张图再下一次，进群会更慢。
  if (isDisplayableChatImageUrl(src)) return
  measureQueue.push(() => {
    uni.getImageInfo({
      src,
      success: (info) => {
        const width = Number(info.width) || 0
        const height = Number(info.height) || 0
        if (width && height) {
          if (naturalSizeCache.size > 500) naturalSizeCache.clear()
          const size = { width, height }
          naturalSizeCache.set(src, size)
          if (mediaSrc.value === src && !knownMediaSize()) naturalSize.value = size
        }
      },
      fail: () => {
        if (mediaSrc.value === src && !knownMediaSize()) naturalSizeFailed.value = true
      },
      complete: () => {
        measureActive -= 1
        pumpMeasureQueue()
      },
    })
  })
  pumpMeasureQueue()
}

watch(
  () => [mediaSrc.value, props.message.width, props.message.height] as const,
  ([src]) => measureMediaSize(src),
  { immediate: true },
)

/** 等比例缩进上限框后的展示尺寸（小图按旧行为放大到 280rpx 宽） */
const mediaBoxStyle = computed(() => {
  const size = naturalSize.value
  if (!size) {
    return { width: toPx(MEDIA_BOX_FALLBACK.width), height: toPx(MEDIA_BOX_FALLBACK.height) }
  }
  const scale = Math.min(MEDIA_BOX.width / size.width, MEDIA_BOX.height / size.height)
  return {
    width: toPx(Math.round(size.width * scale)),
    height: toPx(Math.round(size.height * scale)),
  }
})

/**
 * 始终等比。占位阶段还没有真实宽高时，aspectFill 只裁切占位框，不拉像素；
 * 量到尺寸后盒子已经是原图比例，aspectFit 铺满且不再变形。
 */
const mediaMode = computed(() => {
  if (naturalSize.value || naturalSizeFailed.value) return 'aspectFit'
  return 'aspectFill'
})

function openLink(url: string) {
  const href = url.startsWith('http') ? url : `https://${url}`
  // #ifdef H5
  window.open(href, '_blank')
  // #endif
  // #ifndef H5
  uni.setClipboardData({
    data: href,
    success: () => uni.showToast({ title: '链接已复制', icon: 'none' }),
  })
  // #endif
}
</script>

<template>
  <view
    class="row"
    :class="{ mine }"
  >
    <image
      v-if="!mine"
      class="avatar"
      :src="avatarSrc"
      mode="aspectFill"
      @click="onAvatarClick"
      @longpress.stop="onAvatarLongPress"
      @contextmenu.prevent="onAvatarLongPress"
      @error="onAvatarError"
    />
    <view class="content-wrap">
      <view
        v-if="showNameRow"
        class="name-row"
      >
        <text
          v-if="showNickname"
          class="nickname"
          selectable
          @longpress.stop="copyNickname"
        >
          {{ nickname }}
        </text>
        <text
          v-if="roleBadgeText"
          class="role-badge"
          :class="`role-${role}`"
        >
          {{ roleBadgeText }}
        </text>
      </view>
      <view class="bubble-line">
        <!-- 发送失败：红色感叹号显示在气泡前面，点击重发 -->
        <view
          v-if="mine && message.status === 'failed'"
          class="retry-flag"
          @click.stop="onRetry"
        >
          <text class="retry-icon">
            !
          </text>
        </view>
        <view
          v-if="message.type === 'image'"
          class="bubble image-bubble"
          @click="onImageBubbleClick"
          @longpress="onLongPress"
          @contextmenu.prevent="onContextMenu"
        >
          <image
            v-if="shownImageSrc"
            class="msg-image"
            :style="mediaBoxStyle"
            :src="shownImageSrc"
            :mode="mediaMode"
            @load="onImageLoad"
            @error="onImageError"
          />
          <view
            v-else
            class="msg-image image-placeholder"
            :style="mediaBoxStyle"
          />
          <view
            v-if="imageBubbleLoading"
            class="image-loading"
          >
            <view class="image-spinner" />
          </view>
        </view>
        <view
          v-else-if="message.type === 'video'"
          class="bubble image-bubble video-bubble"
          @click="onVideoClick"
          @longpress="onLongPress"
          @contextmenu.prevent="onContextMenu"
        >
          <image
            v-if="shownVideoPoster"
            class="msg-image"
            :style="mediaBoxStyle"
            :src="shownVideoPoster"
            :mode="mediaMode"
            @load="onImageLoad"
            @error="onVideoPosterError"
          />
          <view
            v-else
            class="msg-image video-poster-placeholder"
          />
          <view class="video-play">
            <text class="video-play-icon">
              ▶
            </text>
          </view>
          <text
            v-if="videoDurationLabel"
            class="video-duration"
          >
            {{ videoDurationLabel }}
          </text>
        </view>
        <view
          v-else-if="message.type === 'voice'"
          class="bubble voice-bubble"
          :class="[mine ? 'bubble-mine voice-mine' : 'bubble-other voice-other', { playing: playing }]"
          :style="voiceBubbleStyle"
          @click="playVoice"
          @longpress="onLongPress"
          @contextmenu.prevent="onContextMenu"
        >
          <view class="voice-inner">
            <view class="voice-play-icon" />
            <view class="voice-wave">
              <view
                v-for="(h, i) in waveBars"
                :key="i"
                class="voice-bar"
                :class="{ played: i < playedBars }"
                :style="{ height: `${h}rpx` }"
              />
            </view>
            <text class="voice-duration">
              {{ formatVoiceDuration(voiceMeta?.duration || 0) }}
            </text>
          </view>
        </view>
        <view
          v-else-if="message.type === 'card'"
          class="bubble card-bubble"
          @click="onViewCard"
          @longpress="onLongPress"
          @contextmenu.prevent="onContextMenu"
        >
          <view class="card-head">
            <image
              class="card-avatar"
              :src="cardAvatar"
              mode="aspectFill"
            />
            <text class="card-name">
              {{ cardMeta?.nickname || '好友名片' }}
            </text>
          </view>
          <view class="card-divider" />
          <view class="card-foot">
            <text class="card-view">
              查看
            </text>
          </view>
        </view>
        <view
          v-else-if="message.type === 'groupInvite'"
          class="bubble group-invite-bubble"
          @longpress="onLongPress"
          @contextmenu.prevent="onContextMenu"
        >
          <image
            class="gi-avatar"
            :src="groupInviteAvatar"
            mode="aspectFill"
          />
          <text class="gi-title">
            {{ groupInviteTitle }}
          </text>
          <text class="gi-desc">
            邀请你加入群聊
          </text>
          <text
            class="gi-action"
            @click.stop="onApplyGroupInvite"
          >
            点击申请入群
          </text>
        </view>
        <view
          v-else-if="message.type === 'groupJoinRequest'"
          class="bubble group-join-request-bubble"
          @longpress="onLongPress"
          @contextmenu.prevent="onContextMenu"
        >
          <view class="gjr-head">
            <image
              class="gjr-avatar"
              :src="groupJoinRequestAvatar"
              mode="aspectFill"
            />
            <view class="gjr-copy">
              <text class="gjr-name">
                {{ groupJoinRequestMeta?.applicantNickname || '申请人' }}
              </text>
              <text class="gjr-desc">
                申请加入 {{ groupJoinRequestMeta?.groupName || '群聊' }}
              </text>
            </view>
          </view>
          <text
            class="gjr-action"
            @click.stop="onOpenGroupJoinRequest"
          >
            去审核
          </text>
        </view>
        <view
          v-else-if="message.type === 'file'"
          class="bubble file-bubble"
          :class="mine ? 'bubble-mine' : 'bubble-other'"
          @click="openFile"
          @longpress="onLongPress"
          @contextmenu.prevent="onContextMenu"
        >
          <view class="file-inner">
            <view class="file-icon">
              📁
            </view>
            <view class="file-meta">
              <text class="file-name">
                {{ fileName }}
              </text>
              <text class="file-sub">
                文件
              </text>
            </view>
          </view>
        </view>
        <view
          v-else
          class="bubble"
          :class="[mine ? 'bubble-mine' : 'bubble-other', { 'bubble-text-selecting': textSelecting }]"
          @longpress="onLongPress"
          @contextmenu="onContextMenu"
        >
          <view
            v-if="message.quote"
            class="quote-box"
            :class="mine ? 'quote-mine' : 'quote-other'"
            @click.stop="onQuoteClick"
          >
            <image
              class="quote-thumb"
              :src="quoteThumbSrc(message.quote)"
              mode="aspectFill"
            />
            <view class="quote-meta">
              <text class="quote-name">
                {{ message.quote.senderNickname }}
              </text>
              <text class="quote-text">
                {{ quoteTextOf(message.quote) }}
              </text>
            </view>
          </view>
          <text
            v-for="(p, idx) in parts"
            :key="idx"
            :selectable="!!textSelecting || p.type === 'text'"
            :user-select="!!textSelecting || p.type === 'text'"
            :class="p.type === 'link' ? 'link' : 'text'"
            @click="p.type === 'link' ? openLink(p.value) : undefined"
          >
            {{ p.value }}
          </text>
        </view>
      </view>
      <view class="meta-row">
        <!-- 私聊已读标识（微信式钩）：未读单钩 / 已读双钩，放在时间前面 -->
        <view
          v-if="readState"
          class="read-flag"
          :class="{ read: readState === 'read' }"
        >
          <view class="tick first" />
          <view
            v-if="readState === 'read'"
            class="tick second"
          />
        </view>
        <text class="time">
          {{ timeText }}
        </text>
      </view>
    </view>
    <image
      v-if="mine"
      class="avatar"
      :src="avatarSrc"
      mode="aspectFill"
      @error="onAvatarError"
    />
  </view>
</template>

<style scoped lang="scss">
.row {
  display: flex;
  align-items: flex-start;
  width: 100%;
  box-sizing: border-box;
  padding: 16rpx 24rpx;
}

.row.mine {
  justify-content: flex-end;
}

.avatar {
  width: 72rpx;
  height: 72rpx;
  border-radius: 50%;
  background: #ddd;
  flex-shrink: 0;
}

.content-wrap {
  max-width: 70%;
  min-width: 0;
  margin: 0 16rpx;
  display: flex;
  flex-direction: column;
}

.mine .content-wrap {
  align-items: flex-end;
}

/** 昵称行：昵称 + 群主/管理员头衔徽章（自己的消息右对齐，只露徽章） */
.name-row {
  display: flex;
  align-items: center;
  gap: 8rpx;
  max-width: 100%;
  margin-bottom: 8rpx;
}

.nickname {
  min-width: 0;
  font-size: 22rpx;
  line-height: 32rpx;
  color: #9aa3b5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/** 头衔徽章：沿用群成员列表的描边药丸，尺寸压到消息昵称档 */
.role-badge {
  flex-shrink: 0;
  padding: 0 8rpx;
  border: 2rpx solid #c5cad6;
  border-radius: 6rpx;
  font-size: 18rpx;
  line-height: 26rpx;
  color: #636e86;
  white-space: nowrap;
}

.role-badge.role-admin {
  border-color: #2b5cff;
  color: #2b5cff;
}

/** 气泡行：感叹号（失败）在气泡前面，与气泡水平居中排列 */
.bubble-line {
  display: flex;
  align-items: center;
  gap: 10rpx;
}

.bubble {
  padding: 18rpx 22rpx;
  border-radius: 16rpx;
  font-size: 30rpx;
  line-height: 1.5;
  word-break: break-all;
  white-space: pre-wrap;
}

.bubble .text,
.bubble .link {
  user-select: text;
  -webkit-user-select: text;
}

.bubble-text-selecting {
  outline: 2rpx solid rgba(43, 92, 255, 0.45);
}

.bubble-other {
  background: #fff;
  color: #222;
  border-top-left-radius: 4rpx;
}

.bubble-mine {
  background: #2b5cff;
  color: #fff;
  border-top-right-radius: 4rpx;
}

.image-bubble {
  position: relative;
  padding: 0;
  background: transparent;
  overflow: hidden;
}

.msg-image {
  border-radius: 12rpx;
  display: block;
  background: #e8e8e8;
}

.image-placeholder {
  width: 280rpx;
  max-width: 56vw;
  min-height: 180rpx;
  background: #e8e8e8;
  border-radius: 12rpx;
}

.image-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(232, 232, 232, 0.55);
  pointer-events: none;
}

.image-spinner {
  width: 48rpx;
  height: 48rpx;
  border: 6rpx solid rgba(0, 0, 0, 0.12);
  border-top-color: rgba(0, 0, 0, 0.45);
  border-radius: 50%;
  animation: image-spin 0.75s linear infinite;
}

@keyframes image-spin {
  to {
    transform: rotate(360deg);
  }
}

/** 尺寸交给封面图自己撑（可能比 280rpx 窄，比如竖屏视频），播放键才居中对得上 */
.video-bubble {
  position: relative;
  flex-shrink: 0;
  overflow: hidden;
}

.video-poster-placeholder {
  width: 280rpx;
  min-height: 240rpx;
  background: #e8e8e8;
  border-radius: 12rpx;
}

.video-play {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  pointer-events: none;
}

.video-play-icon {
  color: #fff;
  font-size: 64rpx;
  line-height: 1;
  text-shadow: 0 2rpx 12rpx rgba(0, 0, 0, 0.45);
}

.video-duration {
  position: absolute;
  left: 50%;
  bottom: 16rpx;
  transform: translateX(-50%);
  padding: 4rpx 14rpx;
  border-radius: 8rpx;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  font-size: 24rpx;
  line-height: 1.3;
  pointer-events: none;
}

.voice-bubble {
  min-width: 260rpx;
  max-width: 440rpx;
  box-sizing: border-box;
  padding: 18rpx 24rpx;
}

.voice-inner {
  display: flex;
  align-items: center;
  gap: 16rpx;
}

/** 最前面的播放三角：CSS 画的 ▶，默认黑色与波形一致，播放态换暂停图标；margin 让图标和波形隔开 */
.voice-play-icon {
  flex-shrink: 0;
  margin-right: 16rpx;
  width: 0;
  height: 0;
  border-top: 10rpx solid transparent;
  border-bottom: 10rpx solid transparent;
  border-left: 16rpx solid #000;
}

/** 播放中：播放三角换成暂停图标（两根竖条） */
.voice-bubble.playing .voice-play-icon {
  width: 16rpx;
  height: 20rpx;
  border: none;
  position: relative;
}

.voice-bubble.playing .voice-play-icon::before,
.voice-bubble.playing .voice-play-icon::after {
  content: '';
  position: absolute;
  top: 0;
  width: 4rpx;
  height: 20rpx;
  border-radius: 2rpx;
  background: #000;
}

.voice-bubble.playing .voice-play-icon::before {
  left: 0;
}

.voice-bubble.playing .voice-play-icon::after {
  right: 0;
}

/** 波形紧凑排列在图标右侧，剩余空白留给时长一侧 */
.voice-wave {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6rpx;
}

.voice-bar {
  width: 2rpx;
  border-radius: 1rpx;
  background: #8a93a1;
  transition: background-color 0.2s ease;
}

/** 播放进度双色：未播灰色，已播过的柱子变黑（两侧统一配色） */
.voice-bar.played {
  background: #000;
}

.voice-duration {
  flex-shrink: 0;
  font-size: 24rpx;
  line-height: 1;
  color: #000;
}

.file-bubble {
  min-width: 320rpx;
  max-width: 420rpx;
}

.file-inner {
  display: flex;
  align-items: center;
  gap: 20rpx;
}

.file-icon {
  width: 76rpx;
  height: 76rpx;
  border-radius: 12rpx;
  background: rgba(43, 92, 255, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 40rpx;
  flex-shrink: 0;
}

.file-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.file-name {
  font-size: 26rpx;
  line-height: 1.4;
  word-break: break-all;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}

.file-sub {
  margin-top: 4rpx;
  font-size: 20rpx;
  opacity: 0.6;
}

.card-bubble {
  width: 360rpx;
  padding: 0;
  background: #fff;
  border: 1rpx solid #e3e8f0;
  overflow: hidden;
}

.card-head {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 24rpx 24rpx 20rpx;
}

.card-avatar {
  width: 72rpx;
  height: 72rpx;
  border-radius: 12rpx;
  background: #f3f4f7;
  flex-shrink: 0;
}

.card-name {
  flex: 1;
  min-width: 0;
  font-size: 28rpx;
  font-weight: 600;
  color: #1f2d3d;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-divider {
  height: 1rpx;
  background: #eef1f6;
  margin: 0 24rpx;
}

.card-foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 14rpx 24rpx;
}

.card-view {
  font-size: 24rpx;
  font-weight: 600;
  color: #2b5cff;
}

.group-invite-bubble {
  width: 420rpx;
  padding: 36rpx 32rpx 28rpx;
  background: #f3f4f6;
  border-radius: 16rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  box-sizing: border-box;
}

.gi-avatar {
  width: 112rpx;
  height: 112rpx;
  border-radius: 50%;
  background: #e5e7eb;
  margin-bottom: 20rpx;
}

.gi-title {
  max-width: 100%;
  font-size: 30rpx;
  font-weight: 600;
  color: #212121;
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gi-desc {
  margin-top: 8rpx;
  font-size: 26rpx;
  color: #6b7280;
}

.gi-action {
  margin-top: 20rpx;
  font-size: 28rpx;
  color: #2563eb;
  font-weight: 500;
}

.group-join-request-bubble {
  width: 440rpx;
  padding: 26rpx;
  background: #fff;
  border: 1rpx solid #e5e7eb;
  border-radius: 16rpx;
  box-sizing: border-box;
}

.gjr-head {
  display: flex;
  align-items: center;
  gap: 18rpx;
}

.gjr-avatar {
  width: 88rpx;
  height: 88rpx;
  border-radius: 50%;
  background: #eef1f5;
  flex-shrink: 0;
}

.gjr-copy {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.gjr-name,
.gjr-desc {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gjr-name {
  font-size: 29rpx;
  font-weight: 600;
  color: #1f2937;
}

.gjr-desc {
  font-size: 25rpx;
  color: #6b7280;
}

.gjr-action {
  margin-top: 22rpx;
  padding-top: 20rpx;
  border-top: 1rpx solid #eef1f5;
  text-align: right;
  font-size: 27rpx;
  font-weight: 600;
  color: #0a2fc2;
}

.voice-other {
  background: #fff;
}

.voice-mine {
  background: #bfe3ff;
}

.link {
  color: #2b5cff;
  text-decoration: underline;
}

.mine .link {
  color: #dce7ff;
}

.quote-box {
  display: flex;
  align-items: center;
  gap: 16rpx;
  min-width: 336rpx;
  margin-bottom: 8rpx;
  padding: 12rpx 16rpx;
  border-radius: 8rpx;
  border-left: 8rpx solid #0a2fc2;
  box-sizing: border-box;
  cursor: pointer;
}

.quote-other {
  background: #f3f4f7;
}

.quote-mine {
  background: #91c3fd;
}

.quote-thumb {
  width: 64rpx;
  height: 64rpx;
  border-radius: 0;
  flex-shrink: 0;
  background: #ddd;
}

.quote-meta {
  flex: 1;
  min-width: 0;
}

.quote-name,
.quote-text {
  display: block;
  font-size: 24rpx;
  line-height: 34rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.quote-name {
  font-weight: 400;
  color: #212121;
}

.quote-other .quote-name {
  color: #0a2fc2;
}

.quote-text {
  color: #212121;
}

.quote-mine .quote-name,
.quote-mine .quote-text {
  color: #212121;
  opacity: 1;
}

/** 气泡下方的元信息行：已读钩 + 时间（自己一侧右对齐） */
.meta-row {
  display: flex;
  align-items: center;
  gap: 8rpx;
  margin-top: 8rpx;
}

/** 未读单钩浅灰；已读双钩用更明显的蓝，电脑端也看得清 */
.read-flag {
  position: relative;
  width: 32rpx;
  height: 18rpx;
  flex-shrink: 0;
  color: #c0c6d0;
}

.read-flag.read {
  color: #2b7cff;
}

/** CSS 画的钩形（border-left + border-bottom 旋转 -45°），顶点朝下、底边贴容器底部 */
.tick {
  position: absolute;
  bottom: 1rpx;
  border-left: 4rpx solid currentColor;
  border-bottom: 4rpx solid currentColor;
  box-sizing: border-box;
  transform: rotate(-45deg);
}

.tick.first {
  left: 0;
  width: 18rpx;
  height: 10rpx;
}

/** 双钩的第二钩：起点落在第一钩的臂上，两钩交叉连贯（微信式 ✓✓） */
.tick.second {
  left: 10rpx;
  width: 16rpx;
  height: 10rpx;
}

/** 发送失败感叹号：红色圆形 + 白感叹号，点击重发 */
.retry-flag {
  width: 32rpx;
  height: 32rpx;
  border-radius: 50%;
  background: #e54d42;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.retry-icon {
  color: #fff;
  font-size: 24rpx;
  font-weight: 700;
  line-height: 1;
}

.time {
  font-size: 22rpx;
  line-height: 1;
  color: #bbb;
}
</style>
