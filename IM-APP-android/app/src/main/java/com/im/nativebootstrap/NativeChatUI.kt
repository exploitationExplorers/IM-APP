package com.im.nativebootstrap

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.os.Handler
import android.os.Looper
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.key.*
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.im.nativebootstrap.chat.*
import com.im.nativebootstrap.core.StoreStatus
import com.im.nativebootstrap.core.SyncStatus
import com.im.nativebootstrap.media.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.collect
import kotlin.coroutines.resume
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID

data class NativeChatCallbacks(
    val onBack:()->Unit,
    val onLoadHistory:()->Unit,
    val onSendText:(String,ChatMessage?,(Boolean)->Unit)->Unit,
    val onSendMedia:(LocalMedia,(Boolean)->Unit)->Unit,
    val onReconcile:(String)->Unit,
    val onAction:(ChatMessage,ChatAction,(Result<Unit>)->Unit)->Unit,
    val onForward:(ChatMessage,ChatConversation,(Result<Unit>)->Unit)->Unit,
    val onOpenPeer:(String)->Unit,
    val onOpenDetails:()->Unit = {},
    val onOpenFavorites:()->Unit = {},
    val onOpenCards:()->Unit = {},
    val onLoadMentions:(String,(Result<ChatMentionPage>)->Unit)->Unit = { _,done -> done(Result.failure(IllegalStateException("成员服务尚未就绪"))) },
    val onSelectMention:(ChatMentionChoice,(Result<Unit>)->Unit)->Unit = { _,done -> done(Result.failure(IllegalStateException("成员服务尚未就绪"))) },
    val onLoadForward:(String,String,String,Int,(Result<ChatForwardPage>)->Unit)->Unit = { _,_,_,_,done -> done(Result.failure(IllegalStateException("转发服务尚未就绪"))) },
    val onSubmitForward:(List<ChatMessage>,ChatForwardSelection,(Result<ChatForwardResult>)->Unit)->Unit = { _,_,done -> done(Result.failure(IllegalStateException("转发服务尚未就绪"))) },
    val onForwardProgress:(List<String>,(Result<List<ChatForwardProgress>>)->Unit)->Unit = { _,done -> done(Result.failure(IllegalStateException("任务服务尚未就绪"))) },
    val onForwardTaskAction:(String,String,(Result<Unit>)->Unit)->Unit = { _,_,done -> done(Result.failure(IllegalStateException("任务服务尚未就绪"))) },
    val onReportUser:(String)->Unit = {},
    val onLoadMessageMenu:(ChatMessage,(Result<ChatMessageMenu>)->Unit)->Unit = { _,done -> done(Result.failure(IllegalStateException("成员服务尚未就绪"))) },
    val onAddSticker:(LocalMedia,(Result<Unit>)->Unit)->Unit = { _,done -> done(Result.failure(IllegalStateException("表情服务尚未就绪"))) },
    val onLoadStickers:(Int,(Result<ChatPickerPage>)->Unit)->Unit = { _,done -> done(Result.failure(IllegalStateException("表情服务尚未就绪"))) },
    val onSendSticker:(String,(Result<ChatMessage>)->Unit)->Unit = { _,done -> done(Result.failure(IllegalStateException("表情服务尚未就绪"))) },
    val onDeleteSticker:(String,(Result<Unit>)->Unit)->Unit = { _,done -> done(Result.failure(IllegalStateException("表情服务尚未就绪"))) },
    val onManageStickers:()->Unit = {},
    val onRefreshPermission:()->Unit = {},
    val onRecall:(ChatMessage,String,(Result<Unit>)->Unit)->Unit = { _,_,done -> done(Result.failure(IllegalStateException("撤回服务尚未就绪"))) },
    val onAcceptGroupInvite:(String,(Result<ChatInviteResult>)->Unit)->Unit = { _,done -> done(Result.failure(IllegalStateException("入群服务尚未就绪"))) },
    /** 群邀请卡片点击/处理完成时登记（token, 文案）；点击即消耗，避免重复点击与过期后再点。 */
    val onInviteHandled:(String,String)->Unit = { _,_-> },
    val onOpenBusinessGroup:(String)->Unit = {},
    val onOpenJoinRequests:(String)->Unit = {},
    val onOpenAnnouncements:(String)->Unit = {},
    val onDismissAnnouncement:()->Unit = {},
    val onDismissPin:()->Unit = {},
    val onLoadGroupMembers:(List<String>)->Unit = {},
    val onRetryFailed:(String)->Unit = {},
    val onRetryUpload:(String)->Unit = {},
    val onDiscardUpload:(String)->Unit = {},
    val onConsumeForwardNotice:(String,String)->Unit = { _,_-> },
)

// 必须是 getter：顶层 val 会把浅色值一次性快照，深色切换后不再跟随。
internal val ChatGray get()=C.page
internal val ChatBlue get()=C.mineBubble
internal val ChatHint get()=C.faint
internal fun onUI(action:()->Unit) { if(Looper.myLooper()==Looper.getMainLooper())action() else Handler(Looper.getMainLooper()).post(action) }

// 正则编译不便宜；imAdmin 系统消息在群聊里长期存在，item 重组时按值匹配，必须复用同一实例。
internal val legacyAdminClearRegex=Regex("^(群主|管理员)清除了「.+」的全部消息$")

internal suspend fun voiceSource(
    context:android.content.Context,
    messageId:String,
    content:MessageContent,
    conversationId:String,
    group:Boolean,
):String {
    if(content.url.isBlank()) return ""
    return withContext(Dispatchers.IO) {
        runCatching {
            MediaLoader.fetch(
                context,
                content.url,
                32L*1024*1024,
                MediaCacheMeta("voice","original",conversationId,messageId,group,content.url),
            ).absolutePath
        }.getOrElse { content.url }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun NativeChatRoom(state:ChatState,callbacks:NativeChatCallbacks,ownAvatar:String="",enterToSend:Boolean=false) {
    val context=LocalContext.current
    val clipboard=LocalClipboardManager.current
    val scope=rememberCoroutineScope()
    val list=rememberLazyListState()
    val factor=LocalConfiguration.current.screenWidthDp/750f
    fun rpx(value:Int)=(value*factor).dp
    val textS=remember(state.active?.target) { mutableStateOf("") }
    var text by textS
    val quotedS=remember(state.active?.target) { mutableStateOf<ChatMessage?>(null) }
    var quoted by quotedS
    var sending by remember(state.active?.target) { mutableStateOf(false) }
    val selectedS=remember { mutableStateOf<ChatMessage?>(null) }
    var selected by selectedS
    val uploadMenuS=remember { mutableStateOf<PendingMediaUpload?>(null) }
    var uploadMenu by uploadMenuS
    val selectedAnchorS=remember { mutableStateOf<Offset?>(null) }
    var selectedAnchor by selectedAnchorS
    val inviteS=remember { mutableStateOf<GroupMessageCard?>(null) }
    var invite by inviteS
    val forwardS=remember { mutableStateOf<ChatMessage?>(null) }
    var forward by forwardS
    val multiS=remember { mutableStateOf(false) }
    var multi by multiS
    val selectionS=remember { mutableStateOf<Set<String>>(emptySet()) }
    var selection by selectionS
    val selectionOrderS=remember { mutableStateOf<List<String>>(emptyList()) }
    var selectionOrder by selectionOrderS
    val forwardModeS=remember { mutableStateOf(false) }
    var forwardMode by forwardModeS
    val confirmMultiRecallS=remember { mutableStateOf(false) }
    var confirmMultiRecall by confirmMultiRecallS
    var recalling by remember { mutableStateOf(false) }
    val recallReasonS=remember { mutableStateOf("") }
    var recallReason by recallReasonS
    val avatarMentionS=remember { mutableStateOf<ChatMessage?>(null) }
    var avatarMention by avatarMentionS
    val multiForwardS=remember { mutableStateOf<List<ChatMessage>?>(null) }
    var multiForward by multiForwardS
    var forwarding by remember { mutableStateOf(false) }
    val confirmMultiDeleteS=remember { mutableStateOf(false) }
    var confirmMultiDelete by confirmMultiDeleteS
    var deleting by remember { mutableStateOf(false) }
    val confirmDeleteS=remember { mutableStateOf<ChatMessage?>(null) }
    var confirmDelete by confirmDeleteS
    val confirmManageS=remember { mutableStateOf<Pair<ChatMessage,ChatAction>?>(null) }
    var confirmManage by confirmManageS
    val muteTargetS=remember { mutableStateOf<ChatMessage?>(null) }
    var muteTarget by muteTargetS
    val pinTargetS=remember { mutableStateOf<ChatMessage?>(null) }
    var pinTarget by pinTargetS
    val selectTextS=remember { mutableStateOf<String?>(null) }
    var selectText by selectTextS
    val imageS=remember { mutableStateOf<String?>(null) }
    var image by imageS
    val imageMessageS=remember { mutableStateOf<ChatMessage?>(null) }
    var imageMessage by imageMessageS
    val videoS=remember { mutableStateOf<String?>(null) }
    var video by videoS
    val videoMessageS=remember { mutableStateOf<ChatMessage?>(null) }
    var videoMessage by videoMessageS
    val videoLocalS=remember { mutableStateOf<LocalMedia?>(null) }
    var videoLocal by videoLocalS
    val noticeS=remember { mutableStateOf<String?>(null) }
    var notice by noticeS
    LaunchedEffect(notice) { notice?.let { NativeNotices.show(it);notice=null } }
    LaunchedEffect(state.error) { state.error?.let(NativeNotices::show) }
    val plusS=remember { mutableStateOf(false) }
    var plus by plusS
    val composerPanels=remember { NativeComposerPanelState() }
    val emoji=composerPanels.emojiOpen
    val voiceModeS=remember { mutableStateOf(false) }
    var voiceMode by voiceModeS
    var recording by remember { mutableStateOf(false) }
    var recordingSeconds by remember { mutableIntStateOf(0) }
    var recordingStarted by remember { mutableLongStateOf(0) }
    var voiceDraft by remember { mutableStateOf<LocalMedia?>(null) }
    var voiceWorking by remember { mutableStateOf(false) }
    var voiceOperation by remember { mutableLongStateOf(0) }
    var playing by remember { mutableStateOf<String?>(null) }
    val pickerKindS=remember { mutableStateOf(MediaKind.IMAGE) }
    var pickerKind by pickerKindS
    val preparingS=remember { mutableStateOf(false) }
    var preparing by preparingS
    val failedMediaS=remember { mutableStateOf<List<LocalMedia>>(emptyList()) }
    var failedMedia by failedMediaS
    var retryingMedia by remember { mutableStateOf<Set<String>>(emptySet()) }
    var saveFile by remember { mutableStateOf<File?>(null) }
    var cameraFile by remember { mutableStateOf<File?>(null) }
    var capturedVideo by remember { mutableStateOf<File?>(null) }
    val showVideoSourceS=remember { mutableStateOf(false) }
    var showVideoSource by showVideoSourceS
    val mergeS=remember { mutableStateOf<ChatMessage?>(null) }
    var merge by mergeS
    val showMentionsS=remember { mutableStateOf(false) }
    var showMentions by showMentionsS
    var atStart by remember { mutableIntStateOf(-1) }
    var mentionKeyword by remember { mutableStateOf("") }
    val composerCursorS=remember { mutableStateOf<Int?>(null) }
    var composerCursor by composerCursorS
    val player=remember { VoicePlayer() }
    val recorder=remember { VoiceRecorder(context) }
    DisposableEffect(Unit) { onDispose { voiceOperation++;player.stop();recorder.release();if(!voiceWorking)voiceDraft?.file?.delete() } }
    fun sendFile(local:LocalMedia) {
        val key=local.file.absolutePath
        if(key in retryingMedia)return
        retryingMedia=retryingMedia+key
        callbacks.onSendMedia(local) { accepted -> onUI {
            retryingMedia=retryingMedia-key
            if(accepted)failedMedia=failedMedia.filterNot { it.file.absolutePath==key }
            else { failedMedia=(failedMedia+local).distinctBy { it.file.absolutePath };notice="附件未提交，可重试上传或移除草稿" }
        } }
    }
    fun toggleSelection(message:ChatMessage) {
        if(message.id in selection) { selection=selection-message.id;selectionOrder=selectionOrder-message.id }
        else { selection=selection+message.id;selectionOrder=selectionOrder+message.id }
    }
    fun selectedMessages()=selectionOrder.mapNotNull { id -> state.messages.firstOrNull { it.id==id } }
    fun canRecall(message:ChatMessage):Boolean {
        if(state.mediaUploads.any { it.id==message.id }||state.outbox.any { it.id==message.id&&it.state!=OutboxState.ACCEPTED })return false
        if(message.status!=2&&message.seq<=0)return false
        return message.mine||(state.active?.target?.sessionType==3&&state.groupRole in setOf("owner","admin"))
    }
    fun mentionMember(message:ChatMessage) {
        callbacks.onLoadMessageMenu(message) { loaded -> onUI {
            val member=loaded.getOrNull()
            if(member?.senderInGroup!=true) { notice=loaded.exceptionOrNull()?.message ?: "该群友已不在群聊";return@onUI }
            val sender=MessageContents.parse(message.serialized,message.text).senderId
            val name=member.publicName.ifBlank { message.sender }.ifBlank { "群成员" }
            callbacks.onSelectMention(ChatMentionChoice(sender,name)) { result -> onUI {
                if(result.isSuccess) { text+="@$name ";voiceMode=false } else notice=result.exceptionOrNull()?.message ?: "提及失败"
            } }
        } }
    }
    fun stopVoice(sendAfter:Boolean=false) {
        if(voiceWorking)return
        if(!recording) {
            if(sendAfter)voiceDraft?.let { draft ->
                voiceWorking=true
                callbacks.onSendMedia(draft) { accepted -> onUI {
                    voiceWorking=false
                    if(accepted) { voiceDraft=null;voiceMode=false;recordingSeconds=0 }
                    else notice="语音未提交，录音草稿已保留，可重试或取消"
                } }
            }
            return
        }
        voiceWorking=true;recording=false
        val operation=voiceOperation
        scope.launch {
            val result=withContext(Dispatchers.IO) { runCatching { recorder.finish() } }
            if(operation!=voiceOperation) { result.getOrNull()?.file?.delete();return@launch }
            voiceWorking=false
            result.fold(onSuccess={ draft ->
                voiceDraft=draft;recordingSeconds=draft.duration.toInt()
                if(sendAfter) {
                    voiceWorking=true
                    callbacks.onSendMedia(draft) { accepted -> onUI {
                        voiceWorking=false
                        if(accepted) { voiceDraft=null;voiceMode=false;recordingSeconds=0 }
                        else notice="语音未提交，录音草稿已保留，可重试或取消"
                    } }
                }
            },onFailure={ notice=it.message ?: "录音未完成";voiceMode=false })
        }
    }
    fun startVoice() {
        if(!state.ready||state.uploading||voiceWorking||state.sendBlockedReason!=null)return
        voiceDraft?.file?.delete();voiceDraft=null
        voiceMode=true;plus=false;composerPanels.setEmoji(false);voiceWorking=true
        val operation=++voiceOperation
        scope.launch {
            val result=withContext(Dispatchers.IO) { runCatching { recorder.start() } }
            if(operation!=voiceOperation) { recorder.cancel();return@launch }
            voiceWorking=false
            result.fold(onSuccess={ recordingSeconds=0;recordingStarted=android.os.SystemClock.elapsedRealtime();recording=true },onFailure={ voiceMode=false;notice="录音启动失败，请检查麦克风权限" })
        }
    }
    fun cancelVoice() {
        voiceOperation++;recording=false;recorder.cancel();voiceDraft?.file?.delete();voiceDraft=null
        voiceMode=false;recordingSeconds=0;voiceWorking=false
    }
    LaunchedEffect(recording) {
        if(recording)while(recording) {
            delay(200)
            recordingSeconds=((android.os.SystemClock.elapsedRealtime()-recordingStarted)/1000).toInt().coerceAtMost(60)
            if(recordingSeconds>=59) { stopVoice();break }
        }
    }
    LaunchedEffect(state.sendBlockedReason) {
        if(state.sendBlockedReason!=null) {
            plus=false;composerPanels.setEmoji(false);showMentions=false
            if(recording)stopVoice()
            else if(voiceWorking&&voiceDraft==null) { voiceOperation++;recorder.cancel();voiceWorking=false;voiceMode=false }
        }
    }
    val voiceLifecycle=LocalLifecycleOwner.current.lifecycle
    DisposableEffect(voiceLifecycle) {
        val observer=LifecycleEventObserver { _,event -> if(event==Lifecycle.Event.ON_STOP) { player.stop();if(recording||(voiceWorking&&voiceDraft==null)) { voiceOperation++;recording=false;recorder.cancel();voiceMode=false;recordingSeconds=0;voiceWorking=false } } }
        voiceLifecycle.addObserver(observer)
        onDispose { voiceLifecycle.removeObserver(observer) }
    }
    fun importMedia(uris:List<android.net.Uri>,kind:MediaKind) {
        if(uris.isEmpty())return
        if(preparing||state.uploading) { notice="请等待当前附件处理完成后再选择";return }
        preparing=true
        scope.launch {
            var saved=0;var failed=0;var firstError=""
            val picks=uris.distinct().take(20)
            try {
                for((index,uri) in picks.withIndex()) {
                    val prepared=withContext(Dispatchers.IO) { runCatching {
                        val actual=if(kind==MediaKind.FILE&&context.contentResolver.getType(uri)?.startsWith("image/")==true)MediaKind.IMAGE else kind
                        MediaIO.stage(context,uri,actual,prepareMetadata=actual!=MediaKind.VIDEO)
                    } }
                    val local=prepared.getOrNull()
                    if(local==null) {
                        failed++;if(firstError.isEmpty())firstError=prepared.exceptionOrNull()?.message ?: "附件读取失败"
                        continue
                    }
                    val accepted=suspendCancellableCoroutine<Boolean> { continuation ->
                        callbacks.onSendMedia(local) { value -> onUI {
                            if(!value)failedMedia=(failedMedia+local).distinctBy { it.file.absolutePath }
                            if(continuation.isActive)continuation.resume(value)
                        } }
                    }
                    if(accepted)saved++ else { failed++;if(firstError.isEmpty())firstError="未提交的附件已保留，可重试上传" }
                }
                notice=if(failed>0)"$failed 个附件未完成：$firstError" else if(uris.size>20)"本次最多 20 个，其余请再次选择" else null
            } finally { preparing=false }
        }
    }
    val pick=rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris -> importMedia(uris,pickerKind) }
    val recordPermission=rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { allowed -> if(allowed)startVoice() else notice="请在系统设置允许麦克风后发送语音" }
    val camera=rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { success -> if(success)cameraFile?.let { importMedia(listOf(FileProvider.getUriForFile(context,context.packageName+".files",it)),MediaKind.IMAGE) } }
    fun capture() {
        val dir=File(context.cacheDir,"media").apply { mkdirs() }
        val file=File(dir,"camera-${UUID.randomUUID()}.jpg");cameraFile=file
        runCatching { camera.launch(FileProvider.getUriForFile(context,context.packageName+".files",file)) }.onFailure { notice="相机不可用，请从相册选择图片" }
    }
    val cameraPermission=rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { if(it)capture() else notice="请允许相机权限后重试" }
    val recordVideo=rememberLauncherForActivityResult(object:ActivityResultContracts.CaptureVideo() {
        override fun createIntent(context:android.content.Context,input:android.net.Uri)=super.createIntent(context,input).putExtra(android.provider.MediaStore.EXTRA_DURATION_LIMIT,60)
    }) { success -> if(success)capturedVideo?.let { source ->
        preparing=true
        scope.launch {
            try {
                val result=withContext(Dispatchers.IO) { runCatching { MediaIO.stageCapturedVideo(context,source) } }
                result.fold(onSuccess={sendFile(it)},onFailure={notice=it.message ?: "视频暂不可读取，请重试"})
            } finally { preparing=false;capturedVideo=null }
        }
    } }
    fun captureVideo() {
        val dir=File(context.cacheDir,"media").apply { check(mkdirs()||isDirectory) }
        val file=File(dir,"camera-${UUID.randomUUID()}.mp4");capturedVideo=file
        runCatching { recordVideo.launch(FileProvider.getUriForFile(context,context.packageName+".files",file)) }.onFailure { notice="视频拍摄不可用，可从相册选择" }
    }
    val videoCameraPermission=rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { if(it)captureVideo() else notice="请允许相机权限后拍摄视频" }
    val videoAlbum=rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> uri?.let { importMedia(listOf(it),MediaKind.VIDEO) } }
    val save=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("*/*")) { uri ->
        val file=saveFile
        if(uri!=null&&file!=null)scope.launch {
            val result=withContext(Dispatchers.IO) { runCatching { context.contentResolver.openOutputStream(uri)?.use { output -> file.inputStream().use { it.copyTo(output) } } ?: error("无法写入所选位置") } }
            notice=if(result.isSuccess) "已保存到所选位置" else "保存失败，请重试"
        }
    }
    fun saveOriginal(url:String) {
        if(preparing)return
        preparing=true
        var done=false
        // 原图可能有几 MB，先给「正在保存」即时反馈，避免点完没反应、结果突然弹出。
        scope.launch { delay(400);if(!done)NativeNotices.show("正在保存原图…") }
        scope.launch {
            val result=withContext(Dispatchers.IO) { runCatching {
                val original=MediaURLs.image(url,ImageVariant.ORIGINAL)
                val file=MediaLoader.fetch(context,original)
                val bounds=BitmapFactory.Options().apply { inJustDecodeBounds=true };BitmapFactory.decodeFile(file.path,bounds)
                val extension=when(bounds.outMimeType) { "image/png" -> "png";"image/gif" -> "gif";"image/webp" -> "webp";"image/heif","image/heic" -> "heic";else -> "jpg" }
                val saved=MediaIO.saveToGallery(context,file,"图片-${System.currentTimeMillis()}.$extension",bounds.outMimeType ?: "image/jpeg",false)
                Triple(file,extension,saved)
            } }
            done=true;preparing=false
            // 保存反馈走全局 toast：大图/视频预览层覆盖聊天页时也能立即看到结果与真实失败原因。
            result.fold(onSuccess={ (file,extension,saved) ->
                if(saved)NativeNotices.show("原图已保存到相册（易可聊）")
                else { NativeNotices.show("请在系统文件选择器中选择原图保存位置");saveFile=file;save.launch("图片-${System.currentTimeMillis()}.$extension") }
            },onFailure={ NativeNotices.show(it.message ?: "原图保存失败") })
        }
    }
    fun saveVideo(url:String,ownedFile:File?=null) {
        if(preparing)return
        preparing=true
        var done=false
        scope.launch { delay(400);if(!done)NativeNotices.show("正在保存视频…") }
        scope.launch {
            val result=withContext(Dispatchers.IO) { runCatching {
                val file=ownedFile?.let { OwnedVideoFiles.verified(it,state.mediaOwnerDirectory.takeIf(String::isNotBlank)?.let(::File),File(context.filesDir,"native-chat")) }
                    ?: listOf(url,MediaURLs.playback(url)).firstNotNullOfOrNull { MediaLoader.cachedFile(context,it) }
                    ?: runCatching { MediaLoader.fetch(context,MediaURLs.playback(url)) }.getOrElse { MediaLoader.fetch(context,url) }
                // 按真实容器决定扩展名/MIME：mov、webm 存成 .mp4 时部分相册和播放器打不开。
                val (extension,mime)=MediaIO.videoFormat(file)
                val saved=MediaIO.saveToGallery(context,file,"视频-${System.currentTimeMillis()}.$extension",mime,true)
                Triple(file,extension,saved)
            } }
            done=true;preparing=false
            result.fold(onSuccess={ (file,extension,saved) ->
                if(saved)NativeNotices.show("视频已保存到相册（易可聊）")
                else { NativeNotices.show("请在系统文件选择器中选择视频保存位置");saveFile=file;save.launch("视频-${System.currentTimeMillis()}.$extension") }
            },onFailure={ NativeNotices.show(it.message ?: "视频保存失败") })
        }
    }
    fun addSticker(url:String) {
        if(preparing)return
        preparing=true
        scope.launch {
            val staged=withContext(Dispatchers.IO) { runCatching { MediaIO.stageSticker(context,url) } }
            staged.fold(onSuccess={ media -> callbacks.onAddSticker(media) { result ->
                media.file.delete()
                onUI { preparing=false;notice=if(result.isSuccess)"已加入表情包" else result.exceptionOrNull()?.message ?: "加入表情包失败" }
            } },onFailure={ preparing=false;notice=it.message ?: "原图暂不能加入表情包" })
        }
    }
    fun openFile(content:MessageContent) {
        preparing=true
        scope.launch {
            val result=withContext(Dispatchers.IO) { runCatching { MediaLoader.fetch(context,content.url) } }
            preparing=false
            result.fold(onSuccess={ runCatching { MediaIO.openFile(context,it,content.fileName) }.onFailure { notice="未找到可打开此文件的应用" } },onFailure={ notice=it.message ?: "文件下载失败" })
        }
    }
    fun submitText() {
        if(!state.ready||text.isBlank()||state.sendBlockedReason!=null||sending)return
        sending=true
        val draft=text;val reply=quoted
        callbacks.onSendText(draft,reply) { accepted -> onUI {
            sending=false
            if(accepted&&text==draft) { text="";quoted=null }
        } }
    }
    fun updateDraft(value:String) {
        val previous=text
        val next=value.take(6000).replace('＠','@')
        text=next
        if(state.active?.target?.sessionType==3) {
            val addedAt=next.count {it=='@'}>previous.count {it=='@'}
            val match=Regex("(^|[\\s\\n])@([^\\s@]*)$").find(next)
            if(addedAt&&match!=null) { atStart=next.length-match.groupValues[2].length-1;showMentions=true;plus=false;composerPanels.setEmoji(false) }
            else if(showMentions&&match==null) showMentions=false
            if(showMentions&&match!=null) mentionKeyword=match.groupValues[2]
        }
    }
    fun pickMention(choice:ChatMentionChoice) {
        callbacks.onSelectMention(choice) { result -> onUI {
            if(result.isSuccess) {
                val start=atStart.coerceIn(0,text.length)
                val rest=text.substring(start).replaceFirst(Regex("^@[^\\s@]*"),"")
                text=text.take(start)+"@${choice.name} "+rest
                composerCursor=(start+1+choice.name.length+1).coerceIn(0,text.length)
                showMentions=false
            } else notice=result.exceptionOrNull()?.message ?: "成员选择失败"
        } }
    }
    fun deleteSelected() {
        val messages=selectedMessages()
        deleting=true
        var index=0
        fun next() {
            if(index>=messages.size) { deleting=false;multi=false;selection=emptySet();selectionOrder=emptyList();return }
            val message=messages[index++]
            callbacks.onAction(message,ChatAction.DELETE_LOCAL) { result -> onUI {
                if(result.isSuccess) { selection=selection-message.id;next() }
                else { deleting=false;notice=result.exceptionOrNull()?.message ?: "部分消息未删除，原记录已保留" }
            } }
        }
        next()
    }
    fun recallSelected() {
        val messages=selectedMessages()
        if(messages.isEmpty()||messages.size!=selection.size||messages.any { !canRecall(it) }) { notice="所选消息尚未确认或没有撤回权限，请重新选择";return }
        recalling=true
        var index=0;var success=0;var failed=0
        fun next() {
            if(index>=messages.size) {
                recalling=false
                if(failed==0) { multi=false;selection=emptySet();selectionOrder=emptyList() }
                notice=if(success==0)"撤回未完成，$failed 条消息保留选择，可核对或重试" else "已撤回 $success 条"+if(failed>0)"，$failed 条未完成，保留选择可核对或重试" else ""
                return
            }
            val message=messages[index++]
            callbacks.onRecall(message,recallReason) { result -> onUI {
                if(result.isSuccess) { success++;selection=selection-message.id;selectionOrder=selectionOrder-message.id } else failed++
                next()
            } }
        }
        next()
    }
    val reversedMessages=remember(state.messages) { state.messages.asReversed() }
    val uploadsById=remember(state.mediaUploads) { state.mediaUploads.associateBy { it.id } }
    val outboxById=remember(state.outbox) { state.outbox.associateBy { it.id } }
    var initialLatestScrollDone by remember(state.active?.target) { mutableStateOf(false) }
    val latestId=state.messages.lastOrNull()?.id
    var presenceNow by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(state.active?.target) { while(true) { delay(60_000);presenceNow=System.currentTimeMillis() } }
    LaunchedEffect(state.active?.target,state.messages.isNotEmpty(),state.focusMessageId) {
        if(!initialLatestScrollDone&&state.focusMessageId==null&&state.messages.isNotEmpty()) {
            withFrameNanos {}
            list.scrollToItem(0)
            initialLatestScrollDone=true
        }
    }
    LaunchedEffect(latestId) { if(state.focusMessageId==null&&list.firstVisibleItemIndex<3) list.scrollToItem(0) }
    // 自己发送的消息：无论当前浏览位置在哪，都跳回最新消息（与竞品一致）；他人消息仅贴底时跟随。
    val latestMineId=state.messages.lastOrNull { it.mine }?.id
    LaunchedEffect(latestMineId) { if(state.focusMessageId==null&&latestMineId!=null) list.scrollToItem(0) }
    LaunchedEffect(state.focusMessageId) { state.focusMessageId?.let { id -> val index=reversedMessages.indexOfFirst { it.id==id };if(index>=0)list.animateScrollToItem(index) } }
    LaunchedEffect(state.forwardSuccessId,state.forwardFailureId) {
        if(state.forwardSuccessId.isNotBlank())NativeNotices.show("转发成功")
        if(state.forwardFailureId.isNotBlank())NativeNotices.show(if(state.pendingForwards.firstOrNull { it.id==state.forwardFailureId }?.status=="uncertain")"转发结果待确认，请稍后查看" else "转发未完成，请稍后重试")
        if(state.forwardSuccessId.isNotBlank()||state.forwardFailureId.isNotBlank())callbacks.onConsumeForwardNotice(state.forwardSuccessId,state.forwardFailureId)
    }
    val historyState by rememberUpdatedState(state)
    val historyCallback by rememberUpdatedState(callbacks.onLoadHistory)
    LaunchedEffect(list,state.active?.target) {
        val gate=HistoryLoadGate()
        snapshotFlow {
            val current=historyState
            HistoryLoadSignal(list.isScrollInProgress,list.firstVisibleItemIndex>0||list.firstVisibleItemScrollOffset>0,
                current.messages.isNotEmpty()&&list.layoutInfo.visibleItemsInfo.any { it.index>=current.messages.lastIndex-5 },current.historyLoading,current.historyEnd,current.historyRevision,current.messages.size)
        }.collect { signal -> if(gate.shouldLoad(signal))historyCallback() }
    }
    val currentMessages by rememberUpdatedState(state.messages)
    LaunchedEffect(list,state.active?.target) {
        if(state.active?.target?.sessionType==3)snapshotFlow {
            val messages=currentMessages.asReversed()
            list.layoutInfo.visibleItemsInfo.mapNotNull { item -> messages.getOrNull(item.index)?.let { it.senderId.ifBlank { MessageContents.parse(it.serialized,it.text).senderId }.takeIf(String::isNotBlank) } }.distinct()
        }.distinctUntilChanged().collect { ids -> if(ids.isNotEmpty())callbacks.onLoadGroupMembers(ids) }
    }
    val rowEvents=remember {
        ChatRowEvents(
            onNotice={ notice=it },
            onImage={ url,msg -> image=url;imageMessage=msg },
            onVideo={ url,msg,local -> video=url;videoMessage=msg;videoLocal=local },
            onMerge={ merge=it },
            onInvite={ invite=it },
            onSelectBubble={ msg,anchor -> selectedAnchor=anchor;selected=msg },
            onUploadMenu={ uploadMenu=it },
            onAvatarMention={ avatarMention=it },
            onToggleSelection={ toggleSelection(it) },
            onOpenFile={ openFile(it) },
            onPlayingChange={ playing=it },
            currentPlaying={ playing },
        )
    }
    val roomScope=ChatDialogScope(
        text=textS,
        quoted=quotedS,
        selected=selectedS,
        uploadMenu=uploadMenuS,
        selectedAnchor=selectedAnchorS,
        invite=inviteS,
        forward=forwardS,
        multi=multiS,
        selection=selectionS,
        selectionOrder=selectionOrderS,
        forwardMode=forwardModeS,
        confirmMultiRecall=confirmMultiRecallS,
        recallReason=recallReasonS,
        avatarMention=avatarMentionS,
        multiForward=multiForwardS,
        confirmMultiDelete=confirmMultiDeleteS,
        confirmDelete=confirmDeleteS,
        confirmManage=confirmManageS,
        muteTarget=muteTargetS,
        pinTarget=pinTargetS,
        selectText=selectTextS,
        image=imageS,
        imageMessage=imageMessageS,
        video=videoS,
        videoMessage=videoMessageS,
        videoLocal=videoLocalS,
        notice=noticeS,
        plus=plusS,
        voiceMode=voiceModeS,
        preparing=preparingS,
        showVideoSource=showVideoSourceS,
        merge=mergeS,
        state=state,
        callbacks=callbacks,
        context=context,
        clipboard=clipboard,
        scope=scope,
        factor=factor,
        player=player,
        uploadsById=uploadsById,
        outboxById=outboxById,
        composerPanels=composerPanels,
        videoAlbum=videoAlbum,
        videoCameraPermission=videoCameraPermission,
        rpx={ rpx(it) },
        selectedMessages={ selectedMessages() },
        canRecall={ canRecall(it) },
        mentionMember={ mentionMember(it) },
        captureVideo={ captureVideo() },
        saveOriginal={ saveOriginal(it) },
        saveVideo={ url,file -> saveVideo(url,file) },
        addSticker={ addSticker(it) },
        openFile={ openFile(it) },
        deleteSelected={ deleteSelected() },
        recallSelected={ recallSelected() },
        showMentions=showMentionsS,
        composerCursor=composerCursorS,
        pickerKind=pickerKindS,
        failedMedia=failedMediaS,
        sending=sending,
        recalling=recalling,
        forwarding=forwarding,
        deleting=deleting,
        recording=recording,
        recordingSeconds=recordingSeconds,
        voiceWorking=voiceWorking,
        playing=playing,
        retryingMedia=retryingMedia,
        mentionKeyword=mentionKeyword,
        presenceNow=presenceNow,
        list=list,
        reversedMessages=reversedMessages,
        rowEvents=rowEvents,
        emoji=emoji,
        ownAvatar=ownAvatar,
        enterToSend=enterToSend,
        pick=pick,
        recordPermission=recordPermission,
        cameraPermission=cameraPermission,
        sendFile={ sendFile(it) },
        stopVoice={ stopVoice(it) },
        startVoice={ startVoice() },
        cancelVoice={ cancelVoice() },
        capture={ capture() },
        submitText={ submitText() },
        updateDraft={ updateDraft(it) },
        pickMention={ pickMention(it) },
    )
    ChatRoomBody(roomScope)
    ChatRoomDialogs(roomScope)
}

@Composable
internal fun ChatRoomLoadingState(state:ChatState,onRetry:()->Unit,modifier:Modifier=Modifier) {
    val factor=LocalConfiguration.current.screenWidthDp/750f
    fun rpx(value:Int)=(value*factor).dp
    val waiting=chatRoomWaiting(state)
    val detail=state.error?.takeIf(String::isNotBlank)
    Column(
        modifier.fillMaxWidth().background(ChatGray).semantics { contentDescription=if(waiting)"聊天记录加载中" else "聊天记录为空" }.padding(horizontal=rpx(24),vertical=rpx(20)),
        horizontalAlignment=Alignment.CenterHorizontally,
        verticalArrangement=Arrangement.Center,
    ) {
        if(waiting) {
            Column(Modifier.fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(rpx(14))) {
                repeat(4) { index ->
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement=if(index%2==0)Arrangement.Start else Arrangement.End,
                        verticalAlignment=Alignment.Top,
                    ) {
                        if(index%2==0)Box(Modifier.size(rpx(64)).clip(CircleShape).background(C.field))
                        Column(Modifier.padding(horizontal=rpx(12)).widthIn(max=(LocalConfiguration.current.screenWidthDp*.58f).dp)) {
                            Box(Modifier.fillMaxWidth(if(index%2==0) .82f else .64f).height(rpx(62)).clip(RoundedCornerShape(rpx(16))).background(if(index%2==0) C.field else C.field))
                            Spacer(Modifier.height(rpx(10)))
                            Box(Modifier.width(rpx(72)).height(rpx(18)).clip(RoundedCornerShape(rpx(4))).background(C.field))
                        }
                        if(index%2!=0)Box(Modifier.size(rpx(64)).clip(CircleShape).background(C.field))
                    }
                }
            }
            Spacer(Modifier.height(rpx(28)))
            CircularProgressIndicator(Modifier.size(rpx(32)),color=ChatBlue,strokeWidth=2.dp)
            Spacer(Modifier.height(rpx(14)))
            Text("正在加载最近消息…",color=ChatHint,fontSize=(24*factor).sp)
            Text("当前群最近消息会优先显示，更早记录随后补齐",color=ChatHint.copy(alpha=.8f),fontSize=(21*factor).sp,modifier=Modifier.padding(top=rpx(8)))
        } else {
            Text(if(detail!=null)"聊天记录暂未同步完成" else "暂无聊天记录",color=ChatHint,fontSize=(25*factor).sp)
            if(detail!=null)Text(detail,color=ChatHint,fontSize=(21*factor).sp,maxLines=3,modifier=Modifier.padding(top=rpx(10)))
            TextButton(onClick=onRetry){Text("重新加载",color=ChatBlue)}
        }
    }
}

internal fun chatRoomWaiting(state:ChatState):Boolean =
    state.error==null&&(state.historyLoading||state.historySyncing||state.sync==SyncStatus.RUNNING||!state.ready||state.store==StoreStatus.OPENING)

@Composable
internal fun ComposerAction(icon:Int,label:String,onClick:()->Unit) {
    val factor=LocalConfiguration.current.screenWidthDp/750f
    Column(Modifier.width((140*factor).dp).clickable(onClick=onClick),horizontalAlignment=Alignment.CenterHorizontally) {
        Box(Modifier.size((100*factor).dp).clip(RoundedCornerShape((20*factor).dp)).background(C.card),contentAlignment=Alignment.Center) { Image(painterResource(icon),label,Modifier.size((56*factor).dp),contentScale=ContentScale.Fit) }
        Text(label,Modifier.padding(top=(12*factor).dp),fontSize=(24*factor).sp,color=C.textSub)
    }
}
@Composable
internal fun ActionButton(label:String,action:()->Unit) { TextButton(onClick=action,modifier=Modifier.fillMaxWidth()) { Text(label) } }
@Composable
internal fun MultiSelectButton(label:String,modifier:Modifier,enabled:Boolean,primary:Boolean=false,danger:Boolean=false,onClick:()->Unit) {
    val factor=LocalConfiguration.current.screenWidthDp/750f
    Box(modifier.height((72*factor).dp).clip(RoundedCornerShape((16*factor).dp)).background(if(primary)C.primary else C.card).clickable(enabled=enabled,onClick=onClick),contentAlignment=Alignment.Center) {
        Text(label,color=(if(primary)Color.White else if(danger)C.danger else C.text).copy(alpha=if(enabled)1f else .4f),fontSize=(28*factor).sp,fontWeight=FontWeight.SemiBold,maxLines=1)
    }
}
// SimpleDateFormat 构造含 locale 查找，聊天列表每条消息每次重组都要格式化时间，线程内复用同一实例。
private val chatTimeFormat=object:ThreadLocal<SimpleDateFormat>() { override fun initialValue()=SimpleDateFormat("HH:mm",Locale.getDefault()) }
private val chatDayFormat=object:ThreadLocal<SimpleDateFormat>() { override fun initialValue()=SimpleDateFormat("yyyy-MM-dd",Locale.getDefault()) }
internal fun chatTime(time:Long)=runCatching { chatTimeFormat.get().format(Date(if(time<10_000_000_000)time*1000 else time)) }.getOrDefault("")
internal fun chatDayKey(time:Long)=runCatching { chatDayFormat.get().format(Date(if(time<10_000_000_000)time*1000 else time)) }.getOrDefault("")
internal fun chatDayLabel(time:Long):String {
    val millis=if(time<10_000_000_000)time*1000 else time
    val day=chatDayKey(time)
    val calendar=java.util.Calendar.getInstance()
    if(day==chatDayKey(calendar.timeInMillis))return "今天"
    calendar.add(java.util.Calendar.DATE,-1)
    if(day==chatDayKey(calendar.timeInMillis))return "昨天"
    return SimpleDateFormat("yyyy年M月d日",Locale.getDefault()).format(Date(millis))
}
internal fun duration(seconds:Long)="${seconds/60}:${(seconds%60).toString().padStart(2,'0')}"
internal fun fileSize(size:Long)=when { size>=1024*1024 -> "%.1f MB".format(size/1024f/1024f);size>=1024 -> "%.1f KB".format(size/1024f);else -> "$size B" }

/** SDK 全本地库检索与媒体档案；分页按原始 SDK 页推进，不按过滤后结果猜结束。 */
@Composable
fun NativeChatArchive(title:String,media:Boolean,onBack:()->Unit,search:(String,List<Int>,Int,Int,(Result<ChatSearchPage>)->Unit)->Unit,openMessage:(ChatMessage)->Unit={}) {
    val context=LocalContext.current
    val scope=rememberCoroutineScope()
    var keyword by remember { mutableStateOf("") }
    var category by remember { mutableIntStateOf(102) }
    var page by remember { mutableIntStateOf(0) }
    var generation by remember { mutableIntStateOf(0) }
    var loading by remember { mutableStateOf(false) }
    var end by remember { mutableStateOf(false) }
    var items by remember { mutableStateOf<List<ChatMessage>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    var image by remember { mutableStateOf<String?>(null) }
    var video by remember { mutableStateOf<String?>(null) }
    var playing by remember { mutableStateOf<String?>(null) }
    var download by remember { mutableStateOf(false) }
    var saveFile by remember { mutableStateOf<File?>(null) }
    val player=remember { VoicePlayer() }
    DisposableEffect(Unit) { onDispose { player.stop() } }
    val save=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("image/*")) { uri ->
        val file=saveFile
        if(uri!=null&&file!=null)scope.launch {
            val result=withContext(Dispatchers.IO) { runCatching { context.contentResolver.openOutputStream(uri)?.use { output -> file.inputStream().use { it.copyTo(output) } } ?: error("保存位置不可用") } }
            NativeNotices.show(if(result.isSuccess)"原图已保存到所选位置" else "原图保存失败，可重试")
        }
    }
    fun load(reset:Boolean=false) {
        if(loading&&!reset)return
        if(!media&&keyword.isBlank())return
        if(reset) { generation++;items=emptyList();page=0;end=false }
        val request=generation
        loading=true;error=null
        search(keyword.trim(),if(media)listOf(category) else emptyList(),page+1,40) { result -> onUI {
            if(request!=generation)return@onUI
            loading=false
            result.fold(onSuccess={ next -> page=next.page;end=next.end;items=mergeMessages(items,next.messages).asReversed() },onFailure={ error=it.message ?: "聊天记录读取失败，请重试" })
        } }
    }
    fun openContent(message:ChatMessage,content:MessageContent) {
        when(content.type) {
            102 -> if(content.url.isNotEmpty())image=content.url else NativeNotices.show("原图地址暂不可用")
            104 -> if(content.url.isNotEmpty())video=content.url else NativeNotices.show("视频地址暂不可用")
            103 -> if(playing==message.id) { player.stop();playing=null } else {
                playing=message.id
                scope.launch {
                    val source=voiceSource(context,message.id,content,"",false)
                    if(playing!=message.id)return@launch
                    if(source.isEmpty()) { playing=null;NativeNotices.show("语音暂无法播放");return@launch }
                    player.play(source,{ onUI { playing=null } },{ onUI { playing=null;NativeNotices.show("语音暂无法播放") } })
                }
            }
            105 -> {
                download=true
                scope.launch {
                    val result=withContext(Dispatchers.IO) { runCatching { MediaLoader.fetch(context,content.url) } }
                    download=false
                    result.fold(onSuccess={ runCatching { MediaIO.openFile(context,it,content.fileName) }.onFailure { NativeNotices.show("没有可打开此文件的应用") } },onFailure={ NativeNotices.show(it.message ?: "文件下载失败") })
                }
            }
        }
    }
    LaunchedEffect(category) { if(media)load(true) }
    Column(Modifier.fillMaxSize().background(ChatGray).statusBarsPadding().navigationBarsPadding()) {
        Row(Modifier.fillMaxWidth().height(52.dp).background(C.card).padding(horizontal=14.dp),verticalAlignment=Alignment.CenterVertically) {
            Image(painterResource(R.drawable.uni_icon_back),"返回",Modifier.size(24.dp).clickable(onClick=onBack))
            Text(if(media)"群媒体" else "搜索聊天记录",Modifier.weight(1f).padding(horizontal=16.dp),fontWeight=FontWeight.Medium,fontSize=17.sp)
        }
        Text(title,Modifier.fillMaxWidth().background(C.card).padding(horizontal=16.dp,vertical=6.dp),fontSize=13.sp,color=ChatHint,maxLines=1)
        if(media)Row(Modifier.fillMaxWidth().background(C.card).padding(10.dp),horizontalArrangement=Arrangement.SpaceAround) {
            listOf(102 to "图片",104 to "视频",105 to "文件",103 to "语音").forEach { (type,label) -> Text(label,Modifier.clickable { category=type }.padding(8.dp),color=if(category==type)ChatBlue else C.hint) }
        }
        Row(Modifier.fillMaxWidth().background(C.card).padding(12.dp),verticalAlignment=Alignment.CenterVertically) {
            BasicTextField(keyword,{ keyword=it.take(200) },Modifier.weight(1f).clip(RoundedCornerShape(8.dp)).background(C.field).padding(12.dp),singleLine=true,keyboardOptions=KeyboardOptions(imeAction=ImeAction.Search),keyboardActions=KeyboardActions(onSearch={ load(true) }),decorationBox={ inner -> if(keyword.isBlank())Text(if(media)"搜索文件名或内容" else "输入聊天关键字",color=ChatHint,fontSize=14.sp);inner() })
            TextButton(onClick={ load(true) }) { Text("搜索") }
        }
        Text("仅搜索本机已同步的聊天记录",Modifier.padding(horizontal=16.dp,vertical=8.dp),fontSize=12.sp,color=ChatHint)
        if(error!=null)Text(error.orEmpty()+" · 点按重试",Modifier.fillMaxWidth().background(C.warnBg).clickable(enabled=!loading) { load(page==0) }.padding(12.dp),fontSize=13.sp,color=C.warnText)
        if(download)Text("正在下载附件…",Modifier.padding(12.dp),fontSize=13.sp,color=ChatHint)
        LazyColumn(Modifier.weight(1f).fillMaxWidth(),contentPadding=PaddingValues(12.dp),verticalArrangement=Arrangement.spacedBy(10.dp)) {
            items(items,key={ it.id }) { message ->
                val content=remember(message.serialized,message.text) { MessageContents.parse(message.serialized,message.text) }
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(C.card).clickable { openContent(message,content) }.padding(12.dp)) {
                    Row(verticalAlignment=Alignment.CenterVertically) {
                        SharedAvatar(content.avatar,Modifier.size(32.dp))
                        Column(Modifier.weight(1f).padding(start=8.dp)) {
                            Text(message.sender.ifBlank { if(message.mine)"我" else "群成员" },fontSize=13.sp,color=C.hint)
                            Text(SimpleDateFormat("yyyy-MM-dd HH:mm",Locale.getDefault()).format(Date(if(message.time<10_000_000_000)message.time*1000 else message.time)),fontSize=11.sp,color=ChatHint)
                        }
                    }
                    Spacer(Modifier.height(10.dp))
                    when(content.type) {
                        102,104 -> Box(Modifier.size(180.dp,140.dp).clip(RoundedCornerShape(6.dp))) {
                            RemoteMediaImage(MediaURLs.image(content.thumbnail.ifEmpty { content.url }),Modifier.fillMaxSize(),scale=ContentScale.Fit,cacheUrls=listOf(content.url,content.thumbnail)+content.imageAlternatives)
                            if(content.type==104)Text("▶ ${duration(content.duration)}",Modifier.align(Alignment.Center).background(Color(0x77000000),RoundedCornerShape(5.dp)).padding(10.dp),color=Color.White)
                        }
                        105 -> { Text("▤  ${content.fileName}");Text(fileSize(content.size)+" · 点击打开",fontSize=12.sp,color=ChatHint,modifier=Modifier.padding(top=6.dp)) }
                        103 -> Text(if(playing==message.id)"■ 正在播放  ${content.duration}″" else "◖)))  ${content.duration}″",color=ChatBlue,modifier=Modifier.padding(vertical=8.dp))
                        else -> SelectionContainer { Text(content.text.ifBlank { message.text }) }
                    }
                    Text("定位到聊天",Modifier.padding(top=10.dp).clickable { openMessage(message) },fontSize=12.sp,color=ChatBlue)
                }
            }
            item {
                Box(Modifier.fillMaxWidth().padding(18.dp),contentAlignment=Alignment.Center) {
                    Text(if(loading)"读取中…" else if(end)if(items.isEmpty())"没有找到聊天记录" else "没有更多记录" else if(!media&&page==0)"输入关键字开始搜索" else "加载更多",Modifier.clickable(enabled=!loading&&!end) { load() },color=ChatHint,fontSize=13.sp)
                }
            }
        }
    }
    image?.let { url ->
        val pictures=items.map { MessageContents.parse(it.serialized,it.text) }.filter { it.type==102&&it.url.isNotEmpty() }.map { it.url }.distinct()
        val gallery=if(url in pictures)pictures else listOf(url)
        val start=gallery.indexOf(url).coerceAtLeast(0)
        ImagePreview(gallery,start,{ image=null },{ saveUrl ->
        if(!download) {
        download=true
        var done=false
        scope.launch { delay(400);if(!done)NativeNotices.show("正在保存原图…") }
        scope.launch {
            val result=withContext(Dispatchers.IO) { runCatching {
                val file=MediaLoader.fetch(context,MediaURLs.image(saveUrl,ImageVariant.ORIGINAL))
                val bounds=BitmapFactory.Options().apply { inJustDecodeBounds=true };BitmapFactory.decodeFile(file.path,bounds)
                val ext=when(bounds.outMimeType) { "image/png" -> "png";"image/gif" -> "gif";"image/webp" -> "webp";else -> "jpg" }
                val saved=MediaIO.saveToGallery(context,file,"图片-${System.currentTimeMillis()}.$ext",bounds.outMimeType ?: "image/jpeg",false)
                Triple(file,ext,saved)
            } }
            done=true;download=false
            result.fold(onSuccess={ (file,ext,saved) -> if(saved)NativeNotices.show("原图已保存到相册（易可聊）") else { NativeNotices.show("请在系统文件选择器中选择原图保存位置");saveFile=file;save.launch("图片-${System.currentTimeMillis()}.$ext") } },onFailure={ NativeNotices.show(it.message ?: "原图保存失败") })
        }
        }
    },saving=download) }
    video?.let { url -> VideoPreview(url,{ video=null },NativeNotices::show) }
}

@Composable
fun NativeFavoriteContent(type:String,content:String) {
    val parsed=remember(type,content) { FavoriteContents.parse(type,content) }
    val context=LocalContext.current
    val scope=rememberCoroutineScope()
    var image by remember { mutableStateOf(false) }
    var video by remember { mutableStateOf(false) }
    var playing by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var saveFile by remember { mutableStateOf<File?>(null) }
    val player=remember { VoicePlayer() }
    DisposableEffect(Unit) { onDispose { player.stop() } }
    val save=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("image/*")) { uri ->
        val file=saveFile
        if(uri!=null&&file!=null)scope.launch {
            val result=withContext(Dispatchers.IO) { runCatching { context.contentResolver.openOutputStream(uri)?.use { output -> file.inputStream().use { it.copyTo(output) } } ?: error("保存位置不可用") } }
            NativeNotices.show(if(result.isSuccess)"原图已保存到所选位置" else "保存失败，请重试")
        }
    }
    Column {
        when(parsed.type) {
            101 -> SelectionContainer { Text(parsed.text) }
            102 -> RemoteMediaImage(MediaURLs.image(parsed.url),Modifier.size(180.dp,140.dp).clip(RoundedCornerShape(8.dp)).clickable { image=true },scale=ContentScale.Fit,cacheUrls=listOf(parsed.url))
            104 -> Box(Modifier.size(180.dp,140.dp).clip(RoundedCornerShape(8.dp)).background(ChatGray).clickable { if(parsed.url.isNotEmpty())video=true else NativeNotices.show("视频地址不可用") },contentAlignment=Alignment.Center) {
                if(parsed.thumbnail.isNotBlank())RemoteMediaImage(MediaURLs.image(parsed.thumbnail),Modifier.fillMaxSize(),scale=ContentScale.Fit)
                Text("▶ ${duration(parsed.duration)}",Modifier.background(Color(0x77000000),RoundedCornerShape(5.dp)).padding(10.dp),color=Color.White)
            }
            103 -> Text(if(playing)"■ 正在播放  ${duration(parsed.duration)}" else "◖)))  语音 ${duration(parsed.duration)}",Modifier.clickable {
                if(playing) { player.stop();playing=false } else {
                    playing=true
                    scope.launch {
                        val source=voiceSource(context,"",parsed,"",false)
                        if(!playing)return@launch
                        if(source.isEmpty()) { playing=false;NativeNotices.show("语音暂无法播放");return@launch }
                        player.play(source,{ onUI { playing=false } },{ onUI { playing=false;NativeNotices.show("语音暂无法播放") } })
                    }
                }
            }.padding(vertical=12.dp),color=ChatBlue)
            105 -> Column(Modifier.clickable(enabled=!busy) {
                busy=true
                scope.launch {
                    val result=withContext(Dispatchers.IO) { runCatching { MediaLoader.fetch(context,parsed.url) } };busy=false
                    result.fold(onSuccess={ runCatching { MediaIO.openFile(context,it,parsed.fileName) }.onFailure { NativeNotices.show("没有可打开此文件的应用") } },onFailure={ NativeNotices.show(it.message ?: "文件下载失败") })
                }
            }) { Text("▤  ${parsed.fileName.ifBlank { "文件" }}");Text(if(busy)"下载中…" else "点击打开",color=ChatHint,fontSize=12.sp) }
            else -> Text("收藏内容暂不可读取",color=ChatHint)
        }
    }
    if(image)ImagePreview(listOf(parsed.url),0,{ image=false },{
        busy=true
        scope.launch {
            val result=withContext(Dispatchers.IO) { runCatching {
                val file=MediaLoader.fetch(context,MediaURLs.image(parsed.url,ImageVariant.ORIGINAL))
                val bounds=BitmapFactory.Options().apply { inJustDecodeBounds=true };BitmapFactory.decodeFile(file.path,bounds)
                val ext=when(bounds.outMimeType) { "image/png" -> "png";"image/gif" -> "gif";"image/webp" -> "webp";else -> "jpg" }
                val saved=MediaIO.saveToGallery(context,file,"图片-${System.currentTimeMillis()}.$ext",bounds.outMimeType ?: "image/jpeg",false)
                Triple(file,ext,saved)
            } };busy=false
            result.fold(onSuccess={ (file,ext,saved) ->
                if(saved)NativeNotices.show("原图已保存到相册") else { NativeNotices.show("请在系统文件选择器中选择原图保存位置");saveFile=file;save.launch("图片-${System.currentTimeMillis()}.$ext") }
            },onFailure={ NativeNotices.show("原图保存失败，可稍后重试") })
        }
    })
    if(video)VideoPreview(parsed.url,{ video=false },NativeNotices::show)
}

@Composable
fun NativeChatPicker(
    mode:String,targetTitle:String,onBack:()->Unit,
    load:(String,Int,Int,String,(Result<ChatPickerPage>)->Unit)->Unit,
    send:(ChatPickerItem,(Result<ChatMessage>)->Unit)->Unit,
    delete:(ChatPickerItem,(Result<Unit>)->Unit)->Unit,
) {
    var keyword by remember { mutableStateOf("") }
    var tab by remember { mutableIntStateOf(0) }
    var managing by remember { mutableStateOf(false) }
    var items by remember { mutableStateOf<List<ChatPickerItem>>(emptyList()) }
    var selected by remember { mutableStateOf<Set<String>>(emptySet()) }
    var page by remember { mutableIntStateOf(0) }
    var cursor by remember { mutableStateOf("") }
    var end by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var generation by remember { mutableIntStateOf(0) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirm by remember { mutableStateOf(false) }
    var preview by remember { mutableStateOf<ChatPickerItem?>(null) }
    fun fetch(reset:Boolean=false) {
        if(loading&&!reset)return
        if(reset) { generation++;items=emptyList();page=0;cursor="";end=false;selected=emptySet() }
        val operation=generation;loading=true;error=null
        load(keyword,tab,page+1,cursor) { result -> onUI {
            if(operation!=generation)return@onUI
            loading=false
            result.fold(onSuccess={ value -> items=(items+value.items).distinctBy { it.id };page=value.page;cursor=value.nextCursor;end=value.end },onFailure={ error=it.message ?: "列表读取失败，可重试" })
        } }
    }
    fun sendOne(item:ChatPickerItem) {
        busy=true;error=null
        send(item) { result -> onUI { busy=false;if(result.isSuccess)onBack() else error=result.exceptionOrNull()?.message ?: "发送结果待核对，请回到聊天确认" } }
    }
    fun runSelected() {
        val pending=items.filter { it.id in selected }
        if(pending.isEmpty())return
        val sendable=pending.filter { managing||it.type in setOf("text","emoji","image") }
        if(sendable.isEmpty()) { error="所选收藏暂不支持发送";return }
        busy=true;error=null
        var index=0
        fun next() {
            if(index>=sendable.size) { busy=false;if(managing)fetch(true) else { if(sendable.size<pending.size)error="已提交 ${sendable.size} 条，跳过 ${pending.size-sendable.size} 条不支持的类型" else onBack() };return }
            val item=sendable[index++]
            fun finished(result:Result<Unit>) { onUI {
                if(result.isFailure) { busy=false;error=result.exceptionOrNull()?.message ?: "操作未完成，可稍后重试" }
                else { selected=selected-item.id;if(managing)items=items.filterNot { it.id==item.id };next() }
            } }
            if(managing)delete(item,::finished) else send(item) { finished(it.map { Unit }) }
        }
        next()
    }
    LaunchedEffect(tab) { fetch(true) }
    LaunchedEffect(keyword) { if(mode=="card") { delay(300);fetch(true) } }
    val filtered=if(mode=="favorite"&&keyword.isNotBlank())items.filter { it.title.contains(keyword,true)||it.type.contains(keyword,true) } else items
    Column(Modifier.fillMaxSize().background(C.card).statusBarsPadding().navigationBarsPadding().imePadding()) {
        Row(Modifier.fillMaxWidth().height(52.dp).padding(horizontal=16.dp),verticalAlignment=Alignment.CenterVertically) {
            Image(painterResource(R.drawable.uni_icon_back),"返回",Modifier.size(24.dp).clickable(enabled=!busy,onClick=onBack))
            Text(if(mode=="card")"选择好友" else "我的收藏",Modifier.weight(1f).padding(horizontal=16.dp),fontSize=17.sp,fontWeight=FontWeight.Medium)
            if(mode=="favorite")Text(if(managing)"完成" else "管理",Modifier.clickable(enabled=!busy) { managing=!managing;selected=emptySet() },color=ChatBlue,fontSize=14.sp)
        }
        Text("发送给：$targetTitle",Modifier.padding(horizontal=20.dp,vertical=8.dp),fontSize=13.sp,color=ChatHint)
        if(mode=="favorite")Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceAround) { listOf("全部","文字","图片与视频","文件","语音").forEachIndexed { index,label -> Text(label,Modifier.clickable(enabled=!busy&&!loading) { tab=index }.padding(vertical=12.dp),color=if(tab==index)ChatBlue else C.hint,fontSize=12.sp) } }
        BasicTextField(keyword,{ if(!busy)keyword=it.take(200) },Modifier.fillMaxWidth().padding(horizontal=16.dp,vertical=8.dp).clip(RoundedCornerShape(8.dp)).background(C.field).padding(12.dp),singleLine=true,decorationBox={ inner -> if(keyword.isEmpty())Text(if(mode=="card")"搜索好友（含备注）" else "搜索已加载收藏",color=ChatHint,fontSize=14.sp);inner() })
        error?.let { Text(it,Modifier.fillMaxWidth().background(C.warnBg).padding(12.dp),color=C.warnText,fontSize=13.sp) }
        LazyColumn(Modifier.weight(1f).fillMaxWidth()) {
            items(filtered,key={ it.id }) { item ->
                Row(Modifier.fillMaxWidth().clickable(enabled=!busy) { if(mode=="card")sendOne(item) else selected=if(item.id in selected)selected-item.id else selected+item.id }.padding(horizontal=20.dp,vertical=13.dp),verticalAlignment=Alignment.CenterVertically) {
                    if(mode=="card")SharedAvatar(item.avatar,Modifier.size(42.dp)) else Text(if(item.id in selected)"●" else "○",Modifier.padding(end=14.dp),color=if(item.id in selected)ChatBlue else ChatHint,fontSize=23.sp)
                    Column(Modifier.weight(1f).padding(start=if(mode=="card")12.dp else 0.dp)) {
                        Text(item.title,maxLines=2,overflow=TextOverflow.Ellipsis,fontSize=15.sp)
                        if(mode=="favorite")Text(when(item.type) { "image" -> "图片";"video" -> "视频";"voice" -> "语音";"file" -> "文件";else -> "文字" },color=ChatHint,fontSize=12.sp)
                    }
                    if(mode=="card")Text(if(busy)"发送中…" else "发送",color=ChatBlue,fontSize=13.sp)
                    else Text("查看",Modifier.clickable { preview=item }.padding(start=10.dp),color=ChatBlue,fontSize=12.sp)
                }
            }
            item { Box(Modifier.fillMaxWidth().padding(18.dp),contentAlignment=Alignment.Center) { Text(if(loading)"读取中…" else if(end)if(items.isEmpty())"暂无内容" else "没有更多" else "加载更多",Modifier.clickable(enabled=!loading&&!end&&!busy) { fetch() },color=ChatHint,fontSize=13.sp) } }
        }
        if(mode=="favorite")TextButton(onClick={ if(managing)confirm=true else runSelected() },enabled=selected.isNotEmpty()&&!busy,modifier=Modifier.fillMaxWidth().padding(12.dp)) { Text(if(busy)"处理中…" else if(managing)"删除 ${selected.size} 条收藏" else "发送 ${selected.size} 条收藏",color=if(managing)C.danger else ChatBlue) }
    }
    if(confirm)AlertDialog(onDismissRequest={ confirm=false },title={ Text("删除所选收藏？") },text={ Text("将删除 ${selected.size} 条收藏。") },confirmButton={ TextButton(onClick={ confirm=false;runSelected() }) { Text("删除") } },dismissButton={ TextButton(onClick={ confirm=false }) { Text("取消") } })
    preview?.let { item -> AlertDialog(onDismissRequest={ preview=null },title={ Text("收藏内容") },text={ NativeFavoriteContent(item.type,item.content) },confirmButton={ TextButton(onClick={ preview=null }) { Text("关闭") } }) }
}

@Composable
internal fun ChatMentionPanel(keyword:String,load:(String,(Result<ChatMentionPage>)->Unit)->Unit,onClose:()->Unit,onPick:(ChatMentionChoice)->Unit) {
    var items by remember { mutableStateOf<List<ChatMentionChoice>>(emptyList()) }
    var cursor by remember { mutableStateOf("") }
    var end by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var canAll by remember { mutableStateOf(false) }
    fun fetch() {
        if(loading||end)return
        loading=true;error=null
        load(cursor) { result -> onUI { loading=false;result.fold(onSuccess={ page -> items=(items+page.items).distinctBy { it.userId };cursor=page.nextCursor;end=page.end;canAll=page.canAtAll },onFailure={ error=it.message ?: "群成员读取失败，可重试" }) } }
    }
    LaunchedEffect(Unit) { fetch() }
    val factor=LocalConfiguration.current.screenWidthDp/750f
    fun rpx(value:Int)=(value*factor).dp
    val filtered=items.filter { keyword.isBlank()||it.displayName.contains(keyword,true)||it.name.contains(keyword,true) }
    Column(Modifier.fillMaxWidth().background(C.card)) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(C.field))
        // 顶栏（灰底）：群主/管理员左侧显示「所有人」，右侧关闭
        Row(Modifier.fillMaxWidth().heightIn(min=rpx(88)).background(C.field).padding(horizontal=rpx(28)),verticalAlignment=Alignment.CenterVertically) {
            if(canAll)Row(Modifier.weight(1f).clickable { onPick(ChatMentionChoice("AtAllTag","所有人")) },verticalAlignment=Alignment.CenterVertically) {
                Box(Modifier.size(rpx(56)).clip(CircleShape).background(C.field),contentAlignment=Alignment.Center) { Image(painterResource(R.drawable.uni_icon_add_member),"所有人",Modifier.size(rpx(32))) }
                Text("所有人",Modifier.padding(start=rpx(20)),fontSize=rpx(30).value.sp,fontWeight=FontWeight.Medium,color=C.text)
            } else Spacer(Modifier.weight(1f))
            Text("×",Modifier.size(rpx(48)).clickable(onClick=onClose).wrapContentSize(),fontSize=rpx(40).value.sp,color=C.faint)
        }
        LazyColumn(Modifier.fillMaxWidth().heightIn(max=rpx(480))) {
            items(filtered,key={ it.userId }) { member ->
                Row(Modifier.fillMaxWidth().clickable { onPick(member) }.padding(horizontal=rpx(28),vertical=rpx(20)),verticalAlignment=Alignment.CenterVertically) {
                    SharedAvatar(member.avatar,Modifier.size(rpx(72)).clip(CircleShape))
                    Text(member.displayName,Modifier.weight(1f).padding(start=rpx(24)),fontSize=rpx(30).value.sp,color=C.text,maxLines=1,overflow=TextOverflow.Ellipsis)
                }
            }
            if(error!=null)item { Text(error.orEmpty(),Modifier.fillMaxWidth().clickable { fetch() }.padding(rpx(28)),color=C.warnText,fontSize=rpx(26).value.sp) }
            else if(filtered.isEmpty())item { Text(if(loading)"成员加载中…" else "无匹配成员",Modifier.fillMaxWidth().padding(horizontal=rpx(28),vertical=rpx(48)),fontSize=rpx(26).value.sp,color=C.faint,textAlign=androidx.compose.ui.text.style.TextAlign.Center) }
            else if(!end)item { Text(if(loading)"读取中…" else "加载更多成员",Modifier.fillMaxWidth().clickable(enabled=!loading) { fetch() }.padding(vertical=rpx(20)),fontSize=rpx(24).value.sp,color=C.faint,textAlign=androidx.compose.ui.text.style.TextAlign.Center) }
        }
    }
}

@Composable
fun NativeGlobalChatSearch(
    onBack:()->Unit,
    search:(String,Int,Int,(Result<ChatGlobalSearchPage>)->Unit)->Unit,
    open:(ChatGlobalHit)->Unit,
) {
    var keyword by remember { mutableStateOf("") }
    var hits by remember { mutableStateOf<List<ChatGlobalHit>>(emptyList()) }
    var page by remember { mutableIntStateOf(0) }
    var version by remember { mutableIntStateOf(0) }
    var loading by remember { mutableStateOf(false) }
    var end by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    fun load(reset:Boolean=false) {
        if(loading&&!reset)return
        if(keyword.isBlank())return
        if(reset) { version++;hits=emptyList();page=0;end=false }
        val request=version;loading=true;error=null
        search(keyword,page+1,60) { result -> onUI {
            if(request!=version)return@onUI
            loading=false
            result.fold(onSuccess={ next -> hits=(hits+next.hits).distinctBy { it.conversation.target.conversationId+"\u0000"+it.message.id };page=next.page;end=next.end },onFailure={ error=it.message ?: "搜索未完成，可重试" })
        } }
    }
    LaunchedEffect(keyword) { version++;loading=false;hits=emptyList();page=0;end=false;if(keyword.isNotBlank()) { delay(300);load(true) } }
    Column(Modifier.fillMaxSize().background(ChatGray).statusBarsPadding().navigationBarsPadding().imePadding()) {
        Row(Modifier.fillMaxWidth().background(C.card).padding(14.dp),verticalAlignment=Alignment.CenterVertically) {
            Image(painterResource(R.drawable.uni_icon_back),"返回",Modifier.size(24.dp).clickable(onClick=onBack))
            BasicTextField(keyword,{ keyword=it.take(200) },Modifier.weight(1f).padding(start=14.dp).clip(RoundedCornerShape(8.dp)).background(C.field).padding(12.dp),singleLine=true,keyboardOptions=KeyboardOptions(imeAction=ImeAction.Search),keyboardActions=KeyboardActions(onSearch={ load(true) }),decorationBox={ inner -> if(keyword.isEmpty())Text("搜索聊天记录",color=ChatHint);inner() })
        }
        Text("搜索本机已同步的全部会话",Modifier.padding(14.dp),fontSize=12.sp,color=ChatHint)
        error?.let { Text(it,Modifier.fillMaxWidth().background(C.warnBg).padding(12.dp),color=C.warnText,fontSize=13.sp) }
        LazyColumn(Modifier.weight(1f),contentPadding=PaddingValues(horizontal=12.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
            items(hits,key={ it.conversation.target.conversationId+"\u0000"+it.message.id }) { hit ->
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(C.card).clickable { open(hit) }.padding(12.dp),verticalAlignment=Alignment.CenterVertically) {
                    SharedAvatar(hit.conversation.avatar,Modifier.size(44.dp),hit.conversation.target.sessionType==3)
                    Column(Modifier.weight(1f).padding(start=12.dp)) { Text(hit.conversation.title,fontSize=15.sp,fontWeight=FontWeight.Medium);Text(hit.message.text,Modifier.padding(top=5.dp),maxLines=2,overflow=TextOverflow.Ellipsis,fontSize=13.sp,color=ChatHint) }
                    Text(chatTime(hit.message.time),fontSize=11.sp,color=ChatHint)
                }
            }
            item { TextButton(onClick={ load() },enabled=!loading&&!end&&keyword.isNotBlank(),modifier=Modifier.fillMaxWidth()) { Text(if(loading)"搜索中…" else if(end)if(hits.isEmpty())"未找到消息" else "没有更多记录" else if(keyword.isBlank())"请输入关键字" else "加载更多") } }
        }
    }
}

@Composable
internal fun GroupInviteCard(
    card:GroupMessageCard,
    mine:Boolean,
    foreground:Color,
    handledLabel:String?,
    onRequest:()->Unit,
) {
    val factor=LocalConfiguration.current.screenWidthDp/750f
    fun rpx(value:Int)=(value*factor).dp
    SharedAvatar(card.avatar,Modifier.size(rpx(100)),group=true)
    Text(card.groupName+(if(card.count>0)" (${card.count} 人)" else ""),Modifier.padding(top=rpx(16)),fontSize=(29*factor).sp,color=foreground,fontWeight=FontWeight.SemiBold)
    Text(if(mine)"你邀请对方加入群聊" else "邀请你加入群聊",Modifier.padding(top=rpx(10)),fontSize=(24*factor).sp,color=foreground.copy(alpha=.7f))
    if(!mine) {
        if(handledLabel!=null) Text(handledLabel,Modifier.padding(top=rpx(18)),color=ChatHint,fontSize=(26*factor).sp)
        else Text("点击申请入群",Modifier.padding(top=rpx(18)).clickable(onClick=onRequest),color=ChatBlue,fontSize=(26*factor).sp)
    }
}

@Composable
internal fun GroupInviteDialog(
    card:GroupMessageCard,
    callbacks:NativeChatCallbacks,
    onDismiss:()->Unit,
    onAccepted:(String)->Unit,
    onNotice:(String)->Unit,
) {
    var accepting by remember(card.token) { mutableStateOf(false) }
    AlertDialog(onDismissRequest={ if(!accepting)onDismiss() },title={ Text("确认加入群聊？") },text={ Text(card.groupName) },confirmButton={
        TextButton(enabled=!accepting,onClick={
            accepting=true
            callbacks.onAcceptGroupInvite(card.token) { result -> onUI {
                accepting=false
                result.fold(onSuccess={ value ->
                    onAccepted(when(value.nextAction) {
                        "joined","already_member" -> "已加入群聊"
                        else -> "已提交申请"
                    })
                    onDismiss()
                    when(value.nextAction) {
                        "joined","already_member" -> {
                            onNotice(if(value.nextAction=="joined")"已加入群聊" else "你已在群中")
                            callbacks.onOpenBusinessGroup(value.groupId.ifBlank { card.groupId })
                        }
                        "pending_approval" -> onNotice("已提交入群申请，等待管理员审核")
                    }
                },onFailure={ onDismiss();onNotice(it.message ?: "申请失败") })
            } }
        }) { Text(if(accepting)"处理中…" else "确认") }
    },dismissButton={ TextButton(enabled=!accepting,onClick=onDismiss) { Text("取消") } })
}

@Composable
fun NativeForwardPicker(
    messageCount:Int,onBack:()->Unit,
    load:(String,String,String,Int,(Result<ChatForwardPage>)->Unit)->Unit,
    submit:(ChatForwardSelection,(Result<ChatForwardResult>)->Unit)->Unit,
    onComplete:(ChatForwardResult)->Unit,
) {
    var tab by remember { mutableStateOf("recent") }
    var keyword by remember { mutableStateOf("") }
    var items by remember { mutableStateOf<List<ChatForwardTarget>>(emptyList()) }
    var selected by remember { mutableStateOf<Map<String,ChatForwardTarget>>(emptyMap()) }
    var allFriends by remember { mutableStateOf(false) }
    var excluded by remember { mutableStateOf<Set<String>>(emptySet()) }
    var cursor by remember { mutableStateOf("") }
    var offset by remember { mutableIntStateOf(0) }
    var total by remember { mutableIntStateOf(0) }
    var end by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var generation by remember { mutableIntStateOf(0) }
    var error by remember { mutableStateOf<String?>(null) }
    fun fetch(reset:Boolean=false) {
        if(loading&&!reset)return
        if(reset) { generation++;items=emptyList();cursor="";offset=0;end=false }
        val request=generation;loading=true;error=null
        load(tab,keyword,cursor,offset) { result -> onUI {
            if(request!=generation)return@onUI
            loading=false
            result.fold(onSuccess={ page -> items=(items+page.items).distinctBy { it.id };cursor=page.nextCursor;offset=page.nextOffset;end=page.end;if(tab=="contacts")total=page.total },onFailure={ error=it.message ?: "转发目标读取失败，可重试" })
        } }
    }
    fun checked(item:ChatForwardTarget)=if(allFriends&&item.kind=="contact"&&item.businessUserId.isNotBlank())item.businessUserId !in excluded else item.id in selected
    fun toggle(item:ChatForwardTarget) {
        if(allFriends&&item.kind=="contact"&&item.businessUserId.isNotBlank())excluded=if(item.businessUserId in excluded)excluded-item.businessUserId else excluded+item.businessUserId
        else selected=if(item.id in selected)selected-item.id else selected+(item.id to item)
    }
    val count=if(allFriends)maxOf(0,total-excluded.size)+selected.values.count { it.kind!="contact" } else selected.size
    LaunchedEffect(tab,keyword) { generation++;loading=false;delay(if(keyword.isBlank())0 else 300);fetch(true) }
    Column(Modifier.fillMaxSize().background(C.card).statusBarsPadding().navigationBarsPadding().imePadding()) {
        Row(Modifier.fillMaxWidth().height(52.dp).padding(horizontal=16.dp),verticalAlignment=Alignment.CenterVertically) {
            Image(painterResource(R.drawable.uni_icon_back),"返回",Modifier.size(24.dp).clickable(enabled=!busy,onClick=onBack))
            Text("转发给",Modifier.weight(1f).padding(start=16.dp),fontSize=17.sp,fontWeight=FontWeight.Medium)
            if(busy)CircularProgressIndicator(Modifier.size(20.dp),color=ChatBlue,strokeWidth=2.dp)
            else Text("传送",Modifier.clickable(enabled=count>0||allFriends) {
                busy=true;error=null
                val targets=selected.values.filter { !allFriends||it.kind=="group" }
                submit(ChatForwardSelection(targets,allFriends,excluded)) { result -> onUI { busy=false;result.fold(onSuccess=onComplete,onFailure={ error=it.message ?: "转发未完成，请回聊天核对" }) } }
            }.padding(8.dp),color=if(count>0||allFriends)ChatBlue else ChatHint)
        }
        BasicTextField(keyword,{ if(!busy)keyword=it.take(200) },Modifier.fillMaxWidth().padding(horizontal=16.dp,vertical=10.dp).clip(RoundedCornerShape(7.dp)).background(C.field).padding(12.dp),singleLine=true,decorationBox={ inner -> if(keyword.isBlank())Text("搜索",color=ChatHint);inner() })
        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceAround) { listOf("recent" to "最近聊天","contacts" to "联络人","groups" to "群组","tags" to "标签").forEach { (key,label) -> Text(label,Modifier.clickable(enabled=!busy) { tab=key }.padding(vertical=13.dp),fontSize=14.sp,color=if(tab==key)ChatBlue else C.hint) } }
        Row(Modifier.fillMaxWidth().padding(horizontal=18.dp,vertical=8.dp),verticalAlignment=Alignment.CenterVertically) {
            Text("已选 $count 个目标 · $messageCount 条消息",Modifier.weight(1f),fontSize=12.sp,color=ChatHint)
            Text(if(tab=="contacts"&&keyword.isBlank())if(allFriends&&excluded.isEmpty())"取消全选" else "全部好友" else "全选本页",Modifier.clickable(enabled=!busy) {
                if(tab=="contacts"&&keyword.isBlank()) { allFriends=!allFriends;excluded=emptySet();selected=selected.filterValues { it.kind!="contact" } }
                else {
                    val all=items.isNotEmpty()&&items.all(::checked)
                    items.forEach { item -> if(checked(item)==all)toggle(item) }
                }
            },color=ChatBlue,fontSize=12.sp)
        }
        error?.let { Text(it,Modifier.fillMaxWidth().background(C.warnBg).padding(12.dp),color=C.warnText,fontSize=13.sp) }
        LazyColumn(Modifier.weight(1f)) {
            // 首屏加载期间给明确反馈，避免列表空白 1 秒后内容突然出现。
            if(items.isEmpty()&&loading&&!busy)item { Box(Modifier.fillParentMaxSize(),contentAlignment=Alignment.Center) { Column(horizontalAlignment=Alignment.CenterHorizontally) { CircularProgressIndicator(Modifier.size(30.dp),color=ChatBlue,strokeWidth=3.dp);Text("正在读取转发目标…",Modifier.padding(top=12.dp),fontSize=14.sp,color=ChatHint) } } }
            items(items,key={ it.id }) { item -> Row(Modifier.fillMaxWidth().clickable(enabled=!busy) { toggle(item) }.padding(horizontal=18.dp,vertical=12.dp),verticalAlignment=Alignment.CenterVertically) {
                Text(if(checked(item))"●" else "○",Modifier.padding(end=14.dp),fontSize=23.sp,color=if(checked(item))ChatBlue else ChatHint)
                if(item.kind=="tag")Box(Modifier.size(42.dp).background(C.field,CircleShape),contentAlignment=Alignment.Center) { Text("#",color=ChatBlue,fontSize=22.sp) } else SharedAvatar(item.avatar,Modifier.size(42.dp),item.kind=="group")
                Text(item.name,Modifier.weight(1f).padding(start=12.dp),fontSize=15.sp,maxLines=1,overflow=TextOverflow.Ellipsis)
            } }
            item { TextButton(onClick={ fetch() },enabled=!busy&&!loading&&!end,modifier=Modifier.fillMaxWidth()) { Text(if(loading)"读取中…" else if(end)if(items.isEmpty())"暂无目标" else "没有更多" else "加载更多") } }
        }
    }
}
