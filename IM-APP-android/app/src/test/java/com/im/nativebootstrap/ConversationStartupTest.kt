package com.im.nativebootstrap

import com.im.nativebootstrap.chat.*
import com.im.nativebootstrap.core.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

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
        val controller=ChatController(gateway,{it()},{_,_->},{publishes+=it})
        val state get()=publishes.last()
        init {controller.start(AccountIdentity("business","im-user"),"https://service.invalid","not-a-token","https://im.invalid","wss://im.invalid",temporary.newFolder())}
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
