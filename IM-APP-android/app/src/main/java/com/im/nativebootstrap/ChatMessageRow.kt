package com.im.nativebootstrap

import android.content.Context
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.ClipboardManager
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.im.nativebootstrap.chat.*
import com.im.nativebootstrap.media.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/**
 * 消息行对宿主 NativeChatRoom 的写回事件集合。
 *
 * 宿主用 remember 创建一次：lambda 捕获的是 by-remember 的 MutableState 委托，
 * 每次调用读到的都是最新值，不会把状态快照进本对象。参数保持同一个实例，
 * 让 ChatMessageRow 在参数未变时可以被 Compose 跳过重组。
 */
internal class ChatRowEvents(
    val onNotice:(String)->Unit,
    val onImage:(String,ChatMessage)->Unit,
    val onVideo:(String,ChatMessage,LocalMedia?)->Unit,
    val onMerge:(ChatMessage)->Unit,
    val onInvite:(GroupMessageCard)->Unit,
    val onSelectBubble:(ChatMessage,Offset?)->Unit,
    val onUploadMenu:(PendingMediaUpload)->Unit,
    val onAvatarMention:(ChatMessage)->Unit,
    val onToggleSelection:(ChatMessage)->Unit,
    val onOpenFile:(MessageContent)->Unit,
    val onPlayingChange:(String?)->Unit,
    /** 异步回调里判断播放态要用实时值，不能用重组时的参数快照。 */
    val currentPlaying:()->String?,
)

/**
 * 单条消息渲染（日期头 / 系统通知 / 头像 / 气泡 / 各类型消息体 / 时间与发送状态）。
 *
 * 从 NativeChatRoom 拆出的独立 Composable：既压低宿主方法的指令数使其可被 JIT 编译，
 * 也让每行拥有独立的重组作用域。渲染逻辑与原实现逐句一致，不做行为变更。
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun ChatMessageRow(
    message:ChatMessage,
    older:ChatMessage?,
    state:ChatState,
    callbacks:NativeChatCallbacks,
    ownAvatar:String,
    factor:Float,
    scope:CoroutineScope,
    context:Context,
    clipboard:ClipboardManager,
    player:VoicePlayer,
    playing:String?,
    multi:Boolean,
    selection:Set<String>,
    deleting:Boolean,
    forwarding:Boolean,
    recalling:Boolean,
    uploadsById:Map<String,PendingMediaUpload>,
    outboxById:Map<String,OutboxEntry>,
    events:ChatRowEvents,
) {
    fun rpx(value:Int)=(value*factor).dp
    // 倒序列表中每条消息只提供一个布局根，日期与气泡按正常顺序排布。
    Column(Modifier.fillMaxWidth()) {
        val content=remember(message.serialized,message.text) { MessageContents.parse(message.serialized,message.text) }
        val upload=uploadsById[message.id]
        val localVideo=if(content.type==104)(upload?.media() ?: state.localSentMedia[message.id]) else null
        // 坐标只在长按时读取，用普通 holder 而非 MutableState：滚动期间每次布局都写 state 会制造无意义的重组压力。
        val bubbleBounds=remember(message.id) { arrayOfNulls<Rect>(1) }
        if(older==null||chatDayKey(older.time)!=chatDayKey(message.time))Box(Modifier.fillMaxWidth().padding(vertical=rpx(12)),contentAlignment=Alignment.Center) { Text(chatDayLabel(message.time),Modifier.clip(RoundedCornerShape(rpx(12))).background(C.field).padding(horizontal=rpx(18),vertical=rpx(7)),color=C.hint,fontSize=(22*factor).sp) }
        val legacySystem=content.senderId=="imAdmin"&&(content.text=="新群创建成功，一起来聊天吧"||legacyAdminClearRegex.matches(content.text))
        if(message.serialized.isBlank()||content.type>=1000||content.type==0||legacySystem) {
            // 群通知的操作人是 OpenIM 管理账号（业务接口代为修改），统一显示「群主」；
            // 不能换成群主昵称，否则会把人名写成账号名（如「用户 8612」），与列表预览也不一致。
            val system=if(content.type>=1000)ChatSystemMessages.format(message.serialized,"群主") { id -> state.groupMembers[id]?.name.orEmpty() } else content.text.ifBlank { message.text }
            if(system.isNotBlank())Box(Modifier.fillMaxWidth().padding(rpx(12)),contentAlignment=Alignment.Center) { Text(system.replace("imAdmin","群主"),color=ChatHint,fontSize=(23*factor).sp) }
        } else {
            // 多选模式下选择圈固定在最左侧：自己的消息改用 Start 排列 + weight 占位把气泡组推回右侧。
            Row(Modifier.fillMaxWidth().padding(horizontal=rpx(24),vertical=rpx(16)),horizontalArrangement=if(message.mine&&!multi)Arrangement.End else Arrangement.Start,verticalAlignment=Alignment.Top) {
                if(multi&&upload==null) {
                    Text(if(message.id in selection)"●" else "○",Modifier.clickable(enabled=!deleting&&!forwarding&&!recalling) { events.onToggleSelection(message) }.padding(end=8.dp,top=8.dp),color=if(message.id in selection)ChatBlue else ChatHint,fontSize=22.sp)
                    if(message.mine)Spacer(Modifier.weight(1f))
                }
                if(!message.mine)SharedAvatar(content.avatar,Modifier.size(rpx(72)).combinedClickable(onClick={ if(multi)events.onToggleSelection(message) else if(content.senderId.isNotEmpty())callbacks.onOpenPeer(content.senderId) },onLongClick={ if(!multi&&state.active?.target?.sessionType==3)events.onAvatarMention(message) }))
                Column(Modifier.widthIn(max=(LocalConfiguration.current.screenWidthDp*.70f).dp).padding(horizontal=rpx(16)),horizontalAlignment=if(message.mine)Alignment.End else Alignment.Start) {
                    if(state.active?.target?.sessionType==3) {
                        val member=state.groupMembers[content.senderId]
                        val role=member?.role ?: if(message.mine)state.groupRole else ""
                        if(!message.mine||role in setOf("owner","admin"))Row(Modifier.padding(bottom=rpx(8)),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(rpx(8))) {
                            if(!message.mine)Text(member?.name?.ifBlank { message.sender } ?: message.sender,Modifier.combinedClickable(onClick={},onLongClick={ clipboard.setText(AnnotatedString(member?.name?.ifBlank { message.sender } ?: message.sender));events.onNotice("已复制昵称") }),color=ChatHint,fontSize=(22*factor).sp,maxLines=1,overflow=TextOverflow.Ellipsis)
                            if(role in setOf("owner","admin"))Text(if(role=="owner")"群主" else "管理员",Modifier.border(rpx(2),if(role=="admin")ChatBlue else C.line,RoundedCornerShape(rpx(6))).padding(horizontal=rpx(8)),color=if(role=="admin")ChatBlue else C.hint,fontSize=(18*factor).sp,lineHeight=(26*factor).sp)
                        }
                    }
                    val shape=RoundedCornerShape(topStart=rpx(if(message.mine)16 else 4),topEnd=rpx(if(message.mine)4 else 16),bottomStart=rpx(16),bottomEnd=rpx(16))
                    val isVisual=content.type==102||content.type==104
                    val background=if(isVisual)Color.Transparent else if(content.groupCard!=null)C.bubble else if(message.mine)ChatBlue else C.bubble
                    val foreground=if(message.mine&&content.groupCard==null)Color.White else C.text
                    Box(Modifier.onGloballyPositioned { bubbleBounds[0]=it.boundsInWindow() }.clip(shape).background(background).combinedClickable(onClick={
                        if(upload!=null&&content.type!=104) { if(upload.state==MediaUploadState.FAILED)callbacks.onRetryUpload(upload.id);return@combinedClickable }
                        if(multi) { if(!deleting&&!recalling)events.onToggleSelection(message);return@combinedClickable }
                        when(content.type) {
                            102 -> if(content.url.isNotEmpty())events.onImage(content.url,message) else events.onNotice("图片原图地址不可用")
                            103 -> if(playing==message.id) { player.stop();events.onPlayingChange(null) } else {
                                events.onPlayingChange(message.id)
                                scope.launch {
                                    val source=voiceSource(context,message.id,content,state.active?.target?.conversationId.orEmpty(),state.active?.target?.sessionType==3)
                                    if(events.currentPlaying()!=message.id)return@launch
                                    if(source.isEmpty()) { events.onPlayingChange(null);events.onNotice("语音暂无法播放");return@launch }
                                    player.play(source,{ onUI { events.onPlayingChange(null) } },{ onUI { events.onPlayingChange(null);events.onNotice("语音播放失败，可稍后重试") } })
                                }
                            }
                            104 -> if(content.url.isNotEmpty()||localVideo?.file?.isFile==true)events.onVideo(content.url,message,localVideo) else events.onNotice("视频仍在准备，请稍后点按")
                            105 -> events.onOpenFile(content)
                            108 -> if(content.cardUserId.isNotEmpty())callbacks.onOpenPeer(content.cardUserId)
                            107 -> events.onMerge(message)
                        }
                    },onLongClick={ if(!multi) { if(upload!=null)events.onUploadMenu(upload) else { events.onSelectBubble(message,bubbleBounds[0]?.let { Offset(it.center.x,it.bottom) }) } } }).then(if(isVisual)Modifier else Modifier.padding(horizontal=rpx(22),vertical=rpx(18)))) {
                        when(content.type) {
                            104 -> VideoMessageBubble(content,localPoster=localVideo?.snapshot,sending=upload?.state==MediaUploadState.UPLOADING||outboxById[message.id]?.state==OutboxState.PENDING||outboxById[message.id]?.state==OutboxState.SENDING)
                            102 -> {
                                val maxWidth=210f*factor/.52f
                                val width=if(content.width>0&&content.height>0)minOf(maxWidth,maxOf(90f,maxWidth*content.width/content.height)) else 170f
                                val height=if(content.width>0&&content.height>0)(width*content.height/content.width).coerceIn(80f,260f) else 160f
                                Box(Modifier.size(width.dp,height.dp).clip(RoundedCornerShape(rpx(12)))) {
                                    if(upload!=null||content.thumbnail.isNotEmpty()||content.url.isNotEmpty())RemoteMediaImage(MediaURLs.image(content.thumbnail.ifEmpty { content.url }),Modifier.fillMaxSize(),scale=ContentScale.Fit,fallbackUrls=content.imageAlternatives.map { MediaURLs.image(it) },localDraft=upload?.media()?.file,retryOnTap=false,cacheUrls=listOf(content.url,content.thumbnail)+content.imageAlternatives)
                                    else Box(Modifier.fillMaxSize().background(C.field),contentAlignment=Alignment.Center) { Text("视频",color=ChatHint) }
                                    if(content.type==104)Text("▶",Modifier.align(Alignment.Center).background(Color(0x77000000),CircleShape).padding(14.dp),color=Color.White,fontSize=24.sp)
                                    if(content.type==104)Text(duration(content.duration),Modifier.align(Alignment.BottomEnd).padding(6.dp),color=Color.White,fontSize=12.sp)
                                    if(upload?.state==MediaUploadState.UPLOADING||outboxById[message.id]?.state==OutboxState.PENDING||outboxById[message.id]?.state==OutboxState.SENDING)Box(Modifier.align(Alignment.Center).size(38.dp).background(Color(0x66000000),CircleShape).semantics { contentDescription="图片正在发送" },contentAlignment=Alignment.Center) { CircularProgressIndicator(Modifier.size(22.dp),strokeWidth=2.dp,color=Color.White) }
                                }
                            }
                            103 -> Row(Modifier.widthIn(min=90.dp,max=180.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.SpaceBetween) { Text(if(playing==message.id) "■ 播放中" else "◖)))",color=foreground);Text("${content.duration}″",color=foreground) }
                            105 -> Column(Modifier.widthIn(min=140.dp,max=220.dp)) { Text("▤  ${content.fileName.ifBlank { "文件" }}",color=foreground,maxLines=2,fontSize=(29*factor).sp);Text(fileSize(content.size)+" · 点击打开",color=foreground.copy(alpha=.7f),fontSize=(22*factor).sp,modifier=Modifier.padding(top=6.dp)) }
                            108 -> Row(verticalAlignment=Alignment.CenterVertically) { SharedAvatar(content.thumbnail,Modifier.size(42.dp));Text(content.cardName.ifBlank { "个人名片" },Modifier.padding(start=10.dp),color=foreground) }
                            107 -> Column { Text("聊天记录",color=foreground,fontWeight=FontWeight.Medium);Text(content.text,color=foreground,fontSize=12.sp) }
                            110 -> content.groupCard?.let { card -> Column(Modifier.widthIn(min=rpx(300),max=rpx(460)),horizontalAlignment=Alignment.CenterHorizontally) {
                                if(card.kind=="group_invite") {
                                    GroupInviteCard(card,message.mine,foreground,state.inviteHandled[card.token]) { callbacks.onInviteHandled(card.token,"邀请已过期");events.onInvite(card) }
                                } else {
                                    Row(verticalAlignment=Alignment.CenterVertically) { SharedAvatar(card.avatar,Modifier.size(rpx(76)));Column(Modifier.padding(start=rpx(16))) { Text(card.applicantName,color=foreground,fontWeight=FontWeight.SemiBold);Text("申请加入 ${card.groupName}",color=foreground.copy(alpha=.7f),fontSize=(24*factor).sp) } }
                                    Text("去审核",Modifier.padding(top=rpx(20)).clickable { callbacks.onOpenJoinRequests(card.groupId) },color=ChatBlue,fontSize=(26*factor).sp)
                                }
                            } } ?: Text(content.text.ifBlank { "[自定义消息]" },color=foreground)
                            else -> Column {
                                if(content.quoteText.isNotEmpty())Row(Modifier.clickable(enabled=content.quoteId.isNotEmpty()) { callbacks.onAction(ChatMessage(content.quoteId,"",false,0),ChatAction.OPEN_MESSAGE) { result -> onUI { if(result.isFailure)events.onNotice(result.exceptionOrNull()?.message ?: "引用消息暂不可定位") } } }.clip(RoundedCornerShape(rpx(8))).background(if(message.mine)Color(0x22FFFFFF) else C.field).padding(rpx(8)),verticalAlignment=Alignment.CenterVertically) {
                                    if(content.quoteThumbnail.isNotEmpty())RemoteMediaImage(MediaURLs.image(content.quoteThumbnail),Modifier.size(rpx(64)),scale=ContentScale.Crop,description="引用封面",retryOnTap=false,cacheUrls=listOf(content.quoteThumbnail))
                                    Column(Modifier.padding(start=if(content.quoteThumbnail.isNotEmpty())rpx(8) else 0.dp)) {
                                        val name=content.quoteText.substringBefore("：")
                                        val summary=content.quoteText.substringAfter("：",missingDelimiterValue="")
                                        Text(name,color=if(message.mine)foreground else ChatBlue,fontSize=(22*factor).sp,maxLines=1,overflow=TextOverflow.Ellipsis)
                                        if(summary.isNotEmpty())Text(summary,color=foreground.copy(alpha=.8f),fontSize=(22*factor).sp,maxLines=1,overflow=TextOverflow.Ellipsis)
                                    }
                                }
                                if(content.quoteText.isNotEmpty())Spacer(Modifier.height(rpx(10)))
                                Text(if(content.type in setOf(101,106,114))content.text else message.text,color=foreground,fontSize=(30*factor).sp,lineHeight=(43*factor).sp)
                            }
                        }
                    }
                    Row(Modifier.padding(top=rpx(5)),verticalAlignment=Alignment.CenterVertically) {
                        Text(chatTime(message.time),color=ChatHint,fontSize=(20*factor).sp)
                        if(message.mine) {
                            val pending=outboxById[message.id]
                            val read=content.read||message.id in state.readMessageIds||(message.seq>0&&message.seq<=state.maxOtherReadSeq)
                            val status=if(upload!=null)if(upload.state==MediaUploadState.FAILED)"上传失败，点按重试" else "" else when(pending?.state) { OutboxState.PENDING,OutboxState.SENDING -> "◷";OutboxState.UNCERTAIN -> "待核对";OutboxState.FAILED -> "发送失败，点按重试";else -> if(message.status==2||message.seq>0)if(read)"✓✓" else "✓" else "◷" }
                            Text("  $status",Modifier.clickable(enabled=pending!=null||upload?.state==MediaUploadState.FAILED) { if(upload!=null)callbacks.onRetryUpload(upload.id) else if(pending?.state==OutboxState.FAILED)callbacks.onRetryFailed(message.id) else callbacks.onReconcile(message.id) },color=if(pending?.state==OutboxState.FAILED||upload?.state==MediaUploadState.FAILED)C.danger else if(read)ChatBlue else ChatHint,fontSize=(20*factor).sp)
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
