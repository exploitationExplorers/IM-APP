package com.im.nativebootstrap.chat

import android.app.Application
import com.google.gson.Gson
import io.openim.android.sdk.OpenIMClient
import io.openim.android.sdk.enums.LogLevel
import io.openim.android.sdk.enums.ViewType
import io.openim.android.sdk.listener.*
import io.openim.android.sdk.models.*
import open_im_sdk.Open_im_sdk
import java.io.File
import java.util.UUID
import com.im.nativebootstrap.media.MediaKind
import com.im.nativebootstrap.media.UploadedMedia
import com.im.nativebootstrap.media.MessageContents
import com.im.nativebootstrap.media.obj
import com.im.nativebootstrap.media.string
import com.im.nativebootstrap.media.number
import com.google.gson.JsonParser

/** 仅此适配器引用官方 SDK。错误只保留数字，不回显原 SDK 字符串/JSON/凭据。 */
class OpenIMGateway(private val application:Application):ChatGateway {
    private val client get()=OpenIMClient.getInstance()
    private val gson=Gson()
    private var userId=""
    private var initialized=false
    private var watchedPeer:String?=null
    private fun <T> base(done:(Result<T>)->Unit)=object:OnBase<T> {
        override fun onSuccess(data:T) { done(Result.success(data)) }
        override fun onError(code:Int,error:String?) { done(Result.failure(ChatFailure(code))) }
    }
    override fun start(userId:String,token:String,api:String,ws:String,directory:File,events:ChatEvents,done:(Result<Unit>)->Unit) {
        this.userId=userId
        try {
            val config=InitConfig(api,ws,directory.absolutePath).apply {
                logLevel=LogLevel.Fatal
                isLogStandardOutput=false
                logFilePath=File(directory,"logs").apply { check(mkdirs()||isDirectory) }.absolutePath
            }
            initialized=client.initSDK(application,config,object:OnConnListener {
                override fun onConnectSuccess()=events.connection(ConnectionState.CONNECTED)
                override fun onConnecting()=events.connection(ConnectionState.CONNECTING)
                override fun onConnectFailed(code:Int,error:String?)=events.connection(ConnectionState.DISCONNECTED)
                override fun onKickedOffline()=events.connection(ConnectionState.AUTH_REQUIRED)
                override fun onUserTokenExpired()=events.connection(ConnectionState.AUTH_REQUIRED)
                override fun onUserTokenInvalid(error:String?)=events.connection(ConnectionState.AUTH_REQUIRED)
            })
            check(initialized) { "聊天初始化失败" }
            client.userInfoManager.setOnUserListener(object:OnUserListener {
                override fun onUserStatusChanged(status:UsersOnlineStatus?) { status?.userID?.takeIf { it.isNotBlank() }?.let { events.peerStatus(it,status.status==1) } }
            })
            client.conversationManager.setOnConversationListener(object:OnConversationListener {
                override fun onConversationChanged(items:MutableList<ConversationInfo>?)=events.conversations(items.orEmpty().mapNotNull(::conversation))
                override fun onNewConversation(items:MutableList<ConversationInfo>?)=events.conversations(items.orEmpty().mapNotNull(::conversation))
                override fun onSyncServerStart(reinstalled:Boolean)=events.syncStarted()
                override fun onSyncServerFinish(reinstalled:Boolean)=events.syncFinished()
                override fun onSyncServerFailed(reinstalled:Boolean)=events.syncFailed()
            })
            client.messageManager.setAdvancedMsgListener(object:OnAdvanceMsgListener {
                override fun onRecvC2CReadReceipt(receipts:MutableList<C2CReadReceiptInfo>?) { events.read(receipts.orEmpty().flatMap { it.msgIDList.orEmpty() }) }
                override fun onRecvGroupMessageReadReceipt(receipt:GroupMessageReceipt?) { events.read(receipt?.groupMessageReadInfo.orEmpty().filter { it.hasReadCount>0 }.mapNotNull { it.clientMsgID?.takeIf(String::isNotEmpty) }) }
                override fun onRecvMessageRevokedV2(info:RevokedInfo?) { info?.clientMsgID?.takeIf { it.isNotBlank() }?.let { events.tombstone(it,false) } }
                override fun onMsgDeleted(message:Message?) { message?.clientMsgID?.takeIf { it.isNotBlank() }?.let { events.tombstone(it,true) } }
                override fun onRecvNewMessage(message:Message?) { message?.let { incoming(it,events,true) } }
                override fun onRecvOfflineNewMessage(messages:MutableList<Message>?) { messages.orEmpty().forEach { incoming(it,events) } }
            })
            client.groupManager.setOnGroupListener(object:OnGroupListener {
                override fun onGroupMemberAdded(info:GroupMembersInfo?) { info?.groupID?.let(events::groupChanged) }
                override fun onGroupMemberDeleted(info:GroupMembersInfo?) { info?.groupID?.let(events::groupChanged) }
                override fun onGroupMemberInfoChanged(info:GroupMembersInfo?) { info?.groupID?.let(events::groupChanged) }
                override fun onGroupInfoChanged(info:GroupInfo?) { info?.groupID?.let(events::groupChanged) }
            })
            client.login(base<String> { result -> done(result.map { Unit }) },userId,token)
        } catch (_:Exception) { done(Result.failure(IllegalStateException("聊天初始化未完成，请稍后重试。"))) }
    }
    private fun incoming(message:Message,events:ChatEvents,realtime:Boolean=false) {
        val target=target(message) ?: return
        if(message.clientMsgID.isNullOrBlank()) return
        if(message.contentType in 1501..1520&&target.sessionType==3)events.groupChanged(target.groupId)
        if(message.contentType==110) {
            val payload=runCatching { JsonParser.parseString(message.customElem?.data.orEmpty()).asJsonObject }.getOrNull()
            if(payload?.string("businessKey","BusinessKey")=="message_pin") {
                val stamp=(if(message.sendTime>0)message.sendTime else message.createTime).let { if(it<10_000_000_000L)it*1000 else it }
                val value=if(payload.string("action","Action")=="unpin") null else PinnedChatMessage(payload.string("clientMsgID","ClientMsgID"),payload.string("preview","Preview"),payload.string("senderNickname","SenderNickname"),payload.string("messageType","MessageType").ifEmpty { "text" },"shared",stamp).takeIf { it.clientMsgID.isNotBlank() }
                if(value!=null||payload.string("action","Action")=="unpin") {
                    applyRemotePin(target,value,message.seq.toLong(),stamp,events)
                }
                return
            }
        }
        val items=listOf(target to map(message))
        if(realtime)events.liveMessages(items) else events.messages(items)
    }
    private fun target(message:Message):ChatTarget? {
        val type=message.sessionType
        val peer=if(type==3) message.groupID.orEmpty() else if(message.sendID==userId) message.recvID.orEmpty() else message.sendID.orEmpty()
        if(type !in listOf(1,3)||peer.isBlank()) return null
        val id=client.conversationManager.getConversationIDBySessionType(peer,type)
        return ChatTarget(id,type,if(type==1)peer else "",if(type==3)peer else "")
    }
    private fun summary(message:Message):String = if(message.status==4) "[消息已删除]" else if(message.contentType==101) message.textElem?.content.orEmpty() else when(message.contentType) {
        102->"[图片]";103->"[语音]";104->"[视频]";105->"[文件]";106->"[提及消息]";107->"[合并消息]";108->"[名片]";109->"[位置]";110->MessageContents.parse(gson.toJson(message)).text.ifBlank { "[自定义消息]" };114->"[引用消息]";else->if(message.contentType>=1000) ChatSystemMessages.format(gson.toJson(message)) else "[暂未支持的消息]"
    }
    private fun map(message:Message)=ChatMessage(message.clientMsgID.orEmpty(),summary(message),message.sendID==userId,if(message.sendTime>0)message.sendTime else message.createTime,message.status,message.seq.toLong(),gson.toJson(message),message.senderNickname.orEmpty())
    private fun conversation(info:ConversationInfo):ChatConversation? {
        if(info.conversationID.isNullOrBlank()) return null
        val preview=try { info.latestMsg?.takeIf { it.isNotBlank() }?.let { summary(gson.fromJson(it,Message::class.java)) }.orEmpty() } catch (_:Exception) { "[消息]" }
        val latestSeq=runCatching { info.latestMsg?.takeIf { it.isNotBlank() }?.let { gson.fromJson(it,Message::class.java).seq.toLong() } ?: 0 }.getOrDefault(0)
        val pinned=runCatching { JsonParser.parseString(info.ex.orEmpty()).asJsonObject.get("pinnedMessage")?.let { gson.fromJson(it,PinnedChatMessage::class.java) }?.takeIf { !it.clientMsgID.isNullOrBlank() } }.getOrNull()
        val latest=runCatching { info.latestMsg?.takeIf { it.isNotBlank() }?.let { map(gson.fromJson(it,Message::class.java)) } }.getOrNull()
        return ChatConversation(ChatTarget(info.conversationID,info.conversationType,info.userID.orEmpty(),info.groupID.orEmpty()),info.showName?.ifBlank { "聊天" } ?: "聊天",preview,info.latestMsgSendTime,info.unreadCount,info.isPinned,info.faceURL.orEmpty(),latestSeq,info.recvMsgOpt!=0,pinned,latest)
    }
    override fun conversations(offset:Int,count:Int,done:(Result<List<ChatConversation>>)->Unit) {
        client.conversationManager.getConversationListSplit(base<List<ConversationInfo>> { result -> done(result.map { it.mapNotNull(::conversation) }) },offset.toLong(),count.toLong())
    }
    override fun watchPeer(userId:String?,done:(Result<Boolean?>)->Unit) {
        if(!initialized) { done(Result.success(null));return }
        val previous=watchedPeer
        if(previous!=null&&previous!=userId)client.userInfoManager.unsubscribeOnlineUsersStatus(base<String> {},listOf(previous))
        watchedPeer=userId
        if(userId.isNullOrBlank()) { done(Result.success(null));return }
        client.userInfoManager.subscribeUsersOnlineStatus(base<List<UsersOnlineStatus>> { result -> done(result.map { values -> values.firstOrNull { it.userID==userId }?.let { it.status==1 } }) },listOf(userId))
    }
    override fun groupMember(target:ChatTarget,userId:String,done:(Result<ChatGroupMember?>)->Unit) {
        require(target.sessionType==3&&userId.isNotBlank())
        client.groupManager.getGroupMembersInfo(base<List<GroupMembersInfo>> { result ->
            done(result.map { members -> members.firstOrNull { it.userID==userId }?.let {
                ChatGroupMember(it.userID,when(it.roleLevel) { 100 -> "owner";60 -> "admin";else -> "member" },it.muteEndTime>System.currentTimeMillis()/1000,it.nickname.orEmpty())
            } })
        },target.groupId,listOf(userId))
    }
    override fun groupMembers(target:ChatTarget,userIds:List<String>,done:(Result<List<ChatGroupMember>>)->Unit) {
        require(target.sessionType==3&&userIds.size in 1..100&&userIds.none { it.isBlank() })
        client.groupManager.getGroupMembersInfo(base<List<GroupMembersInfo>> { result ->
            done(result.map { members -> members.filter { it.userID in userIds }.map { ChatGroupMember(it.userID,when(it.roleLevel) { 100 -> "owner";60 -> "admin";else -> "member" },it.muteEndTime>System.currentTimeMillis()/1000,it.nickname.orEmpty()) } })
        },target.groupId,userIds.distinct())
    }
    override fun history(target:ChatTarget,cursor:String?,count:Int,done:(Result<HistoryPage>)->Unit) {
        val start=cursor?.let { Message().apply { clientMsgID=it } }
        client.messageManager.getAdvancedHistoryMessageList(base<AdvancedMessage> { result ->
            done(result.fold(onSuccess={ page -> if(page.errCode!=0) Result.failure(ChatFailure(page.errCode)) else Result.success(HistoryPage(page.messageList.orEmpty().filter { !it.clientMsgID.isNullOrBlank() && it.status!=4 }.map(::map),page.isEnd,page.lastMinSeq)) },onFailure={ Result.failure(it) }))
        },target.conversationId,start,count,ViewType.History)
    }
    override fun createText(text:String,target:ChatTarget):ChatMessage {
        require(target.supported())
        val message=client.messageManager.createTextMessage(text) ?: error("聊天资源未就绪")
        return prepare(message,target)
    }
    private fun prepare(message:Message,target:ChatTarget):ChatMessage {
        check(!message.clientMsgID.isNullOrBlank())
        message.sessionType=target.sessionType
        message.recvID=if(target.sessionType==1)target.userId else target.groupId
        message.groupID=target.groupId
        message.sendID=userId
        return map(message)
    }
    override fun createQuote(text:String,quote:ChatMessage,target:ChatTarget):ChatMessage {
        val source=gson.fromJson(quote.serialized,Message::class.java)
        return prepare(client.messageManager.createQuoteMessage(text,source) ?: error("引用消息不可用"),target)
    }
    override fun createMention(text:String,mentions:List<Pair<String,String>>,quote:ChatMessage?,target:ChatTarget):ChatMessage {
        require(target.sessionType==3&&mentions.isNotEmpty())
        val users=mentions.map { (id,name) -> AtUserInfo().apply { atUserID=id;groupNickname=name } }
        val source=quote?.let { gson.fromJson(it.serialized,Message::class.java) }
        return prepare(client.messageManager.createTextAtMessage(text,mentions.map { it.first },users,source) ?: error("提及消息不可用"),target)
    }
    override fun createCard(imId:String,businessId:String,nickname:String,avatar:String,target:ChatTarget):ChatMessage {
        require(target.sessionType==1)
        val card=CardElem().apply { userID=imId;this.nickname=nickname;faceURL=avatar;ex=jsonBody("businessUserId" to businessId).toString() }
        return prepare(client.messageManager.createCardMessage(card) ?: error("名片不可用"),target)
    }
    override fun createRemoteImage(url:String,target:ChatTarget):ChatMessage {
        val picture=PictureInfo().apply { this.url=url;type="jpg";width=0;height=0;size=0 }
        return prepare(client.messageManager.createImageMessageByURL("",picture,picture,picture) ?: error("图片消息不可用"),target)
    }
    override fun createForward(source:ChatMessage,snapshot:com.google.gson.JsonObject,target:ChatTarget):ChatMessage {
        val safe=ForwardSnapshots.withSnapshot(source.serialized,snapshot)
        return prepare(client.messageManager.createForwardMessage(gson.fromJson(safe,Message::class.java)) ?: error("转发消息不可用"),target)
    }
    override fun createMedia(media:UploadedMedia,target:ChatTarget):ChatMessage {
        val local=media.local
        val message=when(local.kind) {
            MediaKind.IMAGE -> {
                fun picture(url:String)=PictureInfo().apply { uuid=media.id;type=local.mime.substringAfter('/');size=local.file.length();width=local.width;height=local.height;this.url=url }
                client.messageManager.createImageMessageByURL("",picture(media.url),picture(media.url),picture(media.thumbnail.ifEmpty { media.url }))
            }
            MediaKind.VOICE -> client.messageManager.createSoundMessageByURL(SoundElem().apply { uuid=media.id;soundPath="";sourceUrl=media.url;dataSize=local.file.length();duration=local.duration })
            MediaKind.FILE -> client.messageManager.createFileMessageByURL(FileElem().apply { uuid=media.id;filePath="";sourceUrl=media.url;fileName=local.name;fileSize=local.file.length() })
            MediaKind.VIDEO -> client.messageManager.createVideoMessageByURL(VideoElem().apply { videoUUID=media.id;videoPath="";videoUrl=media.url;videoType=local.mime.substringAfter('/');videoSize=local.file.length();duration=local.duration;snapshotPath="";snapshotUrl=media.thumbnail;snapshotWidth=local.width;snapshotHeight=local.height })
        } ?: error("媒体消息不可用")
        return prepare(message,target)
    }
    override fun send(target:ChatTarget,serialized:String,done:(Result<ChatMessage>)->Unit) {
        require(target.supported())
        val message=gson.fromJson(serialized,Message::class.java)
        check(!message.clientMsgID.isNullOrBlank() && message.sendID==userId && message.contentType in setOf(101,102,103,104,105,106,108,110,114))
        if(message.contentType==110)check(runCatching { JsonParser.parseString(message.customElem?.data.orEmpty()).asJsonObject.string("businessKey") }.getOrNull()=="message_pin")
        val callback=object:OnMsgSendCallback {
            override fun onSuccess(data:Message) { done(Result.success(map(data))) }
            override fun onError(code:Int,error:String?) { done(Result.failure(ChatFailure(code))) }
        }
        // 媒体先经过现有业务签名上传和完成确认；这里不触发 SDK 二次 OSS 上传。
        if(OpenIMSendOptions.uploaded(message.contentType))
            client.messageManager.sendMessageNotOss(callback,message,target.userId,target.groupId,OpenIMSendOptions.push(),false)
        else client.messageManager.sendMessage(callback,message,target.userId,target.groupId,OpenIMSendOptions.push(),false)
    }
    override fun find(target:ChatTarget,id:String,done:(Result<ChatMessage?>)->Unit) {
        val params=SearchParams().apply { conversationID=target.conversationId;clientMsgIDList=listOf(id) }
        client.messageManager.findMessageList(base<SearchResult> { result -> done(result.map { value -> (value.findResultItems.orEmpty()+value.searchResultItems.orEmpty()).flatMap { it.messageList.orEmpty() }.firstOrNull { it.clientMsgID==id }?.let(::map) }) },listOf(params))
    }
    override fun peer(imId:String,group:Boolean,done:(Result<ChatConversation>)->Unit) {
        client.conversationManager.getOneConversation(base<ConversationInfo> { result -> done(result.map { conversation(it) ?: error("会话标识未生成") }) },imId,if(group)3 else 1)
    }
    override fun markRead(target:ChatTarget,done:(Result<Unit>)->Unit) {
        client.messageManager.markConversationMessageAsRead(target.conversationId,base<String> { result ->
            if(result.isFailure)done(result.map { Unit })
            else if(target.sessionType==3)client.conversationManager.setConversation(base<String> { done(it.map { Unit }) },target.conversationId,ConversationReq().apply { groupAtType=0 })
            else done(Result.success(Unit))
        })
    }
    override fun deleteLocal(target:ChatTarget,id:String,done:(Result<Unit>)->Unit) {
        client.messageManager.deleteMessageFromLocalStorage(target.conversationId,id,base<String> { done(it.map { Unit }) })
    }
    override fun setConversation(target:ChatTarget,pinned:Boolean?,muted:Boolean?,done:(Result<Unit>)->Unit) {
        val request=ConversationReq().apply { pinned?.let { setPinned(it) };muted?.let { setRecvMsgOpt(if(it)2 else 0) } }
        client.conversationManager.setConversation(base<String> { done(it.map { Unit }) },target.conversationId,request)
    }
    override fun hideConversation(target:ChatTarget,done:(Result<Unit>)->Unit) {
        client.conversationManager.hideConversation(base<String> { done(it.map { Unit }) },target.conversationId)
    }
    override fun pinMessage(target:ChatTarget,pinned:PinnedChatMessage?,done:(Result<Unit>)->Unit) {
        client.conversationManager.getOneConversation(base<ConversationInfo> { result ->
            result.fold(onSuccess={ info ->
                val extra=runCatching { JsonParser.parseString(info.ex.orEmpty()).asJsonObject }.getOrElse { com.google.gson.JsonObject() }
                if(pinned==null)extra.remove("pinnedMessage") else extra.add("pinnedMessage",gson.toJsonTree(pinned))
                val req=ConversationReq().apply { ex=extra.toString() }
                client.conversationManager.setConversation(base<String> { done(it.map { Unit }) },target.conversationId,req)
            },onFailure={ done(Result.failure(it)) })
        },if(target.sessionType==3)target.groupId else target.userId,target.sessionType)
    }
    private fun applyRemotePin(target:ChatTarget,pinned:PinnedChatMessage?,seq:Long,time:Long,events:ChatEvents) {
        client.conversationManager.getOneConversation(base<ConversationInfo> { result -> result.onSuccess { info ->
            val extra=runCatching { JsonParser.parseString(info.ex.orEmpty()).asJsonObject }.getOrElse { com.google.gson.JsonObject() }
            val oldSeq=extra.number("messagePinSeq")
            val oldTime=maxOf(extra.number("messagePinTime"),extra.obj("pinnedMessage").number("pinnedAt"))
            if((seq>0&&oldSeq>=seq)||(oldSeq==0L&&oldTime>time))return@onSuccess
            if(pinned==null)extra.remove("pinnedMessage") else extra.add("pinnedMessage",gson.toJsonTree(pinned))
            extra.addProperty("messagePinSeq",maxOf(seq,oldSeq));extra.addProperty("messagePinTime",maxOf(time,oldTime))
            val req=ConversationReq().apply { ex=extra.toString() }
            client.conversationManager.setConversation(base<String> { saved -> if(saved.isSuccess)events.pin(target,pinned) },target.conversationId,req)
        } },if(target.sessionType==3)target.groupId else target.userId,target.sessionType)
    }
    override fun createPinSync(target:ChatTarget,pinned:PinnedChatMessage?,old:PinnedChatMessage?):ChatMessage {
        val pin=pinned ?: old ?: error("置顶信息缺失")
        val data=jsonBody("businessKey" to "message_pin","action" to if(pinned==null)"unpin" else "pin","clientMsgID" to pin.clientMsgID,"preview" to (pinned?.preview ?: ""),"senderNickname" to (pinned?.senderNickname ?: ""),"messageType" to pin.messageType).toString()
        return prepare(client.messageManager.createCustomMessage(data,if(pinned==null)"" else "置顶消息","") ?: error("置顶同步不可用"),target)
    }
    override fun reconnect(done:(Result<Unit>)->Unit) {
        if(!initialized) { done(Result.failure(IllegalStateException("聊天尚未初始化")));return }
        Open_im_sdk.networkStatusChanged(object:open_im_sdk_callback.Base {
            override fun onSuccess(data:String?) { done(Result.success(Unit)) }
            override fun onError(code:Int,error:String?) { done(Result.failure(ChatFailure(code))) }
        },UUID.randomUUID().toString())
    }
    override fun search(target:ChatTarget,keyword:String,types:List<Int>,page:Int,count:Int,done:(Result<ChatSearchPage>)->Unit) {
        require(target.supported()&&page>=1&&count in 1..100)
        client.messageManager.searchLocalMessages(base<SearchResult> { result ->
            done(result.map { value ->
                val messages=value.searchResultItems.orEmpty().filter { it.conversationID==target.conversationId }.flatMap { it.messageList.orEmpty() }.filter { !it.clientMsgID.isNullOrBlank()&&it.status!=4 }.map(::map)
                ChatSearchPage(messages,page,page.toLong()*count>=value.totalCount)
            })
        },target.conversationId,keyword.trim().takeIf(String::isNotEmpty)?.let { listOf(it) } ?: emptyList(),0,emptyList(),types,0,0,page,count)
    }
    override fun searchAll(keyword:String,page:Int,count:Int,done:(Result<ChatGlobalSearchPage>)->Unit) {
        require(keyword.isNotBlank()&&page>=1&&count in 1..100)
        client.messageManager.searchLocalMessages(base<SearchResult> { result -> done(result.map { value ->
            val hits=value.searchResultItems.orEmpty().flatMap { item -> item.messageList.orEmpty().filter { !it.clientMsgID.isNullOrBlank()&&it.status!=4 }.mapNotNull { message ->
                val target=target(message) ?: return@mapNotNull null
                val conversation=ChatConversation(target,item.showName?.ifBlank { "聊天" } ?: "聊天",summary(message),message.sendTime,avatar=item.faceURL.orEmpty())
                ChatGlobalHit(conversation,map(message))
            } }
            ChatGlobalSearchPage(hits,page,page.toLong()*count>=value.totalCount)
        }) },"",listOf(keyword.trim()),0,emptyList(),emptyList(),0,0,page,count)
    }
    override fun clearHistory(target:ChatTarget,done:(Result<Unit>)->Unit) {
        // 仅遍历/删除 SDK 本地记录；不能用名字相近但同时修改云端的 bulk API 冒充本地操作。
        val ids=mutableListOf<String>()
        val seen=mutableSetOf<String>()
        fun delete(index:Int) {
            if(index>=ids.size) { done(Result.success(Unit));return }
            deleteLocal(target,ids[index]) { result -> result.fold(onSuccess={ delete(index+1) },onFailure={ done(Result.failure(it)) }) }
        }
        fun page(cursor:String?) {
            history(target,cursor,100) { result ->
                result.fold(onSuccess={ value ->
                    value.messages.map { it.id }.filter { seen.add(it) }.forEach(ids::add)
                    if(ids.size>100_000) { done(Result.failure(IllegalStateException("本地记录量较大，请分会话整理后重试")));return@fold }
                    if(value.end) { delete(0);return@fold }
                    val next=value.messages.minWithOrNull(compareBy<ChatMessage> { it.time }.thenBy { it.id })?.id
                    if(next==null||next==cursor) { done(Result.failure(IllegalStateException("历史读取尚未推进，未开始本地删除")));return@fold }
                    page(next)
                },onFailure={ done(Result.failure(it)) })
            }
        }
        page(null)
    }
    override fun foreground(active:Boolean) {
        if(!initialized) return
        Open_im_sdk.setAppBackgroundStatus(object:open_im_sdk_callback.Base {
            override fun onSuccess(data:String?) {}
            override fun onError(code:Int,error:String?) {}
        },UUID.randomUUID().toString(),!active)
    }
    override fun shutdown() {
        if(initialized) client.unInit()
        initialized=false
        watchedPeer=null
        userId=""
    }
}
