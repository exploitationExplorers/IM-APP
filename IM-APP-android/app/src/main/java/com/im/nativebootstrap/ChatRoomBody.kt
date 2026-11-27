package com.im.nativebootstrap

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.activity.result.ActivityResultLauncher
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.ClipboardManager
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.im.nativebootstrap.chat.*
import com.im.nativebootstrap.media.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import java.io.File

/** 聊天页主内容区（顶栏/横幅/消息列表/输入区），自 NativeChatUI.kt 抽出。 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun ChatRoomBody(dlg:ChatDialogScope) {
    var multi by dlg.multi
    var selection by dlg.selection
    var selectionOrder by dlg.selectionOrder
    var forwardMode by dlg.forwardMode
    var quoted by dlg.quoted
    var notice by dlg.notice
    var text by dlg.text
    var plus by dlg.plus
    var voiceMode by dlg.voiceMode
    var preparing by dlg.preparing
    var showVideoSource by dlg.showVideoSource
    var recallReason by dlg.recallReason
    var confirmMultiRecall by dlg.confirmMultiRecall
    var confirmMultiDelete by dlg.confirmMultiDelete
    var multiForward by dlg.multiForward
    var showMentions by dlg.showMentions
    var composerCursor by dlg.composerCursor
    var pickerKind by dlg.pickerKind
    var failedMedia by dlg.failedMedia
    val sending=dlg.sending
    val recalling=dlg.recalling
    val forwarding=dlg.forwarding
    val deleting=dlg.deleting
    val recording=dlg.recording
    val recordingSeconds=dlg.recordingSeconds
    val voiceWorking=dlg.voiceWorking
    val playing=dlg.playing
    val retryingMedia=dlg.retryingMedia
    val mentionKeyword=dlg.mentionKeyword
    val presenceNow=dlg.presenceNow
    val list=dlg.list
    val reversedMessages=dlg.reversedMessages
    val rowEvents=dlg.rowEvents
    val emoji=dlg.emoji
    val ownAvatar=dlg.ownAvatar
    val enterToSend=dlg.enterToSend
    val pick=dlg.pick
    val recordPermission=dlg.recordPermission
    val cameraPermission=dlg.cameraPermission
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
    fun rpx(value:Int)=dlg.rpx(value)
    fun selectedMessages()=dlg.selectedMessages()
    fun canRecall(message:ChatMessage)=dlg.canRecall(message)
    fun sendFile(local:LocalMedia)=dlg.sendFile(local)
    fun stopVoice(sendAfter:Boolean=false)=dlg.stopVoice(sendAfter)
    fun startVoice()=dlg.startVoice()
    fun cancelVoice()=dlg.cancelVoice()
    fun capture()=dlg.capture()
    fun submitText()=dlg.submitText()
    fun updateDraft(value:String)=dlg.updateDraft(value)
    fun pickMention(choice:ChatMentionChoice)=dlg.pickMention(choice)
    Column(Modifier.fillMaxSize().background(ChatGray).statusBarsPadding().navigationBarsPadding().then(if(!emoji&&!plus)Modifier.imePadding() else Modifier)) {
        Row(Modifier.fillMaxWidth().height(rpx(110)).background(C.card).padding(horizontal=rpx(26)),verticalAlignment=Alignment.CenterVertically) {
            Box(Modifier.size(rpx(52)).clickable(onClick=callbacks.onBack),contentAlignment=Alignment.Center) { Image(painterResource(R.drawable.uni_icon_back),"返回",Modifier.size(rpx(44)),contentScale=ContentScale.Fit) }
            Column(Modifier.weight(1f).combinedClickable(onClick=callbacks.onOpenDetails,onLongClick={ clipboard.setText(AnnotatedString(state.active?.title.orEmpty()));notice="已复制聊天名称" }).padding(horizontal=rpx(8)),horizontalAlignment=Alignment.Start) {
                Text(if(multi)"已选择 ${selection.size} 条消息" else state.active?.title ?: "聊天",fontSize=(34*factor).sp,fontWeight=FontWeight.Bold,color=C.textStrong,maxLines=1,overflow=TextOverflow.Ellipsis)
                if(state.connection!=ConnectionState.CONNECTED)Text(if(state.connection==ConnectionState.CONNECTING) "连接中…" else "连接暂不可用",color=ChatHint,fontSize=(20*factor).sp)
                else if(state.active?.target?.sessionType==1)ChatSystemMessages.lastSeen(state.peerLastSeenAt,state.peerOnline==true,presenceNow).takeIf { it.isNotBlank() }?.let { Text(it,color=ChatHint,fontSize=(20*factor).sp) }
            }
            if(multi)Text("取消",Modifier.clickable(enabled=!deleting&&!forwarding&&!recalling) { multi=false;selection=emptySet();selectionOrder=emptyList();if(forwardMode)quoted=null;forwardMode=false },fontSize=14.sp,color=ChatBlue)
            else Canvas(Modifier.size(rpx(52)).semantics { contentDescription="聊天详情" }.clickable(onClick=callbacks.onOpenDetails)) {
                val gap=size.width*.23f
                listOf(-1,0,1).forEach { index -> drawCircle(C.text,size.width*.043f,Offset(size.width/2+index*gap,size.height/2)) }
            }
        }
        if(BuildConfig.DEBUG&&state.messages.size<=1)Text(
            "诊断 sync=${state.sync} store=${state.store} 本地读=${state.historyLoading} 远端补=${state.historySyncing} 说明=${state.historyDiagnostic ?: state.error ?: "-"}",
            Modifier.fillMaxWidth().background(Color(0x33FFC107)).padding(horizontal=rpx(20),vertical=rpx(6)),
            color=C.textSub,fontSize=(18*factor).sp,maxLines=2,overflow=TextOverflow.Ellipsis,
        )
        if(state.showAnnouncementBanner&&state.groupAnnouncement.isNotBlank())Row(Modifier.fillMaxWidth().height(rpx(72)).background(C.card).padding(horizontal=rpx(24)),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(rpx(16))) {
            Image(painterResource(R.drawable.uni_icon_megaphone),"群公告",Modifier.size(rpx(36)),contentScale=ContentScale.Fit)
            Text(state.groupAnnouncement,Modifier.weight(1f).clickable { if(state.groupBusinessId.isNotBlank())callbacks.onOpenAnnouncements(state.groupBusinessId) },fontSize=(26*factor).sp,color=C.text,maxLines=1,overflow=TextOverflow.Ellipsis)
            Text("不再提示",Modifier.clickable(onClick=callbacks.onDismissAnnouncement),color=C.primaryText,fontSize=(26*factor).sp)
        }
        state.active?.pinnedMessage?.takeIf { state.showPinnedBanner }?.let { pin -> Row(Modifier.fillMaxWidth().background(C.card).clickable {
            callbacks.onAction(ChatMessage(pin.clientMsgID,pin.preview,false,0),ChatAction.OPEN_PIN) { result -> onUI { if(result.isFailure)notice=result.exceptionOrNull()?.message ?: "置顶消息暂不可读取" } }
        }.padding(horizontal=16.dp,vertical=8.dp),verticalAlignment=Alignment.CenterVertically) {
            Box(Modifier.width(3.dp).height(32.dp).background(ChatBlue))
            Column(Modifier.weight(1f).padding(start=10.dp)) { Text(if(pin.scope=="shared")"置顶消息" else "仅为我置顶",color=C.primaryText,fontSize=12.sp);Text(pin.preview,maxLines=1,overflow=TextOverflow.Ellipsis,fontSize=13.sp,color=C.hint) }
            // × 直接走取消置顶（与长按菜单一致），失败时提示并保留本地隐藏。
            Text("×",Modifier.clickable {
                callbacks.onDismissPin()
                callbacks.onAction(ChatMessage(pin.clientMsgID,pin.preview,false,0),ChatAction.UNPIN) { result -> onUI { notice=if(result.isSuccess)"已取消置顶" else result.exceptionOrNull()?.message ?: "取消置顶失败" } }
            }.padding(10.dp),color=ChatHint)
        } }
        val pendingPinSync=remember(state.outbox) { state.outbox.filter { MessageContents.isPinSync(it.message.serialized)&&it.state in setOf(OutboxState.UNCERTAIN,OutboxState.FAILED) } }
        pendingPinSync.forEach { entry -> Text("置顶同步结果待核对 · 点击核对",Modifier.fillMaxWidth().background(C.warnBg).clickable { callbacks.onReconcile(entry.id) }.padding(10.dp),color=C.warnText,fontSize=12.sp) }
        failedMedia.forEach { media -> Row(Modifier.fillMaxWidth().background(C.warnBg).padding(horizontal=12.dp,vertical=6.dp),verticalAlignment=Alignment.CenterVertically) {
            Text("待上传：${media.name}",Modifier.weight(1f),maxLines=1,overflow=TextOverflow.Ellipsis,fontSize=12.sp,color=C.warnText)
            TextButton(enabled=!state.uploading&&media.file.absolutePath !in retryingMedia,onClick={ sendFile(media) }) { Text("重试上传") }
            TextButton(enabled=media.file.absolutePath !in retryingMedia,onClick={ failedMedia=failedMedia.filterNot { it.file==media.file };media.file.delete();media.snapshot?.delete() }) { Text("移除草稿") }
        } }
        if(reversedMessages.isEmpty()) {
            ChatRoomLoadingState(state,callbacks.onLoadHistory,Modifier.weight(1f).fillMaxWidth())
        } else {
        // 消息不足一屏时顶格显示（reverseLayout 下 Top=视觉顶部），与微信一致；消息多时无影响。
        LazyColumn(Modifier.weight(1f).fillMaxWidth(),state=list,reverseLayout=true,verticalArrangement=Arrangement.Top,contentPadding=PaddingValues(vertical=rpx(20))) {
            itemsIndexed(reversedMessages,key={ _,message -> message.id },contentType={ _,message -> message.contentType }) { index,message ->
                ChatMessageRow(
                    message=message,
                    older=reversedMessages.getOrNull(index+1),
                    state=state,
                    callbacks=callbacks,
                    ownAvatar=ownAvatar,
                    factor=factor,
                    scope=scope,
                    context=context,
                    clipboard=clipboard,
                    player=player,
                    playing=playing,
                    multi=multi,
                    selection=selection,
                    deleting=deleting,
                    forwarding=forwarding,
                    recalling=recalling,
                    uploadsById=uploadsById,
                    outboxById=outboxById,
                    events=rowEvents,
                )
            }
            item(key="history-progress") {
                Box(Modifier.fillMaxWidth().height(28.dp),contentAlignment=Alignment.Center) {
                    if(state.historyLoading||state.historySyncing)CircularProgressIndicator(Modifier.size(16.dp).semantics { contentDescription="正在读取更早消息" },color=ChatHint,strokeWidth=1.5.dp)
                }
            }
        }
        }
        if(list.firstVisibleItemIndex>2)Box(Modifier.fillMaxWidth().background(ChatGray).padding(end=16.dp,bottom=6.dp),contentAlignment=Alignment.CenterEnd) { Text("↓",Modifier.size(36.dp).clip(CircleShape).background(C.card).clickable { scope.launch { list.animateScrollToItem(0) } }.wrapContentSize(),color=ChatBlue,fontSize=22.sp) }
        if(multi)Row(Modifier.fillMaxWidth().background(C.field).padding(start=rpx(24),end=rpx(24),top=rpx(16),bottom=rpx(24)),horizontalArrangement=Arrangement.spacedBy(rpx(16))) {
            val idle=!deleting&&!forwarding&&!recalling
            MultiSelectButton("取消",Modifier.weight(1f),idle) { multi=false;selection=emptySet();selectionOrder=emptyList();forwardMode=false }
            MultiSelectButton("转发(${selection.size})",Modifier.weight(1f),selection.isNotEmpty()&&idle,primary=true) { multiForward=selectedMessages() }
            if(!forwardMode)MultiSelectButton(if(recalling)"撤回中…" else "撤回(${selection.size})",Modifier.weight(1f),selection.isNotEmpty()&&selectedMessages().size==selection.size&&selectedMessages().all(::canRecall)&&idle,danger=true) { recallReason="";confirmMultiRecall=true }
            if(!forwardMode)MultiSelectButton(if(deleting)"删除中…" else "删除(${selection.size})",Modifier.weight(1f),selection.isNotEmpty()&&idle,danger=true) { confirmMultiDelete=true }
        }
        else {
        quoted?.let { quote -> Row(Modifier.fillMaxWidth().background(C.field).padding(10.dp),verticalAlignment=Alignment.CenterVertically) { Text("回复 ${quote.sender}：${quote.text}",Modifier.weight(1f),maxLines=2,overflow=TextOverflow.Ellipsis,color=ChatHint,fontSize=12.sp);Text("✕",Modifier.clickable { quoted=null }.padding(8.dp)) } }
        // @ 提及面板（对标 H5 ImAtMentionPanel）：内嵌在输入框上方，不打断键盘输入
        if(showMentions&&state.sendBlockedReason==null)ChatMentionPanel(mentionKeyword,callbacks.onLoadMentions,{ showMentions=false },::pickMention)
        if(state.sendBlockedReason!=null)Row(Modifier.fillMaxWidth().height(rpx(96)).background(C.field).padding(horizontal=rpx(32)),verticalAlignment=Alignment.CenterVertically) {
            Text(state.sendBlockedReason,Modifier.weight(1f),color=C.faint,fontSize=(26*factor).sp)
            // 解散/退群属于终态，重新检查禁言没有意义，仅临时性限制（禁言等）才展示刷新入口。
            if(state.sendBlockedReason !in setOf("群聊已解散","您已不在该群聊"))Text(if(state.permissionLoading)"检查中…" else "检查禁言状态",Modifier.clip(RoundedCornerShape(rpx(28))).border(1.dp,C.primaryText,RoundedCornerShape(rpx(28))).clickable(enabled=!state.permissionLoading,onClick=callbacks.onRefreshPermission).padding(horizontal=rpx(24),vertical=rpx(12)),color=C.primaryText,fontSize=(24*factor).sp)
        }
        else if(voiceMode)Row(Modifier.fillMaxWidth().background(C.field).padding(horizontal=rpx(20),vertical=rpx(18)),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(rpx(12))) {
            Box(Modifier.size(rpx(52)).clickable(enabled=!voiceWorking,onClick=::cancelVoice),contentAlignment=Alignment.Center) { Image(painterResource(R.drawable.uni_video_trash),"取消录音",Modifier.size(rpx(32)),contentScale=ContentScale.Fit,colorFilter=androidx.compose.ui.graphics.ColorFilter.tint(C.textSub)) }
            Row(Modifier.weight(1f).height(rpx(76)).clip(RoundedCornerShape(rpx(18))).background(C.field).clickable(enabled=recording&&!voiceWorking) { stopVoice() },verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.Center) {
                Box(Modifier.size(rpx(14)).clip(CircleShape).background(if(recording)C.danger else C.placeholder))
                Text(duration(recordingSeconds.toLong()),Modifier.padding(start=rpx(12)),fontSize=(28*factor).sp,color=C.textSub)
            }
            Box(Modifier.height(rpx(68)).widthIn(min=rpx(132)).clip(RoundedCornerShape(rpx(20))).background(C.field).clickable(enabled=!voiceWorking) { stopVoice(!recording) }.padding(horizontal=rpx(18)),contentAlignment=Alignment.Center) { Text(if(voiceWorking)"处理中" else if(recording)"结束" else "发送",fontSize=(26*factor).sp,color=C.textSub) }
            Canvas(Modifier.size(rpx(64)).clip(CircleShape).background(C.primary).semantics { contentDescription="发送语音" }.clickable(enabled=!voiceWorking) { stopVoice(true) }) {
                val center=size.width/2;val stroke=2.dp.toPx()
                drawLine(Color.White,Offset(center,size.height*.72f),Offset(center,size.height*.28f),stroke,StrokeCap.Round)
                drawLine(Color.White,Offset(size.width*.33f,size.height*.46f),Offset(center,size.height*.28f),stroke,StrokeCap.Round)
                drawLine(Color.White,Offset(size.width*.67f,size.height*.46f),Offset(center,size.height*.28f),stroke,StrokeCap.Round)
            }
        }
        else NativeMessageComposer(text,state.ready,state.ready&&!state.uploading&&!voiceWorking&&!sending,enterToSend,emoji,::updateDraft,
            composerCursor,{composerCursor=null},
            onEditorTap={ composerPanels.setEmoji(false);plus=false },
            onEmojiChange={ open -> composerPanels.setEmoji(open);plus=false;voiceMode=false },
            onToggleMore={ plus=!plus;composerPanels.setEmoji(false) },
            onStartVoice={ if(ContextCompat.checkSelfPermission(context,Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED)startVoice() else recordPermission.launch(Manifest.permission.RECORD_AUDIO) },onSend=::submitText)
        if(plus&&state.sendBlockedReason==null)Column(Modifier.fillMaxWidth().background(C.field).padding(start=rpx(32),end=rpx(32),top=rpx(24),bottom=rpx(32)),verticalArrangement=Arrangement.spacedBy(rpx(28))) {
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
            composerPanels.setEmoji(false)
            callbacks.onSendSticker(url) { result -> onUI { if(result.isFailure)notice=result.exceptionOrNull()?.message ?: "表情发送结果待核对，请查看聊天" } }
        },{ composerPanels.setEmoji(false);callbacks.onManageStickers() },onClose={ composerPanels.setEmoji(false) })
        }
    }
}
