package com.im.nativebootstrap

import com.im.nativebootstrap.chat.*
import com.im.nativebootstrap.core.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class ChatRuntimeTest {
    @get:Rule val temporary=TemporaryFolder()
    private val target=ChatTarget("si_test",1,"peer")
    private fun message(id:String="sdk-id",status:Int=1,seq:Long=0,time:Long=10)=ChatMessage(id,"文本",true,time,status,seq,"{\"clientMsgID\":\"$id\"}")
    private fun conversation(id:String="si_test",time:Long=10)=ChatConversation(ChatTarget(id,1,"peer"),id,"preview",time)
    private class FakeGateway:ChatGateway {
        lateinit var events:ChatEvents
        lateinit var login:(Result<Unit>)->Unit
        val pages=mutableListOf<Triple<Int,Int,(Result<List<ChatConversation>>)->Unit>>()
        val histories=mutableListOf<Triple<ChatTarget,String?,(Result<HistoryPage>)->Unit>>()
        val localHistories=mutableListOf<Triple<ChatTarget,Int,(Result<HistoryPage>)->Unit>>()
        val localAnchors=mutableListOf<Long>()
        var supportsLocalHistory=false
        val sends=mutableListOf<Triple<ChatTarget,String,(Result<ChatMessage>)->Unit>>()
        val finds=mutableListOf<Pair<String,(Result<ChatMessage?>)->Unit>>()
        var beforeSend:(()->Unit)?=null
        var created=ChatMessage("sdk-id","文本",true,10,1,0,"{\"clientMsgID\":\"sdk-id\"}")
        override fun start(userId:String,token:String,api:String,ws:String,directory:File,events:ChatEvents,done:(Result<Unit>)->Unit) { this.events=events;login=done }
        override fun conversations(offset:Int,count:Int,done:(Result<List<ChatConversation>>)->Unit) { pages+=Triple(offset,count,done) }
        override fun history(target:ChatTarget,cursor:String?,count:Int,done:(Result<HistoryPage>)->Unit) { histories+=Triple(target,cursor,done) }
        override fun localHistory(target:ChatTarget,page:Int,count:Int,done:(Result<HistoryPage>)->Unit) {
            if(supportsLocalHistory)localHistories+=Triple(target,page,done) else done(Result.failure(UnsupportedOperationException()))
        }
        override fun localHistory(target:ChatTarget,page:Int,count:Int,anchorTimeSeconds:Long,done:(Result<HistoryPage>)->Unit) { localAnchors+=anchorTimeSeconds;localHistory(target,page,count,done) }
        override fun createText(text:String,target:ChatTarget)=created
        override fun peer(imId:String,group:Boolean,done:(Result<ChatConversation>)->Unit) { done(Result.success(ChatConversation(ChatTarget("si_test",1,imId),"peer","",0))) }
        override fun send(target:ChatTarget,serialized:String,done:(Result<ChatMessage>)->Unit) { beforeSend?.invoke();sends+=Triple(target,serialized,done) }
        override fun find(target:ChatTarget,id:String,done:(Result<ChatMessage?>)->Unit) { finds+=id to done }
        override fun foreground(active:Boolean) {}
        override fun setConversation(target:ChatTarget,pinned:Boolean?,muted:Boolean?,done:(Result<Unit>)->Unit) { done(Result.success(Unit)) }
        override fun clearHistory(target:ChatTarget,done:(Result<Unit>)->Unit) { done(Result.success(Unit)) }
        override fun shutdown() {}
    }
    private inner class Harness {
        val root=temporary.newFolder()
        val gateway=FakeGateway()
        val timers=mutableListOf<Pair<Long,()->Unit>>()
        var state=ChatState()
        val controller=ChatController(gateway,{ it() },{ ms,action -> timers+=ms to action },{ state=it })
        val directory:File get()=AccountStorage.directory(root,"https://service.invalid/api/v1","business","im-user")
        init { controller.start(AccountIdentity("business","im-user"),"https://service.invalid/api/v1","not-logged","https://im.invalid","wss://im.invalid",root,7) }
        fun ready() { gateway.login(Result.success(Unit));gateway.pages.last().third(Result.success(emptyList())) }
        fun open() { ready();controller.open(conversation()) }
    }
    @Test fun loginDoesNotImplyReadableStoreOrCompletedSync() {
        val h=Harness()
        h.gateway.login(Result.success(Unit))
        assertTrue(h.state.loggedIn)
        assertFalse(h.state.ready)
        assertEquals(StoreStatus.OPENING,h.state.store)
        assertEquals(SyncStatus.IDLE,h.state.sync)
        h.gateway.pages.last().third(Result.failure(ChatFailure(10004)))
        assertFalse(h.state.ready)
        assertEquals(StoreStatus.OPENING,h.state.store)
        h.controller.loadConversations(true)
        h.gateway.pages.last().third(Result.success(emptyList()))
        assertTrue(h.state.ready)
        assertEquals(StoreStatus.READABLE,h.state.store)
        assertEquals(SyncStatus.IDLE,h.state.sync)
    }
    @Test fun initialLocalSnapshotDoesNotEraseProvisionalRows() {
        val h=Harness()
        val early=(1..8).map { conversation("early-$it",1_700_000_000_000L+it) }
        h.gateway.events.conversations(early)
        assertEquals(early.map {it.target}.toSet(),h.state.conversations.map {it.target}.toSet())
        assertFalse(h.state.ready)
        h.gateway.login(Result.success(Unit))
        assertEquals(8,h.state.conversations.size)
        val complete=(1..30).map { conversation("local-$it",1_700_000_010_000L+it) }
        h.gateway.pages.last().third(Result.success(complete))
        assertTrue(h.state.ready)
        assertEquals(38,h.state.conversations.size)
        assertTrue(h.state.conversations.any {it.target.conversationId.startsWith("early-")})
        assertTrue(h.state.conversations.any {it.target.conversationId.startsWith("local-")})
    }
    @Test fun emptyInitialLocalSnapshotKeepsServerConversationSnapshot() {
        val h=Harness()
        val remote=(1..12).map { conversation("remote-$it",1_700_000_020_000L+it) }
        h.gateway.events.conversationSnapshot(remote)
        h.gateway.login(Result.success(Unit))
        h.gateway.pages.last().third(Result.success(emptyList()))
        assertEquals(12,h.state.conversations.size)
        assertTrue(h.state.conversations.all {it.target.conversationId.startsWith("remote-")})
    }
    @Test fun pagesUseSdkOffsetsAndMergeIncrementalEventsWithoutDuplicates() {
        val h=Harness();h.gateway.login(Result.success(Unit))
        h.gateway.pages.last().third(Result.success((0 until 30).map { conversation("id$it") }))
        h.gateway.events.conversations(listOf(conversation("id0",99)))
        h.controller.loadConversations()
        assertEquals(30,h.gateway.pages.last().first)
        h.gateway.pages.last().third(Result.success(listOf(conversation("id0",10),conversation("next",20))))
        assertEquals(31,h.state.conversations.size)
        assertEquals(99L,h.state.conversations.first { it.target.conversationId=="id0" }.time)
        assertTrue(h.state.conversationsEnd)
    }
    @Test fun equalTimePagesAndReversedEventsKeepVisibleOrder() {
        val h=Harness();h.gateway.login(Result.success(Unit))
        val first=(30 downTo 1).map { conversation("id%02d".format(it)) }
        h.gateway.pages.last().third(Result.success(first))
        val order=first.map { it.target.conversationId }
        assertEquals(order,h.state.conversations.map { it.target.conversationId })
        h.gateway.events.conversations(first.reversed().map { it.copy(unread=2,muted=true) })
        assertEquals(order,h.state.conversations.map { it.target.conversationId })
        h.controller.loadConversations()
        h.gateway.pages.last().third(Result.success(listOf(conversation("id00"))))
        assertEquals(order+"id00",h.state.conversations.map { it.target.conversationId })
        assertTrue(h.state.conversations.take(30).all { it.unread==2&&it.muted })
    }
    @Test fun refreshSnapshotCannotUndoEventsArrivingDuringQuery() {
        val h=Harness();h.ready()
        val old=conversation("peer").copy(unread=9)
        h.gateway.events.conversations(listOf(old))
        h.controller.loadConversations(true)
        val changed=old.copy(unread=0,muted=true,pinned=true)
        h.gateway.events.conversations(listOf(changed))
        h.gateway.pages.last().third(Result.success(listOf(old)))
        assertEquals(changed,h.state.conversations.single())
    }
    @Test fun newMessagesAndPinChangesStillMoveConversations() {
        val first=conversation("first",20)
        val second=conversation("second",10)
        val old=listOf(first,second)
        assertEquals(listOf("second","first"),mergeConversations(old,listOf(second.copy(time=30)),true).map { it.target.conversationId })
        assertEquals(listOf("second","first"),mergeConversations(old,listOf(second.copy(pinned=true)),true).map { it.target.conversationId })
        assertEquals(listOf("first","second"),mergeConversations(listOf(second.copy(pinned=true),first),listOf(second),true).map { it.target.conversationId })
    }
    @Test fun stalePinInQueryDoesNotReorderEqualTimeRowsAfterNewerUnpinEvent() {
        val h=Harness();h.ready()
        val first=conversation("first");val second=conversation("second")
        h.gateway.events.conversations(listOf(first,second))
        h.controller.loadConversations(true)
        h.gateway.events.conversations(listOf(second.copy(unread=0,pinned=false)))
        h.gateway.pages.last().third(Result.success(listOf(second.copy(pinned=true),first)))
        assertEquals(listOf("first","second"),h.state.conversations.map { it.target.conversationId })
        assertFalse(h.state.conversations.last().pinned)
    }
    @Test fun successfulLocalSettingsAreNotUndoneByAnInFlightQuery() {
        val h=Harness();h.ready();val old=conversation().copy(unread=5)
        h.gateway.events.conversations(listOf(old));h.controller.loadConversations(true)
        h.controller.updateConversation(old,pinned=true,muted=true) { assertTrue(it.isSuccess) }
        h.gateway.pages.last().third(Result.success(listOf(old)))
        assertTrue(h.state.conversations.single().pinned)
        assertTrue(h.state.conversations.single().muted)
    }
    @Test fun successfulLocalReadIsNotUndoneByAnInFlightQuery() {
        val h=Harness();h.ready();val old=conversation().copy(unread=5)
        h.gateway.events.conversations(listOf(old));h.controller.loadConversations(true)
        h.controller.markConversationRead(old) { assertTrue(it.isSuccess) }
        h.gateway.pages.last().third(Result.success(listOf(old)))
        assertEquals(0,h.state.conversations.single().unread)
    }
    @Test fun successfulLocalClearIsNotUndoneByAnInFlightQuery() {
        val h=Harness();h.ready();val old=conversation().copy(unread=5,latestSeq=42)
        h.gateway.events.conversations(listOf(old));h.controller.loadConversations(true)
        var completed=false
        h.controller.clearConversation(old) { assertTrue(it.isSuccess);completed=true }
        assertTrue(completed)
        h.gateway.pages.last().third(Result.success(listOf(old)))
        assertEquals("",h.state.conversations.single().preview)
        assertEquals(0,h.state.conversations.single().unread)
        assertEquals(0L,h.state.conversations.single().latestSeq)
    }
    @Test fun oldRoomAndReopenedRoomHistoryCallbacksAreRejected() {
        val h=Harness();h.open()
        val old=h.gateway.histories.last().third
        h.controller.open(conversation("second"))
        old(Result.success(HistoryPage(listOf(message("wrong-room")),true)))
        assertTrue(h.state.messages.isEmpty())
        val second=h.gateway.histories.last().third
        h.controller.closeRoom();h.controller.open(conversation("second"))
        second(Result.success(HistoryPage(listOf(message("stale-reopen")),true)))
        assertTrue(h.state.messages.isEmpty())
    }
    @Test fun historyUsesClientMsgIdCursorAndErrorOrEmptyDoesNotMeanEnd() {
        val h=Harness();h.open()
        h.gateway.histories.last().third(Result.success(HistoryPage(listOf(message("new",2,20,20),message("old",2,10,10)),false)))
        h.controller.loadHistory()
        assertEquals("old",h.gateway.histories.last().second)
        h.gateway.histories.last().third(Result.success(HistoryPage(emptyList(),false)))
        assertFalse(h.state.historyEnd)
        assertNotNull(h.state.error)
        h.controller.loadHistory();h.gateway.histories.last().third(Result.failure(ChatFailure(10004)))
        assertFalse(h.state.historyEnd)
        assertEquals(StoreStatus.READABLE,h.state.store)
        h.controller.loadHistory();h.gateway.histories.last().third(Result.success(HistoryPage(emptyList(),true)))
        assertTrue(h.state.historyEnd)
    }
    @Test fun timedOutHistoryCannotOverwriteTheRetry() {
        val h=Harness();h.open();val old=h.gateway.histories.last().third
        h.timers.filter { it.first==20_000L }.last().second()
        assertFalse(h.state.historyLoading)
        h.controller.loadHistory();old(Result.success(HistoryPage(listOf(message("late")),true)))
        assertTrue(h.state.messages.isEmpty())
        assertTrue(h.state.historyLoading)
    }
    @Test fun localPagesRemainReadableDuringSyncAndBlockedAdvancedHistory() {
        val h=Harness();h.gateway.supportsLocalHistory=true;h.open()
        h.gateway.events.connection(ConnectionState.CONNECTED)
        h.gateway.events.syncStarted()
        h.gateway.localHistories.last().third(Result.success(HistoryPage(listOf(message("local-new",2,30,30)),false)))
        assertEquals(listOf("local-new"),h.state.messages.map { it.id })
        assertFalse(h.state.historyLoading);assertFalse(h.state.historyEnd)
        assertEquals(1,h.gateway.histories.size)
        // 高级历史补洞仍不回调，本机第二页无需等待网络。
        h.controller.loadHistory()
        assertEquals(2,h.gateway.localHistories.last().second)
        assertEquals(h.gateway.localAnchors.first(),h.gateway.localAnchors.last())
        h.gateway.localHistories.last().third(Result.success(HistoryPage(listOf(message("local-old",2,20,20)),true)))
        assertEquals(listOf("local-old","local-new"),h.state.messages.map { it.id })
        assertFalse(h.state.historyLoading);assertFalse(h.state.historyEnd)
        h.timers.last { it.first==20_000L }.second()
        assertEquals(2,h.state.messages.size);assertFalse(h.state.historyLoading)
        assertEquals(SyncStatus.RUNNING,h.state.sync)
    }
    @Test fun syncFinishReloadsFirstPageWhenRoomOnlyHasSeedMessage() {
        val h=Harness();h.gateway.supportsLocalHistory=true;h.ready()
        val seed=message("seed",2,99,99)
        h.controller.open(conversation().copy(latestMessage=seed))
        // 库可读且无缓存时，首帧等待本地第一页；空页后回退种子消息。
        assertTrue(h.state.messages.isEmpty())
        h.gateway.localHistories.last().third(Result.success(HistoryPage(emptyList(),true)))
        assertEquals(listOf("seed"),h.state.messages.map { it.id })
        h.gateway.events.syncStarted()
        h.gateway.events.syncFinished()
        assertEquals(1,h.gateway.localHistories.last().second)
        val page=(1..20).map { message("m$it",2,it.toLong(),it.toLong()) }
        h.gateway.localHistories.last().third(Result.success(HistoryPage(page,true)))
        assertEquals(21,h.state.messages.size)
        assertTrue(h.state.messages.any { it.id=="seed" })
        assertTrue(h.state.messages.any { it.id=="m20" })
    }
    @Test fun reconnectReloadsShortRoomEvenAfterLocalHistoryReportedEnd() {
        val h=Harness();h.gateway.supportsLocalHistory=true;h.open()
        val one=message("one",2,10,10)
        h.gateway.localHistories.last().third(Result.success(HistoryPage(listOf(one),true)))
        h.gateway.histories.last().third(Result.success(HistoryPage(listOf(one),true)))
        assertTrue(h.state.historyEnd)
        h.gateway.events.connection(ConnectionState.CONNECTED)
        assertEquals(2,h.gateway.histories.size)
        assertFalse(h.state.historyEnd)
    }
    @Test fun initialSnapshotRetriesShortRoomOpenedBeforeStoreReady() {
        val h=Harness();h.gateway.supportsLocalHistory=true
        val seed=message("seed",2,99,99)
        h.controller.open(conversation().copy(latestMessage=seed))
        assertEquals(listOf("seed"),h.state.messages.map { it.id })
        assertTrue(h.gateway.localHistories.isEmpty())
        h.gateway.login(Result.success(Unit))
        h.gateway.pages.last().third(Result.success(emptyList()))
        assertEquals(1,h.gateway.localHistories.size)
        h.gateway.localHistories.last().third(Result.success(HistoryPage(listOf(seed),true)))
        assertEquals(1,h.gateway.histories.size)
    }
    @Test fun remoteEndDoesNotHideRemainingLocalPagesFromAutomaticPagination() {
        val h=Harness();h.gateway.supportsLocalHistory=true;h.open()
        h.gateway.localHistories.last().third(Result.success(HistoryPage(listOf(message("recent",2,40,40)),false)))
        h.gateway.histories.last().third(Result.success(HistoryPage(emptyList(),true)))
        assertFalse(h.state.historyEnd)
        val revision=h.state.historyRevision
        h.controller.loadHistory()
        assertEquals(2,h.gateway.localHistories.last().second)
        h.gateway.localHistories.last().third(Result.success(HistoryPage(listOf(message("older",2,20,20)),true)))
        assertTrue(h.state.historyEnd)
        assertTrue(h.state.historyRevision>revision)
        assertEquals(listOf("older","recent"),h.state.messages.map { it.id })
    }
    @Test fun localPreviewEndStopsRepeatedEmptyQueriesButOnlyAdvancedCanFinishAllMessageTypes() {
        val h=Harness();h.gateway.supportsLocalHistory=true;h.open()
        h.gateway.localHistories.last().third(Result.success(HistoryPage(listOf(message("last-local",2,3)),true)))
        assertFalse(h.state.historyEnd);assertFalse(h.state.historyLoading)
        h.controller.loadHistory();assertEquals(1,h.gateway.localHistories.size)
        // 用户请求完整历史，SDK高级历史仍可补出本地搜索不支持的表情/高级文本/系统类型。
        assertEquals(1,h.gateway.histories.size)
        val extra=listOf(115,117,1510).mapIndexed { index,type -> message("unsupported-$type",2,(4+index).toLong()).copy(serialized="""{"contentType":$type}""") }
        h.gateway.histories.single().third(Result.success(HistoryPage(extra,false)))
        assertEquals(4,h.state.messages.size)
        assertFalse(h.state.historyEnd)
        h.gateway.events.connection(ConnectionState.CONNECTED)
        assertFalse(h.state.historyEnd)
        assertEquals(2,h.gateway.histories.size)
        h.gateway.histories.last().third(Result.success(HistoryPage(emptyList(),true)))
        assertTrue(h.state.historyEnd);assertFalse(h.state.historyLoading)
    }
    @Test fun disconnectedSdkStillTriesFullLocalHistoryWithoutBlockingTheNextPreviewPage() {
        val h=Harness();h.gateway.supportsLocalHistory=true;h.open()
        h.gateway.events.connection(ConnectionState.DISCONNECTED)
        h.gateway.localHistories.last().third(Result.success(HistoryPage(listOf(message("local-text",2,40)),false)))
        assertEquals(1,h.gateway.histories.size)
        assertFalse(h.state.historyLoading)
        h.controller.loadHistory()
        assertEquals(2,h.gateway.localHistories.last().second)
        h.gateway.localHistories.last().third(Result.success(HistoryPage(listOf(message("older-text",2,30)),true)))
        assertEquals(2,h.state.messages.size);assertFalse(h.state.historyLoading)
        // 网络补洞一直未返回也不阻塞本地第二页；完整渠道随后可补出本地系统消息。
        val system=message("local-system",2,35).copy(serialized="""{"contentType":1510}""")
        h.gateway.histories.single().third(Result.success(HistoryPage(listOf(system),true)))
        assertEquals(3,h.state.messages.size);assertTrue(h.state.historyEnd)
        assertFalse(h.state.historyLoading)
    }
    @Test fun authRequiredDisablesSendWithoutBlockingAlreadyReadableLocalHistory() {
        val h=Harness();h.gateway.supportsLocalHistory=true;h.open()
        h.gateway.events.connection(ConnectionState.AUTH_REQUIRED)
        assertFalse(h.state.ready);assertFalse(h.controller.send("blocked"))
        assertEquals(StoreStatus.READABLE,h.state.store)
        h.gateway.localHistories.last().third(Result.success(HistoryPage(listOf(message("offline",2,10)),false)))
        assertEquals("offline",h.state.messages.single().id)
        h.controller.loadHistory()
        assertEquals(2,h.gateway.localHistories.last().second)
        assertTrue(h.gateway.histories.isEmpty())
    }
    @Test fun authExpiryDuringConversationQueryStillCompletesLocalReadWithoutRestoringSendAuthority() {
        val h=Harness();h.gateway.login(Result.success(Unit))
        val pending=h.gateway.pages.last().third
        h.gateway.events.connection(ConnectionState.AUTH_REQUIRED)
        pending(Result.success(listOf(conversation("cached-room"))))
        assertEquals(StoreStatus.READABLE,h.state.store)
        assertFalse(h.state.conversationsLoading)
        assertFalse(h.state.ready);assertFalse(h.state.loggedIn)
        assertEquals("cached-room",h.state.conversations.single().target.conversationId)
        h.controller.loadConversations(true)
        assertEquals(2,h.gateway.pages.size)
        h.gateway.pages.last().third(Result.success(listOf(conversation("another-local-room"))))
        assertFalse(h.state.conversationsLoading);assertFalse(h.state.ready)
        assertFalse(h.controller.send("forbidden"));assertTrue(h.gateway.sends.isEmpty())
    }
    @Test fun oldLocalCallbackAndTimeoutCannotReplaceReopenedRoomOrKeepLoadingForever() {
        val h=Harness();h.gateway.supportsLocalHistory=true;h.open()
        val old=h.gateway.localHistories.last().third
        h.controller.closeRoom();h.controller.open(conversation())
        old(Result.success(HistoryPage(listOf(message("stale")),true)))
        assertTrue(h.state.messages.isEmpty());assertTrue(h.state.historyLoading)
        h.timers.last { it.first==5_000L }.second()
        assertFalse(h.state.historyLoading)
        h.controller.loadHistory()
        val retry=h.gateway.localHistories.last().third
        retry(Result.success(HistoryPage(listOf(message("fresh")),false)))
        assertEquals("fresh",h.state.messages.single().id)
    }
    @Test fun generationRejectsEventsAndResponsesAfterLogout() {
        val h=Harness();h.open()
        val events=h.gateway.events;val history=h.gateway.histories.last().third
        h.controller.logout()
        events.messages(listOf(target to message("old-account",2,1)))
        events.conversations(listOf(conversation()))
        history(Result.success(HistoryPage(listOf(message("old-history")),true)))
        assertFalse(h.state.ready);assertTrue(h.state.messages.isEmpty());assertTrue(h.state.conversations.isEmpty())
    }
    @Test fun syncFailureAndTimeoutNeverFabricateCompletionOrDeleteDirectory() {
        val h=Harness()
        h.gateway.events.syncStarted();h.gateway.events.syncFinished()
        h.timers.first { it.first==90_000L }.second()
        h.ready()
        assertEquals(SyncStatus.TIMED_OUT,h.state.sync)
        h.gateway.events.syncStarted();h.gateway.events.syncFailed();h.gateway.events.syncFinished()
        assertEquals(SyncStatus.FAILED,h.state.sync)
        assertEquals(StoreStatus.READABLE,h.state.store)
        assertTrue(h.directory.isDirectory)
    }
    @Test fun olderSyncTimeoutCannotFailNewAttemptAndAuthExpiryBlocksSending() {
        val h=Harness();h.open()
        h.gateway.events.syncStarted();val old=h.timers.last { it.first==90_000L }.second
        h.gateway.events.syncStarted();old()
        assertEquals(SyncStatus.RUNNING,h.state.sync)
        h.gateway.events.syncFinished();assertEquals(SyncStatus.COMPLETED,h.state.sync)
        h.gateway.events.connection(ConnectionState.AUTH_REQUIRED)
        assertFalse(h.state.ready);assertFalse(h.state.loggedIn)
        assertFalse(h.controller.send("no"));assertTrue(h.gateway.sends.isEmpty())
    }
    @Test fun outboxIsDurableBeforeSendAndUncertainNeverBlindlyResends() {
        val h=Harness();h.open()
        h.gateway.beforeSend={ assertTrue(File(h.directory,"app-outbox.json").readText().contains("SENDING")) }
        assertTrue(h.controller.send("text"))
        assertEquals(OutboxState.SENDING,h.state.outbox.single().state)
        h.gateway.sends.single().third(Result.failure(ChatFailure(10001)))
        assertEquals(OutboxState.UNCERTAIN,h.state.outbox.single().state)
        h.controller.reconcile("sdk-id");h.gateway.finds.last().second(Result.success(message(status=3)))
        assertEquals(1,h.gateway.sends.size)
        assertEquals(OutboxState.FAILED,h.state.outbox.single().state)
        h.controller.reconcile("sdk-id");h.gateway.finds.last().second(Result.success(null))
        assertEquals(1,h.gateway.sends.size)
        h.controller.reconcile("sdk-id");h.gateway.finds.last().second(Result.success(message(status=2,seq=9)))
        assertTrue(h.state.outbox.isEmpty())
        assertEquals(9L,h.state.messages.single().seq)
    }
    @Test fun sendCallbackMustMatchClientIdAndAcceptance() {
        val h=Harness();h.open();h.controller.send("text")
        h.gateway.sends.single().third(Result.success(message("wrong",2,5)))
        assertEquals(OutboxState.UNCERTAIN,h.state.outbox.single().state)
        assertFalse(h.state.messages.any { it.id=="wrong" })
        h.gateway.sends.single().third(Result.success(message(status=2,seq=7)))
        assertEquals(OutboxState.ACCEPTED,h.state.outbox.single().state)
        h.gateway.events.messages(listOf(target to message(status=2,seq=7)))
        assertTrue(h.state.outbox.isEmpty())
        assertEquals(1,h.state.messages.size)
    }
    @Test fun automaticReconciliationFindsLateAcceptanceWithoutResending() {
        val h=Harness();h.open();h.controller.send("text")
        h.gateway.sends.single().third(Result.failure(ChatFailure(10001)))
        assertEquals(10001,h.state.lastSendErrorCode)
        h.timers.last { it.first==1_000L }.second()
        h.gateway.finds.last().second(Result.success(message(status=2,seq=10)))
        assertTrue(h.state.outbox.isEmpty());assertNull(h.state.error)
        assertEquals(1,h.gateway.sends.size)
        h.gateway.sends.single().third(Result.failure(ChatFailure(10004)))
        assertTrue(h.state.outbox.isEmpty());assertNull(h.state.error)
    }
    @Test fun sdkPreflightRejectionIsRetryableWhileTransportAndDuplicateErrorsRemainUncertain() {
        for(code in listOf(10002,10004,10100,10101,10200,10205,10302,10400,10401)) {
            val h=Harness();h.open();h.controller.send("text")
            h.gateway.sends.single().third(Result.failure(ChatFailure(code)))
            assertEquals("SDK $code",OutboxState.FAILED,h.state.outbox.single().state)
            h.controller.reconcile("sdk-id");h.gateway.finds.last().second(Result.success(null))
            assertEquals("Missing local row must not revoke a known rejection",OutboxState.FAILED,h.state.outbox.single().state)
            assertEquals(1,h.gateway.sends.size)
        }
        for(code in listOf(10000,10001,10003,10005,10006,10204)) {
            val h=Harness();h.open();h.controller.send("text")
            h.gateway.sends.single().third(Result.failure(ChatFailure(code)))
            assertEquals("SDK $code",OutboxState.UNCERTAIN,h.state.outbox.single().state)
        }
    }
    @Test fun reconnectedSessionRechecksUncertainWithoutSendingOrRepeatedPopup() {
        val h=Harness();h.open();h.controller.send("text")
        h.gateway.sends.single().third(Result.failure(ChatFailure(10001)))
        h.controller.closeRoom()
        val before=h.gateway.finds.size
        h.gateway.events.connection(ConnectionState.DISCONNECTED)
        h.gateway.events.connection(ConnectionState.CONNECTED)
        assertEquals(before+1,h.gateway.finds.size)
        h.gateway.finds.last().second(Result.success(null))
        assertNull(h.state.error);assertEquals(OutboxState.UNCERTAIN,h.state.outbox.single().state)
        assertEquals(1,h.gateway.sends.size)
        h.gateway.events.connection(ConnectionState.DISCONNECTED)
        h.gateway.events.connection(ConnectionState.CONNECTED)
        h.gateway.finds.last().second(Result.success(message(status=2,seq=42)))
        assertTrue(h.state.outbox.isEmpty());assertEquals(1,h.gateway.sends.size)
    }
    @Test fun conversationLatestMessageConfirmsUncertainEvenWhenHistoryDoesNotReturnIt() {
        val h=Harness();h.open();h.controller.send("text")
        h.gateway.sends.single().third(Result.failure(ChatFailure(10001)))
        h.gateway.events.conversations(listOf(conversation().copy(latestMessage=message(status=2,seq=42))))
        assertTrue(h.state.outbox.isEmpty())
        assertEquals(42L,h.state.messages.single().seq)
        assertEquals(1,h.gateway.sends.size)
    }
    @Test fun userRetryReusesMessageIdAndChecksForAcceptanceFirst() {
        val h=Harness();h.open();h.controller.send("text")
        val first=h.gateway.sends.single().third
        first(Result.failure(ChatFailure(10002)))
        h.controller.retryFailed("sdk-id")
        assertEquals(1,h.gateway.sends.size)
        h.controller.reconcile("sdk-id");h.gateway.finds.last().second(Result.success(message(status=3)))
        h.controller.retryFailed("sdk-id");h.gateway.finds.last().second(Result.success(message(status=3)))
        assertEquals(2,h.gateway.sends.size)
        assertEquals(h.gateway.sends.first().second,h.gateway.sends.last().second)
        first(Result.failure(ChatFailure(10002)))
        assertEquals(OutboxState.SENDING,h.state.outbox.single().state)
        h.gateway.sends.last().third(Result.success(message(status=2,seq=11)))
        assertEquals(OutboxState.ACCEPTED,h.state.outbox.single().state)
    }
    @Test fun oldReconciliationCannotFailANewerUncertainAttempt() {
        val h=Harness();h.open();h.controller.send("text")
        h.gateway.sends.single().third(Result.failure(ChatFailure(10001)))
        h.controller.reconcile("sdk-id");val stale=h.gateway.finds.last().second
        h.controller.reconcile("sdk-id");h.gateway.finds.last().second(Result.success(message(status=3)))
        h.controller.retryFailed("sdk-id");h.gateway.finds.last().second(Result.success(message(status=3)))
        h.gateway.sends.last().third(Result.failure(ChatFailure(10001)))
        assertEquals(OutboxState.UNCERTAIN,h.state.outbox.single().state)
        stale(Result.success(message(status=3)))
        assertEquals(OutboxState.UNCERTAIN,h.state.outbox.single().state)
        assertEquals(2,h.gateway.sends.size)
    }
    @Test fun incomingAcceptanceCompletesForwardProgressEvenWhenTheSendCallbackFailsLater() {
        val h=Harness();h.open()
        val results=mutableListOf<Result<ChatMessage>>()
        h.controller.sendToPeer("peer",false,"text") { results+=it }
        h.gateway.events.messages(listOf(target to message(status=2,seq=15)))
        assertEquals(1,results.size);assertTrue(results.single().isSuccess)
        h.gateway.sends.single().third(Result.failure(ChatFailure(10004)))
        h.timers.last { it.first==30_000L }.second()
        assertEquals(1,results.size);assertTrue(h.state.outbox.isEmpty())
    }
    @Test fun revokedAndDeletedTombstonesWinOverLateHistory() {
        val h=Harness();h.open()
        h.gateway.events.messages(listOf(target to message("revoked",2,1),target to message("deleted",2,2)))
        h.gateway.events.tombstone("revoked",false);h.gateway.events.tombstone("deleted",true)
        h.gateway.histories.last().third(Result.success(HistoryPage(listOf(message("revoked",2,1),message("deleted",2,2)),true)))
        assertEquals(listOf("revoked"),h.state.messages.map { it.id })
        assertEquals("你撤回了一条消息",h.state.messages.single().text)
    }
    @Test fun privateOutboxRecoversUncertainAndValidatesStateOwnerAndIds() {
        val file=File(temporary.newFolder(),"outbox.json")
        val outbox=PersistentOutbox(file,"owner")
        outbox.put(target,message());outbox.update("sdk-id",OutboxState.SENDING)
        val restored=PersistentOutbox(file,"owner")
        assertEquals(OutboxState.UNCERTAIN,restored.all().single().state)
        assertThrows(IllegalArgumentException::class.java) { restored.update("sdk-id",OutboxState.SENDING) }
        assertThrows(IllegalArgumentException::class.java) { restored.update("sdk-id",OutboxState.ACCEPTED,message("different",2)) }
        assertThrows(IllegalStateException::class.java) { PersistentOutbox(file,"other-account") }
        val original=file.readText()
        file.writeText(original.replace("\"state\":\"UNCERTAIN\"","\"state\":null"))
        assertThrows(Exception::class.java) { PersistentOutbox(file,"owner") }
        assertTrue(file.exists())
    }
    @Test fun endpointUpgradeIsExactAndStorageIsEnvironmentAccountIsolated() {
        val business="https://www.xn--jprz53bj9s.com/api/v1"
        assertEquals("https://www.xn--jprz53bj9s.com/openim-api",ChatEndpoints.normalize(business,"http://8.154.44.197/openim-api",false))
        assertEquals("https://www.xn--jprz53bj9s.com/openim-api",ChatEndpoints.normalize(business,"http://8.154.44.197/openim-api/",false))
        assertEquals("wss://www.xn--jprz53bj9s.com/openim-ws",ChatEndpoints.normalize(business,"ws://8.154.44.197:80/openim-ws",true))
        for(url in listOf("http://8.154.44.197:81/openim-api","http://8.154.44.197/openim-api//","http://evil.invalid/openim-api","http://8.154.44.197/openim-api?x=1","https://user:secret@im.invalid")) assertThrows(Exception::class.java) { ChatEndpoints.normalize(business,url,false) }
        assertThrows(Exception::class.java) { ChatEndpoints.normalize("https://other.invalid","http://8.154.44.197/openim-api",false) }
        assertNotEquals(AccountStorage.key(business,"a","im"),AccountStorage.key(business,"b","im"))
        assertNotEquals(AccountStorage.key(business,"a","im"),AccountStorage.key("https://other.invalid/api/v1","a","im"))
    }
    @Test fun storageFailureInSdkCallbackStaysVisibleAndDoesNotFakeAcceptance() {
        val h=Harness();h.open();h.controller.send("text")
        val blocker=File(h.directory,"app-outbox.json.tmp").apply { mkdir() }
        h.gateway.sends.single().third(Result.success(message(status=2,seq=10)))
        assertEquals(OutboxState.SENDING,h.state.outbox.single().state)
        assertNotNull(h.state.error)
        assertTrue(blocker.isDirectory)
    }
    @Test fun timeoutRemainsUncertainAndLateMatchingAckCanConfirm() {
        val h=Harness();h.open();h.controller.send("text")
        h.timers.last { it.first==30_000L }.second()
        assertEquals(OutboxState.UNCERTAIN,h.state.outbox.single().state)
        h.gateway.sends.single().third(Result.success(message(status=2,seq=10)))
        assertEquals(OutboxState.ACCEPTED,h.state.outbox.single().state)
        h.gateway.sends.single().third(Result.failure(ChatFailure(10004)))
        assertEquals(OutboxState.ACCEPTED,h.state.outbox.single().state)
    }
    @Test fun supergroupUsesTypeThreeAndUnsupportedSessionsDoNotOpen() {
        val h=Harness();h.ready()
        val group=ChatConversation(ChatTarget("sg_group",3,groupId="group"),"群聊","",0)
        h.controller.open(group)
        assertEquals(3,h.gateway.histories.last().first.sessionType)
        h.controller.send("text")
        assertEquals("group",h.gateway.sends.last().first.groupId)
        assertEquals("",h.gateway.sends.last().first.userId)
        h.controller.closeRoom()
        h.controller.open(ChatConversation(ChatTarget("other",2,groupId="legacy"),"其他","",0))
        assertNull(h.state.active)
        assertNotNull(h.state.error)
    }
    @Test fun acceptedHistoryCannotRegressToPendingAndRecoveredQueueDoesNotAutoSend() {
        assertEquals(2,mergeMessages(listOf(message(status=2,seq=2)),listOf(message(status=1))).single().status)
        val h=Harness();h.open();h.controller.send("text");h.controller.logout()
        h.controller.start(AccountIdentity("business","im-user"),"https://service.invalid/api/v1","new-token","https://im.invalid","wss://im.invalid",h.root,8)
        h.ready();h.controller.open(conversation())
        assertEquals(OutboxState.UNCERTAIN,h.state.outbox.single().state)
        assertEquals(1,h.gateway.sends.size)
        assertEquals("sdk-id",h.gateway.finds.last().first)
    }
    @Test fun conversationSummaryNeverReplacesFullMessagePayload() {
        val h=Harness();h.open()
        h.controller.send("text")
        val accepted=message("sdk-id",status=2,seq=9,time=10)
        h.gateway.sends.single().third(Result.success(accepted))
        val summary=accepted.copy(serialized="",text="文本")
        h.gateway.events.conversations(listOf(conversation().copy(latestMessage=summary,latestSeq=9)))
        assertEquals(accepted.serialized,h.state.messages.single().serialized)
        assertEquals(accepted.contentType,h.state.messages.single().contentType)
    }
    @Test fun mergeMessagesPrefersFullPayloadOverConversationSummary() {
        val full=message("sdk-id",status=2,seq=9,time=10).copy(
            contentType=101,
            serialized="""{"clientMsgID":"sdk-id","contentType":101,"textElem":{"content":"文本"}}""",
        )
        val summary=full.copy(serialized="")
        val merged=mergeMessages(listOf(full),listOf(summary)).single()
        assertEquals(full.serialized,merged.serialized)
        assertEquals(101,merged.contentType)
    }
    @Test fun tailAppendAndAcknowledgementDoNotRequireFullReordering() {
        val base=listOf(message("m1",status=2,seq=1,time=1),message("m2",status=2,seq=2,time=2))
        val appended=mergeMessages(base,listOf(message("m3",status=1,seq=0,time=3)))
        assertEquals(listOf("m1","m2","m3"),appended.map { it.id })
        val acknowledged=mergeMessages(appended,listOf(message("m3",status=2,seq=3,time=3)))
        assertEquals(2,acknowledged.last().status)
        assertEquals(3L,acknowledged.last().seq)
        val lateDuplicate=mergeMessages(acknowledged,listOf(message("m3",status=1,seq=0,time=3)))
        assertEquals(3L,lateDuplicate.last().seq)
        assertEquals(2,lateDuplicate.last().status)
        val duplicateBatch=mergeMessages(emptyList(),listOf(message("m4",status=2,seq=5,time=4),message("m4",status=1,seq=0,time=4)))
        assertEquals(5L,duplicateBatch.single().seq)
        assertEquals(2,duplicateBatch.single().status)
    }
    @Test fun tombstoneWindowKeepsOnlyRecentEntries() {
        val window=TombstoneWindow(3)
        window["first"]=true
        window["second"]=false
        window["third"]=true
        window["fourth"]=false
        assertEquals(3,window.size)
        assertNull(window["first"])
        assertEquals(false,window["fourth"])
        window["second"]=true
        assertEquals(true,window["second"])
        window.clear()
        assertEquals(0,window.size)
    }
    @Test fun previousPageTimerCannotCancelTheFollowingPage() {
        val h=Harness();h.gateway.login(Result.success(Unit))
        val oldTimer=h.timers.last { it.first==20_000L }.second
        h.gateway.pages.last().third(Result.success((0 until 30).map { conversation("id$it") }))
        h.controller.loadConversations()
        oldTimer()
        assertTrue(h.state.conversationsLoading)
        h.gateway.pages.last().third(Result.success(emptyList()))
        assertTrue(h.state.conversationsEnd)
    }
    @Test fun damagedAccountStorageShowsTaggedErrorAndPreservesOriginal() {
        val h=Harness();h.controller.logout()
        val path=File(h.directory,"app-outbox.json")
        path.writeText("damaged-original")
        h.controller.start(AccountIdentity("business","im-user"),"https://service.invalid/api/v1","token","https://im.invalid","wss://im.invalid",h.root,99)
        assertEquals(99L,h.state.sessionTag)
        assertEquals(StoreStatus.FAILED,h.state.store)
        assertNotNull(h.state.error)
        assertEquals("damaged-original",path.readText())
    }
}
