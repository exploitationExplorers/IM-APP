package com.im.nativebootstrap.chat

import com.im.nativebootstrap.core.*
import com.im.nativebootstrap.PerfLog
import android.util.Log
import java.io.File
import com.google.gson.JsonArray
import com.google.gson.JsonObject
import com.im.nativebootstrap.media.*
import java.util.UUID
import java.util.concurrent.Executors

private const val READ_ID_WINDOW=2_000
private const val PAGE_SIZE=20
private const val PREFETCH_CONVERSATIONS=50
private const val PREFETCH_MESSAGE_COUNT=30
private const val TOMBSTONE_WINDOW=4_096

// 控制器所有入口及 SDK 回调经同一串行调度器执行，UI 仅接收不可变快照。
data class ChatState(
    val sessionTag: Long = 0,
    val connection: ConnectionState = ConnectionState.IDLE,
    val store: StoreStatus = StoreStatus.CLOSED,
    val sync: SyncStatus = SyncStatus.IDLE,
    val ready: Boolean = false,
    val loggedIn: Boolean = false,
    val conversations: List<ChatConversation> = emptyList(),
    val conversationsLoading: Boolean = false,
    val conversationsEnd: Boolean = false,
    val conversationDiagnostics: List<String> = emptyList(),
    val active: ChatConversation? = null,
    val messages: List<ChatMessage> = emptyList(),
    val historyLoading: Boolean = false,
    val historyEnd: Boolean = false,
    val historyRevision: Long = 0,
    val historySyncing: Boolean = false,
    val historyDiagnostic: String? = null,
    val outbox: List<OutboxEntry> = emptyList(),
    val error: String? = null,
    val uploading: Boolean = false,
    val readMessageIds: Set<String> = emptySet(),
    val maxOtherReadSeq: Long = 0,
    val mentions:List<ChatMention> = emptyList(),
    val focusMessageId:String? = null,
    val sendBlockedReason:String?=null,
    val permissionLoading:Boolean=false,
    val groupRole:String="",
    val groupBusinessId:String="",
    val groupMemberCount:Long=0,
    val groupAnnouncement:String="",
    val showAnnouncementBanner:Boolean=true,
    val showPinnedBanner:Boolean=true,
    val groupMembers:Map<String,ChatGroupMember> = emptyMap(),
    val groupOwnerName:String="",
    val peerOnline:Boolean?=null,
    val peerLastSeenAt:String="",
    val lastSendErrorCode:Int?=null,
    val mediaUploads:List<PendingMediaUpload> = emptyList(),
    val localSentMedia:Map<String,LocalMedia> = emptyMap(),
    val mediaOwnerDirectory:String="",
    val pendingForwards:List<PendingForward> = emptyList(),
    val forwardSuccessId:String="",
    val forwardFailureId:String="",
    /** 群邀请卡片已处理标记：token → 展示文案（只能点击一次，点击即视为消耗/过期）。 */
    val inviteHandled:Map<String,String> = emptyMap(),
    val revision:Long=0,
) {
    // 只用于 StateFlow 快速发布；大列表不在主线程做深度 equals。
    override fun equals(other:Any?)=other is ChatState&&other.revision==revision
    override fun hashCode()=revision.hashCode()
}
class ChatController(
    private val gateway: ChatGateway,
    private val dispatchQueue: (() -> Unit) -> Unit,
    private val after: (Long, () -> Unit) -> Unit,
    private val changed: (ChatState) -> Unit,
) {
    private val coordinator = SessionCoordinator()
    private var ticket: SessionTicket? = null
    private var syncAttempt: SyncAttempt? = null
    private var syncFinishedBeforeStore = false
    private var outbox: PersistentOutbox? = null
    private var mediaUploads:PendingMediaUploads?=null
    private var sentVideos:SentLocalVideos?=null
    private var pendingForwards:PendingForwards?=null
    private var compressCache:File=File(System.getProperty("java.io.tmpdir") ?: "/tmp","upload-compress")
    private val runningForwards=mutableSetOf<String>()
    private val announcedForwards=mutableSetOf<String>()
    private fun notifyForward(job:PendingForward) {
        if(job.status=="completed"&&announcedForwards.add("success:"+job.id))emit(snapshot.copy(forwardSuccessId=job.id))
        else if(job.status in setOf("failed","uncertain")&&announcedForwards.add("failure:"+job.id))emit(snapshot.copy(forwardFailureId=job.id))
    }
    fun consumeForwardNotice(successId:String,failureId:String) {
        emit(snapshot.copy(forwardSuccessId=if(snapshot.forwardSuccessId==successId)"" else snapshot.forwardSuccessId,forwardFailureId=if(snapshot.forwardFailureId==failureId)"" else snapshot.forwardFailureId))
    }
    private fun failureCode(error:Throwable?)=generateSequence(error) { it.cause }.filterIsInstance<ChatFailure>().firstOrNull()?.code
    private val uploadAttempts=mutableMapOf<String,Long>()
    private var snapshot = ChatState()
    private var offset = 0
    private var pageGeneration = 0L
    private var conversationOperation=0L
    private val conversationChangesDuringRequest=linkedMapOf<String,ChatConversation>()
    private var initialConversationSnapshotLoaded=false
    private var pendingConversationRefresh=false
    private var conversationRecoveryScheduled=false
    private var conversationRecoveryGeneration=0L
    private var conversationRecoveryAttempts=0
    private var conversationVisibilityDirty=true
    private var retentionRefreshNeedsRead=false
    private val conversationDiagnostics=ConversationDiagnostics()
    private var roomGeneration = 0L
    private var historyOperation=0L
    private var localHistoryPage=1
    private var localHistorySupported:Boolean?=null
    private var localHistoryEnd=false
    private var localHistoryAnchor=0L
    private var remoteHistoryOperation=0L
    private var remoteHistoryLoading=false
    private var remoteHistoryEnd=false
    private var cursor: String? = null
    private var authRevoked=false
    private val tombstones=TombstoneWindow(TOMBSTONE_WINDOW)
    // 撤回人信息与会话最新消息缓存：用于区分撤回文案（你/对方/群成员）与会话列表「撤回」预览。
    private val recallBy=HashMap<String,String>()
    private val recallById=HashMap<String,String>()
    private val convLatest=HashMap<String,ChatMessage>()
    private val recalledConversation=HashMap<String,String>()
    private val inviteHandled=HashMap<String,String>()
    private val recentMessages=HashMap<String,List<ChatMessage>>()
    private var roomFirstPageRetry=false
    private val recentPrefetchAttempts=HashMap<String,Int>()
    private val serverRecentInFlight=linkedSetOf<String>()
    private val serverRecentDone=linkedSetOf<String>()
    private var serverRecentFailures=0
    private var serverRecentUnavailable=false
    private val recentPrefetching=HashSet<String>()
    private val recentPrefetchDone=HashSet<String>()
    private var business:ChatBusiness?=null
    private var incomingListener:((ChatMessage)->Unit)?=null
    private var appForeground=false
    private var retention:GroupRetention?=null
    private var historyChecks:GroupHistoryChecks?=null
    private var purges:GroupPurges?=null
    private val purgeFresh=mutableMapOf<String,Long>()
    private val purgeInFlight=mutableSetOf<String>()
    private val retentionFresh=mutableMapOf<String,Long>()
    private val retentionInFlight=mutableSetOf<String>()
    private val retentionChecked=mutableSetOf<String>()
    private val readReporting=mutableSetOf<String>()
    private val readReported=mutableMapOf<String,Long>()
    private val readMarkedAt=mutableMapOf<String,Long>()
    private val clearing=mutableSetOf<String>()
    private val uploadingTargets=mutableSetOf<String>()
    private val notified=linkedSetOf<String>()
    private var ownIMId=""
    private val sendAttempts=mutableMapOf<String,Long>()
    private val sendCompletions=mutableMapOf<String,(Result<ChatMessage>)->Unit>()
    private fun acceptEvidence(message:ChatMessage) {
        outbox?.confirmed(message.id)
        sendCompletions.remove(message.id)?.invoke(Result.success(message))
        // 较迟的本地库确认仍能结束此前待核对的转发，不会重新发送消息。
        pendingForwards?.all()?.filter { job -> job.plan.any { it.message.id==message.id&&it.attempted&&!it.accepted } }?.forEach { job ->
            pendingForwards?.update(job.id) { old ->
                val plan=old.plan.map { if(it.message.id==message.id)it.copy(accepted=true) else it }
                old.copy(plan=plan,status=if(plan.all { it.accepted })"completed" else old.status)
            }?.let { updated -> if(updated.status=="completed")runningForwards.remove(updated.id);notifyForward(updated) }
        }
    }
    private val businessIO=Executors.newFixedThreadPool(2) { runnable -> Thread(runnable,"chat-media-business").apply { isDaemon=true } }
    private val priorityIO=Executors.newSingleThreadExecutor { runnable -> Thread(runnable,"chat-priority").apply { isDaemon=true } }
    private val priorityRetention=linkedSetOf<String>()
    private var permissionOperation=0L
    private var presentation:ChatRoomPresentation?=null
    private var membersOperation=0L
    private var membersLoading=false
    private var wantedMembers:List<String> = emptyList()
    private val checkedMembers=linkedSetOf<String>()
    private fun dispatch(action:()->Unit) { dispatchQueue {
        try { action() } catch (_:Exception) { emit(snapshot.copy(error="聊天存储或资源暂不可用，数据已保留，请稍后重试。",historyLoading=false,conversationsLoading=false)) }
    } }
    private fun boundaryReady(target:ChatTarget)=business==null||target.sessionType!=3||!GroupRetention.supported(target.conversationId)||retention?.watermark(target.conversationId)!=null||target.conversationId in retentionChecked
    private fun localHistoryReadable()=snapshot.store==StoreStatus.READABLE||remoteHistoryReadable()
    private fun remoteHistoryReadable()=!authRevoked&&(snapshot.loggedIn||snapshot.connection==ConnectionState.CONNECTED)
    private fun historyExhausted()=remoteHistoryEnd&&(localHistorySupported!=true||localHistoryEnd)
    private fun permits(target:ChatTarget,message:ChatMessage)=retention?.permits(target,message)!=false&&purges?.permits(target,message)!=false
    // 撤回提示文案：本人撤回 / 私聊对方撤回 / 群聊按撤回人昵称展示（管理员代撤时标注）。
    private fun recallLabel(message:ChatMessage,target:ChatTarget?):String {
        val revoker=recallBy[message.id]?.takeIf { it.isNotBlank() }
        val byOther=recallById[message.id]?.takeIf { it.isNotBlank() }?.let { it!=message.senderId } ?: false
        return when {
            message.mine&&byOther -> "${revoker ?: "管理员"}撤回了你的消息"
            message.mine -> "你撤回了一条消息"
            target?.sessionType==1 -> "对方撤回了一条消息"
            else -> (revoker ?: message.sender.ifBlank { null } ?: "对方")+"撤回了一条消息"
        }
    }
    private fun visible(messages:List<ChatMessage>)=messages.filterNot { tombstones[it.id]==true||it.pinSync||(it.contentType<=0&&MessageContents.isPinSync(it.serialized)) }.filter { message -> snapshot.active?.target?.let { target -> (message.seq<=0||boundaryReady(target))&&permits(target,message) } != false }.map { if(tombstones.containsKey(it.id)) it.copy(text=recallLabel(it,snapshot.active?.target),serialized="",status=2) else it }
    fun attachBusiness(value:ChatBusiness?) { business=value;conversationVisibilityDirty=true;value?.let { MediaURLs.businessBase=it.baseUrl };refreshRetention(snapshot.conversations);snapshot.active?.target?.let { refreshGroupPurges(it) } }
    fun attachIncoming(listener:((ChatMessage)->Unit)?) { incomingListener=listener }


    private fun current(t: SessionTicket) = coordinator.accepts(t)
    private fun cancelConversationRecovery() {conversationRecoveryGeneration++;conversationRecoveryScheduled=false}
    private fun scheduleConversationRecovery() {
        val t=ticket ?: return
        if(conversationRecoveryScheduled||conversationRecoveryAttempts>=12||!snapshot.loggedIn||authRevoked||snapshot.connection!=ConnectionState.CONNECTED||coordinator.snapshot().sync!=SyncStatus.RUNNING||snapshot.conversations.isNotEmpty())return
        conversationRecoveryScheduled=true
        val generation=conversationRecoveryGeneration
        val delay=when(conversationRecoveryAttempts) {0->1_000L;1->2_000L;else->5_000L}
        after(delay) {dispatch {
            if(!current(t)||generation!=conversationRecoveryGeneration)return@dispatch
            conversationRecoveryScheduled=false
            if(!snapshot.loggedIn||authRevoked||snapshot.connection!=ConnectionState.CONNECTED||coordinator.snapshot().sync!=SyncStatus.RUNNING||snapshot.conversations.isNotEmpty())return@dispatch
            conversationRecoveryAttempts++
            conversationDiagnostics.phase("empty-sync-recovery attempt=$conversationRecoveryAttempts")
            loadConversations(true)
        }}
    }
    private fun finishConversationRead() {
        if(pendingConversationRefresh) {pendingConversationRefresh=false;loadConversations(true)}
        else scheduleConversationRecovery()
    }
    private fun emit(
        next: ChatState = snapshot,
        source:String="state",
        messagesDirty:Boolean=next.messages!==snapshot.messages,
    ) {
        val previousConversations=snapshot.conversations
        val core = coordinator.snapshot()
        val id=next.active?.target?.conversationId.orEmpty()
        val uploads=mediaUploads?.all().orEmpty()
        val rebuildMessages=messagesDirty||uploads!=snapshot.mediaUploads
        val localMessages=if(rebuildMessages)uploads.filter { it.target.conversationId==id }.map { it.placeholder() } else emptyList()
        val mergedMessages=if(rebuildMessages)mergeMessages(next.messages.filterNot { it.id.startsWith("upload-") },localMessages) else snapshot.messages
        val conversationsDirty=conversationVisibilityDirty||next.conversations!==previousConversations
        val conversations=if(!conversationsDirty)previousConversations else {
            val visible=next.conversations.map { if(!boundaryReady(it.target)) {if(it.preview.isEmpty()&&it.unread==0)it else it.copy(preview="",unread=0)} else purges?.conversation(retention?.conversation(it) ?: it) ?: retention?.conversation(it) ?: it }
            if(visible.indices.all {visible[it]===next.conversations[it]})next.conversations else visible
        }
        conversationVisibilityDirty=false
        snapshot = next.copy(pendingForwards=pendingForwards?.all().orEmpty(),mediaUploads=uploads,localSentMedia=sentVideos?.all().orEmpty(),mediaOwnerDirectory=mediaUploads?.ownerDirectory().orEmpty(),messages=mergedMessages,store=core.store,sync=core.sync,outbox=outbox?.all().orEmpty(),showPinnedBanner=next.active?.pinnedMessage?.let { presentation?.dismissed(id,"pin",pinPresentationKey(it))!=true } ?: true,showAnnouncementBanner=presentation?.dismissed(id,"announcement",next.groupAnnouncement)!=true,conversations=conversations,revision=snapshot.revision+1)
        if(conversationsDirty) {
            conversationDiagnostics.changed(source,previousConversations,snapshot.conversations)
            snapshot=snapshot.copy(conversationDiagnostics=conversationDiagnostics.report())
        }
        changed(snapshot)
    }
    fun start(identity: AccountIdentity, environment: String, token: String, api: String, ws: String, root: File, sessionTag:Long=0) {
        logout()
        val t=coordinator.bind(identity)
        ticket=t
        ownIMId=identity.imUserId
        coordinator.storeOpening(t)
        emit(ChatState(sessionTag=sessionTag,connection=ConnectionState.CONNECTING))
        try {
            val directory=AccountStorage.directory(root,environment,identity.businessUserId,identity.imUserId)
            val owner=AccountStorage.key(environment,identity.businessUserId,identity.imUserId)
            outbox=PersistentOutbox(File(directory,"app-outbox.json"),owner)
            sentVideos=SentLocalVideos(File(directory,"sent-videos.json"),owner)
            mediaUploads=PendingMediaUploads(File(directory,"media-uploads.json"),owner,sentVideos!!.retainedPaths())
            pendingForwards=PendingForwards(File(directory,"pending-forwards.json"),owner)
            compressCache=File(directory,"upload-compress").apply { mkdirs() }
            mediaUploads?.all()?.filter { job -> job.prepared?.id?.let { id -> outbox?.all()?.any { it.id==id } }==true }?.forEach { job ->
                if(job.kind==MediaKind.VIDEO&&job.media().file.isFile)sentVideos?.put(job.prepared!!.id,job.media())
                mediaUploads?.remove(job.id,keepFiles=job.kind==MediaKind.VIDEO)
            }
            retention=GroupRetention(File(directory,"group-retention.json"),owner)
            historyChecks=GroupHistoryChecks(File(directory,"group-history-checks.json"),owner)
            retentionChecked.addAll(historyChecks!!.all())
            purges=GroupPurges(File(directory,"group-purges.json"),owner)
            presentation=runCatching { ChatRoomPresentation(File(directory,"room-presentation.json"),owner) }.getOrNull()
            emit(ChatState(sessionTag=sessionTag,connection=ConnectionState.CONNECTING))
            val events=object: ChatEvents {
                override fun peerStatus(userId:String,online:Boolean) { dispatch { if(current(t)&&snapshot.active?.target?.let { it.sessionType==1&&it.userId==userId }==true) { emit(snapshot.copy(peerOnline=online));if(!online)refreshContactPresence(t,snapshot.active!!.target) } } }
                override fun connection(state: ConnectionState) { dispatch {
                    if(current(t)) {
                        if(state==ConnectionState.AUTH_REQUIRED) authRevoked=true
                        emit(snapshot.copy(connection=state,ready=snapshot.ready&&!authRevoked,loggedIn=snapshot.loggedIn&&!authRevoked,error=if(authRevoked) "聊天登录已失效，请退出后重新登录。" else snapshot.error))
                        if(state==ConnectionState.CONNECTED)scheduleConversationRecovery() else cancelConversationRecovery()
                        if(state==ConnectionState.CONNECTED&&!authRevoked)reconcilePending()
                        if(state==ConnectionState.CONNECTED&&!authRevoked)snapshot.active?.let { active -> prefetchRecentMessages(listOf(active)) }
                        if(state==ConnectionState.CONNECTED&&!authRevoked&&localHistorySupported==true)snapshot.active?.let { active ->
                            if(snapshot.messages.size<PAGE_SIZE&&!remoteHistoryLoading)remoteHistoryEnd=false
                            emit(snapshot.copy(historyEnd=historyExhausted()))
                            loadRemoteHistory(t,active,roomGeneration)
                        }
                    }
                } }
                override fun conversations(items: List<ChatConversation>) { dispatch { if(current(t)) {
                    PerfLog.mark("controller:conversation-event", "count=${items.size}")
                    conversationDiagnostics.input(if(initialConversationSnapshotLoaded)"sdk-event" else "sdk-event/provisional",items)
                    // 会话最新消息缓存 + 撤回预览保持：SDK 撤回后会把 latestMsg 置空，此处回填撤回文案。
                    val decorated=items.map { row ->
                        val cid=row.target.conversationId
                        row.latestMessage?.let { convLatest[cid]=it }
                        if(row.preview.isBlank()&&row.latestMessage==null) recalledConversation[cid]?.let { row.copy(preview=it) } ?: row else row
                    }
                    // 固定 SDK 的发送状态更新通过会话 latestMsg 通知，未必触发新消息监听。
                    val confirmed=decorated.mapNotNull { item -> item.latestMessage?.takeIf { msg -> msg.mine&&(msg.status==2||msg.seq>0)&&outbox?.all()?.any { it.id==msg.id&&it.target==item.target }==true } }
                    confirmed.forEach(::acceptEvidence)
                    if(snapshot.conversationsLoading)decorated.forEach { conversationChangesDuringRequest[it.target.conversationId]=it }
                    // 首登同步期间先显示 SDK 已落地的会话；正式本地快照返回后再校准。
                    val merged=mergeConversations(snapshot.conversations,decorated,authoritative=initialConversationSnapshotLoaded)
                    val confirmedMessages=confirmed.filter { it.serialized.isNotBlank() }
                    if(merged!==snapshot.conversations||confirmed.isNotEmpty())emit(snapshot.copy(conversations=merged,messages=if(confirmedMessages.isEmpty())snapshot.messages else mergeMessages(snapshot.messages,visible(confirmedMessages.filter { msg -> decorated.any { it.target==snapshot.active?.target&&it.latestMessage?.id==msg.id } })),error=if(confirmed.isNotEmpty())null else snapshot.error),"sdk-event")
                    refreshRetention(decorated)
                } } }
                override fun conversationSnapshot(items:List<ChatConversation>) { dispatch { if(current(t)&&items.isNotEmpty()) {
                    PerfLog.mark("controller:conversation-snapshot", "count=${items.size}")
                    conversationDiagnostics.input("sync-snapshot",items)
                    items.forEach { row -> row.latestMessage?.let { convLatest[row.target.conversationId]=it } }
                    val merged=mergeConversations(snapshot.conversations,items.map { row -> if(row.preview.isBlank()&&row.latestMessage==null) recalledConversation[row.target.conversationId]?.let { row.copy(preview=it) } ?: row else row })
                    if(merged!==snapshot.conversations)emit(snapshot.copy(conversations=merged,conversationsLoading=false,error=null),"sync-snapshot")
                    prefetchRecentMessages(items)
                    refreshRetention(items)
                } } }
                override fun read(ids:List<String>) { dispatch { if(current(t)) {
                    val merged=snapshot.readMessageIds+ids
                    val bounded=if(merged.size<=READ_ID_WINDOW)merged else merged.toList().takeLast(READ_ID_WINDOW).toSet()
                    emit(snapshot.copy(readMessageIds=bounded))
                } } }
                override fun pin(target:ChatTarget,pinned:PinnedChatMessage?) { dispatch { if(current(t))applyPinned(target,pinned) } }
                override fun groupChanged(groupId:String) { dispatch {
                    if(current(t)) {
                        snapshot.conversations.filter { it.target.sessionType==3&&it.target.groupId==groupId }.forEach { refreshGroupPurges(it.target,true) }
                        if(snapshot.active?.target?.groupId==groupId) { checkedMembers.clear();membersOperation++;membersLoading=false;emit(snapshot.copy(groupMembers=emptyMap()));loadVisibleGroupMembers(wantedMembers);refreshSendPermission() }
                    }
                } }
                override fun joinRequestHighlights(conversationIds:Set<String>) { dispatch {
                    if(!current(t)||conversationIds.isEmpty())return@dispatch
                    val activeId=snapshot.active?.target?.conversationId
                    val pending=conversationIds.filter { it!=activeId }.toSet()
                    if(pending.isEmpty())return@dispatch
                    val merged=snapshot.conversations.map { row ->
                        if(row.target.sessionType==3&&row.target.conversationId in pending&&!row.joinRequestPending)row.copy(joinRequestPending=true) else row
                    }
                    if(merged!=snapshot.conversations)emit(snapshot.copy(conversations=merged))
                    // 实时通知到了也再拉一次列表，避免只亮一个会话、漏掉并发申请。
                    reconcileJoinRequestHighlights()
                } }
                override fun messages(items: List<Pair<ChatTarget,ChatMessage>>) { dispatch {
                    if(!current(t)) return@dispatch
                    items.forEach { (_,msg) -> if(msg.mine && (msg.seq>0 || msg.status==2)) acceptEvidence(msg) }
                    // 会话最新消息实时缓存：发送确认/新消息都刷新，保证撤回时能命中会话预览（SDK 会话事件可能滞后）。
                    items.forEach { (target,msg) -> if(msg.time>0) { val old=convLatest[target.conversationId]; if(old==null||msg.time>=old.time) { convLatest[target.conversationId]=msg;recalledConversation.remove(target.conversationId) } } }
                    val active=snapshot.active?.target
                    emit(snapshot.copy(messages=mergeMessages(snapshot.messages,visible(items.filter { it.first.conversationId==active?.conversationId }.map { it.second }))))
                    active?.let { target -> MediaPrefetch.enqueue(target,items.filter { it.first==target }.map { it.second }) }
                    items.map { it.first }.distinct().filter { it.sessionType==3 }.forEach { refreshGroupPurges(it) }
                    if(items.any { it.first.conversationId==active?.conversationId&&!it.second.mine }) markRoomRead()
                } }
                override fun liveMessages(items:List<Pair<ChatTarget,ChatMessage>>) {
                    messages(items)
                    dispatch { if(current(t)) items.filter { (target,message) -> !message.mine&&boundaryReady(target)&&permits(target,message)&&tombstones[message.id]!=true&&snapshot.conversations.none { it.target==target&&it.muted }&&!(appForeground&&snapshot.active?.target==target) }.forEach { (_,message) ->
                        if(notified.add(message.id))incomingListener?.invoke(message)
                        while(notified.size>500)notified.remove(notified.first())
                    } }
                }
                override fun tombstone(id:String,deleted:Boolean) { tombstone(id,deleted,"","") }
                override fun tombstone(id:String,deleted:Boolean,revokerId:String,revokerNickname:String) { dispatch {
                    if(!current(t)) return@dispatch
                    if(!deleted&&revokerNickname.isNotBlank())recallBy[id]=revokerNickname
                    if(!deleted&&revokerId.isNotBlank())recallById[id]=revokerId
                    tombstones[id]=deleted
                    outbox?.confirmed(id)
                    // 被撤回的是会话最新消息时，会话列表预览同步为撤回文案（SDK 会把 latestMsg 清空）。
                    val rows=if(!deleted)snapshot.conversations.map { row ->
                        val lm=convLatest[row.target.conversationId]
                        if(lm?.id==id) { val label=recallLabel(lm,row.target);recalledConversation[row.target.conversationId]=label;row.copy(preview=label) } else row
                    } else snapshot.conversations
                    emit(snapshot.copy(messages=visible(snapshot.messages),conversations=rows))
                } }
                override fun syncStarted() { dispatch {
                    if(!current(t)) return@dispatch
                    conversationDiagnostics.phase("sync-start")
                    cancelConversationRecovery();conversationRecoveryAttempts=0
                    syncFinishedBeforeStore=false
                    val attempt=coordinator.beginSync(t) ?: return@dispatch
                    syncAttempt=attempt
                    emit()
                    scheduleConversationRecovery()
                    after(90_000) { dispatch { if(current(t) && syncAttempt===attempt) { coordinator.failSync(attempt,SyncStatus.TIMED_OUT,"同步超时"); syncAttempt=null; syncFinishedBeforeStore=false; emit(snapshot.copy(error="同步暂未完成，可继续读取已保存的聊天。")) } } }
                } }
                override fun syncProgress(progress:Long) {dispatch {
                    if(current(t))scheduleConversationRecovery()
                }}
                override fun syncFinished() { dispatch {
                    if(!current(t)) return@dispatch
                    PerfLog.mark("controller:sync-finished")
                    conversationDiagnostics.phase("sync-finish")
                    val attempt=syncAttempt ?: return@dispatch
                    cancelConversationRecovery()
                    val retryRoom=resetRoomHistoryForSyncRetry()
                    if(coordinator.snapshot().store==StoreStatus.READABLE) { coordinator.completeSync(attempt);syncAttempt=null;loadConversations(true) }
                    else {syncFinishedBeforeStore=true;if(snapshot.loggedIn)loadConversations(true)}
                    reconcilePending()
                    reconcileJoinRequestHighlights()
                    snapshot.active?.let { active -> MediaPrefetch.enqueue(active.target,snapshot.messages) }
                    emit()
                    if(retryRoom)retryRoomFirstPage()
                } }
                override fun syncFailed() { dispatch {
                    if(!current(t)) return@dispatch
                    conversationDiagnostics.phase("sync-failed")
                    syncAttempt?.let { coordinator.failSync(it,SyncStatus.FAILED,"同步未完成") }
                    syncAttempt=null
                    syncFinishedBeforeStore=false
                    cancelConversationRecovery()
                    emit(snapshot.copy(error="同步未完成，可重试读取；不会删除聊天记录。"))
                } }
            }
            gateway.start(identity.imUserId,token,api,ws,File(directory,"sdk").apply { check(mkdirs()||isDirectory) },events) { result -> dispatch {
                if(!current(t)||authRevoked) return@dispatch
                result.fold(onSuccess={
                    // 登录成功仅证明 SDK 会话；首次成功查询才证明本地库可读。
                    emit(snapshot.copy(loggedIn=true,error=null))
                    loadConversations(true)
                },onFailure={
                    coordinator.storeFailed(t,"聊天登录未完成")
                    emit(snapshot.copy(ready=false,error=it.message ?: "聊天登录未完成"))
                })
            } }
        } catch (_: Exception) {
            coordinator.storeFailed(t,"聊天存储初始化失败")
            emit(snapshot.copy(error="聊天存储初始化失败。原数据已保留，请检查空间后重试。"))
        }
    }
    fun loadConversations(refresh: Boolean=false) {
        val t=ticket ?: return
        if((!snapshot.loggedIn&&snapshot.store!=StoreStatus.READABLE) || (snapshot.conversationsEnd && !refresh)) return
        if(snapshot.conversationsLoading) {if(refresh)pendingConversationRefresh=true;return}
        if(refresh) { pageGeneration+=1;offset=0 }
        val version=pageGeneration
        val query=++conversationOperation
        conversationChangesDuringRequest.clear()
        val requestedRows=snapshot.conversations.associateBy { it.target.conversationId }
        val requestedOffset=offset
        conversationDiagnostics.phase(if(refresh)"local-snapshot-request" else "local-page-request offset=$requestedOffset")
        emit(snapshot.copy(conversationsLoading=true,error=null))
        PerfLog.mark("conversations:query", "refresh=$refresh offset=$requestedOffset")
        after(20_000) { dispatch { if(current(t)&&pageGeneration==version&&conversationOperation==query&&snapshot.conversationsLoading) { pageGeneration+=1;emit(snapshot.copy(conversationsLoading=false,error="会话读取超时，可点击刷新重试。"));finishConversationRead() } } }
        val resultHandler:(Result<ConversationSnapshotPage>)->Unit = { result -> dispatch {
            if(!current(t)||version!=pageGeneration||conversationOperation!=query) return@dispatch
            result.fold(onSuccess={ response ->
                val page=response.items
                PerfLog.mark("conversations:result", "count=${page.size} end=${response.end}")
                conversationDiagnostics.input(if(refresh)"local-snapshot-result end=${response.end}" else "local-page-result",page)
                offset=requestedOffset+page.size
                coordinator.storeReadable(t)
                if(syncFinishedBeforeStore) syncAttempt?.let { coordinator.completeSync(it);syncAttempt=null;syncFinishedBeforeStore=false }
                // 事件已原位应用到当前快照；先排除其旧查询行，避免旧置顶值中间排序后留下错误位置。
                val currentRows=snapshot.conversations.associateBy { it.target.conversationId }
                val merged=if(!initialConversationSnapshotLoaded) {
                    // 服务端/同步中的临时快照先保留；本地空库快照不能把它擦掉。
                    val local=mergeConversations(snapshot.conversations,page,authoritative=true)
                    mergeConversations(local,conversationChangesDuringRequest.values.toList(),authoritative=true)
                } else mergeConversations(snapshot.conversations,page.filterNot { item ->
                    val id=item.target.conversationId
                    id in conversationChangesDuringRequest||currentRows[id]!=requestedRows[id]
                })
                initialConversationSnapshotLoaded=true
                conversationChangesDuringRequest.clear()
                emit(snapshot.copy(ready=!authRevoked&&snapshot.loggedIn,conversations=merged,conversationsLoading=false,conversationsEnd=response.end),if(refresh)"local-snapshot" else "local-page")
                if(merged.isNotEmpty())cancelConversationRecovery()
                refreshRetention(page)
                prefetchRecentMessages(merged)
                if(snapshot.active!=null&&!snapshot.historyLoading&&(snapshot.messages.isEmpty()||snapshot.messages.size<PAGE_SIZE||roomFirstPageRetry))retryRoomFirstPage()
                finishConversationRead()
            },onFailure={ emit(snapshot.copy(conversationsLoading=false,error=it.message ?: "会话读取失败，可重试。"));finishConversationRead() })
        } }
        if(refresh)gateway.initialConversations(30,resultHandler)
        else gateway.conversations(requestedOffset,30) { result -> resultHandler(result.map { ConversationSnapshotPage(it,it.size<30) }) }
    }
    /**
     * 首屏只预热可见的前 20 个会话；不按 700+ 会话全量并发拉取。
     * 点开时先用这页消息，历史加载继续在后台补齐。
     */
    private fun prefetchRecentMessages(items:List<ChatConversation>) {
        if(!gateway.supportsRecentPrefetch||authRevoked||(!snapshot.loggedIn&&snapshot.connection!=ConnectionState.CONNECTED))return
        val t=ticket ?: return
        val activeId=snapshot.active?.target?.conversationId
        val candidates=items.filter { it.target.supported() }.take(PREFETCH_CONVERSATIONS)
        fetchServerRecent(candidates)
        candidates.sortedByDescending { it.target.conversationId==activeId }.forEach { conversation ->
            val id=conversation.target.conversationId
            if(id in recentPrefetching||id in recentPrefetchDone)return@forEach
            val attempt=(recentPrefetchAttempts[id]?:0)+1
            val maxAttempts=if(snapshot.active?.target?.conversationId==id)10 else 4
            if(attempt>maxAttempts)return@forEach
            recentPrefetchAttempts[id]=attempt
            recentPrefetching.add(id)
            gateway.history(conversation.target,null,PREFETCH_MESSAGE_COUNT) { result -> dispatch {
                if(!current(t))return@dispatch
                recentPrefetching.remove(id)
                result.fold(onSuccess={ page ->
                    recentMessages[id]=page.messages
                    if(page.messages.isNotEmpty()) { recentPrefetchDone.add(id);recentPrefetchAttempts.remove(id) } else recentPrefetchDone.remove(id)
                    PerfLog.mark("recent-prefetch:ok","count=${page.messages.size}")
                    if(page.messages.isNotEmpty()&&snapshot.active?.target?.conversationId==id&&snapshot.messages.size<PAGE_SIZE) {
                        emit(snapshot.copy(messages=mergeMessages(snapshot.messages,visible(page.messages)),historyRevision=snapshot.historyRevision+1,error=null))
                        MediaPrefetch.enqueue(snapshot.active!!.target,page.messages)
                    }
                    val active=snapshot.active
                    if(page.messages.isNotEmpty()&&active!=null&&active.target.conversationId!=id&&snapshot.messages.size<PAGE_SIZE) {
                        prefetchRecentMessages(listOf(active))
                    }
                    if(page.messages.isEmpty()&&attempt<maxAttempts&&(snapshot.connection==ConnectionState.CONNECTED||snapshot.sync==SyncStatus.RUNNING)) {
                        after(1_500) { dispatch { if(current(t)&&snapshot.active?.target?.conversationId==id)prefetchRecentMessages(listOf(conversation)) } }
                    }
                },onFailure={
                    recentPrefetchDone.remove(id)
                    PerfLog.mark("recent-prefetch:failed")
                    if(attempt<maxAttempts&&(snapshot.connection==ConnectionState.CONNECTED||snapshot.sync==SyncStatus.RUNNING)) {
                        after(1_500) { dispatch { if(current(t)&&snapshot.active?.target?.conversationId==id)prefetchRecentMessages(listOf(conversation)) } }
                    }
                })
            } }
        }
    }
    /**
     * 首屏/进入房间时先走业务后端批量拉最近消息。该接口不依赖 SDK 首次同步，
     * 返回后直接进入内存缓存并回填当前房间；SDK 预取仍作为持久化和兜底。
     */
    private fun fetchServerRecent(items:List<ChatConversation>) {
        val api=business ?: return
        val t=ticket ?: return
        if(serverRecentUnavailable||ownIMId.isBlank())return
        val candidates=items.filter { it.target.supported() && it.latestSeq>0 && it.target.conversationId !in serverRecentInFlight && it.target.conversationId !in serverRecentDone }.take(PREFETCH_CONVERSATIONS)
        if(candidates.isEmpty())return
        candidates.forEach { serverRecentInFlight.add(it.target.conversationId) }
        businessIO.execute {
            val result=runCatching {
                val loaded=LinkedHashMap<String,List<ChatMessage>>()
                var failure:Exception?=null
                candidates.chunked(10).forEach { chunk ->
                    val request=JsonObject().apply {
                        val list=JsonArray()
                        chunk.forEach { conversation ->
                            list.add(JsonObject().apply {
                                addProperty("conversationId",conversation.target.conversationId)
                                addProperty("endSeq",conversation.latestSeq)
                                addProperty("count",PREFETCH_MESSAGE_COUNT)
                            })
                        }
                        add("items",list)
                    }
                    try {
                        loaded.putAll(parseServerRecentMessages(api.request("POST","/im/conversations/recent-messages",request),ownIMId))
                    } catch(error:Exception) {
                        if(failure==null)failure=error
                    }
                }
                if(loaded.isEmpty())failure?.let { throw it }
                loaded
            }
            dispatch {
                candidates.forEach { serverRecentInFlight.remove(it.target.conversationId) }
                if(!current(t))return@dispatch
                result.fold(onSuccess={ parsed ->
                    serverRecentFailures=0
                    candidates.forEach { serverRecentDone.add(it.target.conversationId) }
                    parsed.forEach { (conversationId,messages) ->
                        if(messages.isNotEmpty())recentMessages[conversationId]=messages
                    }
                    val active=snapshot.active
                    val activeMessages=active?.target?.conversationId?.let { parsed[it] }.orEmpty()
                    if(active!=null&&activeMessages.isNotEmpty()&&snapshot.messages.size<PAGE_SIZE) {
                        emit(snapshot.copy(messages=mergeMessages(snapshot.messages,visible(activeMessages)),historyRevision=snapshot.historyRevision+1,error=null))
                        MediaPrefetch.enqueue(active.target,activeMessages)
                    }
                    PerfLog.mark("server-recent:ok","conversations=${parsed.size}")
                },onFailure={ error ->
                    serverRecentFailures+=1
                    if(serverRecentFailures>=3)serverRecentUnavailable=true
                    PerfLog.mark("server-recent:failed","${error.message}")
                })
            }
        }
    }
    fun open(conversation: ChatConversation) {
        if(conversation.target.conversationId in clearing) { emit(snapshot.copy(error="聊天记录正在清理，请稍后打开"));return }
        if(!conversation.target.supported()) { emit(snapshot.copy(error="该会话类型尚未接入，暂不能打开。"));return }
        roomGeneration+=1
        roomFirstPageRetry=false
        localHistoryPage=1;localHistorySupported=null;localHistoryEnd=false;localHistoryAnchor=(System.currentTimeMillis()+999)/1000;remoteHistoryOperation++;remoteHistoryLoading=false;remoteHistoryEnd=false
        membersOperation++;membersLoading=false;wantedMembers=emptyList();checkedMembers.clear()
        cursor=null
        val local=outbox?.all().orEmpty().filter { it.target.conversationId==conversation.target.conversationId }.map { it.message }
        val opened=if(conversation.joinRequestPending)conversation.copy(joinRequestPending=false) else conversation
        val conversations=if(opened.joinRequestPending!=conversation.joinRequestPending) {
            snapshot.conversations.map { if(it.target.conversationId==conversation.target.conversationId)it.copy(joinRequestPending=false) else it }
        } else snapshot.conversations
        emit(snapshot.copy(active=opened,conversations=conversations,messages=emptyList(),historyEnd=false,historyLoading=false,historyRevision=0,historySyncing=false,historyDiagnostic=null,error=null,maxOtherReadSeq=0,mentions=emptyList(),focusMessageId=null,sendBlockedReason=null,permissionLoading=false,groupRole="",groupBusinessId="",groupMemberCount=0,groupAnnouncement="",groupMembers=emptyMap(),groupOwnerName="",peerOnline=null,peerLastSeenAt=""))
        val latest=conversation.latestMessage ?: convLatest[conversation.target.conversationId]
        val seed=latest?.takeIf { it.serialized.isNotBlank() }?.let { visible(listOf(it)) }.orEmpty()
        val cached=visible(recentMessages[conversation.target.conversationId].orEmpty())
        emit(snapshot.copy(messages=mergeMessages(mergeMessages(seed,visible(local)),cached)))
        fetchServerRecent(listOf(opened))
        prefetchRecentMessages(listOf(opened))
        // 先启动历史首屏；retention 只在群消息区做门禁，不再串行阻塞其他房间初始化。
        loadHistory()
        refreshGroupPurges(conversation.target,true)
        refreshSendPermission()
        refreshPeerPresence()
        reconcileRoom()
        markRoomRead()
    }
    fun openPeer(imId:String,group:Boolean,title:String,avatar:String) {
        val t=ticket ?: return
        if(!snapshot.ready&&snapshot.store!=StoreStatus.READABLE) { emit(snapshot.copy(error="聊天库尚未就绪，请稍后重试"));return }
        val operation=++roomGeneration
        gateway.peer(imId,group) { result -> dispatch {
            if(!current(t)||operation!=roomGeneration) return@dispatch
            result.fold(onSuccess={ info -> open(info.copy(title=title.ifBlank { info.title },avatar=avatar.ifBlank { info.avatar })) },onFailure={ emit(snapshot.copy(error=it.message ?: "会话读取失败")) })
        } }
    }
    fun getPeerConversation(imId:String,group:Boolean,done:(Result<ChatConversation>)->Unit) {
        val t=ticket ?: return done(Result.failure(IllegalStateException("请先登录")))
        if(!snapshot.ready)return done(Result.failure(IllegalStateException("聊天库尚未就绪，请稍后重试")))
        if(imId.isBlank())return done(Result.failure(IllegalStateException("会话标识不可用")))
        gateway.peer(imId,group) { result -> dispatch {
            if(current(t))done(result)
        } }
    }
    fun acceptGroupInvite(token:String,done:(Result<ChatInviteResult>)->Unit) {
        val t=ticket ?: return done(Result.failure(IllegalStateException("请先登录")))
        val api=business ?: return done(Result.failure(IllegalStateException("业务服务尚未就绪")))
        if(token.isBlank())return done(Result.failure(IllegalStateException("邀请已失效")))
        businessIO.execute {
            val result=runCatching {
                val safe=java.net.URLEncoder.encode(token,"UTF-8").replace("+","%20")
                val response=api.request("POST","/group-invitations/$safe/accept").asJsonObject
                val action=response.string("nextAction")
                check(action in setOf("joined","already_member","pending_approval")) { "入群结果尚未确认，请刷新群列表核对" }
                ChatInviteResult(action,response.obj("group").string("id"))
            }
            dispatch { if(current(t))done(result) }
        }
    }
    fun markInviteHandled(token:String,label:String) {
        val t=ticket ?: return
        dispatch { if(!current(t))return@dispatch
            inviteHandled[token]=label
            emit(snapshot.copy(inviteHandled=inviteHandled.toMap()))
        }
    }
    fun closeRoom() { roomGeneration+=1;roomFirstPageRetry=false;remoteHistoryOperation++;remoteHistoryLoading=false;cursor=null;gateway.watchPeer(null) {};emit(snapshot.copy(active=null,messages=emptyList(),historyLoading=false,historyEnd=false,error=null,mentions=emptyList(),focusMessageId=null)) }
    private fun refreshPeerPresence() {
        val t=ticket ?: return
        val target=snapshot.active?.target ?: return
        val version=roomGeneration
        gateway.watchPeer(target.userId.takeIf { target.sessionType==1 }) { result -> dispatch {
            if(current(t)&&version==roomGeneration&&snapshot.active?.target==target)result.onSuccess { emit(snapshot.copy(peerOnline=it)) }
        } }
        if(target.sessionType==1)refreshContactPresence(t,target)
    }
    private fun refreshContactPresence(t:SessionTicket,target:ChatTarget) {
        val api=business ?: return
        val id=businessUserId(target.userId).takeIf { it.isNotBlank() } ?: return
        val version=roomGeneration
        businessIO.execute {
            val detail=runCatching { api.request("GET","/contacts/$id").asJsonObject.string("lastSeenAt") }
            dispatch { if(current(t)&&version==roomGeneration&&snapshot.active?.target==target)detail.onSuccess { emit(snapshot.copy(peerLastSeenAt=it)) } }
        }
    }
    fun loadHistory() {
        val t=ticket ?: return
        val active=snapshot.active ?: return
        if(active.target.conversationId in clearing)return
        if(!boundaryReady(active.target)) {
            PerfLog.mark("room:boundary-wait","id=${active.target.conversationId}")
            if(!snapshot.historySyncing)emit(snapshot.copy(historySyncing=true))
            refreshRetention(listOf(active))
            refreshRetentionPriority(active.target)
            return
        }
        if(!localHistoryReadable()||snapshot.historyLoading||snapshot.historyEnd&&(localHistorySupported!=true||localHistoryEnd))return
        if(localHistorySupported!=false) {
            if(localHistoryEnd) { if(snapshot.ready)loadRemoteHistory(t,active,roomGeneration);return }
            val version=roomGeneration;val query=++historyOperation;val page=localHistoryPage
            emit(snapshot.copy(historyLoading=true,historySyncing=false,error=null))
            after(5_000) { dispatch { if(current(t)&&version==roomGeneration&&query==historyOperation&&snapshot.historyLoading) {
                historyOperation++;historyFailure("本地历史暂未读出，可重试。")
            } } }
            gateway.localHistory(active.target,page,PAGE_SIZE,localHistoryAnchor) { result -> dispatch {
                if(!current(t)||version!=roomGeneration||query!=historyOperation||!localHistoryReadable())return@dispatch
                result.fold(onSuccess={ local ->
                    localHistorySupported=true
                    localHistoryEnd=local.end
                    // 只推进本地分页；网络补洞游标与加载状态独立，不阻止继续向上读本地记录。
                    if(local.messages.isNotEmpty()||!local.end)localHistoryPage=page+1
                    local.messages.filter { it.mine&&(it.status==2||it.seq>0) }.forEach(::acceptEvidence)
                    emit(snapshot.copy(messages=mergeMessages(snapshot.messages,visible(local.messages)),historyLoading=false,historyEnd=historyExhausted(),historyRevision=snapshot.historyRevision+1,error=null))
                    MediaPrefetch.enqueue(active.target,local.messages)
                    // 未连上服务器也尝试一次完整 SDK 历史；无补洞时可立即补出本地系统/表情。
                    // 该查询独立限时，既不占本地 loading，也不阻止下一页本地预览。
                    if(remoteHistoryReadable())loadRemoteHistory(t,active,version)
                },onFailure={ error ->
                    if(error is UnsupportedOperationException) { localHistorySupported=false;emit(snapshot.copy(historyLoading=false));loadHistory() }
                    else { historyFailure("本地历史暂未读出，可重试。");if(remoteHistoryReadable())loadRemoteHistory(t,active,version) }
                })
            } }
            return
        }
        if(!remoteHistoryReadable())return
        val version=roomGeneration
        val query=++historyOperation
        val before=cursor
        emit(snapshot.copy(historyLoading=true,historySyncing=false,error=null))
        after(20_000) { dispatch { if(current(t)&&roomGeneration==version&&historyOperation==query&&snapshot.historyLoading) { historyOperation+=1;emit(snapshot.copy(historyLoading=false,error="历史读取超时，可点击重试。")) } } }
        gateway.history(active.target,before,PAGE_SIZE) { result -> dispatch {
            if(!current(t)||version!=roomGeneration||query!=historyOperation||!remoteHistoryReadable()) return@dispatch
            result.fold(onSuccess={ page ->
                val oldest=page.messages.minWithOrNull(compareBy<ChatMessage> { it.time }.thenBy { it.id })?.id
                if(oldest!=null && oldest!=before) cursor=oldest
                page.messages.filter { it.mine && (it.status==2 || it.seq>0) }.forEach(::acceptEvidence)
                // 仅 SDK 的 isEnd 决定结束；空页或重复游标不能冒充无更多历史。
                emit(snapshot.copy(messages=mergeMessages(snapshot.messages,visible(page.messages)),historyLoading=false,historyEnd=page.end,historyRevision=snapshot.historyRevision+if(page.end||oldest!=null&&oldest!=before)1 else 0,error=if(!page.end&&(oldest==null||oldest==before)) "历史暂未推进，请稍后重试。" else null))
                MediaPrefetch.enqueue(active.target,page.messages)
                markRoomRead()
            },onFailure={ emit(snapshot.copy(historyLoading=false,error=it.message ?: "历史读取失败，可重试。")) })
        } }
    }

    /**
     * 首次登录时本地库可能先返回空页，不能把“暂时没数据”当成永久 historyEnd。
     * SDK 同步完成后，当前房间允许从第一页重新读一次。
     */
    private fun resetRoomHistoryForSyncRetry():Boolean {
        if(snapshot.active==null||snapshot.messages.size>=PAGE_SIZE) {
            PerfLog.mark("room:sync-retry-skip","active=${snapshot.active!=null} messages=${snapshot.messages.size}")
            return false
        }
        historyOperation++
        remoteHistoryOperation++
        remoteHistoryLoading=false
        remoteHistoryEnd=false
        localHistoryPage=1
        localHistorySupported=null
        localHistoryEnd=false
        localHistoryAnchor=(System.currentTimeMillis()+999)/1000
        roomFirstPageRetry=true
        PerfLog.mark("room:sync-retry","messages=${snapshot.messages.size}")
        emit(snapshot.copy(historyLoading=false,historySyncing=false,historyEnd=false))
        return true
    }
    private fun retryRoomFirstPage() {
        if(snapshot.active==null||snapshot.historyLoading||!localHistoryReadable()) {
            PerfLog.mark("room:retry-skip","active=${snapshot.active!=null} loading=${snapshot.historyLoading} store=${snapshot.store}")
            return
        }
        PerfLog.mark("room:retry","messages=${snapshot.messages.size}")
        roomFirstPageRetry=false
        loadHistory()
    }
    private fun loadRemoteHistory(t:SessionTicket,active:ChatConversation,version:Long) {
        if(remoteHistoryLoading||remoteHistoryEnd||!remoteHistoryReadable()) {
            PerfLog.mark("room:remote-skip","loading=$remoteHistoryLoading end=$remoteHistoryEnd ready=${snapshot.ready}")
            return
        }
        val query=++remoteHistoryOperation;val before=cursor
        remoteHistoryLoading=true
        emit(snapshot.copy(historySyncing=true))
        after(20_000) { dispatch { if(current(t)&&version==roomGeneration&&query==remoteHistoryOperation&&remoteHistoryLoading) {
            remoteHistoryOperation++;remoteHistoryLoading=false
            if(snapshot.messages.isEmpty())historyFailure("在线历史暂未同步，可继续读取本机记录或稍后重试。")
            else emit(snapshot.copy(historySyncing=false,error=snapshot.error))
        } } }
        gateway.history(active.target,before,PAGE_SIZE) { result -> dispatch {
            if(!current(t)||version!=roomGeneration||query!=remoteHistoryOperation)return@dispatch
            remoteHistoryLoading=false
            result.fold(onSuccess={ page ->
                PerfLog.mark("room:remote-ok","count=${page.messages.size} end=${page.end}")
                page.messages.minWithOrNull(compareBy<ChatMessage> { it.time }.thenBy { it.id })?.id?.takeIf { it!=before }?.let { cursor=it }
                remoteHistoryEnd=page.end&&(page.messages.isNotEmpty()||snapshot.sync!=SyncStatus.RUNNING)
                page.messages.filter { it.mine&&(it.status==2||it.seq>0) }.forEach(::acceptEvidence)
                emit(snapshot.copy(messages=mergeMessages(snapshot.messages,visible(page.messages)),historySyncing=false,historyEnd=historyExhausted(),historyRevision=snapshot.historyRevision+if(page.end||cursor!=before)1 else 0))
                MediaPrefetch.enqueue(active.target,page.messages)
                markRoomRead()
            },onFailure={ error ->
                PerfLog.mark("room:remote-failed","${error.message}")
                if(snapshot.messages.isEmpty())historyFailure("在线历史暂未同步，可继续读取本机记录。") else emit(snapshot.copy(historySyncing=false,error=snapshot.error))
            })
        } }
    }
    private fun historyFailure(message:String) {
        val syncing=snapshot.sync==SyncStatus.RUNNING
        emit(snapshot.copy(historyLoading=false,historySyncing=syncing,error=if(syncing)null else message))
    }
    fun send(text: String,quote:ChatMessage?=null):Boolean {
        val active=snapshot.active ?: return false
        val t=ticket ?: return false
        if(!snapshot.ready || text.isBlank()) return false
        var persisted=false
        try {
            ensureCanSend(active.target)
            val mentions=snapshot.mentions.filter { text.contains("@${it.name}") }
            if(mentions.any { it.userId=="AtAllTag" }) {
                val api=business ?: error("业务服务尚未就绪")
                check(api.request("GET","/im/groups/by-im/${active.target.groupId}").asJsonObject.string("role") in setOf("owner","admin")) { "仅群主或管理员可 @所有人" }
            }
            val message=if(mentions.isNotEmpty())gateway.createMention(text.trim(),mentions.map { it.userId to it.name },quote,active.target) else if(quote==null) gateway.createText(text.trim(),active.target) else gateway.createQuote(text.trim(),quote,active.target)
            val entry=outbox!!.put(active.target,message)
            persisted=true
            emit(snapshot.copy(messages=mergeMessages(snapshot.messages,listOf(message)),error=null,mentions=emptyList()))
            if(quote==null) submit(t,entry) else preserveQuoteThenSubmit(t,entry)
        } catch (_:Exception) { emit(snapshot.copy(error=if(persisted) "消息已保存，结果待核对。" else "消息未提交。待发记录保存失败或聊天资源未就绪，请重试。")) }
        return persisted
    }

    private fun preserveQuoteThenSubmit(t:SessionTicket,entry:OutboxEntry) {
        val api=business
        if(api==null) { submit(t,entry);return }
        val source=entry.message
        businessIO.execute {
            val result=runCatching {
                val preserved=preserveQuote(source)
                val updated=outbox?.update(entry.id,OutboxState.PENDING,preserved)
                if(updated==null)error("引用消息已确认或已消失")
                preserved
            }
            dispatch {
                if(!current(t)||outbox?.all()?.none { it.id==entry.id }!=false)return@dispatch
                result.fold(onSuccess={ preserved ->
                    val fresh=outbox?.all()?.firstOrNull { it.id==entry.id&&it.state==OutboxState.PENDING } ?: return@dispatch
                    emit(snapshot.copy(messages=if(snapshot.active?.target==entry.target)mergeMessages(snapshot.messages,listOf(preserved)) else snapshot.messages))
                    submit(t,fresh)
                },onFailure={ error ->
                    if(outbox?.all()?.firstOrNull { it.id==entry.id }?.state==OutboxState.PENDING)outbox?.update(entry.id,OutboxState.FAILED)
                    emit(snapshot.copy(error=if(snapshot.active?.target?.conversationId==entry.target.conversationId)"引用媒体仍在保护中，请稍后点按重试。" else snapshot.error))
                })
            }
        }
    }
    private fun enqueueVisualMedia(media:LocalMedia,queued:(Boolean)->Unit):Boolean {
        val active=snapshot.active
        val t=ticket
        if(active==null||t==null||!snapshot.ready||business==null) { queued(false);return false }
        var saved:PendingMediaUpload?=null
        return try {
            val entry=mediaUploads!!.put(active.target,media)
            saved=entry
            emit(snapshot.copy(error=null))
            queued(true)
            uploadVisualMedia(t,entry)
            true
        } catch(error:Exception) {
            if(saved!=null) { mediaUploads?.update(saved.id) { it.copy(state=MediaUploadState.FAILED) };emit();true }
            else { emit(snapshot.copy(error=if(media.kind==MediaKind.VIDEO)error.message ?: "视频尚未保存，请重试选择。" else "图片尚未保存，请重试选择。"));queued(false);false }
        }
    }
    fun retryImageUpload(id:String) {
        val t=ticket ?: return
        val old=mediaUploads?.all()?.firstOrNull { it.id==id&&it.state==MediaUploadState.FAILED } ?: return
        if(!snapshot.ready)return
        val entry=mediaUploads?.update(id) { it.copy(state=MediaUploadState.UPLOADING) } ?: return
        emit(snapshot.copy(error=null));uploadVisualMedia(t,entry)
    }
    fun discardImageUpload(id:String) {
        val entry=mediaUploads?.all()?.firstOrNull { it.id==id&&it.state==MediaUploadState.FAILED } ?: return
        if(entry.prepared?.id?.let { value -> outbox?.all()?.any { it.id==value } }==true)return
        mediaUploads?.remove(id);emit()
    }
    private fun uploadVisualMedia(t:SessionTicket,entry:PendingMediaUpload) {
        val api=business ?: return
        val attempt=(uploadAttempts[entry.id] ?: 0)+1
        uploadAttempts[entry.id]=attempt;uploadingTargets.add(entry.target.conversationId)
        val store=mediaUploads ?: return
        businessIO.execute {
            val uploaded=runCatching {
                ensureCanSend(entry.target,api)
                var pending=store.all().firstOrNull { it.id==entry.id } ?: error("本地附件不可用")
                var local=pending.media()
                if(local.kind==MediaKind.VIDEO) {
                    local=api.prepareMedia(local)
                    require(local.kind==MediaKind.VIDEO&&local.file.canonicalPath==File(entry.path).canonicalPath&&local.width>0&&local.height>0&&local.duration>0&&local.snapshot?.isFile==true) { "视频信息暂不可读取，请重试或重新拍摄" }
                    check(current(t)&&mediaUploads===store)
                    pending=store.update(entry.id) { it.copy(width=local.width,height=local.height,duration=local.duration,snapshotPath=local.snapshot!!.absolutePath) } ?: error("本地附件不可用")
                    dispatch { if(current(t)&&mediaUploads===store)emit() }
                }
                var value=if(pending.remoteUrl.isNotBlank())UploadedMedia(local,pending.remoteUrl,pending.remoteThumbnail,pending.remoteId) else {
                    // 服务端直传表单限 20MB，超限图片先本地压缩（降采样+JPEG），原文件不动。
                    val uploadable=com.im.nativebootstrap.media.ImageUploadCompress.compressIfNeeded(local,compressCache)
                    api.uploadMedia(uploadable).also { base ->
                        check(current(t)&&mediaUploads===store)
                        store.update(entry.id) { it.copy(remoteUrl=base.url,remoteThumbnail=base.thumbnail,remoteId=base.id) }
                    }
                }
                if(local.kind==MediaKind.VIDEO&&value.thumbnail.isBlank()) {
                    val cover=local.snapshot ?: error("视频封面暂不可读取")
                    val uploadedCover=api.uploadMedia(LocalMedia(cover,"snapshot.jpg","image/jpeg",MediaKind.IMAGE,width=local.width,height=local.height))
                    value=value.copy(thumbnail=uploadedCover.url)
                    check(current(t)&&mediaUploads===store)
                    store.update(entry.id) { it.copy(remoteThumbnail=uploadedCover.url) }
                }
                value
            }
            dispatch {
                if(!current(t)||mediaUploads!==store||uploadAttempts[entry.id]!=attempt)return@dispatch
                uploaded.fold(onSuccess={ value ->
                    try {
                        val durable=store.update(entry.id) { it.copy(remoteUrl=value.url,remoteThumbnail=value.thumbnail,remoteId=value.id) } ?: return@fold
                        val message=durable.prepared ?: gateway.createMedia(value,entry.target)
                        // 同一个 SDK clientMsgID 先记录到任务，再交接 Outbox；恢复时不会重新创建另一条消息。
                        store.update(entry.id) { it.copy(prepared=message) }
                        val saved=outbox?.all()?.firstOrNull { it.id==message.id } ?: outbox!!.put(entry.target,message)
                        if(value.local.kind==MediaKind.VIDEO)sentVideos!!.put(message.id,value.local)
                        store.remove(entry.id,keepFiles=value.local.kind==MediaKind.VIDEO)
                        finishUploadTarget(entry.target)
                        emit(snapshot.copy(messages=if(snapshot.active?.target==entry.target)mergeMessages(snapshot.messages,listOf(message)) else snapshot.messages))
                        if(saved.state==OutboxState.PENDING)submit(t,saved) else reconcile(saved.id)
                    } catch(_:Exception) {
                        store.update(entry.id) { it.copy(state=MediaUploadState.FAILED) }
                        finishUploadTarget(entry.target);emit()
                    }
                },onFailure={
                    store.update(entry.id) { it.copy(state=MediaUploadState.FAILED) }
                    finishUploadTarget(entry.target);emit()
                })
            }
        }
    }
    private fun finishUploadTarget(target:ChatTarget) {
        if(mediaUploads?.all()?.none { it.target==target&&it.state==MediaUploadState.UPLOADING }!=false)uploadingTargets.remove(target.conversationId)
    }
    fun sendMedia(media:LocalMedia,queued:(Boolean)->Unit={}):Boolean {
        if(media.kind in setOf(MediaKind.IMAGE,MediaKind.VIDEO))return enqueueVisualMedia(media,queued)
        var completed=false
        fun complete(saved:Boolean) { if(!completed) { completed=true;queued(saved) } }
        val active=snapshot.active ?: run { complete(false);return false }
        val t=ticket ?: run { complete(false);return false }
        val api=business ?: run { emit(snapshot.copy(error="文件上传服务尚未就绪"));complete(false);return false }
        if(!snapshot.ready||snapshot.uploading) { complete(false);return false }
        uploadingTargets.add(active.target.conversationId)
        emit(snapshot.copy(uploading=true,error=null))
        businessIO.execute {
            val uploaded=runCatching {
                ensureCanSend(active.target,api)
                var value=api.uploadMedia(media)
                if(media.kind==MediaKind.VIDEO&&media.snapshot!=null) {
                    val image=LocalMedia(media.snapshot,"snapshot.jpg","image/jpeg",MediaKind.IMAGE,width=media.width,height=media.height)
                    val cover=api.uploadMedia(image)
                    value=value.copy(thumbnail=cover.url)
                }
                value
            }
            dispatch {
                if(!current(t)) return@dispatch
                uploadingTargets.remove(active.target.conversationId)
                uploaded.fold(onSuccess={ value ->
                    var persisted=false
                    var persistedId:String?=null
                    try {
                        val message=gateway.createMedia(value,active.target)
                        val entry=outbox!!.put(active.target,message)
                        persisted=true;persistedId=entry.id
                        emit(snapshot.copy(uploading=false,messages=if(snapshot.active?.target==active.target) mergeMessages(snapshot.messages,listOf(message)) else snapshot.messages))
                        complete(true)
                        submit(t,entry)
                    } catch(_:Exception) {
                        persistedId?.let { id -> runCatching { outbox?.update(id,OutboxState.UNCERTAIN) } }
                        complete(persisted)
                        emit(snapshot.copy(uploading=false,error=if(persisted)"媒体已保存到待发箱，发送结果待核对，请勿重新上传。" else "媒体消息未提交，文件仍保留，可重试。"))
                    }
                },onFailure={ emit(snapshot.copy(uploading=false,error=it.message ?: "媒体上传未完成，可重试"));complete(false) })
            }
        }
        return true
    }
    fun sendFavorite(type:String,content:String,done:(Result<ChatMessage>)->Unit) {
        val t=ticket ?: return done(Result.failure(IllegalStateException("请先登录")))
        val active=snapshot.active ?: return done(Result.failure(IllegalStateException("目标会话已关闭")))
        try {
            require(type in setOf("text","emoji","image")) { "该收藏类型暂不支持发送" }
            check(snapshot.ready) { "聊天库暂未就绪" };ensureCanSend(active.target)
            val parsed=FavoriteContents.parse(type,content)
            val message=if(type=="image") {
                check(parsed.url.isNotEmpty()) { "收藏原图地址不可用" };gateway.createRemoteImage(parsed.url,active.target)
            } else { require(content.isNotBlank());gateway.createText(content,active.target) }
            val entry=outbox!!.put(active.target,message)
            emit(snapshot.copy(messages=mergeMessages(snapshot.messages,listOf(message))))
            submit(t,entry,done)
        } catch(error:Exception) { done(Result.failure(IllegalStateException(error.message ?: "收藏未提交"))) }
    }
    fun sendCard(businessId:String,nickname:String,avatar:String,done:(Result<ChatMessage>)->Unit) {
        val t=ticket ?: return done(Result.failure(IllegalStateException("请先登录")))
        val active=snapshot.active ?: return done(Result.failure(IllegalStateException("目标会话已关闭")))
        if(active.target.sessionType==3)return done(Result.failure(IllegalStateException("群内不可分享个人名片")))
        val api=business ?: return done(Result.failure(IllegalStateException("业务服务尚未就绪")))
        businessIO.execute {
            val resolved=runCatching { api.request("GET","/im/peers/$businessId").asJsonObject.string("imUserId").also { check(it.isNotEmpty()) { "名片用户暂不可用" } } }
            dispatch {
                if(!current(t))return@dispatch
                if(snapshot.active?.target!=active.target) { done(Result.failure(IllegalStateException("目标会话已改变，请重新选择")));return@dispatch }
                resolved.fold(onSuccess={ imId ->
                    try {
                        check(snapshot.ready);ensureCanSend(active.target)
                        val message=gateway.createCard(imId,businessId,nickname,avatar,active.target)
                        val entry=outbox!!.put(active.target,message)
                        emit(snapshot.copy(messages=mergeMessages(snapshot.messages,listOf(message))))
                        submit(t,entry,done)
                    } catch(error:Exception) { done(Result.failure(IllegalStateException(error.message ?: "名片未提交"))) }
                },onFailure={ done(Result.failure(it)) })
            }
        }
    }
    fun loadPicker(mode:String,keyword:String,tab:Int,page:Int,cursor:String,done:(Result<ChatPickerPage>)->Unit) {
        val t=ticket ?: return done(Result.failure(IllegalStateException("请先登录")))
        val api=business ?: return done(Result.failure(IllegalStateException("业务服务尚未就绪")))
        require(mode in setOf("card","favorite")&&page>=1&&tab in 0..4)
        businessIO.execute {
            val result=runCatching {
                val response=if(mode=="card")api.request("GET","/contacts",query=buildMap { put("limit","50");put("sort","recent");if(keyword.isNotBlank())put("keyword",keyword.trim());if(cursor.isNotEmpty())put("cursor",cursor) }) else api.request("POST","/favorites/list",jsonBody("type" to tab,"page" to page,"size" to 20))
                val values=if(response.isJsonArray)response.asJsonArray else response.asJsonObject.getAsJsonArray("items") ?: error("列表响应格式无效")
                val items=values.map { element ->
                    val raw=element.asJsonObject
                    val id=raw.string("id","ID");check(id.isNotEmpty()) { "列表项目标识缺失" }
                    if(mode=="card") {
                        val name=raw.string("nickname","Nickname")
                        ChatPickerItem(id,raw.string("remark","Remark").ifBlank { name },"card",avatar=raw.string("avatar","Avatar"),nickname=name)
                    } else {
                        val kind=raw.string("type");val content=raw.string("content")
                        val parsed=FavoriteContents.parse(kind,content)
                        val title=when(kind) { "text","emoji" -> content;"image" -> "图片";"video" -> "视频";"voice" -> "语音 ${parsed.duration}″";"file" -> parsed.fileName.ifBlank { "文件" };else -> "收藏" }
                        ChatPickerItem(id,title,kind,content)
                    }
                }
                val next=if(response.isJsonObject)response.asJsonObject.string("nextCursor") else ""
                val end=if(mode=="favorite")items.size<20 else if(response.isJsonArray)true else response.asJsonObject.field("hasMore")?.asBoolean!=true
                if(!end&&mode=="card")check(next.isNotEmpty()&&next!=cursor) { "联系人分页暂未推进，可重新搜索" }
                ChatPickerPage(items,page,next,end)
            }
            dispatch { if(current(t))done(result) }
        }
    }
    fun loadMentions(cursor:String,done:(Result<ChatMentionPage>)->Unit) {
        val t=ticket ?: return done(Result.failure(IllegalStateException("请先登录")))
        val active=snapshot.active ?: return done(Result.failure(IllegalStateException("会话已关闭")))
        if(active.target.sessionType!=3)return done(Result.failure(IllegalStateException("仅群聊支持提及")))
        val api=business ?: return done(Result.failure(IllegalStateException("业务服务尚未就绪")))
        businessIO.execute {
            val result=runCatching {
                val group=api.request("GET","/im/groups/by-im/${active.target.groupId}").asJsonObject
                val businessId=group.string("businessGroupId").also { check(it.isNotEmpty()) }
                val response=api.request("GET","/group-members",query=buildMap { put("groupId",businessId);put("limit","40");if(cursor.isNotEmpty())put("cursor",cursor) })
                val array=if(response.isJsonArray)response.asJsonArray else response.asJsonObject.getAsJsonArray("items") ?: error("成员列表格式无效")
                val members=array.map { it.asJsonObject }.mapNotNull { raw ->
                    val id=raw.string("id","ID");val im=businessUserId(id).takeIf(String::isNotEmpty)?.replace("-","") ?: id.takeIf { Regex("^[0-9a-f]{32}$").matches(it) } ?: return@mapNotNull null
                    if(im==ownIMId.replace("-",""))return@mapNotNull null
                    val publicName=raw.string("groupNickname","GroupNickname").ifBlank { raw.string("nickname","Nickname").ifBlank { "成员" } }
                    ChatMentionChoice(im,publicName,raw.string("displayName","DisplayName").ifBlank { raw.string("memberRemark","MemberRemark").ifBlank { publicName } },raw.string("avatar","Avatar"))
                }
                val next=if(response.isJsonObject)response.asJsonObject.string("nextCursor") else ""
                val end=response.isJsonArray||response.asJsonObject.field("hasMore")?.asBoolean!=true
                if(!end)check(next.isNotEmpty()&&next!=cursor) { "群成员分页暂未推进，请重试" }
                ChatMentionPage(members,next,end,group.string("role") in setOf("owner","admin"))
            }
            dispatch { if(current(t)&&snapshot.active?.target==active.target)done(result) }
        }
    }
    fun selectMention(choice:ChatMentionChoice,done:(Result<Unit>)->Unit) {
        val active=snapshot.active ?: return done(Result.failure(IllegalStateException("会话已关闭")))
        if(active.target.sessionType!=3)return done(Result.failure(IllegalStateException("仅群聊支持提及")))
        try {
            if(choice.userId=="AtAllTag") {
                val api=business ?: error("业务服务尚未就绪")
                check(api.request("GET","/im/groups/by-im/${active.target.groupId}").asJsonObject.string("role") in setOf("owner","admin")) { "仅群主或管理员可 @所有人" }
            } else require(Regex("^[0-9a-f]{32}$").matches(choice.userId)) { "成员标识无效" }
            emit(snapshot.copy(mentions=(snapshot.mentions+ChatMention(choice.userId,choice.name)).distinctBy { it.userId }))
            done(Result.success(Unit))
        } catch(error:Exception) { done(Result.failure(error)) }
    }
    fun deleteFavorite(id:String,done:(Result<Unit>)->Unit) {
        val t=ticket ?: return done(Result.failure(IllegalStateException("请先登录")))
        val api=business ?: return done(Result.failure(IllegalStateException("业务服务尚未就绪")))
        require(id.isNotEmpty()&&!id.contains('/'))
        businessIO.execute { val result=runCatching { api.request("DELETE","/favorites/$id");Unit };dispatch { if(current(t))done(result) } }
    }
    fun addSticker(media:LocalMedia,done:(Result<Unit>)->Unit) {
        val t=ticket ?: return done(Result.failure(IllegalStateException("请先登录")))
        val api=business ?: return done(Result.failure(IllegalStateException("业务服务尚未就绪")))
        require(media.kind==MediaKind.IMAGE)
        businessIO.execute {
            val result=runCatching {
                val uploaded=ChatMediaUploader.upload(api,media,"sticker")
                api.request("POST","/stickers",jsonBody("fileId" to uploaded.id))
                Unit
            }
            dispatch { if(current(t))done(result) }
        }
    }
    fun loadStickers(page:Int,done:(Result<ChatPickerPage>)->Unit) {
        val t=ticket ?: return done(Result.failure(IllegalStateException("请先登录")))
        val api=business ?: return done(Result.failure(IllegalStateException("业务服务尚未就绪")))
        require(page>=1)
        businessIO.execute {
            val result=runCatching {
                val response=api.request("GET","/stickers",query=mapOf("page" to page.toString(),"size" to "100"))
                val array=if(response.isJsonArray)response.asJsonArray else response.asJsonObject.getAsJsonArray("items") ?: error("表情列表响应无效")
                val values=array.map { raw ->
                    val value=raw.asJsonObject
                    val id=value.string("id").also { check(it.isNotEmpty()) { "表情标识缺失" } }
                    val url=MediaURLs.remote(value.string("url"),api.baseUrl).also { check(it.isNotEmpty()) { "表情地址暂不可用" } }
                    ChatPickerItem(id,"表情","image",url)
                }
                ChatPickerPage(values,page,end=values.size<100)
            }
            dispatch { if(current(t))done(result) }
        }
    }
    fun deleteSticker(id:String,done:(Result<Unit>)->Unit) {
        val t=ticket ?: return done(Result.failure(IllegalStateException("请先登录")))
        val api=business ?: return done(Result.failure(IllegalStateException("业务服务尚未就绪")))
        require(id.isNotBlank())
        businessIO.execute {
            val result=runCatching { api.request("POST","/stickers/delete",jsonBody("stickerIds" to JsonArray().apply { add(id) }));Unit }
            dispatch { if(current(t))done(result) }
        }
    }
    private fun resolvePeer(target:ChatTarget,api:ChatBusiness):String = if(target.sessionType==3) {
        val value=api.request("GET","/im/groups/by-im/${target.groupId}").asJsonObject
        value.string("businessGroupId").also { check(it.isNotEmpty()) { "群资料暂不可用" } }
    } else businessUserId(target.userId).also { check(it.isNotEmpty()) { "用户标识不可用" } }
    private fun ensureCanSend(target:ChatTarget,api:ChatBusiness?=business) {
        check(target.conversationId !in clearing) { "聊天记录正在清理，请稍后发送" }
        api ?: return
        val value=if(target.sessionType==3) api.request("GET","/im/groups/by-im/${target.groupId}") else api.request("GET","/im/peers/${businessUserId(target.userId)}")
        val info=value.asJsonObject
        check(info.field("canChat")?.asBoolean==true) { when(info.string("denyReason")) { "group_muted" -> "全群禁言中";"member_muted" -> "您已被禁言";"blocked" -> "当前会话无法发送消息";else -> "当前暂不能发送，请检查好友或群成员状态" } }
    }
    fun refreshSendPermission() {
        val t=ticket ?: return
        val active=snapshot.active ?: return
        val api=business ?: return
        val operation=++permissionOperation
        emit(snapshot.copy(permissionLoading=true))
        businessIO.execute {
            val result=runCatching {
                val path=if(active.target.sessionType==3)"/im/groups/by-im/${active.target.groupId}" else "/im/peers/${businessUserId(active.target.userId)}"
                api.request("GET",path).asJsonObject.also { check(it.field("canChat")?.isJsonPrimitive==true) { "聊天权限响应缺失" } }
            }
            dispatch {
                if(!current(t)||operation!=permissionOperation||snapshot.active?.target!=active.target) { return@dispatch }
                result.fold(onSuccess={ info ->
                    val reason=if(info.field("canChat")?.asBoolean==true)null else when(info.string("denyReason")) {
                        "group_muted" -> "全群禁言中";"member_muted" -> "您已被禁言";"blocked" -> "当前会话无法发送消息";"not_member" -> "您已不在该群聊";"group_inactive" -> "群聊已解散";else -> "当前暂不能发送，请检查好友或群成员状态"
                    }
                    emit(snapshot.copy(sendBlockedReason=reason,permissionLoading=false,groupRole=info.string("role")))
                    val until=runCatching { java.time.OffsetDateTime.parse(info.string("mutedUntil")).toInstant().toEpochMilli() }.getOrNull()
                    if(reason!=null&&until!=null&&until>System.currentTimeMillis())after((until-System.currentTimeMillis()+1000).coerceIn(1000,43_200_000)) { dispatch { if(current(t)&&operation==permissionOperation&&snapshot.active?.target==active.target)refreshSendPermission() } }
                    val groupId=info.string("businessGroupId")
                    if(active.target.sessionType==3&&groupId.isNotBlank()) {
                        emit(snapshot.copy(groupBusinessId=groupId))
                        businessIO.execute {
                            val detail=runCatching { api.request("GET","/groups/${java.net.URLEncoder.encode(groupId,"UTF-8")}").asJsonObject }
                            dispatch { if(current(t)&&operation==permissionOperation&&snapshot.active?.target==active.target)detail.onSuccess { value -> emit(snapshot.copy(groupMemberCount=value.number("memberCount").coerceAtLeast(0),groupAnnouncement=value.string("announcement").trim(),groupOwnerName=value.string("ownerName"))) } }
                        }
                    }
                },onFailure={ emit(snapshot.copy(permissionLoading=false,error="聊天权限暂未更新，发送前会重新校验。")) })
            }
        }
    }
    private fun pinPresentationKey(pin:PinnedChatMessage)="${pin.clientMsgID}|${pin.pinnedAt}|${pin.scope}"
    fun dismissPinnedBanner() {
        val active=snapshot.active ?: return
        val pin=active.pinnedMessage ?: return
        val store=presentation ?: return emit(snapshot.copy(error="显示偏好暂不可保存，请稍后重试"))
        runCatching { store.dismiss(active.target.conversationId,"pin",pinPresentationKey(pin)) }.fold(onSuccess={ emit() },onFailure={ emit(snapshot.copy(error="置顶横幅偏好暂未保存，请稍后重试")) })
    }
    fun dismissAnnouncementBanner() {
        val active=snapshot.active ?: return
        if(snapshot.groupAnnouncement.isBlank())return
        val store=presentation ?: return emit(snapshot.copy(error="显示偏好暂不可保存，请稍后重试"))
        runCatching { store.dismiss(active.target.conversationId,"announcement",snapshot.groupAnnouncement) }.fold(onSuccess={ emit() },onFailure={ emit(snapshot.copy(error="公告显示偏好暂未保存，请稍后重试")) })
    }
    fun loadVisibleGroupMembers(userIds:List<String>) {
        val t=ticket ?: return
        val active=snapshot.active ?: return
        if(active.target.sessionType!=3)return
        wantedMembers=userIds.filter { it.isNotBlank() }.distinct().take(100)
        if(membersLoading)return
        val missing=wantedMembers.filterNot { it in checkedMembers }
        if(missing.isEmpty())return
        membersLoading=true
        val operation=membersOperation
        gateway.groupMembers(active.target,missing) { result -> dispatch {
            if(!current(t)||operation!=membersOperation||snapshot.active?.target!=active.target)return@dispatch
            membersLoading=false
            result.onSuccess { values ->
                checkedMembers.addAll(missing)
                while(checkedMembers.size>500)checkedMembers.remove(checkedMembers.first())
                val next=(snapshot.groupMembers+values.filter { it.userId in missing }.associateBy { it.userId }).filterKeys { it in checkedMembers }
                emit(snapshot.copy(groupMembers=next))
                loadVisibleGroupMembers(wantedMembers)
            }
        } }
    }
    private fun preserveQuote(message:ChatMessage):ChatMessage {
        val api=business ?: return message
        val frozen=ForwardSnapshots.freeze(message.serialized)
        if(frozen.get("contentType").asInt==101) return message
        val safe=api.request("POST","/forward-media/preserve",jsonBody("sourceSnapshot" to frozen)).asJsonObject
        return message.copy(serialized=ForwardSnapshots.withSnapshot(message.serialized,safe))
    }
    fun loadMessageMenu(message:ChatMessage,done:(Result<ChatMessageMenu>)->Unit) {
        val t=ticket ?: return done(Result.failure(IllegalStateException("请先登录")))
        val active=snapshot.active ?: return done(Result.failure(IllegalStateException("会话已关闭")))
        if(message.mine) { done(Result.success(ChatMessageMenu(canRecall=true)));return }
        if(active.target.sessionType!=3) { done(Result.success(ChatMessageMenu()));return }
        val api=business ?: return done(Result.failure(IllegalStateException("业务服务尚未就绪")))
        val sender=MessageContents.parse(message.serialized,message.text).senderId
        if(sender.isBlank())return done(Result.success(ChatMessageMenu()))
        gateway.groupMember(active.target,sender) { found -> dispatch {
            if(!current(t)||snapshot.active?.target!=active.target)return@dispatch
            found.fold(onSuccess={ member ->
                businessIO.execute {
                    val result=runCatching {
                        val role=api.request("GET","/im/groups/by-im/${active.target.groupId}").asJsonObject.string("role")
                        val canManage=member?.role!="owner"&&(role=="owner"||(role=="admin"&&member?.role!="admin"))
                        ChatMessageMenu(canManage,member!=null,member?.muted==true,canManage,member?.name.orEmpty().ifBlank { message.sender })
                    }
                    dispatch { if(current(t)&&snapshot.active?.target==active.target)done(result) }
                }
            },onFailure={ done(Result.failure(it)) })
        } }
    }
    fun recallMessage(message:ChatMessage,reason:String,done:(Result<Unit>)->Unit)=performActionWithReason(message,ChatAction.RECALL,reason,done)
    fun performAction(message:ChatMessage,action:ChatAction,done:(Result<Unit>)->Unit)=performActionWithReason(message,action,"",done)
    private fun performActionWithReason(message:ChatMessage,action:ChatAction,recallReason:String,done:(Result<Unit>)->Unit) {
        val t=ticket ?: return done(Result.failure(IllegalStateException("请先登录")))
        val active=snapshot.active ?: return done(Result.failure(IllegalStateException("会话已关闭")))
        if(action==ChatAction.MENTION) {
            val content=MessageContents.parse(message.serialized,message.text)
            if(active.target.sessionType!=3||content.senderId.isBlank())return done(Result.failure(IllegalStateException("无法提及该成员")))
            emit(snapshot.copy(mentions=(snapshot.mentions+ChatMention(content.senderId,message.sender.ifBlank { "群成员" })).distinctBy { it.userId }))
            done(Result.success(Unit));return
        }
        if(action in setOf(ChatAction.OPEN_PIN,ChatAction.OPEN_MESSAGE)) {
            if(!boundaryReady(active.target))return done(Result.failure(IllegalStateException("群历史边界尚未校验，请稍后重试")))
            emit(snapshot.copy(focusMessageId=null))
            gateway.find(active.target,message.id) { result -> dispatch {
                if(!current(t)||snapshot.active?.target!=active.target)return@dispatch
                val found=result.getOrNull()
                if(found==null||!permits(active.target,found)||tombstones[found.id]==true)done(Result.failure(IllegalStateException("消息未同步到本机，或已不在可见范围")))
                else { emit(snapshot.copy(messages=mergeMessages(snapshot.messages,visible(listOf(found))),focusMessageId=found.id));done(Result.success(Unit)) }
            } };return
        }
        if(action in setOf(ChatAction.PIN_SELF,ChatAction.PIN_SHARED,ChatAction.UNPIN)) { pinAction(t,active,message,action,done);return }
        if(action==ChatAction.DELETE_LOCAL) {
            if(outbox?.all()?.any { it.id==message.id }==true) return done(Result.failure(IllegalStateException("该消息结果尚未确认，请先核对")))
            gateway.deleteLocal(active.target,message.id) { result -> dispatch {
                if(!current(t)) return@dispatch
                if(result.isSuccess) { tombstones[message.id]=true;if(snapshot.active?.target==active.target) emit(snapshot.copy(messages=visible(snapshot.messages))) }
                done(result)
            } };return
        }
        val api=business ?: return done(Result.failure(IllegalStateException("业务服务尚未就绪")))
        if(action==ChatAction.RECALL&&message.seq<=0) {
            // 发送回调可能先于 SDK 本地库的 seq 更新，按旧端流程重新定位正式消息。
            gateway.find(active.target,message.id) { found -> dispatch {
                if(!current(t)||snapshot.active?.target!=active.target)return@dispatch
                val resolved=found.getOrNull()?.takeIf { it.id==message.id&&it.seq>0 }
                if(resolved!=null)performActionWithReason(resolved,action,recallReason,done)
                else gateway.history(active.target,null,80) { recent -> dispatch {
                    if(!current(t)||snapshot.active?.target!=active.target)return@dispatch
                    val synced=recent.getOrNull()?.messages?.firstOrNull { it.id==message.id&&it.seq>0 }
                    if(synced!=null)performActionWithReason(synced,action,recallReason,done)
                    else done(Result.failure(IllegalStateException("消息发送结果尚未确认，请稍后重试")))
                } }
            } };return
        }
        if(action==ChatAction.RECALL&&message.seq>0) {
            // 乐观撤回：确认后立即本地呈现「[消息已撤回]」，服务端结果回来后确认或回滚（见 dispatch）。
            tombstones[message.id]=false
            if(snapshot.active?.target==active.target) emit(snapshot.copy(messages=visible(snapshot.messages)))
        }
        businessIO.execute {
            var refreshedPurges:List<GroupMessagePurge>?=null
            val result=runCatching {
                when(action) {
                    ChatAction.RECALL -> {
                        if(!message.mine) {
                            check(active.target.sessionType==3) { "只能撤回自己发送的消息" }
                            check(api.request("GET","/im/groups/by-im/${active.target.groupId}").asJsonObject.string("role") in setOf("owner","admin")) { "仅群主或管理员可撤回成员消息" }
                        }
                        check(message.seq>0) { "消息发送结果尚未确认" }
                        api.request("POST","/im/messages/recall",jsonBody("peerType" to if(active.target.sessionType==3) "group" else "c2c","peerId" to resolvePeer(active.target,api),"clientMsgId" to message.id,"seq" to message.seq,"reason" to if(message.mine)null else recallReason.trim().take(500).ifBlank { "管理员撤回" }))
                    }
                    ChatAction.FAVORITE -> {
                        val content=MessageContents.parse(message.serialized,message.text)
                        val kind=when(content.type) { 101,106,108,114 -> "text";102 -> "image";103 -> "voice";104 -> "video";105 -> "file";else -> error("该消息暂不支持收藏") }
                        val value=FavoriteContents.serialize(content)
                        check(value.isNotEmpty()) { "消息内容不可用" }
                        api.request("POST","/favorites",jsonBody("messageId" to message.id,"type" to kind,"content" to value,"senderId" to businessUserId(content.senderId).ifEmpty { content.senderId },"conversationId" to active.target.conversationId))
                    }
                    ChatAction.MUTE_10_MIN,ChatAction.MUTE_1_HOUR,ChatAction.MUTE_12_HOURS,ChatAction.MUTE_1_DAY,ChatAction.MUTE_7_DAYS,ChatAction.MUTE_30_DAYS,
                    ChatAction.UNMUTE,ChatAction.KICK,ChatAction.KICK_AND_DELETE,ChatAction.PURGE -> {
                        check(!message.mine&&active.target.sessionType==3) { "请选择其他群成员的消息" }
                        val group=api.request("GET","/im/groups/by-im/${active.target.groupId}").asJsonObject
                        check(group.string("role") in setOf("owner","admin")) { "仅群主或管理员可管理成员" }
                        val groupId=group.string("businessGroupId").also { check(it.isNotBlank()) { "群资料暂不可用" } }
                        val userId=businessUserId(MessageContents.parse(message.serialized,message.text).senderId).also { check(it.isNotEmpty()) { "成员标识无效" } }
                        when(action) {
                            ChatAction.KICK,ChatAction.KICK_AND_DELETE -> api.request("DELETE","/groups/$groupId/members/$userId",jsonBody("deleteMessages" to (action==ChatAction.KICK_AND_DELETE)))
                            ChatAction.PURGE -> {
                                val purge=api.request("POST","/group-members/purge-messages",jsonBody("groupId" to groupId,"memberUserId" to userId))
                                refreshedPurges=GroupPurges.parse(JsonArray().apply { add(purge) })
                            }
                            ChatAction.UNMUTE -> api.request("POST","/group-members/unmute",jsonBody("groupId" to groupId,"memberUserId" to userId))
                            else -> api.request("POST","/group-members/mute",jsonBody("groupId" to groupId,"memberUserId" to userId,"mutedSeconds" to action.muteSeconds()))
                        }
                        if(action==ChatAction.KICK_AND_DELETE) {
                            val response=runCatching { api.request("GET","/groups/$groupId/message-purges").asJsonObject }
                                .getOrElse { error("成员已移除，消息清理边界尚未同步，请刷新聊天，勿重复操作") }
                            refreshedPurges=GroupPurges.parse(response.getAsJsonArray("items") ?: error("成员已移除，消息清理边界响应缺失，请刷新聊天"))
                        }
                    }
                    else -> error("不支持的消息操作")
                }
            }
            dispatch {
                if(!current(t)) return@dispatch
                val persisted=runCatching { refreshedPurges?.let { purges?.merge(active.target.conversationId,it);conversationVisibilityDirty=true;emit(snapshot.copy(messages=visible(snapshot.messages))) } }
                if(persisted.isFailure) {
                    emit(snapshot.copy(error="服务端已处理成员消息，但本机清理边界暂未保存，请检查空间后刷新聊天。"))
                    done(Result.failure(IllegalStateException("服务端已处理，本机清理边界暂未保存，请检查空间后刷新，勿重复操作")))
                    return@dispatch
                }
                if(result.isSuccess&&action==ChatAction.RECALL) { tombstones[message.id]=false;outbox?.confirmed(message.id)
                    // 优先用 convLatest 实时缓存匹配会话预览（row.latestMessage 可能仍停留在旧消息）。
                    val rows=snapshot.conversations.map { row ->
                        val lm=convLatest[row.target.conversationId] ?: row.latestMessage
                        if(lm?.id==message.id) { val label=recallLabel(message,row.target);recalledConversation[row.target.conversationId]=label;row.copy(preview=label) } else row
                    }
                    if(snapshot.active?.target==active.target) emit(snapshot.copy(messages=visible(snapshot.messages),conversations=rows)) else if(rows!==snapshot.conversations) emit(snapshot.copy(conversations=rows))
                }
                if(result.isFailure&&action==ChatAction.RECALL) { tombstones.remove(message.id);emit(snapshot.copy(messages=visible(snapshot.messages.map { if(it.id==message.id) message else it }))) }
                done(result.map { Unit })
            }
        }
    }
    private fun applyPinned(target:ChatTarget,pinned:PinnedChatMessage?) {
        emit(snapshot.copy(active=snapshot.active?.let { if(it.target==target)it.copy(pinnedMessage=pinned) else it },conversations=snapshot.conversations.map { if(it.target==target)it.copy(pinnedMessage=pinned) else it }))
    }
    private fun pinAction(t:SessionTicket,active:ChatConversation,message:ChatMessage,action:ChatAction,done:(Result<Unit>)->Unit) {
        val shared=action==ChatAction.PIN_SHARED||(action==ChatAction.UNPIN&&active.pinnedMessage?.scope=="shared")
        val applyPin={
          try {
            val content=MessageContents.parse(message.serialized,message.text)
            val kind=when(content.type) { 102 -> "image";103 -> "voice";104 -> "video";105 -> "file";else -> "text" }
            val pinned=if(action==ChatAction.UNPIN)null else PinnedChatMessage(message.id,message.text.take(300),message.sender,kind,if(shared)"shared" else "self")
            gateway.pinMessage(active.target,pinned) { result -> dispatch {
                if(!current(t))return@dispatch
                if(result.isFailure) { done(result);return@dispatch }
                applyPinned(active.target,pinned)
                if(shared) {
                    try {
                        val sync=gateway.createPinSync(active.target,pinned,active.pinnedMessage)
                        val entry=outbox!!.put(active.target,sync)
                        submit(t,entry) { accepted -> done(accepted.map { Unit }) }
                    } catch(error:Exception) { done(Result.failure(IllegalStateException("本账号置顶已保存，共享同步尚未完成"))) }
                } else done(Result.success(Unit))
            } }
          } catch(error:Exception) { done(Result.failure(IllegalStateException(error.message ?: "置顶未完成"))) }
        }
        if(!shared) { applyPin();return }
        val api=business ?: return done(Result.failure(IllegalStateException("业务服务尚未就绪")))
        businessIO.execute {
            val permission=runCatching {
                ensureCanSend(active.target,api)
                if(active.target.sessionType==3) {
                    val role=api.request("GET","/im/groups/by-im/${active.target.groupId}").asJsonObject.string("role")
                    check(role in setOf("owner","admin")) { "仅群主和管理员可为全员置顶" }
                }
            }
            dispatch {
                if(!current(t))return@dispatch
                permission.fold(onSuccess={ applyPin() },onFailure={ done(Result.failure(it)) })
            }
        }
    }
    fun forward(message:ChatMessage,target:ChatConversation,done:(Result<Unit>)->Unit) {
        val t=ticket ?: return done(Result.failure(IllegalStateException("请先登录")))
        val source=snapshot.active ?: return done(Result.failure(IllegalStateException("会话已关闭")))
        val api=business ?: return done(Result.failure(IllegalStateException("业务服务尚未就绪")))
        val frozen=runCatching { ForwardSnapshots.freeze(message.serialized) }.getOrElse { return done(Result.failure(it)) }
        // 同一次操作使用固定幂等键；服务端任务负责目标权限、媒体持久化与失败重试。
        val key=UUID.randomUUID().toString()
        businessIO.execute {
            val result=runCatching {
                ensureCanSend(target.target,api)
                val messages=JsonArray().apply { add(jsonBody("sourceConversationId" to source.target.conversationId,"sourceClientMsgId" to message.id,"sourceSnapshot" to frozen)) }
                val ids=JsonArray().apply { add(resolvePeer(target.target,api)) }
                val body=jsonBody("messages" to messages,"idempotencyKey" to key)
                body.add(if(target.target.sessionType==3) "targetGroupIds" else "targetUserIds",ids)
                api.request("POST","/forward-batches",body)
            }
            dispatch { if(current(t)) done(result.map { Unit }) }
        }
    }
    fun loadForwardTargets(tab:String,keyword:String,cursor:String,offset:Int,done:(Result<ChatForwardPage>)->Unit) {
        val t=ticket ?: return done(Result.failure(IllegalStateException("请先登录")))
        val api=business ?: return done(Result.failure(IllegalStateException("业务服务尚未就绪")))
        require(tab in setOf("recent","contacts","groups","tags")&&offset>=0)
        if(tab=="recent") {
            gateway.conversations(offset,80) { result -> dispatch {
                if(!current(t))return@dispatch
                done(result.map { values -> ChatForwardPage(values.filter { it.target.supported()&&it.title.contains(keyword,true) }.map { item ->
                    ChatForwardTarget("r_${item.target.conversationId}",item.title,if(item.target.sessionType==3)"group" else "contact",item.avatar,businessUserId=if(item.target.sessionType==1)businessUserId(item.target.userId) else "",imGroupId=item.target.groupId)
                },nextOffset=offset+values.size,end=values.size<80) })
            } };return
        }
        businessIO.execute {
            val result=runCatching {
                val path=when(tab) { "contacts" -> "/contacts";"groups" -> "/groups";else -> "/contact-tags" }
                val response=api.request("GET",path,query=if(tab=="tags")emptyMap() else buildMap {
                    put("limit",if(tab=="contacts")"80" else "100");if(cursor.isNotEmpty())put("cursor",cursor)
                    if(tab=="contacts") { put("sort","recent");if(keyword.isNotBlank())put("keyword",keyword.trim()) }
                })
                val values=if(response.isJsonArray)response.asJsonArray else response.asJsonObject.getAsJsonArray("items") ?: error("转发目标列表格式无效")
                val items=values.map { it.asJsonObject }.filter { it.string("status")!="dismissed" }.map { raw ->
                    val id=raw.string("id","ID").also { check(it.isNotEmpty()) }
                    val name=raw.string("remark","Remark").ifBlank { raw.string("nickname","Nickname").ifBlank { raw.string("name","Name") } }
                    ChatForwardTarget("${tab}_$id",name,if(tab=="contacts")"contact" else if(tab=="groups")"group" else "tag",raw.string("avatar","Avatar"),businessUserId=if(tab=="contacts")id else "",businessGroupId=if(tab=="groups")id else "",tagId=if(tab=="tags")id else "")
                }.filter { tab=="contacts"||it.name.contains(keyword,true) }
                val next=if(response.isJsonObject)response.asJsonObject.string("nextCursor") else ""
                val end=response.isJsonArray||response.asJsonObject.field("hasMore")?.asBoolean!=true
                if(!end)check(next.isNotEmpty()&&next!=cursor) { "转发目标分页暂未推进，可重试" }
                ChatForwardPage(items,nextCursor=next,end=end,total=if(response.isJsonObject)response.asJsonObject.number("total").toInt() else items.size)
            }
            dispatch { if(current(t))done(result) }
        }
    }
    fun submitForward(messages:List<ChatMessage>,selection:ChatForwardSelection,done:(Result<ChatForwardResult>)->Unit,sourceConversationId:String="") {
        if(ticket==null||!snapshot.ready)return done(Result.failure(IllegalStateException("请先连接聊天")))
        val sourceId=sourceConversationId.ifBlank { snapshot.active?.target?.conversationId.orEmpty() }
        var acknowledged=false
        try {
            require(sourceId.isNotBlank()&&messages.isNotEmpty()&&messages.size<=100)
            messages.forEach { ForwardSnapshots.freeze(it.serialized) }
            require(selection.allFriends||selection.targets.isNotEmpty())
            val job=pendingForwards!!.put(sourceId,messages,selection)
            emit()
            acknowledged=true
            done(Result.success(ChatForwardResult(true,messages.size,selection.targets.size,listOf(job.id))))
            executeForwardJob(job)
        } catch(error:Exception) { if(!acknowledged)done(Result.failure(error)) else emit(snapshot.copy(error="转发未完成，请稍后重试。")) }
    }
    private fun executeForwardJob(job:PendingForward) {
        val messages=job.sources;val selection=job.selection;val sourceConversationId=job.sourceConversationId
        val store=pendingForwards ?: return
        if(!runningForwards.add(job.id))return
        fun done(result:Result<ChatForwardResult>) {
            runningForwards.remove(job.id)
            result.fold(onSuccess={ value -> store.update(job.id) { it.copy(status=if(value.queued)"processing" else "completed",remoteTaskIds=value.taskIds) } },onFailure={ error ->
                Log.w("ChatForward","forward ${job.id} failed stage=${store.all().firstOrNull { it.id==job.id }?.failureStage.orEmpty()}",error)
                store.update(job.id) { it.copy(status="failed",failureStage=it.failureStage.ifBlank { "prepare" },failureCode=failureCode(error)) }
            })
            emit()
            store.all().firstOrNull { it.id==job.id }?.let(::notifyForward)
        }
        announcedForwards.remove("failure:"+job.id)
        store.update(job.id) { it.copy(status="processing",failureStage="",failureCode=null) };emit()
        if(job.plan.isNotEmpty()) { resumeForwardPlan(job,store);return }

        val t=ticket ?: return done(Result.failure(IllegalStateException("请先登录")))
        val sourceId=sourceConversationId.ifBlank { snapshot.active?.target?.conversationId.orEmpty() }
        if(sourceId.isBlank())return done(Result.failure(IllegalStateException("原会话已关闭")))
        val api=business ?: return done(Result.failure(IllegalStateException("业务服务尚未就绪")))
        require(messages.isNotEmpty()&&messages.size<=100)
        val frozen=runCatching { messages.map { message -> message to ForwardSnapshots.freeze(message.serialized) } }.getOrElse { return done(Result.failure(it)) }
        val directTargets=selection.targets.filter { it.kind!="tag" }.distinctBy { it.kind+":"+it.businessUserId+it.businessGroupId+it.imGroupId }
        val direct=frozen.all { it.second.get("contentType").asInt in setOf(101,102,104) }&&!selection.allFriends&&selection.targets.none { it.kind=="tag" }&&directTargets.size in 1..12
        businessIO.execute {
            val resolved=runCatching {
                // 无标识的目标（如系统会话 imAdmin 映射不到业务 ID）自动跳过，不因单个目标阻塞整个转发。
                val usable=selection.targets.filter { when(it.kind) {
                    "contact" -> it.businessUserId.isNotEmpty()
                    "group" -> it.businessGroupId.isNotEmpty()||it.imGroupId.isNotEmpty()
                    "tag" -> it.tagId.isNotEmpty()
                    else -> false
                } }
                check(usable.isNotEmpty()) { "所选目标暂不可转发，请刷新后重试" }
                var skipped=0
                val users=linkedSetOf<String>();val groups=linkedSetOf<String>();val tags=linkedSetOf<String>()
                val targets=mutableListOf<Pair<String,Boolean>>()
                usable.forEach { item -> when(item.kind) {
                    "tag" -> { require(item.tagId.isNotEmpty());tags.add(item.tagId) }
                    "contact" -> {
                        require(item.businessUserId.isNotEmpty()) { "无法识别转发用户" }
                        if(direct) {
                            val peer=api.request("GET","/im/peers/${item.businessUserId}").asJsonObject
                            // 单个目标不可发送（解散/禁言/非好友）只跳过并记日志，不让整批转发失败。
                            if(peer.field("canChat")?.asBoolean==true) targets.add(peer.string("imUserId").also { check(it.isNotEmpty()) } to false)
                            else { skipped++;Log.w("ChatForward","skip peer ${item.businessUserId}: canChat=false") }
                        } else users.add(item.businessUserId)
                    }
                    "group" -> {
                        val group=runCatching {
                            if(item.businessGroupId.isNotEmpty())api.request("GET","/im/groups/${item.businessGroupId}").asJsonObject else api.request("GET","/im/groups/by-im/${item.imGroupId}").asJsonObject
                        }.getOrElse {
                            skipped++;Log.w("ChatForward","skip group ${item.businessGroupId.ifEmpty { item.imGroupId }}: ${it.message}")
                            return@forEach
                        }
                        val id=group.string("businessGroupId")
                        if(id.isEmpty()) { skipped++;Log.w("ChatForward","skip group ${item.businessGroupId.ifEmpty { item.imGroupId }}: 群已解散或不可用");return@forEach }
                        groups.add(id)
                        if(direct) {
                            if(group.field("canChat")?.asBoolean==true) targets.add(group.string("imGroupId").also { check(it.isNotEmpty()) } to true)
                            else { skipped++;Log.w("ChatForward","skip group $id: canChat=false") }
                        }
                    }
                    else -> error("转发目标类型无效")
                } }
                if(direct) {
                    check(targets.isNotEmpty()) { "所选目标均不可发送（群已解散、被禁言或已非好友），请重新选择" }
                    // 归档(preserve)后移：气泡先上屏（原始快照命中本地缓存），后台归档成功后在发送前替换为远端副本 URL（见 archiveForwardMedia）。
                    Triple(targets.distinct(),frozen,null)
                } else {
                    check(selection.allFriends||users.isNotEmpty()||groups.isNotEmpty()||tags.isNotEmpty()) { "请选择转发目标" }
                    fun array(ids:Iterable<String>)=JsonArray().apply { ids.forEach(::add) }
                    val sources=JsonArray().apply { frozen.forEach { (message,body) -> add(jsonBody("sourceConversationId" to sourceId,"sourceClientMsgId" to message.id,"sourceSnapshot" to body)) } }
                    val body=jsonBody("messages" to sources,"idempotencyKey" to job.idempotencyKey,"targetUserIds" to array(users),"targetGroupIds" to array(groups))
                    if(selection.allFriends) {
                        body.add("selector",jsonBody("mode" to "all_friends"))
                        body.add("excludeUserIds",array(selection.excludedUserIds))
                    } else if(tags.isNotEmpty()) {
                        body.add("selector",jsonBody("mode" to "tags","tagIds" to array(tags)))
                    }
                    val accepted=api.request("POST","/forward-batches",body).asJsonObject
                    val taskIds=accepted.getAsJsonArray("taskIds")?.map { it.asString }.orEmpty()
                    check(accepted.string("status")=="queued"&&taskIds.isNotEmpty()) { "转发结果尚未确认，请稍后重试。" }
                    Triple(emptyList<Pair<String,Boolean>>(),frozen,ChatForwardResult(true,messages.size,selection.targets.size,taskIds))
                }
            }
            dispatch {
                if(!current(t)) { return@dispatch }
                resolved.fold(onSuccess={ (targets,sources,queued) ->
                    if(queued!=null) {
                        done(Result.success(queued))
                        businessIO.execute { warmForwardTasks(t,api,job,queued.taskIds) }
                        listOf(1_000L,3_000L,10_000L,20_000L,40_000L,60_000L).forEach { delay -> after(delay) { dispatch {
                            if(current(t)&&pendingForwards===store&&store.all().any { it.id==job.id&&it.status=="processing" })businessIO.execute { warmForwardTasks(t,api,job,queued.taskIds,finalAttempt=delay==60_000L) }
                        } } }
                        return@fold
                    }
                    // 全部目标并发解析，任一失败即整体失败；解析完成后立即落盘并提交，不按人数串行累积往返。
                    val resolvedPeers=java.util.concurrent.ConcurrentHashMap<Int,ChatConversation>()
                    val peerFailures=java.util.concurrent.ConcurrentLinkedQueue<Throwable>()
                    targets.forEachIndexed { index,(imId,group) ->
                        gateway.peer(imId,group) { peer -> dispatch {
                            if(!current(t))return@dispatch
                            peer.fold(onSuccess={ conversation ->
                                resolvedPeers[index]=conversation
                                if(resolvedPeers.size==targets.size&&peerFailures.isEmpty()) {
                                    try {
                                        val planned=targets.indices.flatMap { position -> val conversation=resolvedPeers[position]!!;sources.map { (message,body) -> PreparedForward(conversation.target,gateway.createForward(message,body,conversation.target),sourceId=message.id) } }
                                        store.update(job.id) { it.copy(plan=planned) }
                                        val mediaSources=sources.filter { it.second.get("contentType").asInt in setOf(102,104) }
                                        dispatchForwardPlan(t,job.id,planned,store,mediaSources,api)
                                    } catch(error:Exception) { done(Result.failure(error)) }
                                }
                            },onFailure={ error -> if(peerFailures.isEmpty()&&resolvedPeers.size<targets.size) { peerFailures.add(error);done(Result.failure(error)) } })
                        } }
                    }
                },onFailure={ done(Result.failure(it)) })
            }
        }
    }
    private fun remoteForwardProgress(raw:JsonObject,id:String,job:PendingForward?=null,index:Int=0):ChatForwardProgress {
        fun unconfirmed()=ChatForwardProgress(id,"uncertain",0,0,0,0)
        if(raw.string("id")!=id)return unconfirmed()
        if(job!=null&&(raw.string("sourceConversationId")!=job.sourceConversationId||raw.string("sourceClientMsgId")!=job.sources.getOrNull(index)?.id))return unconfirmed()
        val names=listOf("targetCount","successCount","failedCount","skippedCount","cancelledCount","pendingCount","processingCount")
        val counts=names.map { name -> runCatching { raw.get(name)?.takeIf { it.isJsonPrimitive&&it.asJsonPrimitive.isNumber }?.asBigDecimal?.longValueExact() }.getOrNull() ?: return unconfirmed() }
        if(counts.any { it<0||it>Int.MAX_VALUE }||counts.drop(1).sum()!=counts[0]||counts[0]==0L)return unconfirmed()
        val (total,success,failed)=counts
        val status=when(raw.string("status")) {
            "completed" -> if(success==total&&counts.drop(2).all { it==0L })"completed" else "uncertain"
            "failed","partially_completed","cancelled","paused" -> "failed"
            "draft","expanding","pending","processing" -> "processing"
            else -> "uncertain"
        }
        return ChatForwardProgress(id,status,total.toInt(),success.toInt(),failed.toInt(),(counts[5]+counts[6]).toInt())
    }
    private fun warmForwardTasks(t:SessionTicket,api:ChatBusiness,job:PendingForward,ids:List<String>,finalAttempt:Boolean=false) {
        val states=ids.mapIndexed { index,id ->
            if(!current(t))return
            runCatching {
                val task=api.request("GET","/forward-task-progress",query=mapOf("taskId" to id)).asJsonObject
                val progress=remoteForwardProgress(task,id,job,index)
                if(progress.status!="uncertain"&&current(t)) {
                    val preserved=task.get("sourceSnapshot")?.takeIf { it.isJsonObject }?.asJsonObject
                    if(preserved!=null)runCatching { api.rememberForwardMedia(job.sources[index],preserved) }
                }
                progress.status
            }.getOrDefault("uncertain")
        }
        dispatch { if(current(t)) {
            val completeCoverage=ids.size==job.sources.size&&ids.distinct().size==ids.size&&ids.isNotEmpty()
            val status=when {
                !completeCoverage -> if(finalAttempt)"uncertain" else "processing"
                states.any { it=="failed" } -> "failed"
                states.all { it=="completed" } -> "completed"
                finalAttempt -> "uncertain"
                else -> "processing"
            }
            // 同时发起的较早查询不得把已确认完成的任务降回处理中。
            pendingForwards?.update(job.id) { if(it.status=="completed"||status=="processing"&&it.status in setOf("failed","uncertain"))it else it.copy(status=status,failureStage=when(status) { "failed"->"server";"uncertain"->"server_unconfirmed";else->"" }) }?.let(::notifyForward);emit()
        } }
    }
    /** 转发秒完成：条目落待发箱后立即开始提交；媒体归档仅作后台优化（成功后为未提交条目换归档 URL 并预热缓存），不阻塞提交。 */
    private fun dispatchForwardPlan(t:SessionTicket,id:String,plan:List<PreparedForward>,store:PendingForwards,mediaSources:List<Pair<ChatMessage,JsonObject>> = emptyList(),api:ChatBusiness? = null) {
        try {
            // 全部消息先写待发箱，随后可并行等待 ACK，避免按人数累加网络往返。
            val entries=plan.filterNot { it.accepted }.map { item -> outbox?.all()?.firstOrNull { it.id==item.message.id } ?: outbox!!.put(item.target,item.message) }
            emit(snapshot.copy(messages=mergeMessages(snapshot.messages,entries.filter { it.target==snapshot.active?.target }.map { it.message })))
            // 先提交后归档：提交循环同步走完（attempted 全部落定），归档 settle 必然能读到最终提交状态。
            submitStagedForwardPlan(t,id,store,entries)
            if(mediaSources.isNotEmpty()&&api!=null)archiveForwardMedia(t,api,id,plan,mediaSources,store,entries)
        } catch(_:Exception) { store.update(id) { it.copy(status="failed",failureStage="outbox") }?.let(::notifyForward);runningForwards.remove(id);emit() }
    }
    private fun submitStagedForwardPlan(t:SessionTicket,id:String,store:PendingForwards,entries:List<OutboxEntry>) {
        try {
            entries.groupBy { it.target }.values.forEach { targetEntries ->
                var index=0
                fun next() {
                    if(!current(t)||pendingForwards!==store||index>=targetEntries.size)return
                    val entry=targetEntries[index++]
                    store.update(id) { job -> job.copy(plan=job.plan.map { if(it.message.id==entry.id)it.copy(attempted=true) else it }) }
                    submit(t,entry) { result ->
                        if(!current(t)||pendingForwards!==store)return@submit
                        store.update(id) { job ->
                            val items=job.plan.map { if(it.message.id==entry.id&&result.isSuccess)it.copy(accepted=true) else it }
                            val failed=outbox?.all()?.firstOrNull { it.id==entry.id }?.state==OutboxState.FAILED
                            job.copy(plan=items,status=if(items.all { it.accepted })"completed" else if(result.isFailure)if(failed)"failed" else "uncertain" else job.status,failureStage=if(result.isFailure)"sdk" else job.failureStage,failureCode=if(result.isFailure)failureCode(result.exceptionOrNull()) else job.failureCode)
                        }
                        if(store.all().firstOrNull { it.id==id }?.status in setOf("completed","failed","uncertain"))runningForwards.remove(id)
                        emit()
                        store.all().firstOrNull { it.id==id }?.let(::notifyForward)
                        if(result.isSuccess)next()
                    }
                }
                next()
            }
            if(entries.isEmpty()) { store.update(id) { it.copy(status="completed") }?.let(::notifyForward);runningForwards.remove(id);emit() }
        } catch(_:Exception) { store.update(id) { it.copy(status="failed",failureStage="outbox") }?.let(::notifyForward);runningForwards.remove(id);emit() }
    }
    /** direct 转发秒显示：气泡已上屏（原始快照），后台归档源媒体；成功则发送前把 payload 换成远端副本 URL，失败降级用原始 URL 发送，均不阻塞用户。 */
    private fun archiveForwardMedia(t:SessionTicket,api:ChatBusiness,id:String,plan:List<PreparedForward>,mediaSources:List<Pair<ChatMessage,JsonObject>>,store:PendingForwards,entries:List<OutboxEntry>) {
        val archivedBySource=java.util.concurrent.ConcurrentHashMap<String,JsonObject>()
        val failedSources=java.util.Collections.newSetFromMap(java.util.concurrent.ConcurrentHashMap<String,Boolean>())
        val remaining=java.util.concurrent.atomic.AtomicInteger(mediaSources.size)
        fun settle() { if(remaining.decrementAndGet()!=0)return;dispatch {
            if(!current(t)||pendingForwards!==store)return@dispatch
            // 以最新持久化 plan 为准：提交阶段会就地把 attempted 置真，入参快照可能已过时。
            val latest=store.all().firstOrNull { it.id==id }?.plan ?: return@dispatch
            val updated=latest.map { item ->
                val archived=item.sourceId?.let { archivedBySource[it] }
                val related=item.sourceId!=null&&(item.sourceId in failedSources||archivedBySource.containsKey(item.sourceId))
                when {
                    // 已提交(attempted)的条目 payload 保持发出时的原始 URL，仅标记归档已处理。
                    archived!=null -> runCatching { if(item.attempted)item.copy(archived=true) else item.copy(message=item.message.copy(serialized=ForwardSnapshots.withSnapshot(item.message.serialized,archived)),archived=true) }.getOrElse { item.copy(archived=true) }
                    related -> item.copy(archived=true)
                    else -> item
                }
            }
            store.update(id) { it.copy(plan=updated) }
            // 仅替换仍未提交（PENDING）的条目：已发出的消息不再改动，alias 让显示端与下次转发命中缓存。
            entries.forEach { entry ->
                val next=updated.firstOrNull { it.message.id==entry.id }
                val live=outbox?.all()?.firstOrNull { it.id==entry.id }
                if(next!=null&&live!=null&&live.state==OutboxState.PENDING&&next.message.serialized!=live.message.serialized)outbox?.update(entry.id,live.state,next.message)
            }
            emit()
        } }
        mediaSources.forEach { (message,body) ->
            businessIO.execute {
                val archived=runCatching {
                    val preserved=api.request("POST","/forward-media/preserve",jsonBody("sourceSnapshot" to body)).asJsonObject
                    check(preserved.get("contentType")?.asInt==body.get("contentType").asInt) { "媒体转发副本格式无效" }
                    preserved
                }.getOrNull()
                if(archived!=null) {
                    runCatching { api.rememberForwardMedia(message,archived) }
                    archivedBySource[message.id]=archived
                } else failedSources.add(message.id)
                settle()
            }
        }
    }
    private fun resumeForwardPlan(job:PendingForward,store:PendingForwards) {
        val t=ticket ?: return
        val api=business ?: return
        businessIO.execute {
            val permitted=runCatching { job.plan.map { it.target }.distinct().forEach { ensureCanSend(it,api) } }
            dispatch {
                if(!current(t)||pendingForwards!==store)return@dispatch
                if(permitted.isSuccess)resumeForwardPlanVerified(job,store)
                else { store.update(job.id) { it.copy(status="failed",failureStage="permission",failureCode=failureCode(permitted.exceptionOrNull())) }?.let(::notifyForward);runningForwards.remove(job.id);emit() }
            }
        }
    }
    private fun resumeForwardPlanVerified(job:PendingForward,store:PendingForwards) {
        val t=ticket ?: return
        var index=0
        fun repairUnsubmittedImage(item:PreparedForward):Boolean {
            return try {
                if(MessageContents.parse(item.message.serialized).type==102) {
                    // 旧版已准备但明确未成功的消息沿用原 ID 和归档地址，仅补齐图片规格契约。
                    val repaired=item.copy(message=item.message.copy(serialized=ForwardSnapshots.withSnapshot(item.message.serialized,ForwardSnapshots.freeze(item.message.serialized))))
                    store.update(job.id) { old -> old.copy(plan=old.plan.map { if(it.message.id==item.message.id)repaired else it }) }
                    outbox?.all()?.firstOrNull { it.id==item.message.id }?.let { outbox?.update(it.id,it.state,repaired.message) }
                }
                true
            } catch(error:Exception) {
                store.update(job.id) { it.copy(status="failed",failureStage="prepare",failureCode=failureCode(error)) }?.let(::notifyForward)
                runningForwards.remove(job.id);emit();false
            }
        }
        fun next() {
            if(!current(t)||pendingForwards!==store)return
            // 归档补跑会原地更新 plan payload，迭代必须读最新持久化状态而非启动时的快照。
            val plan=store.all().firstOrNull { it.id==job.id }?.plan ?: return
            if(index>=plan.size) {
                dispatchForwardPlan(t,job.id,plan,store);return
            }
            val item=plan[index++]
            if(item.accepted) { next();return }
            if(!item.attempted) { if(repairUnsubmittedImage(item))next();return }
            gateway.find(item.target,item.message.id) { result -> dispatch {
                if(!current(t)||pendingForwards!==store)return@dispatch
                val found=result.getOrNull()
                if(found!=null&&(found.status==2||found.seq>0)) {
                    acceptEvidence(found)
                    store.update(job.id) { old -> old.copy(plan=old.plan.map { if(it.message.id==item.message.id)it.copy(accepted=true) else it }) }
                    next()
                } else if(found?.status==3) {
                    outbox?.all()?.firstOrNull { it.id==item.message.id }?.let { old ->
                        if(old.state==OutboxState.SENDING)outbox?.update(old.id,OutboxState.UNCERTAIN)
                        outbox?.update(old.id,OutboxState.FAILED)
                    }
                    if(repairUnsubmittedImage(item))next()
                } else {
                    store.update(job.id) { it.copy(status="uncertain",failureStage="reconcile",failureCode=failureCode(result.exceptionOrNull())) }?.let(::notifyForward);runningForwards.remove(job.id);emit()
                }
            } }
        }
        // 归档已是纯后台优化：恢复路径直接以已存 payload 提交（多数条目在归档完成前已按原始 URL 发出，与降级语义一致）。
        next()
    }
    fun loadFavoriteSource(messageId:String,conversationId:String,done:(Result<ChatMessage>)->Unit) {
        val t=ticket ?: return done(Result.failure(IllegalStateException("请先登录")))
        allConversations(t) { result -> result.fold(onSuccess={ conversations ->
            val conversation=conversations.firstOrNull { it.target.conversationId==conversationId }
            if(conversation==null) { done(Result.failure(IllegalStateException("请回到聊天同步原消息后转发")));return@fold }
            gateway.find(conversation.target,messageId) { found -> dispatch {
                if(!current(t))return@dispatch
                val message=found.getOrNull()
                if(message==null)done(Result.failure(IllegalStateException("请回到聊天同步原消息后转发")))
                else if(!boundaryReady(conversation.target)||!permits(conversation.target,message)||tombstones[message.id]==true)done(Result.failure(IllegalStateException("原消息已不在聊天可见范围；收藏快照仍保留")))
                else done(Result.success(message))
            } }
        },onFailure={ done(Result.failure(it)) }) }
    }
    fun forwardProgress(taskIds:List<String>,done:(Result<List<ChatForwardProgress>>)->Unit) {
        val t=ticket ?: return done(Result.failure(IllegalStateException("请先登录")))
        val api=business ?: return done(Result.failure(IllegalStateException("业务服务尚未就绪")))
        require(taskIds.size in 1..100)
        businessIO.execute {
            val result=runCatching { taskIds.map { id ->
                if(id.startsWith("local-forward-")) {
                    val local=pendingForwards?.all()?.firstOrNull { it.id==id } ?: error("本地转发记录不存在")
                    if(local.remoteTaskIds.isEmpty())return@map local.progress()
                    val values=local.remoteTaskIds.mapIndexed { index,remote -> remoteForwardProgress(api.request("GET","/forward-task-progress",query=mapOf("taskId" to remote)).asJsonObject,remote,local,index) }
                    val covered=local.remoteTaskIds.size==local.sources.size&&local.remoteTaskIds.distinct().size==local.remoteTaskIds.size
                    val status=when { !covered||values.any { it.status=="uncertain" } -> "uncertain";values.any { it.status=="failed" } -> "failed";values.all { it.status=="completed" } -> "completed";else -> "processing" }
                    return@map ChatForwardProgress(id,status,values.sumOf { it.total },values.sumOf { it.success },values.sumOf { it.failed },values.sumOf { it.pending })
                }
                val raw=api.request("GET","/forward-task-progress",query=mapOf("taskId" to id)).asJsonObject
                remoteForwardProgress(raw,id)
            } }
            dispatch { if(current(t)) {
                result.getOrNull()?.filter { it.id.startsWith("local-forward-")&&it.status in setOf("completed","failed","uncertain") }?.forEach { progress -> pendingForwards?.update(progress.id) { if(it.status=="completed")it else it.copy(status=progress.status,failureStage=when(progress.status) { "failed"->"server";"uncertain"->"server_unconfirmed";else->"" }) }?.let(::notifyForward) }
                emit();done(result)
            } }
        }
    }
    fun forwardTaskAction(taskId:String,action:String,done:(Result<Unit>)->Unit) {
        val t=ticket ?: return done(Result.failure(IllegalStateException("请先登录")))
        if(taskId.startsWith("local-forward-")) {
            val store=pendingForwards ?: return done(Result.failure(IllegalStateException("转发记录暂不可读")))
            val job=store.all().firstOrNull { it.id==taskId } ?: return done(Result.failure(IllegalStateException("转发记录不存在")))
            if(job.remoteTaskIds.isEmpty()) {
                if(action in setOf("resume","retry")&&job.status in setOf("failed","uncertain")) { executeForwardJob(job);done(Result.success(Unit)) }
                else done(Result.failure(IllegalStateException("任务正在处理，请稍后核对")))
                return
            }
            businessIO.execute {
                val result=runCatching { val api=business ?: error("请先登录");job.remoteTaskIds.forEach { remote -> api.request("POST","/forward-tasks/$action",jsonBody("taskId" to remote,"onlyFailed" to if(action=="retry")true else null)) };Unit }
                dispatch { if(current(t))done(result) }
            }
            return
        }
        val api=business ?: return done(Result.failure(IllegalStateException("业务服务尚未就绪")))
        require(action in setOf("pause","resume","retry","cancel"))
        businessIO.execute {
            val result=runCatching { api.request("POST","/forward-tasks/$action",jsonBody("taskId" to taskId,"onlyFailed" to if(action=="retry")true else null));Unit }
            dispatch { if(current(t))done(result) }
        }
    }
    fun setConversation(pinned:Boolean?=null,muted:Boolean?=null,done:(Result<Unit>)->Unit) {
        val active=snapshot.active ?: return
        updateConversation(active,pinned,muted,done)
    }
    fun updateConversation(conversation:ChatConversation,pinned:Boolean?=null,muted:Boolean?=null,done:(Result<Unit>)->Unit) {
        val t=ticket ?: return done(Result.failure(IllegalStateException("请先登录")))
        gateway.setConversation(conversation.target,pinned,muted) { result -> dispatch {
            if(!current(t)) return@dispatch
            if(result.isSuccess) {
                val current=snapshot.conversations.firstOrNull { it.target==conversation.target } ?: conversation
                val updated=current.copy(pinned=pinned ?: current.pinned,muted=muted ?: current.muted)
                emit(snapshot.copy(active=if(snapshot.active?.target==conversation.target)updated else snapshot.active,conversations=mergeConversations(snapshot.conversations,listOf(updated),authoritative=true)))
            }
            done(result)
        } }
    }
    fun hideConversation(conversation:ChatConversation,done:(Result<Unit>)->Unit) {
        val t=ticket ?: return done(Result.failure(IllegalStateException("请先登录")))
        if(outbox?.all()?.any { it.target==conversation.target }==true)return done(Result.failure(IllegalStateException("会话仍有待核对消息，请先核对")))
        gateway.hideConversation(conversation.target) { result -> dispatch {
            if(!current(t))return@dispatch
            if(result.isSuccess) {
                pageGeneration++;conversationOperation++
                if(snapshot.active?.target==conversation.target) { roomGeneration++;cursor=null }
                emit(snapshot.copy(conversations=snapshot.conversations.filterNot { it.target==conversation.target },conversationsLoading=false,active=if(snapshot.active?.target==conversation.target)null else snapshot.active,messages=if(snapshot.active?.target==conversation.target)emptyList() else snapshot.messages))
            }
            done(result)
        } }
    }
    fun markConversationRead(conversation:ChatConversation,done:(Result<Unit>)->Unit) {
        val t=ticket ?: return done(Result.failure(IllegalStateException("请先登录")))
        val target=conversation.target
        gateway.markRead(target) { result -> dispatch {
            if(!current(t))return@dispatch
            if(result.isFailure) { done(result);return@dispatch }
            emit(snapshot.copy(conversations=snapshot.conversations.map { if(it.target==target)it.copy(unread=0) else it }))
            val api=business
            if(target.sessionType!=3||api==null) { done(Result.success(Unit));return@dispatch }
            businessIO.execute {
                val report=runCatching { api.request("POST","/im/group-read-cursors/report",jsonBody("conversationId" to target.conversationId));Unit }
                dispatch { if(current(t))done(report) }
            }
        } }
    }
    private fun markRoomRead() {
        val t=ticket ?: return
        val target=snapshot.active?.target ?: return
        if(!boundaryReady(target))return
        val now=System.currentTimeMillis()
        if(now-(readMarkedAt[target.conversationId]?:0)<300)return
        readMarkedAt[target.conversationId]=now
        gateway.markRead(target) { result -> dispatch {
            if(!current(t)||snapshot.active?.target!=target) return@dispatch
            if(result.isSuccess) emit(snapshot.copy(conversations=snapshot.conversations.map { if(it.target==target)it.copy(unread=0) else it }))
        } }
        val api=business ?: return
        if(target.sessionType!=3) return
        if(target.conversationId in readReporting||now-(readReported[target.conversationId] ?: 0)<2_000) return
        readReporting.add(target.conversationId)
        businessIO.execute {
            val state=runCatching {
                api.request("POST","/im/group-read-cursors/report",jsonBody("conversationId" to target.conversationId))
                api.request("GET","/im/group-read-state",query=mapOf("conversationId" to target.conversationId)).asJsonObject.number("maxOtherReadSeq")
            }
            dispatch {
                if(!current(t))return@dispatch
                readReporting.remove(target.conversationId)
                if(state.isSuccess)readReported[target.conversationId]=System.currentTimeMillis()
                if(snapshot.active?.target==target) state.getOrNull()?.let { emit(snapshot.copy(maxOtherReadSeq=maxOf(snapshot.maxOtherReadSeq,it))) }
            }
        }
    }
    private fun refreshRetention(items:List<ChatConversation>) {
        val t=ticket ?: return
        val api=business ?: return
        val ids=items.filter { it.target.sessionType==3 }.map { it.target.conversationId }.filter { GroupRetention.supported(it)&&it !in retentionInFlight&&System.currentTimeMillis()-(retentionFresh[it] ?: 0)>15_000 }.distinct()
        ids.chunked(50).forEach { batch ->
            retentionInFlight.addAll(batch)
            businessIO.execute {
                val result=runCatching {
                    val response=api.request("GET","/im/group-retention/states",query=mapOf("conversationIds" to batch.joinToString(","))).asJsonObject
                    GroupRetention.parse(response.getAsJsonArray("items") ?: error("群历史边界响应缺失"),batch.toSet())
                }
                dispatch {
                    if(!current(t)) return@dispatch
                    retentionInFlight.removeAll(batch.toSet())
                    result.fold(onSuccess={ states ->
                        retention?.merge(states)
                        conversationVisibilityDirty=true
                        retentionRefreshNeedsRead=true
                        historyChecks?.mark(batch)
                        batch.forEach { retentionFresh[it]=System.currentTimeMillis() }
                        retentionChecked.addAll(batch)
                        emit(snapshot.copy(messages=visible(snapshot.messages),historySyncing=false))
                        if(snapshot.active?.target?.conversationId in batch)loadHistory()
                    },onFailure={
                        // 已验证的本地边界继续生效；后台刷新失败保留诊断，避免打断浏览。
                        batch.forEach { retentionFresh[it]=System.currentTimeMillis() }
                        val active=snapshot.active?.target
                        val blocked=active?.conversationId in batch&&active!=null&&!boundaryReady(active)
                        emit(snapshot.copy(historyDiagnostic="群历史边界刷新失败",historySyncing=false,error=if(blocked)"暂时无法读取此群历史，请稍后重试。" else snapshot.error))
                    })
                    // 所有分批边界校验共用一次完整本地重读，避免每 50 个群触发全表扫描。
                    if(retentionInFlight.isEmpty()&&retentionRefreshNeedsRead) {retentionRefreshNeedsRead=false;loadConversations(true)}
                }
            }
        }
    }
    private fun refreshRetentionPriority(target:ChatTarget) {
        val t=ticket ?: return
        val api=business ?: return
        val id=target.conversationId
        if(target.sessionType!=3||!GroupRetention.supported(id)||boundaryReady(target)||id in priorityRetention)return
        priorityRetention.add(id)
        priorityIO.execute {
            val result=runCatching {
                val response=api.request("GET","/im/group-retention/states",query=mapOf("conversationIds" to id)).asJsonObject
                GroupRetention.parse(response.getAsJsonArray("items") ?: error("群历史边界响应缺失"),setOf(id))
            }
            dispatch {
                priorityRetention.remove(id)
                if(!current(t))return@dispatch
                result.fold(onSuccess={ states ->
                    retention?.merge(states)
                    conversationVisibilityDirty=true
                    retentionRefreshNeedsRead=true
                    historyChecks?.mark(listOf(id))
                    retentionFresh[id]=System.currentTimeMillis()
                    retentionChecked.add(id)
                    PerfLog.mark("room:boundary-ok","id=$id")
                    emit(snapshot.copy(messages=visible(snapshot.messages),historySyncing=false))
                    if(snapshot.active?.target?.conversationId==id)loadHistory()
                },onFailure={
                    retentionFresh[id]=System.currentTimeMillis()
                    if(snapshot.active?.target?.conversationId==id)emit(snapshot.copy(historyDiagnostic="群历史边界刷新失败",historySyncing=false,error="暂时无法读取此群历史，请稍后重试。"))
                })
            }
        }
    }
    private fun refreshGroupPurges(target:ChatTarget,force:Boolean=false) {
        val t=ticket ?: return
        val api=business ?: return
        val id=target.conversationId
        if(target.sessionType!=3||!GroupRetention.supported(id)||id in purgeInFlight)return
        if(!force&&System.currentTimeMillis()-(purgeFresh[id] ?: 0)<15_000)return
        purgeInFlight.add(id)
        businessIO.execute {
            val result=runCatching {
                val group=resolvePeer(target,api)
                val response=api.request("GET","/groups/$group/message-purges").asJsonObject
                GroupPurges.parse(response.getAsJsonArray("items") ?: error("成员消息清理边界响应缺失"))
            }
            dispatch {
                if(!current(t)) { return@dispatch }
                purgeInFlight.remove(id)
                result.fold(onSuccess={ rules ->
                    purges?.merge(id,rules)
                    conversationVisibilityDirty=true
                    purgeFresh[id]=System.currentTimeMillis()
                    emit(snapshot.copy(messages=visible(snapshot.messages)))
                },onFailure={
                    purgeFresh[id]=System.currentTimeMillis()
                    if(snapshot.active?.target==target)emit(snapshot.copy(historyDiagnostic="成员消息清理边界刷新失败"))
                })
            }
        }
    }
    private fun submit(t:SessionTicket,entry:OutboxEntry,done:((Result<ChatMessage>)->Unit)?=null) {
        var completed=false
        fun complete(result:Result<ChatMessage>) { if(!completed) { completed=true;sendCompletions.remove(entry.id);done?.invoke(result) } }
        sendCompletions[entry.id]=::complete
        outbox!!.update(entry.id,OutboxState.SENDING,entry.message)
        val attempt=(sendAttempts[entry.id] ?: 0)+1
        sendAttempts[entry.id]=attempt
        emit()
        fun checkLater() { listOf(1_000L,3_000L,8_000L).forEach { delay -> after(delay) { dispatch {
            if(current(t)&&outbox?.all()?.any { it.id==entry.id&&it.state==OutboxState.UNCERTAIN }==true)reconcile(entry.id,notify=false)
        } } } }
        try { gateway.send(entry.target,entry.message.serialized) { result -> dispatch {
            if(!current(t)) return@dispatch
            // 本机历史或实时回执可能先确认成功，之后到来的失败回调不能重新制造待核对。
            if(outbox?.all()?.none { it.id==entry.id }!=false) {
                result.getOrNull()?.takeIf { it.id==entry.id&&(it.status==2||it.seq>0) }?.let { complete(Result.success(it)) }
                return@dispatch
            }
            result.fold(onSuccess={ message ->
                if(message.id!=entry.id || (message.status!=2 && message.seq<=0)) {
                    outbox?.update(entry.id,OutboxState.UNCERTAIN)
                    emit()
                    checkLater()
                    complete(Result.failure(IllegalStateException("发送结果待核对，未自动重发")))
                } else {
                    outbox?.update(entry.id,OutboxState.ACCEPTED,message)
                    confirmAccepted(t,entry)
                    emit(snapshot.copy(messages=if(snapshot.active?.target?.conversationId==entry.target.conversationId) mergeMessages(snapshot.messages,visible(listOf(message))) else snapshot.messages,error=null,lastSendErrorCode=null))
                    complete(Result.success(message))
                }
            },onFailure={ error ->
                if(sendAttempts[entry.id]!=attempt)return@fold
                if(outbox?.all()?.firstOrNull { it.id==entry.id }?.state==OutboxState.ACCEPTED)return@fold
                val rejected=SendFailurePolicy.rejectedBeforeSubmission((error as? ChatFailure)?.code)
                val alreadyFailed=outbox?.all()?.firstOrNull { it.id==entry.id }?.state==OutboxState.FAILED
                outbox?.update(entry.id,if(rejected||alreadyFailed)OutboxState.FAILED else OutboxState.UNCERTAIN)
                emit(snapshot.copy(lastSendErrorCode=(error as? ChatFailure)?.code,error=if(snapshot.active?.target?.conversationId==entry.target.conversationId)if(rejected)"消息未发送，请稍后点按重试。" else "发送结果待确认。" else snapshot.error))
                if(!rejected&&!alreadyFailed)checkLater()
                complete(Result.failure(IllegalStateException("发送结果待核对，未自动重发",error)))
            })
        } } } catch(error:Exception) {
            // SDK 调用在提交前抛出，消息仍留在本机，允许沿用同一 ID 重试。
            outbox?.update(entry.id,OutboxState.FAILED)
            emit(snapshot.copy(error="消息未提交，请点按失败状态重试。"))
            complete(Result.failure(IllegalStateException("消息未提交",error)))
        }
        after(30_000) { dispatch {
            if(current(t)&&sendAttempts[entry.id]==attempt&&outbox?.all()?.any { it.id==entry.id&&it.state==OutboxState.SENDING }==true) { outbox?.update(entry.id,OutboxState.UNCERTAIN);emit(snapshot.copy(error=if(snapshot.active?.target?.conversationId==entry.target.conversationId) "发送结果待核对，可点击消息状态。" else snapshot.error));checkLater();complete(Result.failure(IllegalStateException("发送超时，结果待核对，未自动重发"))) }
        } }
    }
    fun sendToPeer(imId:String,group:Boolean,text:String,done:(Result<ChatMessage>)->Unit) = sendCreatedToPeer(imId,group,done) { target ->
        require(text.isNotBlank()) { "发送内容不能为空" };gateway.createText(text.trim(),target)
    }
    fun sendToPeer(imId:String,group:Boolean,media:UploadedMedia,done:(Result<ChatMessage>)->Unit) = sendCreatedToPeer(imId,group,done) { target -> gateway.createMedia(media,target) }
    private fun sendCreatedToPeer(imId:String,group:Boolean,done:(Result<ChatMessage>)->Unit,create:(ChatTarget)->ChatMessage) {
        val t=ticket ?: return done(Result.failure(IllegalStateException("请先登录")))
        if(!snapshot.ready)return done(Result.failure(IllegalStateException("聊天库暂未就绪")))
        gateway.peer(imId,group) { result ->
            dispatch {
                if(!current(t)) {
                    return@dispatch
                }
                result.fold(onSuccess={ conversation ->
                    try {
                        ensureCanSend(conversation.target)
                        val message=create(conversation.target)
                        val entry=outbox!!.put(conversation.target,message)
                        emit(snapshot.copy(messages=if(snapshot.active?.target==conversation.target)mergeMessages(snapshot.messages,listOf(message)) else snapshot.messages))
                        submit(t,entry,done)
                    } catch(error:Exception) {
                        done(Result.failure(IllegalStateException(error.message ?: "消息未提交")))
                    }
                },onFailure={ done(Result.failure(it)) })
            }
        }
    }
    fun reconnect(done:(Result<Unit>)->Unit) {
        val t=ticket ?: return done(Result.failure(IllegalStateException("请先登录")))
        if(authRevoked)return done(Result.failure(IllegalStateException("登录已失效，请重新登录")))
        emit(snapshot.copy(connection=ConnectionState.CONNECTING))
        gateway.reconnect { result -> dispatch { if(current(t)) { if(result.isFailure)emit(snapshot.copy(connection=ConnectionState.DISCONNECTED));done(result) } } }
    }
    fun searchPeerMessages(imId:String,group:Boolean,keyword:String,types:List<Int>,page:Int,count:Int,done:(Result<ChatSearchPage>)->Unit) {
        val t=ticket ?: return done(Result.failure(IllegalStateException("请先登录")))
        if(!snapshot.ready)return done(Result.failure(IllegalStateException("聊天库暂未就绪，请稍后重试")))
        require(page>=1&&count in 1..100&&types.all { it in setOf(101,102,103,104,105,106,107,108,109,110,114,115,117) })
        gateway.peer(imId,group) { resolved -> dispatch {
            if(!current(t))return@dispatch
            resolved.fold(onSuccess={ conversation ->
                if(!boundaryReady(conversation.target)) { refreshRetention(listOf(conversation));done(Result.failure(IllegalStateException("群历史边界正在校验，请稍后重试")));return@fold }
                gateway.search(conversation.target,keyword,types,page,count) { result -> dispatch {
                    if(!current(t))return@dispatch
                    done(result.map { value -> value.copy(messages=value.messages.filter { tombstones[it.id]!=true&&!MessageContents.isPinSync(it.serialized)&&permits(conversation.target,it) }.map { if(tombstones.containsKey(it.id))it.copy(text=recallLabel(it,conversation.target),serialized="") else it }) })
                } }
            },onFailure={ done(Result.failure(it)) })
        } }
    }
    fun searchAllMessages(keyword:String,page:Int,count:Int,done:(Result<ChatGlobalSearchPage>)->Unit) {
        val t=ticket ?: return done(Result.failure(IllegalStateException("请先登录")))
        if(!snapshot.ready)return done(Result.failure(IllegalStateException("聊天库暂未就绪")))
        require(keyword.isNotBlank()&&page>=1&&count in 1..100)
        gateway.searchAll(keyword,page,count) { result -> dispatch {
            if(!current(t))return@dispatch
            result.fold(onSuccess={ found ->
                fun deliver() { done(Result.success(found.copy(hits=found.hits.filter { hit -> boundaryReady(hit.conversation.target)&&permits(hit.conversation.target,hit.message)&&tombstones[hit.message.id]!=true&&!MessageContents.isPinSync(hit.message.serialized) }.map { hit -> if(tombstones.containsKey(hit.message.id))hit.copy(message=hit.message.copy(text=recallLabel(hit.message,hit.conversation.target),serialized="")) else hit }))) }
                val ids=found.hits.map { it.conversation.target }.filter { it.sessionType==3&&GroupRetention.supported(it.conversationId)&&!boundaryReady(it) }.map { it.conversationId }.distinct()
                val api=business
                if(ids.isEmpty()||api==null) { deliver();return@fold }
                businessIO.execute {
                    val boundaries=runCatching { ids.chunked(50).flatMap { batch ->
                        val response=api.request("GET","/im/group-retention/states",query=mapOf("conversationIds" to batch.joinToString(","))).asJsonObject
                        GroupRetention.parse(response.getAsJsonArray("items") ?: error("群历史边界响应无效"),batch.toSet())
                    } }
                    dispatch {
                        if(!current(t)) { return@dispatch }
                        boundaries.fold(onSuccess={ values -> retention?.merge(values);conversationVisibilityDirty=true;retentionChecked.addAll(ids);ids.forEach { retentionFresh[it]=System.currentTimeMillis() };deliver() },onFailure={ done(Result.failure(IllegalStateException("群历史边界暂不可校验，请稍后重试搜索"))) })
                    }
                }
            },onFailure={ done(Result.failure(it)) })
        } }
    }
    fun openSearchHit(hit:ChatGlobalHit) {
        if(!boundaryReady(hit.conversation.target)||!permits(hit.conversation.target,hit.message)||tombstones[hit.message.id]==true) { emit(snapshot.copy(error="该搜索结果已不在可见范围，请重新搜索"));return }
        open(hit.conversation)
        val found=visible(listOf(hit.message))
        if(found.isNotEmpty())emit(snapshot.copy(messages=mergeMessages(snapshot.messages,found),focusMessageId=hit.message.id))
    }
    fun openPeerMessage(imId:String,group:Boolean,title:String,avatar:String,message:ChatMessage) {
        val t=ticket ?: return
        gateway.peer(imId,group) { result -> dispatch {
            if(!current(t))return@dispatch
            result.fold(onSuccess={ conversation ->
                if(!boundaryReady(conversation.target)||!permits(conversation.target,message)||tombstones[message.id]==true) { emit(snapshot.copy(error="该消息已不在可见范围，请刷新检索结果"));return@fold }
                openSearchHit(ChatGlobalHit(conversation.copy(title=title.ifBlank { conversation.title },avatar=avatar.ifBlank { conversation.avatar }),message))
            },onFailure={ emit(snapshot.copy(error=it.message ?: "聊天定位未完成")) })
        } }
    }
    fun clearConversation(conversation:ChatConversation,done:(Result<Unit>)->Unit) {
        val t=ticket ?: return done(Result.failure(IllegalStateException("请先登录")))
        val target=conversation.target
        if(outbox?.all()?.any { it.target.conversationId==target.conversationId }==true||target.conversationId in uploadingTargets)return done(Result.failure(IllegalStateException("会话仍有上传或待核对消息，请先核对发送结果")))
        if(!clearing.add(target.conversationId))return done(Result.failure(IllegalStateException("会话正在清理")))
        clearLockedConversation(t,conversation,done)
    }
    fun clearOwnConversation(conversation:ChatConversation,done:(Result<Unit>)->Unit) {
        val t=ticket ?: return done(Result.failure(IllegalStateException("请先登录")))
        val api=business ?: return done(Result.failure(IllegalStateException("业务服务尚未就绪")))
        val target=conversation.target
        if(outbox?.all()?.any { it.target.conversationId==target.conversationId }==true||target.conversationId in uploadingTargets)return done(Result.failure(IllegalStateException("会话仍有上传或待核对消息，请先核对发送结果")))
        if(!clearing.add(target.conversationId))return done(Result.failure(IllegalStateException("会话正在清理")))
        businessIO.execute {
            val remote=runCatching {
                api.request("POST","/im/conversation-messages/clear",jsonBody("peerType" to if(target.sessionType==3)"group" else "c2c","peerId" to resolvePeer(target,api)))
            }
            dispatch {
                if(!current(t))return@dispatch
                remote.fold(onSuccess={ clearLockedConversation(t,conversation) { local ->
                    done(local.recoverCatching { throw IllegalStateException("本账号远端记录已清理，本机清理未完成，请重试本地清理",it) })
                } },onFailure={ clearing.remove(target.conversationId);done(Result.failure(it)) })
            }
        }
    }
    private fun clearLockedConversation(t:SessionTicket,conversation:ChatConversation,done:(Result<Unit>)->Unit) {
        val target=conversation.target
        if(snapshot.active?.target==target) { roomGeneration++;emit(snapshot.copy(historyLoading=false)) }
        val visibleIds=if(snapshot.active?.target==target)snapshot.messages.map { it.id } else emptyList()
        gateway.clearHistory(target) { result -> dispatch {
            if(!current(t))return@dispatch
            clearing.remove(target.conversationId)
            if(result.isSuccess) {
                visibleIds.forEach { tombstones[it]=true }
                if(snapshot.active?.target==target)cursor=null
                emit(snapshot.copy(messages=if(snapshot.active?.target==target)emptyList() else snapshot.messages,historyEnd=if(snapshot.active?.target==target)true else snapshot.historyEnd,conversations=snapshot.conversations.map { if(it.target==target)it.copy(preview="",unread=0,latestSeq=0) else it }))
            }
            done(result)
        } }
    }
    private fun allConversations(t:SessionTicket,done:(Result<List<ChatConversation>>)->Unit) {
        val items=linkedMapOf<String,ChatConversation>()
        fun page(offset:Int) {
            gateway.conversations(offset,100) { result -> dispatch {
                if(!current(t))return@dispatch
                result.fold(onSuccess={ values ->
                    val before=items.size
                    values.forEach { items[it.target.conversationId]=it }
                    when {
                        values.size<100 -> done(Result.success(items.values.toList()))
                        items.size>=100_000 -> done(Result.failure(IllegalStateException("会话数量较大，请分批处理")))
                        items.size==before -> done(Result.failure(IllegalStateException("会话分页暂未推进，请重试")))
                        else -> page(offset+values.size)
                    }
                },onFailure={ done(Result.failure(it)) })
            } }
        }
        page(0)
    }
    fun markAllConversationsRead(done:(Result<String>)->Unit) {
        val t=ticket ?: return done(Result.failure(IllegalStateException("请先登录")))
        allConversations(t) { resolved ->
            resolved.fold(onSuccess={ conversations ->
                var index=0;var success=0;var failed=0
                fun next() {
                    if(!current(t))return
                    if(index>=conversations.size) { done(Result.success("已标记 $success 个会话已读"+if(failed>0)"，$failed 个会话未完成，可重试。" else ""));return }
                    markConversationRead(conversations[index++]) { result -> if(result.isSuccess)success++ else failed++;next() }
                }
                next()
            },onFailure={ done(Result.failure(it)) })
        }
    }
    fun clearAllConversations(done:(Result<String>)->Unit) {
        val t=ticket ?: return done(Result.failure(IllegalStateException("请先登录")))
        val api=business ?: return done(Result.failure(IllegalStateException("业务服务尚未就绪")))
        allConversations(t) { resolved -> resolved.fold(onSuccess={ conversations ->
            var index=0;var success=0;var failed=0;var pending=0
            fun next() {
                if(!current(t))return
                if(index>=conversations.size) { done(Result.success("已清除本账号 $success 个会话的记录"+(if(failed>0)"，$failed 个会话未完成" else "")+(if(pending>0)"，$pending 个会话有上传或待核对消息，已保留" else "")));return }
                val conversation=conversations[index++]
                val id=conversation.target.conversationId
                if(outbox?.all()?.any { it.target.conversationId==id }==true||id in uploadingTargets||!clearing.add(id)) { pending++;next();return }
                businessIO.execute {
                    val remote=runCatching {
                        val peer=resolvePeer(conversation.target,api)
                        api.request("POST","/im/conversation-messages/clear",jsonBody("peerType" to if(conversation.target.sessionType==3)"group" else "c2c","peerId" to peer))
                    }
                    dispatch {
                        if(!current(t)) {
                            return@dispatch
                        }
                        clearing.remove(id)
                        if(remote.isFailure) {
                            failed++
                            next()
                        } else {
                            clearConversation(conversation) { result ->
                                if(result.isSuccess) {
                                    success++
                                } else {
                                    failed++
                                }
                                next()
                            }
                        }
                    }
                }
            }
            next()
        },onFailure={ done(Result.failure(it)) }) }
    }
    private fun confirmAccepted(t:SessionTicket,entry:OutboxEntry) {
        gateway.find(entry.target,entry.id) { result -> dispatch {
            if(!current(t)) return@dispatch
            val confirmed=result.getOrNull()
            if(confirmed?.id==entry.id && (confirmed.status==2||confirmed.seq>0)) { acceptEvidence(confirmed);emit() }
        } }
    }
    private fun reconcilePending() { outbox?.all().orEmpty().filter { it.state==OutboxState.UNCERTAIN }.forEach { reconcile(it.id,notify=false) } }
    /** 对齐 uni-app：用 pending-join-requests 校准群主/管理员会话上的入群申请标记。 */
    private fun reconcileJoinRequestHighlights() {
        val t=ticket ?: return
        val api=business ?: return
        businessIO.execute {
            val pending=runCatching {
                val rows=api.request("GET","/groups/pending-join-requests")
                val values=if(rows.isJsonArray)rows.asJsonArray else return@runCatching emptySet<String>()
                values.mapNotNull { item ->
                    if(!item.isJsonObject)return@mapNotNull null
                    val id=item.asJsonObject.get("groupConversationId")?.takeIf { it.isJsonPrimitive }?.asString.orEmpty()
                    id.takeIf { it.startsWith("sg_") }
                }.toSet()
            }.getOrDefault(emptySet())
            dispatch {
                if(!current(t))return@dispatch
                val activeId=snapshot.active?.target?.conversationId
                val visible=pending.filter { it!=activeId }.toSet()
                val merged=snapshot.conversations.map { row ->
                    val want=row.target.sessionType==3&&row.target.conversationId in visible
                    if(row.joinRequestPending==want)row else row.copy(joinRequestPending=want)
                }
                if(merged!=snapshot.conversations)emit(snapshot.copy(conversations=merged))
            }
        }
    }
    private fun reconcileRoom() { outbox?.all().orEmpty().filter { it.target.conversationId==snapshot.active?.target?.conversationId&&it.state!=OutboxState.SENDING }.forEach { if(it.state==OutboxState.ACCEPTED) ticket?.let { t -> confirmAccepted(t,it) } else reconcile(it.id,notify=false) } }
    fun reconcile(id:String,notify:Boolean=true) {
        val t=ticket ?: return
        val entry=outbox?.all()?.firstOrNull { it.id==id } ?: return
        if(!snapshot.ready || entry.state in listOf(OutboxState.SENDING,OutboxState.ACCEPTED)) return
        val room=roomGeneration
        val attempt=sendAttempts[id]
        fun roomError(text:String)=if(notify&&room==roomGeneration&&snapshot.active?.target?.conversationId==entry.target.conversationId) text else snapshot.error
        gateway.find(entry.target,id) { result -> dispatch {
            if(!current(t)) return@dispatch
            if(sendAttempts[id]!=attempt||outbox?.all()?.none { it.id==id }!=false)return@dispatch
            if(outbox?.all()?.firstOrNull { it.id==id }?.state in listOf(OutboxState.SENDING,OutboxState.ACCEPTED)) return@dispatch
            result.fold(onSuccess={ found ->
                when {
                    found!=null&&found.id==id&&(found.status==2||found.seq>0) -> { acceptEvidence(found);emit(snapshot.copy(error=null,messages=if(snapshot.active?.target?.conversationId==entry.target.conversationId) mergeMessages(snapshot.messages,visible(listOf(found))) else snapshot.messages)) }
                    found!=null&&found.id==id&&found.status==3 -> { outbox?.update(id,OutboxState.FAILED,found);emit(snapshot.copy(error=roomError("消息发送失败，可点按失败状态重试。"))) }
                    else -> {
                        // SDK 提交前明确拒绝且未入库的消息，空查询不能撤销已有失败事实。
                        if(outbox?.all()?.firstOrNull { it.id==id }?.state!=OutboxState.FAILED)outbox?.update(id,OutboxState.UNCERTAIN)
                        emit(snapshot.copy(error=roomError(if(entry.state==OutboxState.FAILED)"消息未发送，请点按重试。" else "发送结果待确认，请稍后查看。")))
                    }
                }
            },onFailure={ emit(snapshot.copy(error=roomError("暂时无法核对，待发记录已保留。"))) })
        } }
    }
    fun retryFailed(id:String) {
        val t=ticket ?: return
        val entry=outbox?.all()?.firstOrNull { it.id==id&&it.state==OutboxState.FAILED } ?: return
        if(!snapshot.ready)return
        val attempt=sendAttempts[id]
        // 先再次查询本地 SDK，避免核对期间已成功的消息被重发；不重新创建 ID 或上传文件。
        gateway.find(entry.target,id) { result -> dispatch {
            if(!current(t)||sendAttempts[id]!=attempt||outbox?.all()?.firstOrNull { it.id==id }?.state!=OutboxState.FAILED)return@dispatch
            result.fold(onSuccess={ found ->
                if(found?.id==id&&(found.status==2||found.seq>0)) {
                    acceptEvidence(found)
                    emit(snapshot.copy(error=null,messages=if(snapshot.active?.target==entry.target)mergeMessages(snapshot.messages,visible(listOf(found))) else snapshot.messages))
                } else if(found==null||found.id==id&&found.status==3) {
                    try {
                        if(MessageContents.parse(entry.message.serialized).type==114) preserveQuoteThenSubmit(t,entry)
                        else { ensureCanSend(entry.target);submit(t,entry) }
                    } catch(_:Exception) { emit(snapshot.copy(error="暂不可重试，请检查连接及会话权限。")) }
                } else { outbox?.update(id,OutboxState.UNCERTAIN);emit(snapshot.copy(error="发送结果仍需核对，未重复发送。")) }
            },onFailure={ emit(snapshot.copy(error="暂时无法核对，未重复发送。")) })
        } }
    }
    fun foreground(active:Boolean) { appForeground=active;if(ticket!=null) { gateway.foreground(active);if(active) { reconcilePending();reconcileJoinRequestHighlights();snapshot.active?.target?.let { refreshGroupPurges(it,true) };refreshSendPermission();refreshPeerPresence() } } }
    fun logout() {
        conversationDiagnostics.reset()
        initialConversationSnapshotLoaded=false
        pendingConversationRefresh=false;cancelConversationRecovery();conversationRecoveryAttempts=0
        conversationVisibilityDirty=true;retentionRefreshNeedsRead=false
        conversationChangesDuringRequest.clear()
        presentation=null;membersOperation++;membersLoading=false;wantedMembers=emptyList();checkedMembers.clear()
        coordinator.logout();ticket=null;syncAttempt=null;outbox=null;mediaUploads=null;sentVideos=null;pendingForwards=null;runningForwards.clear();announcedForwards.clear();uploadAttempts.clear();retention=null;historyChecks=null;purges=null;purgeFresh.clear();purgeInFlight.clear();retentionFresh.clear();retentionInFlight.clear();retentionChecked.clear();readReporting.clear();readReported.clear();readMarkedAt.clear();clearing.clear();uploadingTargets.clear();notified.clear();ownIMId="";pageGeneration+=1;roomGeneration+=1;remoteHistoryOperation++;remoteHistoryLoading=false;cursor=null;offset=0
        gateway.shutdown()
        authRevoked=false;syncFinishedBeforeStore=false;tombstones.clear();sendAttempts.clear();sendCompletions.clear()
        recallBy.clear();recallById.clear();convLatest.clear();recalledConversation.clear();inviteHandled.clear();recentMessages.clear();recentPrefetching.clear();recentPrefetchDone.clear();recentPrefetchAttempts.clear();serverRecentInFlight.clear();serverRecentDone.clear();serverRecentFailures=0;serverRecentUnavailable=false;priorityRetention.clear();roomFirstPageRetry=false
        snapshot=ChatState();changed(snapshot)
    }
}
