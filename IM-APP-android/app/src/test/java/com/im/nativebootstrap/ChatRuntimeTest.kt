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
        val sends=mutableListOf<Triple<ChatTarget,String,(Result<ChatMessage>)->Unit>>()
        val finds=mutableListOf<Pair<String,(Result<ChatMessage?>)->Unit>>()
        var beforeSend:(()->Unit)?=null
        var created=ChatMessage("sdk-id","文本",true,10,1,0,"{\"clientMsgID\":\"sdk-id\"}")
        override fun start(userId:String,token:String,api:String,ws:String,directory:File,events:ChatEvents,done:(Result<Unit>)->Unit) { this.events=events;login=done }
        override fun conversations(offset:Int,count:Int,done:(Result<List<ChatConversation>>)->Unit) { pages+=Triple(offset,count,done) }
        override fun history(target:ChatTarget,cursor:String?,count:Int,done:(Result<HistoryPage>)->Unit) { histories+=Triple(target,cursor,done) }
        override fun createText(text:String,target:ChatTarget)=created
        override fun peer(imId:String,group:Boolean,done:(Result<ChatConversation>)->Unit) { done(Result.success(ChatConversation(ChatTarget("si_test",1,imId),"peer","",0))) }
        override fun send(target:ChatTarget,serialized:String,done:(Result<ChatMessage>)->Unit) { beforeSend?.invoke();sends+=Triple(target,serialized,done) }
        override fun find(target:ChatTarget,id:String,done:(Result<ChatMessage?>)->Unit) { finds+=id to done }
        override fun foreground(active:Boolean) {}
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
        h.gateway.sends.single().third(Result.failure(ChatFailure(10004)))
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
        h.gateway.sends.single().third(Result.failure(ChatFailure(10004)))
        assertEquals(10004,h.state.lastSendErrorCode)
        h.timers.last { it.first==1_000L }.second()
        h.gateway.finds.last().second(Result.success(message(status=2,seq=10)))
        assertTrue(h.state.outbox.isEmpty());assertNull(h.state.error)
        assertEquals(1,h.gateway.sends.size)
        h.gateway.sends.single().third(Result.failure(ChatFailure(10004)))
        assertTrue(h.state.outbox.isEmpty());assertNull(h.state.error)
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
        h.gateway.sends.single().third(Result.failure(ChatFailure(10004)))
        h.controller.reconcile("sdk-id");val stale=h.gateway.finds.last().second
        h.controller.reconcile("sdk-id");h.gateway.finds.last().second(Result.success(message(status=3)))
        h.controller.retryFailed("sdk-id");h.gateway.finds.last().second(Result.success(message(status=3)))
        h.gateway.sends.last().third(Result.failure(ChatFailure(10004)))
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
        assertEquals("[消息已撤回]",h.state.messages.single().text)
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
