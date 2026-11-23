package com.im.nativebootstrap

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.activity.result.ActivityResultLauncher
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.ClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.im.nativebootstrap.chat.*
import com.im.nativebootstrap.media.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import java.io.File

/** 聊天弹层区（自 NativeChatUI.kt 抽出；holder 每次重组构造，避免捕获 state 快照）。 */
internal class ChatDialogScope(
    val text:MutableState<String>,
    val quoted:MutableState<ChatMessage?>,
    val selected:MutableState<ChatMessage?>,
    val uploadMenu:MutableState<PendingMediaUpload?>,
    val selectedAnchor:MutableState<Offset?>,
    val invite:MutableState<GroupMessageCard?>,
    val forward:MutableState<ChatMessage?>,
    val multi:MutableState<Boolean>,
    val selection:MutableState<Set<String>>,
    val selectionOrder:MutableState<List<String>>,
    val forwardMode:MutableState<Boolean>,
    val confirmMultiRecall:MutableState<Boolean>,
    val recallReason:MutableState<String>,
    val avatarMention:MutableState<ChatMessage?>,
    val multiForward:MutableState<List<ChatMessage>?>,
    val confirmMultiDelete:MutableState<Boolean>,
    val confirmDelete:MutableState<ChatMessage?>,
    val confirmManage:MutableState<Pair<ChatMessage,ChatAction>?>,
    val muteTarget:MutableState<ChatMessage?>,
    val pinTarget:MutableState<ChatMessage?>,
    val selectText:MutableState<String?>,
    val image:MutableState<String?>,
    val imageMessage:MutableState<ChatMessage?>,
    val video:MutableState<String?>,
    val videoMessage:MutableState<ChatMessage?>,
    val videoLocal:MutableState<LocalMedia?>,
    val notice:MutableState<String?>,
    val plus:MutableState<Boolean>,
    val voiceMode:MutableState<Boolean>,
    val preparing:MutableState<Boolean>,
    val showVideoSource:MutableState<Boolean>,
    val merge:MutableState<ChatMessage?>,
    val state:ChatState,
    val callbacks:NativeChatCallbacks,
    val context:Context,
    val clipboard:ClipboardManager,
    val scope:CoroutineScope,
    val factor:Float,
    val player:VoicePlayer,
    val uploadsById:Map<String,PendingMediaUpload>,
    val outboxById:Map<String,OutboxEntry>,
    val composerPanels:NativeComposerPanelState,
    val videoAlbum:ActivityResultLauncher<Array<String>>,
    val videoCameraPermission:ActivityResultLauncher<String>,
    val rpx:(Int)->Dp,
    val selectedMessages:()->List<ChatMessage>,
    val canRecall:(ChatMessage)->Boolean,
    val mentionMember:(ChatMessage)->Unit,
    val captureVideo:()->Unit,
    val saveOriginal:(String)->Unit,
    val saveVideo:(String,File?)->Unit,
    val addSticker:(String)->Unit,
    val openFile:(MessageContent)->Unit,
    val deleteSelected:()->Unit,
    val recallSelected:()->Unit,
    // —— ChatRoomBody（顶栏/横幅/消息列表/输入区）追加 ——
    val showMentions:MutableState<Boolean>,
    val composerCursor:MutableState<Int?>,
    val pickerKind:MutableState<MediaKind>,
    val failedMedia:MutableState<List<LocalMedia>>,
    val sending:Boolean,
    val recalling:Boolean,
    val forwarding:Boolean,
    val deleting:Boolean,
    val recording:Boolean,
    val recordingSeconds:Int,
    val voiceWorking:Boolean,
    val playing:String?,
    val retryingMedia:Set<String>,
    val mentionKeyword:String,
    val presenceNow:Long,
    val list:LazyListState,
    val reversedMessages:List<ChatMessage>,
    val rowEvents:ChatRowEvents,
    val emoji:Boolean,
    val ownAvatar:String,
    val enterToSend:Boolean,
    val pick:ActivityResultLauncher<Array<String>>,
    val recordPermission:ActivityResultLauncher<String>,
    val cameraPermission:ActivityResultLauncher<String>,
    val sendFile:(LocalMedia)->Unit,
    val stopVoice:(Boolean)->Unit,
    val startVoice:()->Unit,
    val cancelVoice:()->Unit,
    val capture:()->Unit,
    val submitText:()->Unit,
    val updateDraft:(String)->Unit,
    val pickMention:(ChatMentionChoice)->Unit,
)

@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun ChatRoomDialogs(dlg:ChatDialogScope) {
    var text by dlg.text
    var quoted by dlg.quoted
    var selected by dlg.selected
    var uploadMenu by dlg.uploadMenu
    var selectedAnchor by dlg.selectedAnchor
    var invite by dlg.invite
    var forward by dlg.forward
    var multi by dlg.multi
    var selection by dlg.selection
    var selectionOrder by dlg.selectionOrder
    var forwardMode by dlg.forwardMode
    var confirmMultiRecall by dlg.confirmMultiRecall
    var recallReason by dlg.recallReason
    var avatarMention by dlg.avatarMention
    var multiForward by dlg.multiForward
    var confirmMultiDelete by dlg.confirmMultiDelete
    var confirmDelete by dlg.confirmDelete
    var confirmManage by dlg.confirmManage
    var muteTarget by dlg.muteTarget
    var pinTarget by dlg.pinTarget
    var selectText by dlg.selectText
    var image by dlg.image
    var imageMessage by dlg.imageMessage
    var video by dlg.video
    var videoMessage by dlg.videoMessage
    var videoLocal by dlg.videoLocal
    var notice by dlg.notice
    var plus by dlg.plus
    var voiceMode by dlg.voiceMode
    var preparing by dlg.preparing
    var showVideoSource by dlg.showVideoSource
    var merge by dlg.merge
    val state=dlg.state
    val callbacks=dlg.callbacks
    val context=dlg.context
    val clipboard=dlg.clipboard
    val scope=dlg.scope
    val factor=dlg.factor
    val player=dlg.player
    val uploadsById=dlg.uploadsById
    val outboxById=dlg.outboxById
    val composerPanels=dlg.composerPanels
    val videoAlbum=dlg.videoAlbum
    val videoCameraPermission=dlg.videoCameraPermission
    fun rpx(value:Int)=dlg.rpx(value)
    fun selectedMessages()=dlg.selectedMessages()
    fun canRecall(message:ChatMessage)=dlg.canRecall(message)
    fun mentionMember(message:ChatMessage)=dlg.mentionMember(message)
    fun captureVideo()=dlg.captureVideo()
    fun saveOriginal(url:String)=dlg.saveOriginal(url)
    fun saveVideo(url:String,ownedFile:File?)=dlg.saveVideo(url,ownedFile)
    fun addSticker(url:String)=dlg.addSticker(url)
    fun openFile(content:MessageContent)=dlg.openFile(content)
    fun deleteSelected()=dlg.deleteSelected()
    fun recallSelected()=dlg.recallSelected()
    invite?.let { card -> GroupInviteDialog(card,callbacks,{ invite=null },{ value ->
        callbacks.onInviteHandled(card.token,value)
    },{ notice=it }) }
    uploadMenu?.let { upload ->
        val mediaName=if(upload.kind==MediaKind.VIDEO)"视频" else "图片"
        AlertDialog(onDismissRequest={ uploadMenu=null },title={ Text(if(upload.state==MediaUploadState.FAILED)"${mediaName}未发送" else "${mediaName}正在发送") },text={ Text(if(upload.state==MediaUploadState.FAILED)"本地${mediaName}已保留，可重试上传或删除草稿。" else "${mediaName}上传完成后会继续发送，无需重复选择。") },confirmButton={ if(upload.state==MediaUploadState.FAILED)TextButton(onClick={ uploadMenu=null;callbacks.onRetryUpload(upload.id) }) { Text("重试") } else TextButton(onClick={ uploadMenu=null }) { Text("知道了") } },dismissButton={ if(upload.state==MediaUploadState.FAILED)TextButton(onClick={ uploadMenu=null;callbacks.onDiscardUpload(upload.id) }) { Text("删除草稿") } })
    }
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
            canManage=memberMenu.canManage,canRecall=memberMenu.canRecall&&canRecall(message),senderInGroup=memberMenu.senderInGroup,
            muted=memberMenu.muted,pinned=state.active?.pinnedMessage?.clientMsgID==message.id,
            delivery=outboxById[message.id]?.state,
        ))
        val options=entries.map { entry -> ChatMenuOption(entry) {
            selected=null
            when(entry.action) {
                MessageMenuAction.RETRY -> callbacks.onRetryFailed(message.id)
                MessageMenuAction.RECONCILE -> callbacks.onReconcile(message.id)
                MessageMenuAction.RECALL -> { recallReason="";confirmManage=message to ChatAction.RECALL }
                MessageMenuAction.FORWARD -> { multi=true;forwardMode=true;selection=setOf(message.id);selectionOrder=listOf(message.id);plus=false;composerPanels.setEmoji(false) }
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
                MessageMenuAction.MULTI -> { multi=true;forwardMode=false;selection=setOf(message.id);selectionOrder=listOf(message.id);plus=false;composerPanels.setEmoji(false) }
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
    // 长按头像 @TA（对标 H5 ImAtActionSheet）：45% 黑遮罩 + 底部白色圆角卡片，@TA / 取消 两档，蓝色文案
    avatarMention?.let { message -> androidx.compose.ui.window.Dialog(onDismissRequest={ avatarMention=null },properties=androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth=false)) {
        Box(Modifier.fillMaxSize().background(Color(0x73000000)).clickable { avatarMention=null }) {
            Column(Modifier.fillMaxWidth().align(Alignment.BottomCenter).padding(start=rpx(32),end=rpx(32),top=rpx(24),bottom=rpx(32)).clip(RoundedCornerShape(rpx(24))).background(C.card)) {
                Text("@TA",Modifier.fillMaxWidth().height(rpx(104)).clickable { avatarMention=null;mentionMember(message) }.wrapContentSize(),fontSize=(32*factor).sp,color=C.primaryText)
                Box(Modifier.fillMaxWidth().padding(horizontal=rpx(24)).height(1.dp).background(C.field))
                Text("取消",Modifier.fillMaxWidth().height(rpx(104)).clickable { avatarMention=null }.wrapContentSize(),fontSize=(32*factor).sp,color=C.primaryText)
            }
        }
    } }
    if(showVideoSource)AlertDialog(onDismissRequest={ showVideoSource=false },title={ Text("选择视频") },text={ Column {
        ActionButton("从相册选择") { showVideoSource=false;videoAlbum.launch(arrayOf("video/*")) }
        ActionButton("拍摄视频") { showVideoSource=false;if(ContextCompat.checkSelfPermission(context,Manifest.permission.CAMERA)==PackageManager.PERMISSION_GRANTED)captureVideo() else videoCameraPermission.launch(Manifest.permission.CAMERA) }
    } },confirmButton={ TextButton(onClick={ showVideoSource=false }) { Text("取消") } })
    confirmDelete?.let { message -> AlertDialog(onDismissRequest={ confirmDelete=null },title={ Text("删除本地消息？") },text={ Text("这条消息将从本机聊天记录移除。") },confirmButton={ TextButton(onClick={ confirmDelete=null;callbacks.onAction(message,ChatAction.DELETE_LOCAL) { result -> onUI { if(result.isFailure)notice=result.exceptionOrNull()?.message ?: "删除失败" else NativeNotices.show("已删除") } } }) { Text("删除") } },dismissButton={ TextButton(onClick={ confirmDelete=null }) { Text("取消") } }) }
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
        val gallery=if(url in pictures)pictures else listOf(url)
        val start=gallery.indexOf(url).coerceAtLeast(0)
        val message=imageMessage
        ImagePreview(gallery,start,{ image=null;imageMessage=null },{ saveOriginal(it) },
            sender=message?.sender?.ifBlank { if(message.mine)"我" else "图片" } ?: "",
            time=message?.let { chatDayLabel(it.time)+" "+chatTime(it.time) }.orEmpty(),
            onDelete=message?.takeUnless { it.id.startsWith("upload-") }?.let { target -> { image=null;imageMessage=null;confirmDelete=target } },
            onForward=message?.takeUnless { it.id.startsWith("upload-") }?.let { target -> { image=null;imageMessage=null;forward=target } },
            saving=preparing)
    }
    video?.let { url ->
        val message=videoMessage?.takeIf { MessageContents.parse(it.serialized,it.text).url==url }
        val content=message?.let { MessageContents.parse(it.serialized,it.text) }
        val ownMedia=message?.let { current->uploadsById[current.id]?.media() ?: state.localSentMedia[current.id] } ?: videoLocal
        VideoPreview(url,{ video=null;videoMessage=null;videoLocal=null },{ notice=it },poster=content?.thumbnail.orEmpty(),sender=message?.sender?.ifBlank { if(message.mine)"我" else "视频" } ?: "视频",time=message?.let { chatDayLabel(it.time)+" "+chatTime(it.time) }.orEmpty(),onSave={ saveVideo(url,ownMedia?.file) },onForward=message?.takeUnless { it.id.startsWith("upload-") }?.let { { video=null;videoMessage=null;videoLocal=null;forward=it } },onDelete=message?.takeUnless { it.id.startsWith("upload-") }?.let { { video=null;videoMessage=null;videoLocal=null;confirmDelete=it } },localFile=ownMedia?.file,localPoster=ownMedia?.snapshot,allowedLocalDirectory=state.mediaOwnerDirectory.takeIf(String::isNotBlank)?.let(::File),saving=preparing)
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
                    102 -> RemoteMediaImage(MediaURLs.image(content.thumbnail.ifEmpty { content.url }),Modifier.size(180.dp,140.dp).clickable { image=content.url;imageMessage=null },scale=ContentScale.Fit,cacheUrls=listOf(content.url,content.thumbnail)+content.imageAlternatives)
                    104 -> Box(Modifier.size(180.dp,140.dp).background(ChatGray).clickable { video=content.url },contentAlignment=Alignment.Center) { if(content.thumbnail.isNotBlank())RemoteMediaImage(MediaURLs.image(content.thumbnail),Modifier.fillMaxSize(),scale=ContentScale.Fit);Text("▶ ${duration(content.duration)}",color=ChatBlue) }
                    103 -> Text("◖))) ${content.duration}″",Modifier.clickable { scope.launch {
                        val source=voiceSource(context,message.id,content,state.active?.target?.conversationId.orEmpty(),state.active?.target?.sessionType==3)
                        if(source.isEmpty())notice="语音暂无法播放" else player.play(source,{}, { onUI { notice="语音暂无法播放" } })
                    } }.padding(8.dp),color=ChatBlue)
                    105 -> Text("▤ ${content.fileName}",Modifier.clickable { openFile(content) }.padding(8.dp),color=ChatBlue)
                    108 -> Text("名片：${content.cardName}",Modifier.clickable { callbacks.onOpenPeer(content.cardUserId) }.padding(8.dp),color=ChatBlue)
                    else -> SelectionContainer { Text(content.text.ifBlank { "[消息]" }) }
                }
            }
        }
    } },confirmButton={ TextButton(onClick={ merge=null }) { Text("关闭") } }) }
}
