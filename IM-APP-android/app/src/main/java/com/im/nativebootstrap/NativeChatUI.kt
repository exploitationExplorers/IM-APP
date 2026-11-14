package com.im.nativebootstrap

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.os.Handler
import android.os.Looper
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
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
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.PointerEventPass
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

private val ChatGray=Color(0xFFE6E8EE)
private val ChatBlue=Color(0xFF2B5CFF)
private val ChatHint=Color(0xFF9AA3B5)
private fun onUI(action:()->Unit) { if(Looper.myLooper()==Looper.getMainLooper())action() else Handler(Looper.getMainLooper()).post(action) }

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun NativeChatRoom(state:ChatState,callbacks:NativeChatCallbacks,ownAvatar:String="",enterToSend:Boolean=false) {
    val context=LocalContext.current
    val focus=LocalFocusManager.current
    val keyboard=LocalSoftwareKeyboardController.current
    val clipboard=LocalClipboardManager.current
    val scope=rememberCoroutineScope()
    val list=rememberLazyListState()
    val factor=LocalConfiguration.current.screenWidthDp/750f
    fun rpx(value:Int)=(value*factor).dp
    var text by remember(state.active?.target) { mutableStateOf("") }
    var quoted by remember(state.active?.target) { mutableStateOf<ChatMessage?>(null) }
    var selected by remember { mutableStateOf<ChatMessage?>(null) }
    var uploadMenu by remember { mutableStateOf<PendingMediaUpload?>(null) }
    var selectedAnchor by remember { mutableStateOf<Offset?>(null) }
    var invite by remember { mutableStateOf<GroupMessageCard?>(null) }
    var acceptingInvite by remember { mutableStateOf(false) }
    var forward by remember { mutableStateOf<ChatMessage?>(null) }
    var multi by remember { mutableStateOf(false) }
    var selection by remember { mutableStateOf<Set<String>>(emptySet()) }
    var selectionOrder by remember { mutableStateOf<List<String>>(emptyList()) }
    var forwardMode by remember { mutableStateOf(false) }
    var confirmMultiRecall by remember { mutableStateOf(false) }
    var recalling by remember { mutableStateOf(false) }
    var recallReason by remember { mutableStateOf("") }
    var avatarMention by remember { mutableStateOf<ChatMessage?>(null) }
    var multiForward by remember { mutableStateOf<List<ChatMessage>?>(null) }
    var forwarding by remember { mutableStateOf(false) }
    var confirmMultiDelete by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf<ChatMessage?>(null) }
    var confirmManage by remember { mutableStateOf<Pair<ChatMessage,ChatAction>?>(null) }
    var muteTarget by remember { mutableStateOf<ChatMessage?>(null) }
    var pinTarget by remember { mutableStateOf<ChatMessage?>(null) }
    var selectText by remember { mutableStateOf<String?>(null) }
    var image by remember { mutableStateOf<String?>(null) }
    var video by remember { mutableStateOf<String?>(null) }
    var videoMessage by remember { mutableStateOf<ChatMessage?>(null) }
    var videoLocal by remember { mutableStateOf<LocalMedia?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(notice) { notice?.let { NativeNotices.show(it);notice=null } }
    LaunchedEffect(state.error) { state.error?.let(NativeNotices::show) }
    var plus by remember { mutableStateOf(false) }
    var emoji by remember { mutableStateOf(false) }
    var voiceMode by remember { mutableStateOf(false) }
    var recording by remember { mutableStateOf(false) }
    var recordingSeconds by remember { mutableIntStateOf(0) }
    var recordingStarted by remember { mutableLongStateOf(0) }
    var voiceDraft by remember { mutableStateOf<LocalMedia?>(null) }
    var voiceWorking by remember { mutableStateOf(false) }
    var voiceOperation by remember { mutableLongStateOf(0) }
    var playing by remember { mutableStateOf<String?>(null) }
    var pickerKind by remember { mutableStateOf(MediaKind.IMAGE) }
    var preparing by remember { mutableStateOf(false) }
    var failedMedia by remember { mutableStateOf<List<LocalMedia>>(emptyList()) }
    var retryingMedia by remember { mutableStateOf<Set<String>>(emptySet()) }
    var saveFile by remember { mutableStateOf<File?>(null) }
    var cameraFile by remember { mutableStateOf<File?>(null) }
    var capturedVideo by remember { mutableStateOf<File?>(null) }
    var showVideoSource by remember { mutableStateOf(false) }
    var merge by remember { mutableStateOf<ChatMessage?>(null) }
    var showMentions by remember { mutableStateOf(false) }
    var atStart by remember { mutableIntStateOf(-1) }
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
        voiceMode=true;plus=false;emoji=false;voiceWorking=true
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
            plus=false;emoji=false;showMentions=false
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
        preparing=true
        scope.launch {
            val result=withContext(Dispatchers.IO) { runCatching {
                val original=MediaURLs.image(url,ImageVariant.ORIGINAL)
                val file=MediaLoader.fetch(context,original)
                val bounds=BitmapFactory.Options().apply { inJustDecodeBounds=true };BitmapFactory.decodeFile(file.path,bounds)
                val extension=when(bounds.outMimeType) { "image/png" -> "png";"image/gif" -> "gif";"image/webp" -> "webp";"image/heif","image/heic" -> "heic";else -> "jpg" }
                val saved=MediaIO.saveToGallery(context,file,"图片-${System.currentTimeMillis()}.$extension",bounds.outMimeType ?: "image/jpeg",false)
                Triple(file,extension,saved)
            } }
            preparing=false
            result.fold(onSuccess={ (file,extension,saved) -> if(saved)notice="原图已保存到相册" else { notice="请在系统文件选择器中选择原图保存位置";saveFile=file;save.launch("图片-${System.currentTimeMillis()}.$extension") } },onFailure={ notice=it.message ?: "原图保存失败" })
        }
    }
    fun saveVideo(url:String,ownedFile:File?=null) {
        preparing=true
        scope.launch {
            val result=withContext(Dispatchers.IO) { runCatching {
                val file=ownedFile?.let { OwnedVideoFiles.verified(it,state.mediaOwnerDirectory.takeIf(String::isNotBlank)?.let(::File),File(context.filesDir,"native-chat")) } ?: MediaLoader.fetch(context,MediaURLs.playback(url))
                val saved=MediaIO.saveToGallery(context,file,"视频-${System.currentTimeMillis()}.mp4","video/mp4",true)
                file to saved
            } }
            preparing=false
            result.fold(onSuccess={ (file,saved) -> if(saved)notice="视频已保存到相册" else { notice="请在系统文件选择器中选择视频保存位置";saveFile=file;save.launch("视频-${System.currentTimeMillis()}.mp4") } },onFailure={ notice=it.message ?: "视频保存失败" })
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
        if(!state.ready||text.isBlank()||state.sendBlockedReason!=null)return
        val draft=text;val reply=quoted
        callbacks.onSendText(draft,reply) { accepted -> onUI { if(accepted&&text==draft) { text="";quoted=null } } }
    }
    fun updateDraft(value:String) {
        text=value.take(6000).replace('＠','@')
        if(state.active?.target?.sessionType==3) {
            val match=Regex("(^|[\\s\\n])@([^\\s@]*)$").find(text)
            if(match!=null) { atStart=text.length-match.groupValues[2].length-1;showMentions=true;plus=false;emoji=false }
        }
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
        val messages=selectedMessages().filter { it.seq>0 }
        recalling=true
        var index=0;var success=0;var failed=0
        fun next() {
            if(index>=messages.size) {
                recalling=false
                if(failed==0) { multi=false;selection=emptySet();selectionOrder=emptyList() }
                notice="已撤回 $success 条"+if(failed>0)"，$failed 条未完成，保留选择可核对或重试" else ""
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
    val latestId=state.messages.lastOrNull()?.id
    var presenceNow by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(state.active?.target) { while(true) { delay(60_000);presenceNow=System.currentTimeMillis() } }
    LaunchedEffect(latestId) { if(list.firstVisibleItemIndex<3) list.animateScrollToItem(0) }
    LaunchedEffect(state.focusMessageId) { state.focusMessageId?.let { id -> val index=state.messages.asReversed().indexOfFirst { it.id==id };if(index>=0)list.animateScrollToItem(index) } }
    LaunchedEffect(state.forwardSuccessId,state.forwardFailureId) {
        if(state.forwardSuccessId.isNotBlank())NativeNotices.show("转发成功")
        if(state.forwardFailureId.isNotBlank())NativeNotices.show("转发未完成，请稍后重试")
        if(state.forwardSuccessId.isNotBlank()||state.forwardFailureId.isNotBlank())callbacks.onConsumeForwardNotice(state.forwardSuccessId,state.forwardFailureId)
    }
    LaunchedEffect(list,state.historyLoading,state.historyEnd,state.messages.size) {
        if(!state.historyLoading&&!state.historyEnd&&state.messages.isNotEmpty())snapshotFlow {
            list.isScrollInProgress&&list.layoutInfo.visibleItemsInfo.any { it.index>=state.messages.lastIndex-4 }
        }.distinctUntilChanged().collect { nearOldest -> if(nearOldest)callbacks.onLoadHistory() }
    }
    LaunchedEffect(list,state.active?.target,state.messages) {
        if(state.active?.target?.sessionType==3)snapshotFlow {
            list.layoutInfo.visibleItemsInfo.mapNotNull { item -> state.messages.asReversed().getOrNull(item.index)?.let { MessageContents.parse(it.serialized,it.text).senderId.takeIf(String::isNotBlank) } }.distinct()
        }.distinctUntilChanged().collect { ids -> if(ids.isNotEmpty())callbacks.onLoadGroupMembers(ids) }
    }
    Column(Modifier.fillMaxSize().background(ChatGray).statusBarsPadding().navigationBarsPadding().then(if(!emoji&&!plus)Modifier.imePadding() else Modifier)) {
        Row(Modifier.fillMaxWidth().height(rpx(110)).background(Color.White).padding(horizontal=rpx(26)),verticalAlignment=Alignment.CenterVertically) {
            Box(Modifier.size(rpx(52)).clickable(onClick=callbacks.onBack),contentAlignment=Alignment.Center) { Image(painterResource(R.drawable.uni_icon_back),"返回",Modifier.size(rpx(44)),contentScale=ContentScale.Fit) }
            Column(Modifier.weight(1f).combinedClickable(onClick=callbacks.onOpenDetails,onLongClick={ clipboard.setText(AnnotatedString(state.active?.title.orEmpty()));notice="已复制聊天名称" }).padding(horizontal=rpx(8)),horizontalAlignment=Alignment.Start) {
                Text(if(multi)"已选择 ${selection.size} 条消息" else state.active?.title ?: "聊天",fontSize=(34*factor).sp,fontWeight=FontWeight.Bold,color=Color(0xFF111111),maxLines=1,overflow=TextOverflow.Ellipsis)
                if(state.connection!=ConnectionState.CONNECTED)Text(if(state.connection==ConnectionState.CONNECTING) "连接中…" else "连接暂不可用",color=ChatHint,fontSize=(20*factor).sp)
                else if(state.active?.target?.sessionType==1)ChatSystemMessages.lastSeen(state.peerLastSeenAt,state.peerOnline==true,presenceNow).takeIf { it.isNotBlank() }?.let { Text(it,color=ChatHint,fontSize=(20*factor).sp) }
            }
            if(multi)Text("取消",Modifier.clickable(enabled=!deleting&&!forwarding&&!recalling) { multi=false;selection=emptySet();selectionOrder=emptyList();if(forwardMode)quoted=null;forwardMode=false },fontSize=14.sp,color=ChatBlue)
            else Canvas(Modifier.size(rpx(52)).semantics { contentDescription="聊天详情" }.clickable(onClick=callbacks.onOpenDetails)) {
                val gap=size.width*.23f
                listOf(-1,0,1).forEach { index -> drawCircle(Color(0xFF444444),size.width*.043f,Offset(size.width/2+index*gap,size.height/2)) }
            }
        }
        if(state.showAnnouncementBanner&&state.groupAnnouncement.isNotBlank())Row(Modifier.fillMaxWidth().height(rpx(72)).background(Color.White).padding(horizontal=rpx(24)),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(rpx(16))) {
            Image(painterResource(R.drawable.uni_icon_megaphone),"群公告",Modifier.size(rpx(36)),contentScale=ContentScale.Fit)
            Text(state.groupAnnouncement,Modifier.weight(1f).clickable { if(state.groupBusinessId.isNotBlank())callbacks.onOpenAnnouncements(state.groupBusinessId) },fontSize=(26*factor).sp,color=Color(0xFF212121),maxLines=1,overflow=TextOverflow.Ellipsis)
            Text("不再提示",Modifier.clickable(onClick=callbacks.onDismissAnnouncement),color=Color(0xFF0A2FC2),fontSize=(26*factor).sp)
        }
        state.active?.pinnedMessage?.takeIf { state.showPinnedBanner }?.let { pin -> Row(Modifier.fillMaxWidth().background(Color.White).clickable {
            callbacks.onAction(ChatMessage(pin.clientMsgID,pin.preview,false,0),ChatAction.OPEN_PIN) { result -> onUI { if(result.isFailure)notice=result.exceptionOrNull()?.message ?: "置顶消息暂不可读取" } }
        }.padding(horizontal=16.dp,vertical=8.dp),verticalAlignment=Alignment.CenterVertically) {
            Box(Modifier.width(3.dp).height(32.dp).background(ChatBlue))
            Column(Modifier.weight(1f).padding(start=10.dp)) { Text(if(pin.scope=="shared")"置顶消息" else "仅为我置顶",color=ChatBlue,fontSize=12.sp);Text(pin.preview,maxLines=1,overflow=TextOverflow.Ellipsis,fontSize=13.sp,color=Color(0xFF5B6478)) }
            Text("×",Modifier.clickable(onClick=callbacks.onDismissPin).padding(10.dp),color=ChatHint)
        } }
        state.outbox.filter { MessageContents.isPinSync(it.message.serialized)&&it.state in setOf(OutboxState.UNCERTAIN,OutboxState.FAILED) }.forEach { entry -> Text("置顶同步结果待核对 · 点击核对",Modifier.fillMaxWidth().background(Color(0xFFFFF5DF)).clickable { callbacks.onReconcile(entry.id) }.padding(10.dp),color=Color(0xFF805F29),fontSize=12.sp) }
        failedMedia.forEach { media -> Row(Modifier.fillMaxWidth().background(Color(0xFFFFF5DF)).padding(horizontal=12.dp,vertical=6.dp),verticalAlignment=Alignment.CenterVertically) {
            Text("待上传：${media.name}",Modifier.weight(1f),maxLines=1,overflow=TextOverflow.Ellipsis,fontSize=12.sp,color=Color(0xFF805F29))
            TextButton(enabled=!state.uploading&&media.file.absolutePath !in retryingMedia,onClick={ sendFile(media) }) { Text("重试上传") }
            TextButton(enabled=media.file.absolutePath !in retryingMedia,onClick={ failedMedia=failedMedia.filterNot { it.file==media.file };media.file.delete();media.snapshot?.delete() }) { Text("移除草稿") }
        } }
        LazyColumn(Modifier.weight(1f).fillMaxWidth(),state=list,reverseLayout=true,contentPadding=PaddingValues(vertical=rpx(20))) {
            itemsIndexed(state.messages.asReversed(),key={ _,message -> message.id }) { index,message ->
                // 倒序列表中每条消息只提供一个布局根，日期与气泡按正常顺序排布。
                Column(Modifier.fillMaxWidth()) {
                val content=remember(message.serialized,message.text) { MessageContents.parse(message.serialized,message.text) }
                val upload=state.mediaUploads.firstOrNull { it.id==message.id }
                val localVideo=if(content.type==104)(upload?.media() ?: state.localSentMedia[message.id]) else null
                var bubbleBounds by remember(message.id) { mutableStateOf<Rect?>(null) }
                val older=state.messages.asReversed().getOrNull(index+1)
                if(older==null||chatDayKey(older.time)!=chatDayKey(message.time))Box(Modifier.fillMaxWidth().padding(vertical=rpx(12)),contentAlignment=Alignment.Center) { Text(chatDayLabel(message.time),Modifier.clip(RoundedCornerShape(rpx(12))).background(Color(0xFFD8DBE2)).padding(horizontal=rpx(18),vertical=rpx(7)),color=Color(0xFF7A8090),fontSize=(22*factor).sp) }
                val legacySystem=content.senderId=="imAdmin"&&(content.text=="新群创建成功，一起来聊天吧"||Regex("^(群主|管理员)清除了「.+」的全部消息$").matches(content.text))
                if(message.serialized.isBlank()||content.type>=1000||content.type==0||legacySystem) {
                    val system=if(content.type>=1000)ChatSystemMessages.format(message.serialized,state.groupOwnerName.ifBlank { "群主" }) { id -> state.groupMembers[id]?.name.orEmpty() } else content.text.ifBlank { message.text }
                    if(system.isNotBlank())Box(Modifier.fillMaxWidth().padding(rpx(12)),contentAlignment=Alignment.Center) { Text(system.replace("imAdmin",state.groupOwnerName.ifBlank { "群主" }),color=ChatHint,fontSize=(23*factor).sp) }
                } else {
                    Row(Modifier.fillMaxWidth().padding(horizontal=rpx(24),vertical=rpx(16)),horizontalArrangement=if(message.mine)Arrangement.End else Arrangement.Start,verticalAlignment=Alignment.Top) {
                        if(multi&&upload==null)Text(if(message.id in selection)"●" else "○",Modifier.clickable(enabled=!deleting&&!forwarding&&!recalling) { toggleSelection(message) }.padding(end=8.dp,top=8.dp),color=if(message.id in selection)ChatBlue else ChatHint,fontSize=22.sp)
                        if(!message.mine)SharedAvatar(content.avatar,Modifier.size(rpx(72)).combinedClickable(onClick={ if(multi)toggleSelection(message) else if(content.senderId.isNotEmpty())callbacks.onOpenPeer(content.senderId) },onLongClick={ if(!multi&&state.active?.target?.sessionType==3)avatarMention=message }))
                        Column(Modifier.widthIn(max=(LocalConfiguration.current.screenWidthDp*.70f).dp).padding(horizontal=rpx(16)),horizontalAlignment=if(message.mine)Alignment.End else Alignment.Start) {
                            if(state.active?.target?.sessionType==3) {
                                val member=state.groupMembers[content.senderId]
                                val role=member?.role ?: if(message.mine)state.groupRole else ""
                                if(!message.mine||role in setOf("owner","admin"))Row(Modifier.padding(bottom=rpx(8)),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(rpx(8))) {
                                    if(!message.mine)Text(member?.name?.ifBlank { message.sender } ?: message.sender,Modifier.combinedClickable(onClick={},onLongClick={ clipboard.setText(AnnotatedString(member?.name?.ifBlank { message.sender } ?: message.sender));notice="已复制昵称" }),color=ChatHint,fontSize=(22*factor).sp,maxLines=1,overflow=TextOverflow.Ellipsis)
                                    if(role in setOf("owner","admin"))Text(if(role=="owner")"群主" else "管理员",Modifier.border(rpx(2),if(role=="admin")ChatBlue else Color(0xFFC5CAD6),RoundedCornerShape(rpx(6))).padding(horizontal=rpx(8)),color=if(role=="admin")ChatBlue else Color(0xFF636E86),fontSize=(18*factor).sp,lineHeight=(26*factor).sp)
                                }
                            }
                            val shape=RoundedCornerShape(topStart=rpx(if(message.mine)16 else 4),topEnd=rpx(if(message.mine)4 else 16),bottomStart=rpx(16),bottomEnd=rpx(16))
                            val isVisual=content.type==102||content.type==104
                            val background=if(isVisual)Color.Transparent else if(content.groupCard!=null)Color.White else if(message.mine)ChatBlue else Color.White
                            val foreground=if(message.mine&&content.groupCard==null)Color.White else Color(0xFF222222)
                            Box(Modifier.onGloballyPositioned { bubbleBounds=it.boundsInWindow() }.clip(shape).background(background).combinedClickable(onClick={
                                if(upload!=null&&content.type!=104) { if(upload.state==MediaUploadState.FAILED)callbacks.onRetryUpload(upload.id);return@combinedClickable }
                                if(multi) { if(!deleting&&!recalling)toggleSelection(message);return@combinedClickable }
                                
                                when(content.type) {
                                    102 -> if(content.url.isNotEmpty())image=content.url else notice="图片原图地址不可用"
                                    103 -> if(playing==message.id) { player.stop();playing=null } else { playing=message.id;player.play(content.url,{ onUI { playing=null } },{ onUI { playing=null;notice="语音播放失败，可稍后重试" } }) }
                                    104 -> if(content.url.isNotEmpty()||localVideo?.file?.isFile==true) { videoMessage=message;videoLocal=localVideo;video=content.url } else notice="视频仍在准备，请稍后点按"
                                    105 -> openFile(content)
                                    108 -> if(content.cardUserId.isNotEmpty())callbacks.onOpenPeer(content.cardUserId)
                                    107 -> merge=message
                                }
                            },onLongClick={ if(!multi) { if(upload!=null)uploadMenu=upload else { selectedAnchor=bubbleBounds?.let { Offset(it.center.x,it.bottom) };selected=message } } }).then(if(isVisual)Modifier else Modifier.padding(horizontal=rpx(22),vertical=rpx(18)))) {
                                when(content.type) {
                                    104 -> VideoMessageBubble(content,localPoster=localVideo?.snapshot,sending=upload?.state==MediaUploadState.UPLOADING||state.outbox.any { it.id==message.id&&it.state in setOf(OutboxState.PENDING,OutboxState.SENDING) })
                                    102 -> {
                                        val maxWidth=210f*factor/.52f
                                        val width=if(content.width>0&&content.height>0)minOf(maxWidth,maxOf(90f,maxWidth*content.width/content.height)) else 170f
                                        val height=if(content.width>0&&content.height>0)(width*content.height/content.width).coerceIn(80f,260f) else 160f
                                        Box(Modifier.size(width.dp,height.dp).clip(RoundedCornerShape(rpx(12)))) {
                                            if(upload!=null||content.thumbnail.isNotEmpty()||content.url.isNotEmpty())RemoteMediaImage(MediaURLs.image(content.thumbnail.ifEmpty { content.url }),Modifier.fillMaxSize(),scale=ContentScale.Fit,fallbackUrls=content.imageAlternatives.map { MediaURLs.image(it) },localDraft=upload?.media()?.file,retryOnTap=false)
                                            else Box(Modifier.fillMaxSize().background(Color(0xFFCDD3E0)),contentAlignment=Alignment.Center) { Text("视频",color=ChatHint) }
                                            if(content.type==104)Text("▶",Modifier.align(Alignment.Center).background(Color(0x77000000),CircleShape).padding(14.dp),color=Color.White,fontSize=24.sp)
                                            if(content.type==104)Text(duration(content.duration),Modifier.align(Alignment.BottomEnd).padding(6.dp),color=Color.White,fontSize=12.sp)
                                            if(upload?.state==MediaUploadState.UPLOADING||state.outbox.any { it.id==message.id&&it.state in setOf(OutboxState.PENDING,OutboxState.SENDING) })Box(Modifier.align(Alignment.Center).size(38.dp).background(Color(0x66000000),CircleShape).semantics { contentDescription="图片正在发送" },contentAlignment=Alignment.Center) { CircularProgressIndicator(Modifier.size(22.dp),strokeWidth=2.dp,color=Color.White) }
                                        }
                                    }
                                    103 -> Row(Modifier.widthIn(min=90.dp,max=180.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.SpaceBetween) { Text(if(playing==message.id) "■ 播放中" else "◖)))",color=foreground);Text("${content.duration}″",color=foreground) }
                                    105 -> Column(Modifier.widthIn(min=140.dp,max=220.dp)) { Text("▤  ${content.fileName.ifBlank { "文件" }}",color=foreground,maxLines=2,fontSize=(29*factor).sp);Text(fileSize(content.size)+" · 点击打开",color=foreground.copy(alpha=.7f),fontSize=(22*factor).sp,modifier=Modifier.padding(top=6.dp)) }
                                    108 -> Row(verticalAlignment=Alignment.CenterVertically) { SharedAvatar(content.thumbnail,Modifier.size(42.dp));Text(content.cardName.ifBlank { "个人名片" },Modifier.padding(start=10.dp),color=foreground) }
                                    107 -> Column { Text("聊天记录",color=foreground,fontWeight=FontWeight.Medium);Text(content.text,color=foreground,fontSize=12.sp) }
                                    110 -> content.groupCard?.let { card -> Column(Modifier.widthIn(min=rpx(300),max=rpx(460)),horizontalAlignment=Alignment.CenterHorizontally) {
                                        if(card.kind=="group_invite") {
                                            SharedAvatar(card.avatar,Modifier.size(rpx(100)),group=true)
                                            Text(card.groupName+(if(card.count>0)" (${card.count} 人)" else ""),Modifier.padding(top=rpx(16)),fontSize=(29*factor).sp,color=foreground,fontWeight=FontWeight.SemiBold)
                                            Text(if(message.mine)"你邀请对方加入群聊" else "邀请你加入群聊",Modifier.padding(top=rpx(10)),fontSize=(24*factor).sp,color=foreground.copy(alpha=.7f))
                                            if(!message.mine)Text("点击申请入群",Modifier.padding(top=rpx(18)).clickable { invite=card },color=ChatBlue,fontSize=(26*factor).sp)
                                        } else {
                                            Row(verticalAlignment=Alignment.CenterVertically) { SharedAvatar(card.avatar,Modifier.size(rpx(76)));Column(Modifier.padding(start=rpx(16))) { Text(card.applicantName,color=foreground,fontWeight=FontWeight.SemiBold);Text("申请加入 ${card.groupName}",color=foreground.copy(alpha=.7f),fontSize=(24*factor).sp) } }
                                            Text("去审核",Modifier.padding(top=rpx(20)).clickable { callbacks.onOpenJoinRequests(card.groupId) },color=ChatBlue,fontSize=(26*factor).sp)
                                        }
                                    } } ?: Text(content.text.ifBlank { "[自定义消息]" },color=foreground)
                                    else -> Column {
                                        if(content.quoteText.isNotEmpty())Text(content.quoteText,Modifier.clickable(enabled=content.quoteId.isNotEmpty()) { callbacks.onAction(ChatMessage(content.quoteId,"",false,0),ChatAction.OPEN_MESSAGE) { result -> onUI { if(result.isFailure)notice=result.exceptionOrNull()?.message ?: "引用消息暂不可定位" } } }.padding(bottom=rpx(10)),color=foreground.copy(alpha=.65f),maxLines=2,fontSize=(23*factor).sp)
                                        Text(if(content.type in setOf(101,106,114))content.text else message.text,color=foreground,fontSize=(30*factor).sp,lineHeight=(43*factor).sp)
                                    }
                                }
                            }
                            Row(Modifier.padding(top=rpx(5)),verticalAlignment=Alignment.CenterVertically) {
                                Text(chatTime(message.time),color=ChatHint,fontSize=(20*factor).sp)
                                if(message.mine) {
                                    val pending=state.outbox.firstOrNull { it.id==message.id }
                                    val read=content.read||message.id in state.readMessageIds||(message.seq>0&&message.seq<=state.maxOtherReadSeq)
                                    val status=if(upload!=null)if(upload.state==MediaUploadState.FAILED)"上传失败，点按重试" else "" else when(pending?.state) { OutboxState.PENDING,OutboxState.SENDING -> "◷";OutboxState.UNCERTAIN -> "待核对";OutboxState.FAILED -> "发送失败，点按重试";else -> if(message.status==2||message.seq>0)if(read)"✓✓" else "✓" else "◷" }
                                    Text("  $status",Modifier.clickable(enabled=pending!=null||upload?.state==MediaUploadState.FAILED) { if(upload!=null)callbacks.onRetryUpload(upload.id) else if(pending?.state==OutboxState.FAILED)callbacks.onRetryFailed(message.id) else callbacks.onReconcile(message.id) },color=if(pending?.state==OutboxState.FAILED||upload?.state==MediaUploadState.FAILED)Color(0xFFE54D4D) else if(read)ChatBlue else ChatHint,fontSize=(20*factor).sp)
                                }
                            }
                        }
                        if(message.mine) {
                            val avatar=ownAvatar.ifEmpty { content.avatar }
                            if(avatar.isBlank())Image(painterResource(R.drawable.uni_avatar_me),"我的头像",Modifier.size(rpx(72)).clip(CircleShape))
                            else SharedAvatar(avatar,Modifier.size(rpx(72)))
                        }
                    }
                }
            }
                }
            item { Box(Modifier.fillMaxWidth().padding(12.dp),contentAlignment=Alignment.Center) { Text(if(state.historyLoading)"读取历史中…" else if(state.historyEnd)"没有更多历史" else "点击加载更早消息",Modifier.clickable(enabled=!state.historyLoading&&!state.historyEnd,onClick=callbacks.onLoadHistory),color=ChatHint,fontSize=12.sp) } }
        }
        if(list.firstVisibleItemIndex>2)Box(Modifier.fillMaxWidth().background(ChatGray).padding(end=16.dp,bottom=6.dp),contentAlignment=Alignment.CenterEnd) { Text("↓",Modifier.size(36.dp).clip(CircleShape).background(Color.White).clickable { scope.launch { list.animateScrollToItem(0) } }.wrapContentSize(),color=ChatBlue,fontSize=22.sp) }
        if(multi)Row(Modifier.fillMaxWidth().background(Color(0xFFF7F7F7)).padding(start=rpx(24),end=rpx(24),top=rpx(16),bottom=rpx(24)),horizontalArrangement=Arrangement.spacedBy(rpx(16))) {
            val idle=!deleting&&!forwarding&&!recalling
            MultiSelectButton("取消",Modifier.weight(1f),idle) { multi=false;selection=emptySet();selectionOrder=emptyList();forwardMode=false }
            MultiSelectButton("转发(${selection.size})",Modifier.weight(1f),selection.isNotEmpty()&&idle,primary=true) { multiForward=selectedMessages() }
            if(!forwardMode&&state.groupRole in setOf("owner","admin"))MultiSelectButton(if(recalling)"撤回中…" else "撤回(${selection.size})",Modifier.weight(1f),selection.isNotEmpty()&&idle,danger=true) { recallReason="";confirmMultiRecall=true }
            if(!forwardMode)MultiSelectButton(if(deleting)"删除中…" else "删除(${selection.size})",Modifier.weight(1f),selection.isNotEmpty()&&idle,danger=true) { confirmMultiDelete=true }
        }
        else {
        quoted?.let { quote -> Row(Modifier.fillMaxWidth().background(Color(0xFFF1F3F7)).padding(10.dp),verticalAlignment=Alignment.CenterVertically) { Text("回复 ${quote.sender}：${quote.text}",Modifier.weight(1f),maxLines=2,overflow=TextOverflow.Ellipsis,color=ChatHint,fontSize=12.sp);Text("✕",Modifier.clickable { quoted=null }.padding(8.dp)) } }
        if(state.sendBlockedReason!=null)Row(Modifier.fillMaxWidth().height(rpx(96)).background(Color(0xFFF7F7F7)).padding(horizontal=rpx(32)),verticalAlignment=Alignment.CenterVertically) {
            Text(state.sendBlockedReason,Modifier.weight(1f),color=Color(0xFF999999),fontSize=(26*factor).sp)
            Text(if(state.permissionLoading)"检查中…" else "检查禁言状态",Modifier.clip(RoundedCornerShape(rpx(28))).border(1.dp,Color(0xFF0A2FC2),RoundedCornerShape(rpx(28))).clickable(enabled=!state.permissionLoading,onClick=callbacks.onRefreshPermission).padding(horizontal=rpx(24),vertical=rpx(12)),color=Color(0xFF0A2FC2),fontSize=(24*factor).sp)
        }
        else if(voiceMode)Row(Modifier.fillMaxWidth().background(Color(0xFFF2F2F2)).padding(horizontal=rpx(20),vertical=rpx(18)),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(rpx(12))) {
            Box(Modifier.size(rpx(52)).clickable(enabled=!voiceWorking,onClick=::cancelVoice),contentAlignment=Alignment.Center) { Image(painterResource(R.drawable.uni_video_trash),"取消录音",Modifier.size(rpx(32)),contentScale=ContentScale.Fit,colorFilter=androidx.compose.ui.graphics.ColorFilter.tint(Color(0xFF666666))) }
            Row(Modifier.weight(1f).height(rpx(76)).clip(RoundedCornerShape(rpx(18))).background(Color(0xFFF6F6F6)).clickable(enabled=recording&&!voiceWorking) { stopVoice() },verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.Center) {
                Box(Modifier.size(rpx(14)).clip(CircleShape).background(if(recording)Color(0xFFFF4D4F) else Color(0xFFBBBBBB)))
                Text(duration(recordingSeconds.toLong()),Modifier.padding(start=rpx(12)),fontSize=(28*factor).sp,color=Color(0xFF555555))
            }
            Box(Modifier.height(rpx(68)).widthIn(min=rpx(132)).clip(RoundedCornerShape(rpx(20))).background(Color(0xFFD9D9D9)).clickable(enabled=!voiceWorking) { stopVoice(!recording) }.padding(horizontal=rpx(18)),contentAlignment=Alignment.Center) { Text(if(voiceWorking)"处理中" else if(recording)"结束" else "发送",fontSize=(26*factor).sp,color=Color(0xFF666666)) }
            Canvas(Modifier.size(rpx(64)).clip(CircleShape).background(Color(0xFF1A73FF)).semantics { contentDescription="发送语音" }.clickable(enabled=!voiceWorking) { stopVoice(true) }) {
                val center=size.width/2;val stroke=2.dp.toPx()
                drawLine(Color.White,Offset(center,size.height*.72f),Offset(center,size.height*.28f),stroke,StrokeCap.Round)
                drawLine(Color.White,Offset(size.width*.33f,size.height*.46f),Offset(center,size.height*.28f),stroke,StrokeCap.Round)
                drawLine(Color.White,Offset(size.width*.67f,size.height*.46f),Offset(center,size.height*.28f),stroke,StrokeCap.Round)
            }
        }
        else Row(Modifier.fillMaxWidth().background(Color(0xFFF7F7F7)).padding(horizontal=rpx(20),vertical=rpx(16)),verticalAlignment=Alignment.Bottom,horizontalArrangement=Arrangement.spacedBy(rpx(12))) {
            Box(Modifier.size(rpx(64)).clickable(enabled=state.ready&&!state.uploading&&!voiceWorking) { if(ContextCompat.checkSelfPermission(context,Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED)startVoice() else recordPermission.launch(Manifest.permission.RECORD_AUDIO) },contentAlignment=Alignment.Center) { Image(painterResource(R.drawable.uni_icon_mic),"语音输入",Modifier.size(rpx(44)),contentScale=ContentScale.Fit) }
            Row(Modifier.weight(1f).heightIn(min=rpx(72)).clip(RoundedCornerShape(rpx(36))).background(Color.White),verticalAlignment=Alignment.Bottom) {
                BasicTextField(text,::updateDraft,Modifier.weight(1f).heightIn(min=rpx(72),max=160.dp).padding(start=rpx(16),top=rpx(8),bottom=rpx(8)).pointerInput(Unit) {
                    awaitEachGesture { awaitFirstDown(requireUnconsumed=false,pass=PointerEventPass.Initial);emoji=false;plus=false }
                }.onPreviewKeyEvent { event -> if(enterToSend&&event.key==Key.Enter&&event.type==KeyEventType.KeyDown&&!event.isShiftPressed) { submitText();true } else false },enabled=state.ready,textStyle=androidx.compose.ui.text.TextStyle(fontSize=16.sp,lineHeight=24.sp,color=Color(0xFF1A1A1A)),cursorBrush=SolidColor(ChatBlue),keyboardOptions=KeyboardOptions(imeAction=if(enterToSend)ImeAction.Send else ImeAction.Default),keyboardActions=KeyboardActions(onSend={ submitText() }),decorationBox={ inner -> Box(Modifier.fillMaxWidth(),contentAlignment=Alignment.CenterStart) { if(text.isEmpty())Text("输入消息",fontSize=16.sp,lineHeight=24.sp,color=Color(0xFFB0B0B0));inner() } })
                Box(Modifier.padding(end=rpx(6),bottom=rpx(4)).size(rpx(64)).semantics { contentDescription="表情" }.clickable { emoji=!emoji;plus=false;voiceMode=false;focus.clearFocus();keyboard?.hide() },contentAlignment=Alignment.Center) {
                Canvas(Modifier.size(rpx(36))) {
                    val unit=size.width/24
                    val ink=Color(0xFF666666)
                    drawCircle(ink,10*unit,Offset(12*unit,12*unit),style=Stroke(1.4f*unit))
                    drawCircle(ink,1.1f*unit,Offset(8.1f*unit,9*unit));drawCircle(ink,1.1f*unit,Offset(15.9f*unit,9*unit))
                    drawArc(ink,0f,180f,false,Offset(6*unit,7.5f*unit),Size(12*unit,10*unit),style=Stroke(1.4f*unit,cap=StrokeCap.Round))
                }
                }
            }
            Box(Modifier.size(rpx(64)).clickable { plus=!plus;emoji=false;focus.clearFocus();keyboard?.hide() },contentAlignment=Alignment.Center) { Image(painterResource(R.drawable.uni_icon_plus),"更多功能",Modifier.size(rpx(40)),contentScale=ContentScale.Fit) }
            if(text.isNotBlank())Box(Modifier.height(rpx(64)).widthIn(min=rpx(120)).clip(RoundedCornerShape(rpx(18))).background(Color(0xFF0A2FC2)).clickable(enabled=state.ready,onClick=::submitText).padding(horizontal=rpx(22)),contentAlignment=Alignment.Center) { Text("传送",color=Color.White,fontSize=(26*factor).sp,fontWeight=FontWeight.SemiBold) }
        }
        if(plus&&state.sendBlockedReason==null)Column(Modifier.fillMaxWidth().background(Color(0xFFF0F0F0)).padding(start=rpx(32),end=rpx(32),top=rpx(24),bottom=rpx(32)),verticalArrangement=Arrangement.spacedBy(rpx(28))) {
            val tools=buildList<Pair<Int,String>> {
                add(R.drawable.uni_icon_camera to "相机");add(R.drawable.uni_icon_photo to "照片");add(R.drawable.uni_icon_video to "视频")
                if(state.active?.target?.sessionType==1)add(R.drawable.uni_icon_card to "名片")
                add(R.drawable.uni_icon_file to "文件");add(R.drawable.uni_icon_favorite to "收藏")
            }
            tools.chunked(4).forEach { row -> Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(rpx(24))) {
                row.forEach { (icon,label) -> ComposerAction(icon,label) {
                    if(preparing||state.uploading) { notice="请等待当前附件处理完成";return@ComposerAction }
                    plus=false
                    when(label) {
                        "相机" -> if(ContextCompat.checkSelfPermission(context,Manifest.permission.CAMERA)==PackageManager.PERMISSION_GRANTED)capture() else cameraPermission.launch(Manifest.permission.CAMERA)
                        "照片" -> { pickerKind=MediaKind.IMAGE;pick.launch(arrayOf("image/*")) }
                        "视频" -> showVideoSource=true
                        "名片" -> callbacks.onOpenCards()
                        "文件" -> { pickerKind=MediaKind.FILE;pick.launch(arrayOf("*/*")) }
                        "收藏" -> callbacks.onOpenFavorites()
                    }
                } }
            } }
        }
        if(emoji&&state.sendBlockedReason==null)NativeEmojiStickerPanel(callbacks,{ text+=it },{ url ->
            emoji=false
            callbacks.onSendSticker(url) { result -> onUI { if(result.isFailure)notice=result.exceptionOrNull()?.message ?: "表情发送结果待核对，请查看聊天" } }
        },{ emoji=false;callbacks.onManageStickers() },close={ emoji=false })
        }
    }
    invite?.let { card -> AlertDialog(onDismissRequest={ if(!acceptingInvite)invite=null },title={ Text("确认加入群聊？") },text={ Text(card.groupName) },confirmButton={ TextButton(enabled=!acceptingInvite,onClick={
        acceptingInvite=true
        callbacks.onAcceptGroupInvite(card.token) { result -> onUI {
            acceptingInvite=false
            result.fold(onSuccess={ value ->
                invite=null
                when(value.nextAction) {
                    "joined","already_member" -> { notice=if(value.nextAction=="joined")"已加入群聊" else "你已在群中";callbacks.onOpenBusinessGroup(value.groupId.ifBlank { card.groupId }) }
                    "pending_approval" -> notice="已提交入群申请，等待管理员审核"
                }
            },onFailure={ invite=null;notice=it.message ?: "申请失败" })
        } }
    }) { Text(if(acceptingInvite)"处理中…" else "确认") } },dismissButton={ TextButton(enabled=!acceptingInvite,onClick={ invite=null }) { Text("取消") } }) }
    uploadMenu?.let { upload -> AlertDialog(onDismissRequest={ uploadMenu=null },title={ Text(if(upload.state==MediaUploadState.FAILED)"图片未发送" else "图片正在发送") },text={ Text(if(upload.state==MediaUploadState.FAILED)"本地图片已保留，可重试上传或删除这张草稿。" else "图片上传完成后会继续发送，无需重复选择。") },confirmButton={ if(upload.state==MediaUploadState.FAILED)TextButton(onClick={ uploadMenu=null;callbacks.onRetryUpload(upload.id) }) { Text("重试") } else TextButton(onClick={ uploadMenu=null }) { Text("知道了") } },dismissButton={ if(upload.state==MediaUploadState.FAILED)TextButton(onClick={ uploadMenu=null;callbacks.onDiscardUpload(upload.id) }) { Text("删除草稿") } }) }
    selected?.let { message ->
        var memberMenu by remember(message.id) { mutableStateOf(ChatMessageMenu(canRecall=message.mine)) }
        var menuError by remember(message.id) { mutableStateOf<String?>(null) }
        var checkingMember by remember(message.id) { mutableStateOf(false) }
        var menuRetry by remember(message.id) { mutableIntStateOf(0) }
        LaunchedEffect(message.id,menuRetry) {
            if(state.active?.target?.sessionType==3&&!message.mine) {
                checkingMember=true;menuError=null
                callbacks.onLoadMessageMenu(message) { result -> onUI {
                    checkingMember=false
                    result.fold(onSuccess={ memberMenu=it },onFailure={ menuError=it.message ?: "成员权限暂未读取" })
                } }
            }
        }
        val content=remember(message.serialized,message.text) { MessageContents.parse(message.serialized,message.text) }
        val entries=messageMenuEntries(MessageMenuContext(
            contentType=content.type,mine=message.mine,group=state.active?.target?.sessionType==3,
            canManage=memberMenu.canManage,canRecall=memberMenu.canRecall,senderInGroup=memberMenu.senderInGroup,
            muted=memberMenu.muted,pinned=state.active?.pinnedMessage?.clientMsgID==message.id,
            delivery=state.outbox.firstOrNull { it.id==message.id }?.state,
        ))
        val options=entries.map { entry -> ChatMenuOption(entry) {
            selected=null
            when(entry.action) {
                MessageMenuAction.RETRY -> callbacks.onRetryFailed(message.id)
                MessageMenuAction.RECONCILE -> callbacks.onReconcile(message.id)
                MessageMenuAction.RECALL -> { recallReason="";confirmManage=message to ChatAction.RECALL }
                MessageMenuAction.FORWARD -> { multi=true;forwardMode=true;selection=setOf(message.id);selectionOrder=listOf(message.id);plus=false;emoji=false }
                MessageMenuAction.QUOTE -> { quoted=message;voiceMode=false }
                MessageMenuAction.COPY -> { clipboard.setText(AnnotatedString(content.text));notice="已复制" }
                MessageMenuAction.SELECT_TEXT -> selectText=content.text
                MessageMenuAction.SAVE_IMAGE -> saveOriginal(content.url)
                MessageMenuAction.SAVE_VIDEO -> saveVideo(content.url,state.localSentMedia[message.id]?.file)
                MessageMenuAction.ADD_STICKER -> addSticker(content.url)
                MessageMenuAction.FAVORITE -> callbacks.onAction(message,ChatAction.FAVORITE) { result -> onUI { notice=if(result.isSuccess)"已收藏" else result.exceptionOrNull()?.message ?: "收藏失败" } }
                MessageMenuAction.PIN -> {
                    if(state.active?.pinnedMessage?.clientMsgID==message.id)callbacks.onAction(message,ChatAction.UNPIN) { result -> onUI { notice=if(result.isSuccess)"已取消置顶" else result.exceptionOrNull()?.message ?: "取消置顶失败" } }
                    else if(state.active?.target?.sessionType==3&&state.groupRole !in setOf("owner","admin"))callbacks.onAction(message,ChatAction.PIN_SELF) { result -> onUI { notice=if(result.isSuccess)"已置顶" else result.exceptionOrNull()?.message ?: "置顶失败" } }
                    else pinTarget=message
                }
                MessageMenuAction.REPORT -> callbacks.onReportUser(content.senderId)
                MessageMenuAction.MENTION -> {
                    val name=memberMenu.publicName.ifBlank { message.sender }.ifBlank { "群成员" }
                    callbacks.onSelectMention(ChatMentionChoice(content.senderId,name)) { result -> onUI { if(result.isSuccess) { text+="@$name ";voiceMode=false } else notice=result.exceptionOrNull()?.message ?: "提及失败" } }
                }
                MessageMenuAction.MUTE -> muteTarget=message
                MessageMenuAction.UNMUTE -> confirmManage=message to ChatAction.UNMUTE
                MessageMenuAction.DELETE -> confirmDelete=message
                MessageMenuAction.MULTI -> { multi=true;forwardMode=false;selection=setOf(message.id);selectionOrder=listOf(message.id);plus=false;emoji=false }
                MessageMenuAction.KICK_AND_DELETE -> confirmManage=message to ChatAction.KICK_AND_DELETE
                MessageMenuAction.KICK -> confirmManage=message to ChatAction.KICK
                MessageMenuAction.PURGE -> confirmManage=message to ChatAction.PURGE
            }
        } }
        ChatActionMenu(options,selectedAnchor,{ selected=null }) {
            if(checkingMember)Text("正在读取成员权限…",Modifier.padding(10.dp),color=ChatHint,fontSize=12.sp)
            menuError?.let { error -> Text(error+" · 点按重试",Modifier.clickable { menuRetry++ }.padding(10.dp),color=ChatHint,fontSize=12.sp) }
        }
    }
    pinTarget?.let { message ->
        AlertDialog(onDismissRequest={ pinTarget=null },title={ Text("置顶") },text={ Column {
            fun pin(action:ChatAction) {
                pinTarget=null
                callbacks.onAction(message,action) { result -> onUI { notice=if(result.isSuccess)"已置顶" else result.exceptionOrNull()?.message ?: "置顶失败" } }
            }
            ActionButton(if(state.active?.target?.sessionType==3)"为全员置顶" else "为我和 ${state.active?.title.orEmpty().ifBlank { "对方" }} 置顶") { pin(ChatAction.PIN_SHARED) }
            ActionButton("仅为我置顶") { pin(ChatAction.PIN_SELF) }
        } },confirmButton={ TextButton(onClick={ pinTarget=null }) { Text("取消") } })
    }
    selectText?.let { value -> AlertDialog(onDismissRequest={ selectText=null },title={ Text("选择文字") },text={ SelectionContainer { Text(value,Modifier.heightIn(max=360.dp).verticalScroll(rememberScrollState())) } },confirmButton={ TextButton(onClick={ clipboard.setText(AnnotatedString(value));selectText=null }) { Text("复制全部") } },dismissButton={ TextButton(onClick={ selectText=null }) { Text("关闭") } }) }
    muteTarget?.let { message -> AlertDialog(onDismissRequest={ muteTarget=null },title={ Text("禁言时长") },text={ Column {
        listOf("10 分钟" to ChatAction.MUTE_10_MIN,"1 小时" to ChatAction.MUTE_1_HOUR,"12 小时" to ChatAction.MUTE_12_HOURS,"1 天" to ChatAction.MUTE_1_DAY,"7 天" to ChatAction.MUTE_7_DAYS,"30 天" to ChatAction.MUTE_30_DAYS).forEach { (label,action) ->
            ActionButton(label) { muteTarget=null;confirmManage=message to action }
        }
    } },confirmButton={ TextButton(onClick={ muteTarget=null }) { Text("取消") } }) }
    confirmManage?.let { (message,action) ->
        val prompt=when(action) {
            ChatAction.KICK -> "确定移除该成员？"
            ChatAction.KICK_AND_DELETE -> "确定移除该成员并为所有群成员删除其此前消息？此操作不可恢复。"
            ChatAction.PURGE -> "确定为所有群成员删除该成员此前的全部消息？此操作不可恢复。"
            ChatAction.UNMUTE -> "确定解除该成员的禁言？"
            ChatAction.RECALL -> if(message.mine)"确定撤回这条消息？" else "确定以群管理身份撤回这条成员消息？"
            else -> "确定禁言该成员？"
        }
        AlertDialog(onDismissRequest={ confirmManage=null },title={ Text("确认操作") },text={ Column {
            Text(prompt)
            if(action==ChatAction.RECALL&&!message.mine)BasicTextField(recallReason,{ recallReason=it.take(500) },Modifier.fillMaxWidth().padding(top=12.dp).background(ChatGray,RoundedCornerShape(8.dp)).padding(12.dp),decorationBox={ inner -> if(recallReason.isEmpty())Text("请输入撤回原因",color=ChatHint);inner() })
        } },confirmButton={ TextButton(onClick={
            confirmManage=null
            val complete:(Result<Unit>)->Unit={ result -> onUI { notice=if(result.isSuccess)"操作已完成" else result.exceptionOrNull()?.message ?: "操作未完成" } }
            if(action==ChatAction.RECALL)callbacks.onRecall(message,recallReason,complete) else callbacks.onAction(message,action,complete)
        }) { Text("确定") } },dismissButton={ TextButton(onClick={ confirmManage=null }) { Text("取消") } })
    }
    if(confirmMultiRecall)AlertDialog(onDismissRequest={ confirmMultiRecall=false },title={ Text("撤回 ${selection.size} 条消息") },text={ Column {
        Text("将逐条撤回有权限管理的消息，对其他成员同时生效。")
        if(selectedMessages().any { !it.mine })BasicTextField(recallReason,{ recallReason=it.take(500) },Modifier.fillMaxWidth().padding(top=12.dp).background(ChatGray,RoundedCornerShape(8.dp)).padding(12.dp),decorationBox={ inner -> if(recallReason.isEmpty())Text("请输入撤回原因",color=ChatHint);inner() })
    } },confirmButton={ TextButton(onClick={ confirmMultiRecall=false;recallSelected() }) { Text("撤回") } },dismissButton={ TextButton(onClick={ confirmMultiRecall=false }) { Text("取消") } })
    avatarMention?.let { message -> AlertDialog(onDismissRequest={ avatarMention=null },text={ TextButton(onClick={ avatarMention=null;mentionMember(message) },modifier=Modifier.fillMaxWidth()) { Text("@TA") } },confirmButton={ TextButton(onClick={ avatarMention=null }) { Text("取消") } }) }
    if(showVideoSource)AlertDialog(onDismissRequest={ showVideoSource=false },title={ Text("选择视频") },text={ Column {
        ActionButton("从相册选择") { showVideoSource=false;videoAlbum.launch(arrayOf("video/*")) }
        ActionButton("拍摄视频") { showVideoSource=false;if(ContextCompat.checkSelfPermission(context,Manifest.permission.CAMERA)==PackageManager.PERMISSION_GRANTED)captureVideo() else videoCameraPermission.launch(Manifest.permission.CAMERA) }
    } },confirmButton={ TextButton(onClick={ showVideoSource=false }) { Text("取消") } })
    confirmDelete?.let { message -> AlertDialog(onDismissRequest={ confirmDelete=null },title={ Text("删除本地消息？") },text={ Text("这条消息将从本机聊天记录移除。") },confirmButton={ TextButton(onClick={ confirmDelete=null;callbacks.onAction(message,ChatAction.DELETE_LOCAL) { result -> onUI { if(result.isFailure)notice=result.exceptionOrNull()?.message ?: "删除失败" } } }) { Text("删除") } },dismissButton={ TextButton(onClick={ confirmDelete=null }) { Text("取消") } }) }
    val forwardItems=multiForward ?: forward?.let { listOf(it) }
    forwardItems?.let { messages -> androidx.compose.ui.window.Dialog(onDismissRequest={ forward=null;multiForward=null },properties=androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth=false)) {
        NativeForwardPicker(messages.size,{ forward=null;multiForward=null },callbacks.onLoadForward,{ plan,done -> callbacks.onSubmitForward(messages,plan,done) },{ result ->
            forward=null;multiForward=null;multi=false;selection=emptySet();selectionOrder=emptyList();forwardMode=false
            if(!result.queued)NativeNotices.show("转发成功")
        })
    } }
    if(confirmMultiDelete)AlertDialog(onDismissRequest={ confirmMultiDelete=false },title={ Text("删除 ${selection.size} 条本地消息？") },text={ Text("仅从本机移除所选消息；待核对的发送记录会保留。") },confirmButton={ TextButton(onClick={ confirmMultiDelete=false;deleteSelected() }) { Text("删除") } },dismissButton={ TextButton(onClick={ confirmMultiDelete=false }) { Text("取消") } })
    image?.let { url ->
        val pictures=state.messages.map { MessageContents.parse(it.serialized,it.text) }.filter { it.type==102&&it.url.isNotEmpty() }.map { it.url }.distinct()
        val index=pictures.indexOf(url)
        ImagePreview(url,{ image=null },{ saveOriginal(url) },previous=if(index>0)({ image=pictures[index-1] }) else null,next=if(index>=0&&index<pictures.lastIndex)({ image=pictures[index+1] }) else null,position=if(index>=0)"${index+1} / ${pictures.size}" else "")
    }
    if(showMentions)ChatMentionPicker(callbacks.onLoadMentions,{ showMentions=false },{ choice ->
        callbacks.onSelectMention(choice) { result -> onUI {
            if(result.isSuccess) {
                val start=atStart.coerceIn(0,text.length)
                val rest=text.substring(start).replaceFirst(Regex("^@[^\\s@]*"),"")
                text=text.take(start)+"@${choice.name} "+rest;showMentions=false
            } else notice=result.exceptionOrNull()?.message ?: "成员选择失败"
        } }
    })
    video?.let { url ->
        val message=videoMessage?.takeIf { MessageContents.parse(it.serialized,it.text).url==url }
        val content=message?.let { MessageContents.parse(it.serialized,it.text) }
        val ownMedia=message?.let { current->state.mediaUploads.firstOrNull { it.id==current.id }?.media() ?: state.localSentMedia[current.id] } ?: videoLocal
        VideoPreview(url,{ video=null;videoMessage=null;videoLocal=null },{ notice=it },poster=content?.thumbnail.orEmpty(),sender=message?.sender?.ifBlank { if(message.mine)"我" else "视频" } ?: "视频",time=message?.let { chatDayLabel(it.time)+" "+chatTime(it.time) }.orEmpty(),onSave={ saveVideo(url,ownMedia?.file) },onForward=message?.takeUnless { it.id.startsWith("upload-") }?.let { { video=null;videoMessage=null;videoLocal=null;forward=it } },onDelete=message?.takeUnless { it.id.startsWith("upload-") }?.let { { video=null;videoMessage=null;videoLocal=null;confirmDelete=it } },localFile=ownMedia?.file,localPoster=ownMedia?.snapshot,allowedLocalDirectory=state.mediaOwnerDirectory.takeIf(String::isNotBlank)?.let(::File))
    }
    merge?.let { message -> AlertDialog(onDismissRequest={ merge=null },title={ Text("聊天记录") },text={ Column(Modifier.verticalScroll(rememberScrollState())) {
        val raw=runCatching { com.google.gson.JsonParser.parseString(message.serialized).asJsonObject }.getOrNull()
        val elem=raw?.obj("mergeElem","MergeElem")
        val values=elem?.field("multiMessage","MultiMessage")
        val array=runCatching { if(values?.isJsonArray==true)values.asJsonArray else values?.asString?.let { com.google.gson.JsonParser.parseString(it).asJsonArray } }.getOrNull()
        if(array==null)Text("合并记录暂不可读取") else array.take(200).forEach { item ->
            val content=MessageContents.parse(item.toString())
            Column(Modifier.fillMaxWidth().padding(vertical=8.dp)) {
                Text(runCatching { item.asJsonObject.string("senderNickname","SenderNickname") }.getOrDefault(""),color=ChatHint,fontSize=12.sp)
                when(content.type) {
                    102 -> RemoteMediaImage(MediaURLs.image(content.thumbnail.ifEmpty { content.url }),Modifier.size(180.dp,140.dp).clickable { image=content.url },scale=ContentScale.Fit)
                    104 -> Box(Modifier.size(180.dp,140.dp).background(ChatGray).clickable { video=content.url },contentAlignment=Alignment.Center) { if(content.thumbnail.isNotBlank())RemoteMediaImage(MediaURLs.image(content.thumbnail),Modifier.fillMaxSize(),scale=ContentScale.Fit);Text("▶ ${duration(content.duration)}",color=ChatBlue) }
                    103 -> Text("◖))) ${content.duration}″",Modifier.clickable { player.play(content.url,{}, { onUI { notice="语音暂无法播放" } }) }.padding(8.dp),color=ChatBlue)
                    105 -> Text("▤ ${content.fileName}",Modifier.clickable { openFile(content) }.padding(8.dp),color=ChatBlue)
                    108 -> Text("名片：${content.cardName}",Modifier.clickable { callbacks.onOpenPeer(content.cardUserId) }.padding(8.dp),color=ChatBlue)
                    else -> SelectionContainer { Text(content.text.ifBlank { "[消息]" }) }
                }
            }
        }
    } },confirmButton={ TextButton(onClick={ merge=null }) { Text("关闭") } }) }
}

@Composable
private fun ComposerAction(icon:Int,label:String,onClick:()->Unit) {
    val factor=LocalConfiguration.current.screenWidthDp/750f
    Column(Modifier.width((140*factor).dp).clickable(onClick=onClick),horizontalAlignment=Alignment.CenterHorizontally) {
        Box(Modifier.size((100*factor).dp).clip(RoundedCornerShape((20*factor).dp)).background(Color.White),contentAlignment=Alignment.Center) { Image(painterResource(icon),label,Modifier.size((56*factor).dp),contentScale=ContentScale.Fit) }
        Text(label,Modifier.padding(top=(12*factor).dp),fontSize=(24*factor).sp,color=Color(0xFF666666))
    }
}
@Composable
private fun ActionButton(label:String,action:()->Unit) { TextButton(onClick=action,modifier=Modifier.fillMaxWidth()) { Text(label) } }
@Composable
private fun MultiSelectButton(label:String,modifier:Modifier,enabled:Boolean,primary:Boolean=false,danger:Boolean=false,onClick:()->Unit) {
    val factor=LocalConfiguration.current.screenWidthDp/750f
    Box(modifier.height((72*factor).dp).clip(RoundedCornerShape((16*factor).dp)).background(if(primary)Color(0xFF0A2FC2) else Color.White).clickable(enabled=enabled,onClick=onClick),contentAlignment=Alignment.Center) {
        Text(label,color=(if(primary)Color.White else if(danger)Color(0xFFE54D4D) else Color(0xFF333333)).copy(alpha=if(enabled)1f else .4f),fontSize=(28*factor).sp,fontWeight=FontWeight.SemiBold,maxLines=1)
    }
}
private fun chatTime(time:Long)=runCatching { SimpleDateFormat("HH:mm",Locale.getDefault()).format(Date(if(time<10_000_000_000)time*1000 else time)) }.getOrDefault("")
private fun chatDayKey(time:Long)=runCatching { SimpleDateFormat("yyyy-MM-dd",Locale.getDefault()).format(Date(if(time<10_000_000_000)time*1000 else time)) }.getOrDefault("")
private fun chatDayLabel(time:Long):String {
    val millis=if(time<10_000_000_000)time*1000 else time
    val day=chatDayKey(time)
    val calendar=java.util.Calendar.getInstance()
    if(day==chatDayKey(calendar.timeInMillis))return "今天"
    calendar.add(java.util.Calendar.DATE,-1)
    if(day==chatDayKey(calendar.timeInMillis))return "昨天"
    return SimpleDateFormat("yyyy年M月d日",Locale.getDefault()).format(Date(millis))
}
private fun duration(seconds:Long)="${seconds/60}:${(seconds%60).toString().padStart(2,'0')}"
private fun fileSize(size:Long)=when { size>=1024*1024 -> "%.1f MB".format(size/1024f/1024f);size>=1024 -> "%.1f KB".format(size/1024f);else -> "$size B" }

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
            error=if(result.isSuccess)"原图已保存到所选位置" else "原图保存失败，可重试"
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
            102 -> if(content.url.isNotEmpty())image=content.url else error="原图地址暂不可用"
            104 -> if(content.url.isNotEmpty())video=content.url else error="视频地址暂不可用"
            103 -> if(playing==message.id) { player.stop();playing=null } else { playing=message.id;player.play(content.url,{ onUI { playing=null } },{ onUI { playing=null;error="语音暂无法播放" } }) }
            105 -> {
                download=true
                scope.launch {
                    val result=withContext(Dispatchers.IO) { runCatching { MediaLoader.fetch(context,content.url) } }
                    download=false
                    result.fold(onSuccess={ runCatching { MediaIO.openFile(context,it,content.fileName) }.onFailure { error="没有可打开此文件的应用" } },onFailure={ error=it.message ?: "文件下载失败" })
                }
            }
        }
    }
    LaunchedEffect(category) { if(media)load(true) }
    Column(Modifier.fillMaxSize().background(ChatGray).statusBarsPadding().navigationBarsPadding()) {
        Row(Modifier.fillMaxWidth().height(52.dp).background(Color.White).padding(horizontal=14.dp),verticalAlignment=Alignment.CenterVertically) {
            Image(painterResource(R.drawable.uni_icon_back),"返回",Modifier.size(24.dp).clickable(onClick=onBack))
            Text(if(media)"群媒体" else "搜索聊天记录",Modifier.weight(1f).padding(horizontal=16.dp),fontWeight=FontWeight.Medium,fontSize=17.sp)
        }
        Text(title,Modifier.fillMaxWidth().background(Color.White).padding(horizontal=16.dp,vertical=6.dp),fontSize=13.sp,color=ChatHint,maxLines=1)
        if(media)Row(Modifier.fillMaxWidth().background(Color.White).padding(10.dp),horizontalArrangement=Arrangement.SpaceAround) {
            listOf(102 to "图片",104 to "视频",105 to "文件",103 to "语音").forEach { (type,label) -> Text(label,Modifier.clickable { category=type }.padding(8.dp),color=if(category==type)ChatBlue else Color(0xFF4B566A)) }
        }
        Row(Modifier.fillMaxWidth().background(Color.White).padding(12.dp),verticalAlignment=Alignment.CenterVertically) {
            BasicTextField(keyword,{ keyword=it.take(200) },Modifier.weight(1f).clip(RoundedCornerShape(8.dp)).background(Color(0xFFF2F4F8)).padding(12.dp),singleLine=true,keyboardOptions=KeyboardOptions(imeAction=ImeAction.Search),keyboardActions=KeyboardActions(onSearch={ load(true) }),decorationBox={ inner -> if(keyword.isBlank())Text(if(media)"搜索文件名或内容" else "输入聊天关键字",color=ChatHint,fontSize=14.sp);inner() })
            TextButton(onClick={ load(true) }) { Text("搜索") }
        }
        Text("仅搜索本机已同步的聊天记录",Modifier.padding(horizontal=16.dp,vertical=8.dp),fontSize=12.sp,color=ChatHint)
        if(error!=null)Text(error.orEmpty(),Modifier.fillMaxWidth().background(Color(0xFFFFF5DF)).padding(12.dp),fontSize=13.sp,color=Color(0xFF805F29))
        if(download)Text("正在下载附件…",Modifier.padding(12.dp),fontSize=13.sp,color=ChatHint)
        LazyColumn(Modifier.weight(1f).fillMaxWidth(),contentPadding=PaddingValues(12.dp),verticalArrangement=Arrangement.spacedBy(10.dp)) {
            items(items,key={ it.id }) { message ->
                val content=remember(message.serialized,message.text) { MessageContents.parse(message.serialized,message.text) }
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(Color.White).clickable { openContent(message,content) }.padding(12.dp)) {
                    Row(verticalAlignment=Alignment.CenterVertically) {
                        SharedAvatar(content.avatar,Modifier.size(32.dp))
                        Column(Modifier.weight(1f).padding(start=8.dp)) {
                            Text(message.sender.ifBlank { if(message.mine)"我" else "群成员" },fontSize=13.sp,color=Color(0xFF576176))
                            Text(SimpleDateFormat("yyyy-MM-dd HH:mm",Locale.getDefault()).format(Date(if(message.time<10_000_000_000)message.time*1000 else message.time)),fontSize=11.sp,color=ChatHint)
                        }
                    }
                    Spacer(Modifier.height(10.dp))
                    when(content.type) {
                        102,104 -> Box(Modifier.size(180.dp,140.dp).clip(RoundedCornerShape(6.dp))) {
                            RemoteMediaImage(MediaURLs.image(content.thumbnail.ifEmpty { content.url }),Modifier.fillMaxSize(),scale=ContentScale.Fit)
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
        val index=pictures.indexOf(url)
        ImagePreview(url,{ image=null },{
        download=true
        scope.launch {
            val result=withContext(Dispatchers.IO) { runCatching {
                val file=MediaLoader.fetch(context,MediaURLs.image(url,ImageVariant.ORIGINAL))
                val bounds=BitmapFactory.Options().apply { inJustDecodeBounds=true };BitmapFactory.decodeFile(file.path,bounds)
                val ext=when(bounds.outMimeType) { "image/png" -> "png";"image/gif" -> "gif";"image/webp" -> "webp";else -> "jpg" }
                val saved=MediaIO.saveToGallery(context,file,"图片-${System.currentTimeMillis()}.$ext",bounds.outMimeType ?: "image/jpeg",false)
                Triple(file,ext,saved)
            } }
            download=false
            result.fold(onSuccess={ (file,ext,saved) -> if(saved)error="原图已保存到相册" else { error="请在系统文件选择器中选择原图保存位置";saveFile=file;save.launch("图片-${System.currentTimeMillis()}.$ext") } },onFailure={ error="原图保存失败，请稍后重试" })
        }
    },previous=if(index>0)({ image=pictures[index-1] }) else null,next=if(index>=0&&index<pictures.lastIndex)({ image=pictures[index+1] }) else null,position=if(index>=0)"${index+1} / ${pictures.size}" else "") }
    video?.let { url -> VideoPreview(url,{ video=null },{ error=it }) }
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
    var error by remember { mutableStateOf<String?>(null) }
    var saveFile by remember { mutableStateOf<File?>(null) }
    val player=remember { VoicePlayer() }
    DisposableEffect(Unit) { onDispose { player.stop() } }
    val save=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("image/*")) { uri ->
        val file=saveFile
        if(uri!=null&&file!=null)scope.launch {
            val result=withContext(Dispatchers.IO) { runCatching { context.contentResolver.openOutputStream(uri)?.use { output -> file.inputStream().use { it.copyTo(output) } } ?: error("保存位置不可用") } }
            error=if(result.isSuccess)"原图已保存到所选位置" else "保存失败，请重试"
        }
    }
    Column {
        when(parsed.type) {
            101 -> SelectionContainer { Text(parsed.text) }
            102 -> RemoteMediaImage(MediaURLs.image(parsed.url),Modifier.size(180.dp,140.dp).clip(RoundedCornerShape(8.dp)).clickable { image=true },scale=ContentScale.Fit)
            104 -> Box(Modifier.size(180.dp,140.dp).clip(RoundedCornerShape(8.dp)).background(ChatGray).clickable { if(parsed.url.isNotEmpty())video=true else error="视频地址不可用" },contentAlignment=Alignment.Center) {
                if(parsed.thumbnail.isNotBlank())RemoteMediaImage(MediaURLs.image(parsed.thumbnail),Modifier.fillMaxSize(),scale=ContentScale.Fit)
                Text("▶ ${duration(parsed.duration)}",Modifier.background(Color(0x77000000),RoundedCornerShape(5.dp)).padding(10.dp),color=Color.White)
            }
            103 -> Text(if(playing)"■ 正在播放  ${duration(parsed.duration)}" else "◖)))  语音 ${duration(parsed.duration)}",Modifier.clickable {
                if(playing) { player.stop();playing=false } else { playing=true;player.play(parsed.url,{ onUI { playing=false } },{ onUI { playing=false;error="语音暂无法播放" } }) }
            }.padding(vertical=12.dp),color=ChatBlue)
            105 -> Column(Modifier.clickable(enabled=!busy) {
                busy=true
                scope.launch {
                    val result=withContext(Dispatchers.IO) { runCatching { MediaLoader.fetch(context,parsed.url) } };busy=false
                    result.fold(onSuccess={ runCatching { MediaIO.openFile(context,it,parsed.fileName) }.onFailure { error="没有可打开此文件的应用" } },onFailure={ error=it.message ?: "文件下载失败" })
                }
            }) { Text("▤  ${parsed.fileName.ifBlank { "文件" }}");Text(if(busy)"下载中…" else "点击打开",color=ChatHint,fontSize=12.sp) }
            else -> Text("收藏内容暂不可读取",color=ChatHint)
        }
        error?.let { Text(it,color=Color(0xFF9B6C2F),fontSize=12.sp,modifier=Modifier.padding(top=6.dp)) }
    }
    if(image)ImagePreview(parsed.url,{ image=false },{
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
                if(saved)error="原图已保存到相册" else { error="请在系统文件选择器中选择原图保存位置";saveFile=file;save.launch("图片-${System.currentTimeMillis()}.$ext") }
            },onFailure={ error="原图保存失败，可稍后重试" })
        }
    })
    if(video)VideoPreview(parsed.url,{ video=false },{ error=it })
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
    Column(Modifier.fillMaxSize().background(Color.White).statusBarsPadding().navigationBarsPadding().imePadding()) {
        Row(Modifier.fillMaxWidth().height(52.dp).padding(horizontal=16.dp),verticalAlignment=Alignment.CenterVertically) {
            Image(painterResource(R.drawable.uni_icon_back),"返回",Modifier.size(24.dp).clickable(enabled=!busy,onClick=onBack))
            Text(if(mode=="card")"选择好友" else "我的收藏",Modifier.weight(1f).padding(horizontal=16.dp),fontSize=17.sp,fontWeight=FontWeight.Medium)
            if(mode=="favorite")Text(if(managing)"完成" else "管理",Modifier.clickable(enabled=!busy) { managing=!managing;selected=emptySet() },color=ChatBlue,fontSize=14.sp)
        }
        Text("发送给：$targetTitle",Modifier.padding(horizontal=20.dp,vertical=8.dp),fontSize=13.sp,color=ChatHint)
        if(mode=="favorite")Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceAround) { listOf("全部","文字","图片与视频","文件","语音").forEachIndexed { index,label -> Text(label,Modifier.clickable(enabled=!busy&&!loading) { tab=index }.padding(vertical=12.dp),color=if(tab==index)ChatBlue else Color(0xFF596477),fontSize=12.sp) } }
        BasicTextField(keyword,{ if(!busy)keyword=it.take(200) },Modifier.fillMaxWidth().padding(horizontal=16.dp,vertical=8.dp).clip(RoundedCornerShape(8.dp)).background(Color(0xFFF3F5F8)).padding(12.dp),singleLine=true,decorationBox={ inner -> if(keyword.isEmpty())Text(if(mode=="card")"搜索好友（含备注）" else "搜索已加载收藏",color=ChatHint,fontSize=14.sp);inner() })
        error?.let { Text(it,Modifier.fillMaxWidth().background(Color(0xFFFFF5DF)).padding(12.dp),color=Color(0xFF805F29),fontSize=13.sp) }
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
        if(mode=="favorite")TextButton(onClick={ if(managing)confirm=true else runSelected() },enabled=selected.isNotEmpty()&&!busy,modifier=Modifier.fillMaxWidth().padding(12.dp)) { Text(if(busy)"处理中…" else if(managing)"删除 ${selected.size} 条收藏" else "发送 ${selected.size} 条收藏",color=if(managing)Color(0xFFCB3B3B) else ChatBlue) }
    }
    if(confirm)AlertDialog(onDismissRequest={ confirm=false },title={ Text("删除所选收藏？") },text={ Text("将删除 ${selected.size} 条收藏。") },confirmButton={ TextButton(onClick={ confirm=false;runSelected() }) { Text("删除") } },dismissButton={ TextButton(onClick={ confirm=false }) { Text("取消") } })
    preview?.let { item -> AlertDialog(onDismissRequest={ preview=null },title={ Text("收藏内容") },text={ NativeFavoriteContent(item.type,item.content) },confirmButton={ TextButton(onClick={ preview=null }) { Text("关闭") } }) }
}

@Composable
private fun ChatMentionPicker(load:(String,(Result<ChatMentionPage>)->Unit)->Unit,onDismiss:()->Unit,onPick:(ChatMentionChoice)->Unit) {
    var items by remember { mutableStateOf<List<ChatMentionChoice>>(emptyList()) }
    var keyword by remember { mutableStateOf("") }
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
    AlertDialog(onDismissRequest=onDismiss,title={ Text("选择要提及的成员") },text={ Column {
        BasicTextField(keyword,{ keyword=it },Modifier.fillMaxWidth().background(Color(0xFFF1F3F7),RoundedCornerShape(6.dp)).padding(12.dp),singleLine=true,decorationBox={ inner -> if(keyword.isEmpty())Text("搜索已加载成员",color=ChatHint);inner() })
        if(canAll)Text("@所有人",Modifier.fillMaxWidth().clickable { onPick(ChatMentionChoice("AtAllTag","所有人")) }.padding(12.dp),color=ChatBlue)
        error?.let { Text(it,color=Color(0xFF986427),fontSize=12.sp) }
        LazyColumn(Modifier.heightIn(max=360.dp)) {
            items(items.filter { it.displayName.contains(keyword,true)||it.name.contains(keyword,true) },key={ it.userId }) { member -> Row(Modifier.fillMaxWidth().clickable { onPick(member) }.padding(vertical=10.dp),verticalAlignment=Alignment.CenterVertically) { SharedAvatar(member.avatar,Modifier.size(36.dp));Column(Modifier.padding(start=10.dp)) { Text(member.displayName);if(member.displayName!=member.name)Text(member.name,color=ChatHint,fontSize=12.sp) } } }
            item { TextButton(onClick=::fetch,enabled=!loading&&!end,modifier=Modifier.fillMaxWidth()) { Text(if(loading)"读取中…" else if(end)"没有更多成员" else "加载更多成员") } }
        }
    } },confirmButton={ TextButton(onClick=onDismiss) { Text("取消") } })
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
        Row(Modifier.fillMaxWidth().background(Color.White).padding(14.dp),verticalAlignment=Alignment.CenterVertically) {
            Image(painterResource(R.drawable.uni_icon_back),"返回",Modifier.size(24.dp).clickable(onClick=onBack))
            BasicTextField(keyword,{ keyword=it.take(200) },Modifier.weight(1f).padding(start=14.dp).clip(RoundedCornerShape(8.dp)).background(Color(0xFFF1F3F7)).padding(12.dp),singleLine=true,keyboardOptions=KeyboardOptions(imeAction=ImeAction.Search),keyboardActions=KeyboardActions(onSearch={ load(true) }),decorationBox={ inner -> if(keyword.isEmpty())Text("搜索聊天记录",color=ChatHint);inner() })
        }
        Text("搜索本机已同步的全部会话",Modifier.padding(14.dp),fontSize=12.sp,color=ChatHint)
        error?.let { Text(it,Modifier.fillMaxWidth().background(Color(0xFFFFF5DF)).padding(12.dp),color=Color(0xFF89652B),fontSize=13.sp) }
        LazyColumn(Modifier.weight(1f),contentPadding=PaddingValues(horizontal=12.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
            items(hits,key={ it.conversation.target.conversationId+"\u0000"+it.message.id }) { hit ->
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(Color.White).clickable { open(hit) }.padding(12.dp),verticalAlignment=Alignment.CenterVertically) {
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
    var confirm by remember { mutableStateOf(false) }
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
    Column(Modifier.fillMaxSize().background(Color.White).statusBarsPadding().navigationBarsPadding().imePadding()) {
        Row(Modifier.fillMaxWidth().height(52.dp).padding(horizontal=16.dp),verticalAlignment=Alignment.CenterVertically) {
            Image(painterResource(R.drawable.uni_icon_back),"返回",Modifier.size(24.dp).clickable(enabled=!busy,onClick=onBack))
            Text("转发给",Modifier.weight(1f).padding(start=16.dp),fontSize=17.sp,fontWeight=FontWeight.Medium)
            if(busy)CircularProgressIndicator(Modifier.size(20.dp),color=ChatBlue,strokeWidth=2.dp)
            else Text("传送",Modifier.clickable(enabled=count>0||allFriends) { confirm=true }.padding(8.dp),color=if(count>0||allFriends)ChatBlue else ChatHint)
        }
        BasicTextField(keyword,{ if(!busy)keyword=it.take(200) },Modifier.fillMaxWidth().padding(horizontal=16.dp,vertical=10.dp).clip(RoundedCornerShape(7.dp)).background(Color(0xFFF1F3F7)).padding(12.dp),singleLine=true,decorationBox={ inner -> if(keyword.isBlank())Text("搜索",color=ChatHint);inner() })
        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceAround) { listOf("recent" to "最近聊天","contacts" to "联络人","groups" to "群组","tags" to "标签").forEach { (key,label) -> Text(label,Modifier.clickable(enabled=!busy) { tab=key }.padding(vertical=13.dp),fontSize=14.sp,color=if(tab==key)ChatBlue else Color(0xFF555F71)) } }
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
        error?.let { Text(it,Modifier.fillMaxWidth().background(Color(0xFFFFF5DF)).padding(12.dp),color=Color(0xFF89652B),fontSize=13.sp) }
        LazyColumn(Modifier.weight(1f)) {
            items(items,key={ it.id }) { item -> Row(Modifier.fillMaxWidth().clickable(enabled=!busy) { toggle(item) }.padding(horizontal=18.dp,vertical=12.dp),verticalAlignment=Alignment.CenterVertically) {
                Text(if(checked(item))"●" else "○",Modifier.padding(end=14.dp),fontSize=23.sp,color=if(checked(item))ChatBlue else ChatHint)
                if(item.kind=="tag")Box(Modifier.size(42.dp).background(Color(0xFFEAF0FF),CircleShape),contentAlignment=Alignment.Center) { Text("#",color=ChatBlue,fontSize=22.sp) } else SharedAvatar(item.avatar,Modifier.size(42.dp),item.kind=="group")
                Text(item.name,Modifier.weight(1f).padding(start=12.dp),fontSize=15.sp,maxLines=1,overflow=TextOverflow.Ellipsis)
            } }
            item { TextButton(onClick={ fetch() },enabled=!busy&&!loading&&!end,modifier=Modifier.fillMaxWidth()) { Text(if(loading)"读取中…" else if(end)if(items.isEmpty())"暂无目标" else "没有更多" else "加载更多") } }
        }
    }
    if(confirm)AlertDialog(onDismissRequest={ if(!busy)confirm=false },title={ Text("确认传送？") },text={ Text("将 $messageCount 条消息转发给 ${if(allFriends)"全部好友（已排除 ${excluded.size} 人）及所选群" else "$count 个所选目标"}。") },confirmButton={ TextButton(onClick={
        confirm=false;busy=true;error=null
        val targets=selected.values.filter { !allFriends||it.kind=="group" }
        submit(ChatForwardSelection(targets,allFriends,excluded)) { result -> onUI { busy=false;result.fold(onSuccess=onComplete,onFailure={ error=it.message ?: "转发未完成，请回聊天核对" }) } }
    }) { Text("确认") } },dismissButton={ TextButton(onClick={ confirm=false }) { Text("取消") } })
}
