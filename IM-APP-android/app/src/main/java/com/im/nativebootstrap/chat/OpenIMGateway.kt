package com.im.nativebootstrap.chat

import android.app.Application
import android.os.Handler
import android.os.Looper
import com.im.nativebootstrap.PerfLog
import com.im.nativebootstrap.data.APIRequest
import com.im.nativebootstrap.data.URLConnectionTransport
import com.google.gson.Gson
import com.google.gson.JsonArray
import com.google.gson.JsonObject
import io.openim.android.sdk.OpenIMClient
import io.openim.android.sdk.enums.LogLevel
import io.openim.android.sdk.enums.ViewType
import io.openim.android.sdk.listener.*
import io.openim.android.sdk.models.*
import open_im_sdk.Open_im_sdk
import java.io.File
import java.net.URI
import java.util.UUID
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.Executors
import com.im.nativebootstrap.media.MediaKind
import com.im.nativebootstrap.media.UploadedMedia
import com.im.nativebootstrap.media.MessageContents
import com.im.nativebootstrap.media.field
import com.im.nativebootstrap.media.parseObject
import com.im.nativebootstrap.media.obj
import com.im.nativebootstrap.media.string
import com.im.nativebootstrap.media.number
import com.google.gson.JsonParser

/** SDK 回调在主线程；模型映射按账号顺序在工作线程完成，换账号时立即切走旧队列。 */
internal class ConversationMappingQueue {
    internal class Owner(val userId:String,val executor:ThreadPoolExecutor)
    private fun create(userId:String)=Owner(userId,ThreadPoolExecutor(1,1,0,TimeUnit.MILLISECONDS,LinkedBlockingQueue()) { task ->
        Thread(task,"openim-conversation-map").apply {isDaemon=true}
    })
    @Volatile private var current:Owner?=create("")
    @Synchronized fun bind(userId:String):Owner {
        val previous=current
        val next=create(userId)
        current=next
        previous?.executor?.shutdownNow()
        return next
    }
    fun owner()=current
    fun active(owner:Owner)=current===owner&&!Thread.currentThread().isInterrupted
    fun execute(owner:Owner,work:(()->Boolean)->Unit) {
        if(!active(owner))return
        try {owner.executor.execute {if(active(owner))work {active(owner)}}}
        catch(_:RejectedExecutionException) { /* 已取消的账号任务不向新账号回传。 */ }
    }
    @Synchronized fun close() {val previous=current;current=null;previous?.executor?.shutdownNow()}
}

/** 仅此适配器引用官方 SDK。错误只保留数字，不回显原 SDK 字符串/JSON/凭据。 */
class OpenIMGateway(private val application:Application):ChatGateway {
    override val supportsRecentPrefetch=true
    private val client get()=OpenIMClient.getInstance()
    private val gson=Gson()
    private var userId=""
    private var initialized=false
    private val conversationMapping=ConversationMappingQueue()
    private var watchedPeer:String?=null
    private val liveHandler=Handler(Looper.getMainLooper())
    // 置顶 ex 读-改-写统一走单线程：用户置顶/取消与远端 pinSync 并发调用 Go 核心（getOneConversation→setConversation）
    // 曾触发 gomobile 空指针 native 崩溃，这里串行化消除竞争。
    private val exIO=Executors.newSingleThreadExecutor()
    private val liveLock=Any()
    private val liveBatch=mutableListOf<Pair<ChatTarget,ChatMessage>>()
    private var liveScheduled=false
    private var liveEvents:ChatEvents?=null
    private val syncSnapshotLock=Any()
    private var syncSnapshotInFlight=false
    private var syncSnapshotAt=0L
    private val flushLive=object:Runnable {
        override fun run()=flushLiveMessages()
    }
    private fun <T> base(done:(Result<T>)->Unit)=object:OnBase<T> {
        override fun onSuccess(data:T) { done(Result.success(data)) }
        override fun onError(code:Int,error:String?) { done(Result.failure(ChatFailure(code))) }
    }
    override fun start(userId:String,token:String,api:String,ws:String,directory:File,events:ChatEvents,done:(Result<Unit>)->Unit) {
        PerfLog.mark("gateway:start-begin")
        this.userId=userId
        synchronized(liveLock) {
            liveHandler.removeCallbacks(flushLive)
            liveBatch.clear()
            liveScheduled=false
            liveEvents=events
        }
        synchronized(syncSnapshotLock) {
            syncSnapshotInFlight=false
            syncSnapshotAt=0L
        }
        val mappingOwner=conversationMapping.bind(userId)
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
            PerfLog.mark("gateway:init-sdk-done")
            client.userInfoManager.setOnUserListener(object:OnUserListener {
                override fun onUserStatusChanged(status:UsersOnlineStatus?) { status?.userID?.takeIf { it.isNotBlank() }?.let { events.peerStatus(it,status.status==1) } }
            })
            client.conversationManager.setOnConversationListener(object:OnConversationListener {
                override fun onConversationChanged(items:MutableList<ConversationInfo>?)=enqueueConversations(mappingOwner,items.orEmpty().toList(),events::conversations)
                override fun onNewConversation(items:MutableList<ConversationInfo>?)=enqueueConversations(mappingOwner,items.orEmpty().toList(),events::conversations)
                override fun onSyncServerStart(reinstalled:Boolean) {
                    PerfLog.mark("gateway:sync-start")
                    conversationMapping.execute(mappingOwner) {events.syncStarted()}
                    publishConversationSnapshot(mappingOwner,events)
                }
                override fun onSyncServerProgress(progress:Long) {
                    PerfLog.mark("gateway:sync-progress", "value=$progress")
                    conversationMapping.execute(mappingOwner) {events.syncProgress(progress)}
                    publishConversationSnapshot(mappingOwner,events)
                }
                override fun onSyncServerFinish(reinstalled:Boolean) {
                    PerfLog.mark("gateway:sync-finish")
                    conversationMapping.execute(mappingOwner) {events.syncFinished()}
                    publishConversationSnapshot(mappingOwner,events,force=true)
                }
                override fun onSyncServerFailed(reinstalled:Boolean)=conversationMapping.execute(mappingOwner) {events.syncFailed()}
            })
            client.messageManager.setAdvancedMsgListener(object:OnAdvanceMsgListener {
                override fun onRecvC2CReadReceipt(receipts:MutableList<C2CReadReceiptInfo>?) { events.read(receipts.orEmpty().flatMap { it.msgIDList.orEmpty() }) }
                override fun onRecvGroupMessageReadReceipt(receipt:GroupMessageReceipt?) { events.read(receipt?.groupMessageReadInfo.orEmpty().filter { it.hasReadCount>0 }.mapNotNull { it.clientMsgID?.takeIf(String::isNotEmpty) }) }
                override fun onRecvMessageRevokedV2(info:RevokedInfo?) { info?.clientMsgID?.takeIf { it.isNotBlank() }?.let { events.tombstone(it,false,info.revokerID.orEmpty(),info.revokerNickname.orEmpty()) } }
                override fun onMsgDeleted(message:Message?) { message?.clientMsgID?.takeIf { it.isNotBlank() }?.let { events.tombstone(it,true,"","") } }
                override fun onRecvNewMessage(message:Message?) { message?.let { enqueueRealtime(it,events) } }
                override fun onRecvOfflineNewMessage(messages:MutableList<Message>?) {
                    val items=messages.orEmpty().mapNotNull { prepareIncoming(it,events) }
                    if(items.isNotEmpty())events.messages(items)
                }
            })
            client.groupManager.setOnGroupListener(object:OnGroupListener {
                override fun onGroupMemberAdded(info:GroupMembersInfo?) { info?.groupID?.let(events::groupChanged) }
                override fun onGroupMemberDeleted(info:GroupMembersInfo?) { info?.groupID?.let(events::groupChanged) }
                override fun onGroupMemberInfoChanged(info:GroupMembersInfo?) { info?.groupID?.let(events::groupChanged) }
                override fun onGroupInfoChanged(info:GroupInfo?) { info?.groupID?.let(events::groupChanged) }
            })
            // 与 uni-app OnRecvCustomBusinessMessage 对齐：入群申请靠业务通知，不是普通聊天气泡。
            client.setCustomBusinessListener(object:OnCustomBusinessListener {
                override fun onRecvCustomBusinessMessage(raw:String?) {
                    parseJoinRequestConversationId(raw)?.let { id -> events.joinRequestHighlights(setOf(id)) }
                }
            })
            fetchRemoteConversationSnapshot(token,api,events)
            client.login(base<String> { result ->
                PerfLog.mark("gateway:login-callback", "success=${result.isSuccess}")
                done(result.map { Unit })
            },userId,token)
            PerfLog.mark("gateway:login-invoked")
        } catch (_:Exception) { done(Result.failure(IllegalStateException("聊天初始化未完成，请稍后重试。"))) }
    }
    private fun prepareIncoming(message:Message,events:ChatEvents):Pair<ChatTarget,ChatMessage>? {
        val target=target(message) ?: return null
        if(message.clientMsgID.isNullOrBlank()) return null
        if(message.contentType in 1501..1520&&target.sessionType==3)events.groupChanged(target.groupId)
        if(message.contentType==110) {
            val payload=runCatching { JsonParser.parseString(message.customElem?.data.orEmpty()).asJsonObject }.getOrNull()
            if(payload?.string("businessKey","BusinessKey")=="message_pin") {
                val stamp=(if(message.sendTime>0)message.sendTime else message.createTime).let { if(it<10_000_000_000L)it*1000 else it }
                val value=if(payload.string("action","Action")=="unpin") null else PinnedChatMessage(payload.string("clientMsgID","ClientMsgID"),payload.string("preview","Preview"),payload.string("senderNickname","SenderNickname"),payload.string("messageType","MessageType").ifEmpty { "text" },"shared",stamp).takeIf { it.clientMsgID.isNotBlank() }
                if(value!=null||payload.string("action","Action")=="unpin") {
                    applyRemotePin(target,value,message.seq.toLong(),stamp,events)
                }
                return null
            }
        }
        return target to map(message)
    }
    private fun enqueueRealtime(message:Message,events:ChatEvents) {
        val item=prepareIncoming(message,events) ?: return
        synchronized(liveLock) {
            liveEvents=events
            liveBatch.add(item)
            if(!liveScheduled) {
                liveScheduled=true
                liveHandler.postDelayed(flushLive,LIVE_BATCH_MS)
            }
        }
    }
    private fun flushLiveMessages() {
        val batch=synchronized(liveLock) {
            if(liveBatch.isEmpty()) {
                liveScheduled=false
                return
            }
            val copy=liveBatch.toList()
            liveBatch.clear()
            liveScheduled=false
            copy
        }
        liveEvents?.liveMessages(batch)
    }
    private fun publishConversationSnapshot(owner:ConversationMappingQueue.Owner,events:ChatEvents,force:Boolean=false) {
        if(!conversationMapping.active(owner))return
        val now=System.currentTimeMillis()
        synchronized(syncSnapshotLock) {
            if(syncSnapshotInFlight)return
            if(!force&&now-(syncSnapshotAt.takeIf { it>0 } ?: 0)<400)return
            syncSnapshotInFlight=true
            syncSnapshotAt=now
        }
        client.conversationManager.getConversationListSplit(base<List<ConversationInfo>> { result ->
            synchronized(syncSnapshotLock) {syncSnapshotInFlight=false}
            result.onSuccess { items ->
                enqueueConversations(owner,items) {rows->
                    PerfLog.mark("gateway:snapshot-rows", "count=${rows.size}")
                    if(rows.isNotEmpty())events.conversationSnapshot(rows)
                }
            }
        },0,SYNC_SNAPSHOT_COUNT)
    }
    private fun fetchRemoteConversationSnapshot(token:String,address:String,events:ChatEvents) {
        val owner=userId
        if(owner.isBlank()||token.isBlank()||address.isBlank())return
        Thread {
            val enriched=runCatching { fetchSortedRemoteConversations(address,token,owner,emptyMap()) }.onFailure {PerfLog.mark("gateway:remote-sorted-failed")}.getOrDefault(emptyList())
            if(enriched.isNotEmpty()) {
                PerfLog.mark("gateway:remote-sorted","count=${enriched.size}")
                PerfLog.mark("gateway:remote-sorted-avatars",
                    "empty=${enriched.count {it.avatar.isBlank()}} http=${enriched.count {it.avatar.startsWith("http://")}} "+
                        "https=${enriched.count {it.avatar.startsWith("https://")}} "+
                        "httpHosts="+enriched.filter {it.avatar.startsWith("http://")}.mapNotNull {runCatching {URI(it.avatar).host}.getOrNull()}.distinct().joinToString(",")+" "+
                        "httpPaths="+enriched.filter {it.avatar.startsWith("http://")}.mapNotNull {runCatching {URI(it.avatar).path.orEmpty().split('/').filter(String::isNotEmpty).take(3).joinToString("/")}.getOrNull()}.distinct().take(3).joinToString(",")+" "+
                        "invalid="+enriched.count {runCatching {com.im.nativebootstrap.media.MediaURLs.image(it.avatar,com.im.nativebootstrap.media.ImageVariant.AVATAR)}.getOrDefault("").isBlank()&&it.avatar.isNotBlank()})
                events.conversationSnapshot(enriched)
            }
            val all=runCatching { fetchAllRemoteConversations(address,token,owner) }.onFailure {PerfLog.mark("gateway:remote-all-failed")}.getOrDefault(emptyList())
            val byId=all.associateByTo(LinkedHashMap()) {it.target.conversationId}
            enriched.forEach {byId[it.target.conversationId]=it}
            val rows=byId.values.toList()
            PerfLog.mark("gateway:remote-snapshot","all=${all.size} enriched=${enriched.size} merged=${rows.size}")
            PerfLog.mark("gateway:remote-avatars",
                "empty=${rows.count {it.avatar.isBlank()}} http=${rows.count {it.avatar.startsWith("http://")}} "+
                    "hosts="+rows.mapNotNull { runCatching { URI(it.avatar).host }.getOrNull() }.distinct().take(5).joinToString(","))
            if(rows.isNotEmpty())events.conversationSnapshot(rows)
        }.apply{isDaemon=true;name="openim-conversation-rest"}.start()
    }
    private fun openIMConversationRequest(address:String,token:String,path:String,fields:(JsonObject)->Unit):JsonObject {
        val operation=UUID.randomUUID().toString()
        val body=JsonObject().apply {
            addProperty("operationID",operation)
            fields(this)
        }
        val response=URLConnectionTransport().execute(APIRequest(
            address.trimEnd('/')+path,
            mapOf("Accept" to "application/json","Content-Type" to "application/json","token" to token,"operationID" to operation),
            body.toString(),
            "POST",
        ))
        check(response.status in 200..299) { "HTTP ${response.status}" }
        val root=JsonParser.parseString(response.body).asJsonObject
        check((root.get("errCode")?.asInt ?: -1)==0) { "errCode" }
        return root.getAsJsonObject("data") ?: error("missing data")
    }
    private fun fetchAllRemoteConversations(address:String,token:String,owner:String):List<ChatConversation> {
        val data=openIMConversationRequest(address,token,"/conversation/get_all_conversations") {it.addProperty("ownerUserID",owner)}
        return (data.getAsJsonArray("conversations") ?: JsonArray()).mapNotNull { element ->
            runCatching {gson.fromJson(element,ConversationInfo::class.java)}.getOrNull()?.let {conversation(it,owner)}
        }
    }
    private fun fetchSortedRemoteConversations(address:String,token:String,owner:String,base:Map<String,ChatConversation>):List<ChatConversation> {
        val data=openIMConversationRequest(address,token,"/conversation/get_sorted_conversation_list") {
            it.addProperty("userID",owner)
            it.add("pagination",JsonObject().apply {
                addProperty("pageNumber",1)
                addProperty("showNumber",100)
            })
        }
        val elems=data.getAsJsonArray("conversationElems") ?: JsonArray()
        if(elems.size()>0)PerfLog.mark("gateway:remote-sorted-fields",elems[0].asJsonObject.keySet().joinToString(","))
        return elems.mapNotNull { enrichedConversation(it.asJsonObject,owner,base) }
    }
    private fun enrichedConversation(element:JsonObject,owner:String,base:Map<String,ChatConversation>):ChatConversation? {
        val id=element.string("conversationID","ConversationID")
        if(id.isBlank())return null
        val msg=parseObject(element.field("msgInfo","MsgInfo")) ?: JsonObject()
        val sessionType=msg.number("sessionType","SessionType").toInt().takeIf {it==1||it==3} ?: if(id.startsWith("sg_"))3 else 1
        val send=msg.string("sendID","SendID")
        val recv=msg.string("recvID","RecvID")
        val group=msg.string("groupID","GroupID")
        val peer=if(sessionType==1)if(send==owner)recv else send else ""
        val old=base[id]
        val title=if(sessionType==3)msg.string("groupName","GroupName").ifBlank{"群聊"} else msg.string("senderName","SenderName").ifBlank{"聊天"}
        val avatar=if(sessionType==3)msg.string("groupFaceURL","GroupFaceURL") else msg.string("senderFaceUrl","SenderFaceUrl","faceURL","FaceURL")
        val type=msg.number("contentType","ContentType").toInt()
        val content=msg.string("content","Content")
        val preview=remotePreview(type,content)
        val time=msg.number("latestMsgRecvTime","LatestMsgRecvTime").takeIf {it>0} ?: msg.number("sendTime","SendTime").takeIf {it>0} ?: old?.time ?: 0
        val latest=remoteLatest(msg,owner,type,preview,time)
        return ChatConversation(
            ChatTarget(id,sessionType,peer,group),
            title,
            preview.ifBlank {old?.preview.orEmpty()},
            time,
            element.get("unreadCount")?.asInt ?: old?.unread ?: 0,
            (element.get("isPinned") ?: element.get("IsPinned"))?.asBoolean ?: old?.pinned ?: false,
            avatar,
            msg.number("seq","Seq").takeIf {it>0} ?: old?.latestSeq ?: 0,
            (element.get("recvMsgOpt")?.asInt ?: 0)!=0,
            old?.pinnedMessage,
            latest ?: old?.latestMessage,
            old?.joinRequestPending==true,
        )
    }
    private fun remoteLatest(msg:JsonObject,owner:String,type:Int,preview:String,time:Long):ChatMessage? {
        if(msg.size()==0||type<=0||time<=0)return null
        val id=msg.string("clientMsgID","ClientMsgID","clientMsgId").takeIf {it.isNotBlank()} ?: return null
        val send=msg.string("sendID","SendID")
        val serialized=msg.deepCopy().apply {
            if(type==101&&parseObject(field("textElem","TextElem"))?.string("content","Content").isNullOrBlank()) {
                add("textElem",JsonObject().apply {addProperty("content",preview)})
            }
        }.toString()
        return ChatMessage(
            id=id,
            text=preview,
            mine=send.isNotBlank()&&send==owner,
            time=time,
            status=2,
            seq=msg.number("seq","Seq").toLong(),
            serialized=serialized,
            sender=msg.string("senderNickname","SenderNickname","senderName","SenderName"),
            contentType=type,
            senderId=send,
        )
    }
    private fun remotePreview(type:Int,content:String)=when(type) {
        101->runCatching {
            val raw=JsonParser.parseString(content)
            parseObject(raw)?.string("content","Content").orEmpty().ifBlank {content}
        }.getOrDefault(content)
        102->"[图片]"
        103->"[语音]"
        104->"[视频]"
        105->"[文件]"
        // @ 消息预览显示正文（对齐微信/H5），取不到再回退占位
        106->runCatching {
            val raw=parseObject(JsonParser.parseString(content))
            (raw?.obj("atTextElem","AtTextElem")?.takeIf {it.size()>0} ?: raw)?.string("text","Text").orEmpty()
        }.getOrDefault("").ifBlank {"[提及消息]"}
        107->"[合并消息]"
        108->"[名片]"
        109->"[位置]"
        110->"[自定义消息]"
        114->"[引用消息]"
        else->if(type>=1000)"[系统消息]" else content
    }
    private fun target(message:Message):ChatTarget? {
        val type=message.sessionType
        val peer=if(type==3) message.groupID.orEmpty() else if(message.sendID==userId) message.recvID.orEmpty() else message.sendID.orEmpty()
        if(type !in listOf(1,3)||peer.isBlank()) return null
        val id=client.conversationManager.getConversationIDBySessionType(peer,type)
        return ChatTarget(id,type,if(type==1)peer else "",if(type==3)peer else "")
    }
    private fun summary(message:Message,serialized:String?=null):String = if(message.status==4) "[消息已删除]" else if(message.contentType==101) message.textElem?.content.orEmpty() else when(message.contentType) {
        102->"[图片]";103->"[语音]";104->"[视频]";105->"[文件]";106->MessageContents.parse(serialized ?: gson.toJson(message)).text.ifBlank { "[提及消息]" };107->"[合并消息]";108->"[名片]";109->"[位置]";110->MessageContents.parse(serialized ?: gson.toJson(message)).text.ifBlank { "[自定义消息]" };114->MessageContents.parse(serialized ?: gson.toJson(message)).text.ifBlank { "[引用消息]" };else->if(message.contentType>=1000) ChatSystemMessages.format(serialized ?: gson.toJson(message)) else "[暂未支持的消息]"
    }
    private fun map(message:Message,owner:String=userId):ChatMessage {
        val serialized=gson.toJson(message)
        val pinSync=message.contentType==110&&runCatching {
            val raw=JsonParser.parseString(serialized).asJsonObject
            raw.number("contentType","ContentType")==110L&&parseObject(raw.obj("customElem","CustomElem").field("data","Data"))?.string("businessKey","BusinessKey")=="message_pin"
        }.getOrDefault(false)
        return ChatMessage(
            message.clientMsgID.orEmpty(),
            summary(message,serialized),
            message.sendID==owner,
            if(message.sendTime>0)message.sendTime else message.createTime,
            message.status,
            message.seq.toLong(),
            serialized,
            message.senderNickname.orEmpty(),
            contentType=message.contentType,
            senderId=message.sendID.orEmpty(),
            pinSync=pinSync,
        )
    }

    private fun conversationLatest(message:Message,serialized:String,owner:String)=ChatMessage(
        message.clientMsgID.orEmpty(),
        summary(message,serialized),
        message.sendID==owner,
        if(message.sendTime>0)message.sendTime else message.createTime,
        message.status,
        message.seq.toLong(),
        // 会话行只保留展示/确认需要的轻量字段，不常驻完整消息 JSON。
        serialized="",
        sender=message.senderNickname.orEmpty(),
        contentType=message.contentType,
        senderId=message.sendID.orEmpty(),
    )

    private fun conversationLatestOrNull(parsed:Message?,raw:String?,owner:String):ChatMessage? {
        if(parsed==null||raw==null)return null
        return runCatching { conversationLatest(parsed,raw,owner) }.getOrNull()
    }
    private fun conversation(info:ConversationInfo,owner:String=userId):ChatConversation? {
        if(info.conversationID.isNullOrBlank()) return null
        val raw=info.latestMsg?.takeIf {it.isNotBlank()}
        val parsed=runCatching {raw?.let {gson.fromJson(it,Message::class.java)}}.getOrNull()
        val latest=conversationLatestOrNull(parsed,raw,owner)
        val preview=latest?.text ?: if(raw!=null)"[消息]" else ""
        val latestSeq=parsed?.seq?.toLong() ?: 0
        val pinned=runCatching { JsonParser.parseString(info.ex.orEmpty()).asJsonObject.get("pinnedMessage")?.let { gson.fromJson(it,PinnedChatMessage::class.java) }?.takeIf { !it.clientMsgID.isNullOrBlank() } }.getOrNull()
        return ChatConversation(ChatTarget(info.conversationID,info.conversationType,info.userID.orEmpty(),info.groupID.orEmpty()),info.showName?.ifBlank { "聊天" } ?: "聊天",preview,info.latestMsgSendTime,info.unreadCount,info.isPinned,info.faceURL.orEmpty(),latestSeq,info.recvMsgOpt!=0,pinned,latest,atType=info.groupAtType)
    }
    private fun enqueueConversations(owner:ConversationMappingQueue.Owner,items:List<ConversationInfo>,done:(List<ChatConversation>)->Unit) {
        conversationMapping.execute(owner) {active->
            val mapped=ArrayList<ChatConversation>(items.size)
            for(item in items) {
                if(!active())return@execute
                conversation(item,owner.userId)?.let(mapped::add)
            }
            if(active())done(mapped)
        }
    }
    override fun conversations(offset:Int,count:Int,done:(Result<List<ChatConversation>>)->Unit) {
        val owner=conversationMapping.owner() ?: return done(Result.failure(IllegalStateException("聊天已关闭")))
        client.conversationManager.getConversationListSplit(base<List<ConversationInfo>> { result ->
            result.fold(onSuccess={enqueueConversations(owner,it) {rows->done(Result.success(rows))}},onFailure={error->conversationMapping.execute(owner) {done(Result.failure(error))}})
        },offset.toLong(),count.toLong())
    }
    override fun initialConversations(count:Int,done:(Result<ConversationSnapshotPage>)->Unit) {
        // 官方接口读取完整本地会话表；首屏不能由无序增量子集或前 30 条拼出来。
        val owner=conversationMapping.owner() ?: return done(Result.failure(IllegalStateException("聊天已关闭")))
        client.conversationManager.getAllConversationList(base<List<ConversationInfo>> { result ->
            result.fold(onSuccess={enqueueConversations(owner,it) {rows->done(Result.success(ConversationSnapshotPage(rows,true)))}},onFailure={error->conversationMapping.execute(owner) {done(Result.failure(error))}})
        })
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
            done(result.fold(onSuccess={ page ->
                OpenIMHistoryResults.page(page,::map)
            },onFailure={ Result.failure(it) }))
        },target.conversationId,start,count,ViewType.History)
    }
    override fun localHistory(target:ChatTarget,page:Int,count:Int,done:(Result<HistoryPage>)->Unit) {
        localHistory(target,page,count,(System.currentTimeMillis()+999)/1000,done)
    }
    override fun localHistory(target:ChatTarget,page:Int,count:Int,anchorTimeSeconds:Long,done:(Result<HistoryPage>)->Unit) {
        require(target.supported()&&page>=1&&count in 1..100)
        // 固定 Core 的 searchLocalMessages 直接读本地表，不经过高级历史的网络补洞。
        // filterMsg 会二次过滤其它类型；仅查询明确支持的类型，防止 SQL 分页后被过滤成假短页。
        // 表情、高级文本、系统/撤回等仍由高级历史渠道补齐，本地短页不代表完整历史结束。
        val types=(101..110).toList()+114
        client.messageManager.searchLocalMessages(base<SearchResult> { result -> done(result.map { value ->
            val rows=value.searchResultItems.orEmpty().filter { it.conversationID==target.conversationId }.flatMap { it.messageList.orEmpty() }
            HistoryPage(rows.filter(OpenIMHistoryResults::previewSafe).map(::map),rows.size<count)
        }) },target.conversationId,emptyList(),0,emptyList(),types,anchorTimeSeconds.coerceAtMost(Int.MAX_VALUE.toLong()).toInt(),0,page,count)
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
        exIO.execute {
            client.conversationManager.getOneConversation(base<ConversationInfo> { result ->
                result.fold(onSuccess={ info ->
                    val extra=runCatching { JsonParser.parseString(info.ex.orEmpty()).asJsonObject }.getOrElse { com.google.gson.JsonObject() }
                    if(pinned==null)extra.remove("pinnedMessage") else extra.add("pinnedMessage",gson.toJsonTree(pinned))
                    val req=ConversationReq().apply { ex=extra.toString() }
                    exIO.execute { client.conversationManager.setConversation(base<String> { done(it.map { Unit }) },target.conversationId,req) }
                },onFailure={ done(Result.failure(it)) })
            },if(target.sessionType==3)target.groupId else target.userId,target.sessionType)
        }
    }
    private fun applyRemotePin(target:ChatTarget,pinned:PinnedChatMessage?,seq:Long,time:Long,events:ChatEvents) {
        exIO.execute { client.conversationManager.getOneConversation(base<ConversationInfo> { result -> result.onSuccess { info ->
            val extra=runCatching { JsonParser.parseString(info.ex.orEmpty()).asJsonObject }.getOrElse { com.google.gson.JsonObject() }
            val oldSeq=extra.number("messagePinSeq")
            val oldTime=maxOf(extra.number("messagePinTime"),extra.obj("pinnedMessage").number("pinnedAt"))
            if((seq>0&&oldSeq>=seq)||(oldSeq==0L&&oldTime>time))return@onSuccess
            if(pinned==null)extra.remove("pinnedMessage") else extra.add("pinnedMessage",gson.toJsonTree(pinned))
            extra.addProperty("messagePinSeq",maxOf(seq,oldSeq));extra.addProperty("messagePinTime",maxOf(time,oldTime))
            val req=ConversationReq().apply { ex=extra.toString() }
            exIO.execute { client.conversationManager.setConversation(base<String> { saved -> if(saved.isSuccess)events.pin(target,pinned) },target.conversationId,req) }
        } },if(target.sessionType==3)target.groupId else target.userId,target.sessionType) }
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
        synchronized(liveLock) {
            liveHandler.removeCallbacks(flushLive)
            liveBatch.clear()
            liveScheduled=false
            liveEvents=null
        }
        synchronized(syncSnapshotLock) {
            syncSnapshotInFlight=false
            syncSnapshotAt=0L
        }
        conversationMapping.close()
        if(initialized) client.unInit()
        initialized=false
        watchedPeer=null
        userId=""
    }
    companion object {
        private const val LIVE_BATCH_MS=24L
        private const val SYNC_SNAPSHOT_COUNT=50L
    }
}

/** 解析 OpenIM 业务通知；仅接受带 sg_ 会话号的入群申请，与 uni-app 一致。 */
internal fun parseJoinRequestConversationId(raw:String?):String? {
    if(raw.isNullOrBlank())return null
    val root=runCatching { JsonParser.parseString(raw).takeIf { it.isJsonObject }?.asJsonObject }.getOrNull() ?: return null
    fun JsonObject.text(vararg keys:String):String {
        for(key in keys) {
            val field=get(key) ?: continue
            if(field.isJsonPrimitive&&field.asJsonPrimitive.isString) {
                val value=field.asString
                if(value.isNotBlank())return value
            }
        }
        return ""
    }
    if(root.text("key","Key")!="group_join_request")return null
    val dataField=root.get("data") ?: root.get("Data") ?: return null
    val data=when {
        dataField.isJsonObject -> dataField.asJsonObject
        dataField.isJsonPrimitive && dataField.asJsonPrimitive.isString ->
            runCatching { JsonParser.parseString(dataField.asString).takeIf { it.isJsonObject }?.asJsonObject }.getOrNull()
        else -> null
    } ?: return null
    return data.text("groupConversationId","GroupConversationId","groupConversationID").takeIf { it.startsWith("sg_") }
}
