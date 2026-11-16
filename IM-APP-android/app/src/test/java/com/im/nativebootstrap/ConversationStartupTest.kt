package com.im.nativebootstrap

import com.im.nativebootstrap.chat.*
import com.im.nativebootstrap.core.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

class ConversationStartupTest {
    @get:Rule val temporary=TemporaryFolder()
    private fun row(index:Int)=ChatConversation(ChatTarget("local-$index",1,"peer-$index"),"name-$index","private preview",1_800_000_000_000L+index*73, pinned=index in setOf(11,97,203))
    private class Gateway:ChatGateway {
        lateinit var events:ChatEvents
        lateinit var login:(Result<Unit>)->Unit
        val snapshots=mutableListOf<(Result<ConversationSnapshotPage>)->Unit>()
        override fun start(userId:String,token:String,api:String,ws:String,directory:File,events:ChatEvents,done:(Result<Unit>)->Unit) {this.events=events;login=done}
        override fun initialConversations(count:Int,done:(Result<ConversationSnapshotPage>)->Unit) {snapshots+=done}
        override fun conversations(offset:Int,count:Int,done:(Result<List<ChatConversation>>)->Unit) {error("Full snapshot must not request split pages")}
        override fun history(target:ChatTarget,cursor:String?,count:Int,done:(Result<HistoryPage>)->Unit) {error("No room open")}
        override fun createText(text:String,target:ChatTarget):ChatMessage=error("No sends")
        override fun send(target:ChatTarget,serialized:String,done:(Result<ChatMessage>)->Unit) {error("No sends")}
        override fun find(target:ChatTarget,id:String,done:(Result<ChatMessage?>)->Unit) {done(Result.success(null))}
        override fun foreground(active:Boolean) {}
        override fun shutdown() {}
    }
    private inner class Harness {
        val gateway=Gateway()
        val publishes=mutableListOf<ChatState>()
        val timers=mutableListOf<Pair<Long,()->Unit>>()
        val callbacks=LinkedBlockingQueue<()->Unit>()
        val thread=Thread.currentThread()
        val controller=ChatController(gateway,{if(Thread.currentThread()===thread)it() else callbacks.offer(it)},{ms,work->timers+=ms to work},{publishes+=it})
        val state get()=publishes.last()
        init {controller.start(AccountIdentity("business","im-user"),"https://service.invalid","not-a-token","https://im.invalid","wss://im.invalid",temporary.newFolder())}
    }
    @Test fun manyGroupBoundaryBatchesShareOneFullReadAndUnchangedEventsDoNotRepublish() {
        val h=Harness();h.gateway.login(Result.success(Unit))
        val groups=(1..201).map {index->row(index).copy(target=ChatTarget("sg_"+index.toString(16).padStart(32,'0'),3,groupId="group-$index"))}
        h.gateway.snapshots.first()(Result.success(ConversationSnapshotPage(groups,true)))
        var requests=0
        h.controller.attachBusiness(object:ChatBusiness {
            override val baseUrl="https://business.invalid"
            override fun request(method:String,path:String,body:com.google.gson.JsonObject?,query:Map<String,String>):com.google.gson.JsonElement {
                check(path=="/im/group-retention/states")
                synchronized(this) {requests++}
                return com.google.gson.JsonParser.parseString("""{"items":[]}""")
            }
        })
        val deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(5)
        while(h.gateway.snapshots.size<2&&System.nanoTime()<deadline)h.callbacks.poll(100,TimeUnit.MILLISECONDS)?.invoke()
        assertEquals(5,requests)
        assertEquals("201 groups must not trigger five full queries",2,h.gateway.snapshots.size)
        h.gateway.snapshots.last()(Result.success(ConversationSnapshotPage(groups,true)))
        val before=h.publishes.size
        val rows=h.state.conversations
        repeat(100) {h.gateway.events.conversations(rows.reversed())}
        assertEquals(before,h.publishes.size)
        assertSame(rows,h.state.conversations)
    }
    @Test fun syncFinishDuringInitialQueryAutomaticallyRereadsAfterTheStaleEmptyResult() {
        val h=Harness();h.gateway.events.syncStarted();h.gateway.login(Result.success(Unit))
        h.gateway.events.syncFinished()
        assertEquals(1,h.gateway.snapshots.size)
        h.gateway.snapshots.first()(Result.success(ConversationSnapshotPage(emptyList(),true)))
        assertEquals("A sync completion received during a query requires a fresh local read",2,h.gateway.snapshots.size)
        h.gateway.snapshots.last()(Result.success(ConversationSnapshotPage((1..243).map(::row),true)))
        assertEquals(243,h.state.conversations.size)
        assertEquals(SyncStatus.COMPLETED,h.state.sync)
    }
    @Test fun initialEmptyStoreDuringSyncAutomaticallyReadsAgainWithoutManualRefresh() {
        val h=Harness();h.gateway.events.connection(ConnectionState.CONNECTED);h.gateway.events.syncStarted();h.gateway.login(Result.success(Unit))
        h.gateway.snapshots.first()(Result.success(ConversationSnapshotPage(emptyList(),true)))
        val recovery=h.timers.firstOrNull {it.first in 500L..5_000L}
        assertNotNull("Syncing empty store needs an automatic local recovery read",recovery)
        recovery!!.second()
        assertEquals(2,h.gateway.snapshots.size)
        h.gateway.snapshots.last()(Result.success(ConversationSnapshotPage((1..243).map(::row),true)))
        assertEquals(243,h.state.conversations.size)
        assertEquals(SyncStatus.RUNNING,h.state.sync)
    }
    @Test fun emptySnapshotBeforeSyncStartRecoversAndRefreshRequestsAreCoalesced() {
        val h=Harness();h.gateway.events.connection(ConnectionState.CONNECTED);h.gateway.login(Result.success(Unit))
        h.gateway.snapshots.first()(Result.success(ConversationSnapshotPage(emptyList(),true)))
        assertTrue(h.state.ready)
        h.gateway.events.syncStarted()
        h.timers.single {it.first==1_000L}.second()
        assertEquals(2,h.gateway.snapshots.size)
        repeat(50) {h.controller.loadConversations(true)}
        h.gateway.snapshots[1](Result.success(ConversationSnapshotPage((1..1000).map(::row),true)))
        assertEquals(3,h.gateway.snapshots.size)
        h.gateway.snapshots.last()(Result.success(ConversationSnapshotPage((1..1000).map(::row),true)))
        assertEquals(1000,h.state.conversations.size)
        assertFalse(h.state.conversationsLoading)
    }
    @Test fun emptyRecoveryStopsAfterBudgetOrLogoutAndIgnoresOldTimer() {
        val h=Harness();h.gateway.events.connection(ConnectionState.CONNECTED);h.gateway.login(Result.success(Unit))
        h.gateway.snapshots.first()(Result.success(ConversationSnapshotPage(emptyList(),true)))
        h.gateway.events.syncStarted()
        repeat(12) {
            val recovery=h.timers.last {it.first in 1_000L..5_000L};recovery.second()
            h.gateway.snapshots.last()(Result.success(ConversationSnapshotPage(emptyList(),true)))
        }
        val reads=h.gateway.snapshots.size
        h.gateway.events.syncProgress(50)
        assertEquals(reads,h.gateway.snapshots.size)
        assertEquals(12,h.timers.count {it.first in 1_000L..5_000L})
        h.controller.logout()
        h.timers.first {it.first==1_000L}.second()
        assertEquals(reads,h.gateway.snapshots.size)
        assertTrue(h.state.conversations.isEmpty())
    }
    @Test fun completeLocalSnapshotIsVisibleOfflineWithoutWaitingForSyncOrPagination() {
        val h=Harness();val rows=(1..243).map(::row)
        h.gateway.events.connection(ConnectionState.DISCONNECTED)
        h.gateway.events.syncStarted()
        h.gateway.events.conversations(rows.takeLast(9))
        h.gateway.login(Result.success(Unit))
        h.gateway.events.conversations(rows.take(7).map {it.copy(unread=3)})
        assertTrue(h.publishes.all {it.conversations.isEmpty()})
        h.gateway.snapshots.single()(Result.success(ConversationSnapshotPage(rows.shuffled(java.util.Random(17)),true)))
        val expected=rows.sortedWith(compareByDescending<ChatConversation>{it.pinned}.thenByDescending {it.time})
        assertEquals(expected.map {it.target},h.state.conversations.map {it.target})
        assertEquals(3,h.state.conversations.first {it.target==row(1).target}.unread)
        assertEquals(0,h.state.conversations.first {it.target==row(243).target}.unread)
        assertTrue(h.state.ready)
        assertEquals(StoreStatus.READABLE,h.state.store)
        assertEquals(SyncStatus.RUNNING,h.state.sync)
        assertEquals(ConnectionState.DISCONNECTED,h.state.connection)
        assertTrue(h.state.conversationsEnd)
        h.controller.loadConversations()
        assertEquals(1,h.gateway.snapshots.size)
        for(batch in rows.chunked(27).reversed())h.gateway.events.conversations(batch.reversed().map {it.copy(unread=5)})
        assertEquals(expected.map {it.target},h.state.conversations.map {it.target})
        assertTrue(h.publishes.filter {it.conversations.isNotEmpty()}.all {it.conversations.size==243})
        h.gateway.events.syncFinished()
        assertEquals(2,h.gateway.snapshots.size)
        assertEquals(243,h.state.conversations.size)
        h.gateway.snapshots.last()(Result.success(ConversationSnapshotPage(rows.reversed(),true)))
        assertEquals(expected.map {it.target},h.state.conversations.map {it.target})
        val newMessage=row(1).copy(time=row(243).time+1000,unread=1)
        h.gateway.events.conversations(listOf(newMessage))
        assertEquals(newMessage.target,h.state.conversations[3].target)
    }
    @Test fun snapshotFailureCanRetryAndEventsDuringRetryOverrideStaleRows() {
        val h=Harness();h.gateway.login(Result.success(Unit))
        h.gateway.snapshots.single()(Result.failure(ChatFailure(10004)))
        assertFalse(h.state.ready)
        assertTrue(h.state.conversations.isEmpty())
        h.controller.loadConversations(true)
        val changed=row(1).copy(pinned=true,unread=7,time=row(2).time+1000)
        h.gateway.events.conversations(listOf(changed))
        assertTrue(h.state.conversations.isEmpty())
        h.gateway.snapshots.last()(Result.success(ConversationSnapshotPage(listOf(row(2),row(1)),true)))
        assertEquals(changed,h.state.conversations.first())
        assertTrue(h.state.ready)
    }
    @Test fun diagnosticsAreBoundedAndContainNoRawIdentifiersOrContent() {
        var now=1L;val trace=ConversationDiagnostics {now}
        val old=listOf(row(1),row(2));val next=listOf(row(2).copy(unread=7),row(1))
        trace.changed("sdk-event",old,next)
        val summary=trace.report().single()
        assertTrue(summary.contains("move=2 time=0 pin=0 message=0"))
        assertFalse(summary.contains("local-"))
        assertFalse(summary.contains("peer-"))
        assertFalse(summary.contains("name-"))
        assertFalse(summary.contains("private preview"))
        trace.changed("unchanged",next,next)
        assertEquals(1,trace.report().size)
        repeat(100) {now++;trace.phase("sync-start")}
        assertEquals(64,trace.report().size)
        trace.reset()
        assertTrue(trace.report().isEmpty())
    }
}
