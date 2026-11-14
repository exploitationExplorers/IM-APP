package com.im.nativebootstrap

import com.google.gson.JsonParser
import com.im.nativebootstrap.chat.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class GroupRetentionTest {
    @get:Rule val temporary=TemporaryFolder()
    private val id="sg_12345678123412341234123456789abc"
    private val stamp="2026-11-13T00:00:00Z"
    private fun state(min:Long=10,revision:Long=1)=RetentionWatermark(id,min,revision,stamp)
    private fun record(min:String="10",revision:String="1",conversation:String=id)="""{"conversationId":"$conversation","minVisibleSeq":$min,"revision":$revision,"updatedAt":"$stamp"}"""
    @Test fun watermarksAreDurableAndNeverMoveBackwards() {
        val file=File(temporary.newFolder(),"retention.json")
        val store=GroupRetention(file,"account-a")
        store.merge(listOf(state(10,2)))
        store.merge(listOf(state(9,3),state(99,1)))
        assertEquals(10L,store.watermark(id)!!.minVisibleSeq)
        store.merge(listOf(state(15,3)))
        val restored=GroupRetention(file,"account-a")
        assertEquals(15L,restored.watermark(id)!!.minVisibleSeq)
        assertThrows(IllegalStateException::class.java) { GroupRetention(file,"account-b") }
    }
    @Test fun emptyOfflineResponseDoesNotEraseSavedWatermarks() {
        val store=GroupRetention(File(temporary.newFolder(),"retention.json"),"owner")
        store.merge(listOf(state()))
        store.merge(GroupRetention.parse(JsonParser.parseString("[]").asJsonArray,setOf(id)))
        assertEquals(10L,store.watermark(id)!!.minVisibleSeq)
    }
    @Test fun historyRealtimeAndPreviewUseSameBoundaryAndLocalPendingSurvives() {
        val store=GroupRetention(File(temporary.newFolder(),"retention.json"),"owner");store.merge(listOf(state()))
        val target=ChatTarget(id,3,groupId="group")
        assertFalse(store.permits(target,ChatMessage("old","",false,1,seq=9)))
        assertTrue(store.permits(target,ChatMessage("edge","",false,1,seq=10)))
        assertTrue(store.permits(target,ChatMessage("pending","",true,1,seq=0)))
        val hidden=store.conversation(ChatConversation(target,"群","旧预览",1,99,latestSeq=9))
        assertEquals("",hidden.preview);assertEquals(0,hidden.unread)
        val allowed=store.conversation(ChatConversation(target,"群","可见",1,99,latestSeq=12))
        assertEquals("可见",allowed.preview);assertEquals(3,allowed.unread)
    }
    @Test fun duplicateOutOfScopeAndFractionalBatchesAreRejectedBeforeMerge() {
        val requested=setOf(id)
        assertThrows(IllegalArgumentException::class.java) { GroupRetention.parse(JsonParser.parseString("[${record()},${record()}]").asJsonArray,requested) }
        assertThrows(IllegalArgumentException::class.java) { GroupRetention.parse(JsonParser.parseString("[${record(conversation="sg_00000000000000000000000000000000")}]").asJsonArray,requested) }
        listOf("0","-1","1.5","9007199254740992","\"10\"").forEach { invalid -> assertThrows(IllegalArgumentException::class.java) { GroupRetention.parse(JsonParser.parseString("[${record(min=invalid)}]").asJsonArray,requested) } }
    }
    @Test fun corruptionIsPreservedAndNeverSilentlyReplacedByEmptyState() {
        val file=File(temporary.newFolder(),"retention.json");file.writeText("broken")
        assertThrows(Exception::class.java) { GroupRetention(file,"owner") }
        assertEquals("broken",file.readText())
    }
}
