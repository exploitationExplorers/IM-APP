package com.im.nativebootstrap

import com.im.nativebootstrap.chat.ChatConversation
import com.im.nativebootstrap.chat.ChatMessage
import com.im.nativebootstrap.chat.ChatTarget
import com.im.nativebootstrap.chat.ConversationSnapshotStore
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files

class ConversationSnapshotStoreTest {
    private fun row(id:String,time:Long)=ChatConversation(
        target=ChatTarget(id,1,id,""),title="会话$id",preview="预览$id",time=time,unread=3,pinned=time>10,
        avatar="https://example.test/$id.png",latestSeq=42,muted=true,
        latestMessage=ChatMessage("m-$id","消息$id",false,time,2,42,"""{"contentType":101}""","对方",101,"peer"),
    )

    @Test fun roundTripKeepsSessionRowsAndSeedMessage() {
        val dir=Files.createTempDirectory("conversation-cache").toFile()
        val store=ConversationSnapshotStore(File(dir,"conversations.json"),"owner")
        store.save(listOf(row("a",20),row("b",10)))
        val loaded=store.load()
        assertEquals(listOf("a","b"),loaded.map { it.target.conversationId })
        val first=loaded.first()
        assertEquals("会话a",first.title)
        assertEquals(3,first.unread)
        assertTrue(first.pinned)
        assertEquals("m-a",first.latestMessage?.id)
        assertEquals(101,first.latestMessage?.contentType)
    }

    @Test fun corruptedCacheIsIgnoredInsteadOfBlockingChat() {
        val dir=Files.createTempDirectory("conversation-cache").toFile()
        val file=File(dir,"conversations.json")
        file.writeText("{not json")
        assertTrue(ConversationSnapshotStore(file,"owner").load().isEmpty())
    }

    @Test fun differentAccountNeverReusesCache() {
        val dir=Files.createTempDirectory("conversation-cache").toFile()
        val file=File(dir,"conversations.json")
        ConversationSnapshotStore(file,"owner-a").save(listOf(row("a",20)))
        assertTrue(ConversationSnapshotStore(file,"owner-b").load().isEmpty())
    }

    @Test fun cacheIsBoundedForHugeAccounts() {
        val dir=Files.createTempDirectory("conversation-cache").toFile()
        val store=ConversationSnapshotStore(File(dir,"conversations.json"),"owner")
        store.save((1..600).map { row("c$it",it.toLong()) })
        assertEquals(500,store.load().size)
    }
}
