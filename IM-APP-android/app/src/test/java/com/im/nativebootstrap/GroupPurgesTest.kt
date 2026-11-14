package com.im.nativebootstrap

import com.google.gson.JsonParser
import com.im.nativebootstrap.chat.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.time.Instant

class GroupPurgesTest {
    @get:Rule val temporary=TemporaryFolder()
    private val group="sg_12345678123412341234123456789abc"
    private val user="abcdef12-1234-1234-1234-123456789abc"
    private val imId=user.replace("-","")
    private val stamp="2026-11-13T00:00:00Z"
    private val boundary=Instant.parse(stamp).toEpochMilli()
    private val target=ChatTarget(group,3,groupId="group")
    private fun message(time:Long,mine:Boolean=false,sender:String=imId)=ChatMessage("message","历史",mine,time,seq=10,serialized="""{"sendID":"$sender","contentType":101,"textElem":{"content":"历史"}}""")
    @Test fun onlyOlderMessagesFromThePurgedMemberAreHidden() {
        val store=GroupPurges(File(temporary.newFolder(),"purges.json"),"owner")
        store.merge(group,listOf(GroupMessagePurge(user,boundary)))
        assertFalse(store.permits(target,message(boundary-1)))
        assertFalse(store.permits(target,message(boundary/1000-1)))
        assertFalse(store.permits(target,message(0)))
        assertTrue(store.permits(target,message(boundary)))
        assertTrue(store.permits(target,message(boundary+1000)))
        assertTrue(store.permits(target,message(boundary-1,sender="11111111111111111111111111111111")))
        assertTrue(store.permits(target,message(boundary-1,mine=true)))
        assertTrue(store.permits(ChatTarget("si_single",1,userId=imId),message(boundary-1)))
    }
    @Test fun boundariesPersistAndNeverRegressOnOldOrEmptyResponses() {
        val file=File(temporary.newFolder(),"purges.json")
        val store=GroupPurges(file,"owner")
        store.merge(group,listOf(GroupMessagePurge(user,boundary)))
        store.merge(group,listOf(GroupMessagePurge(user,boundary-10_000)))
        store.merge(group,emptyList())
        val restored=GroupPurges(file,"owner")
        assertFalse(restored.permits(target,message(boundary-1)))
        assertTrue(restored.permits(target,message(boundary)))
        assertThrows(IllegalStateException::class.java) { GroupPurges(file,"another-owner") }
    }
    @Test fun aPurgedLatestMessageCannotResurfaceAsConversationPreview() {
        val store=GroupPurges(File(temporary.newFolder(),"purges.json"),"owner")
        store.merge(group,listOf(GroupMessagePurge(user,boundary)))
        val old=ChatConversation(target,"群","旧消息",boundary,latestMessage=message(boundary-1))
        assertEquals("",store.conversation(old).preview)
        assertEquals("新消息",store.conversation(old.copy(preview="新消息",latestMessage=message(boundary+1))).preview)
    }
    @Test fun malformedDuplicateAndNonBusinessMemberRecordsAreRejectedAsOneBatch() {
        val valid="""{"userId":"$user","purgedAt":"$stamp"}"""
        assertEquals(boundary,GroupPurges.parse(JsonParser.parseString("[$valid]").asJsonArray).single().beforeMillis)
        assertThrows(IllegalArgumentException::class.java) { GroupPurges.parse(JsonParser.parseString("[$valid,$valid]").asJsonArray) }
        assertThrows(Exception::class.java) { GroupPurges.parse(JsonParser.parseString("""[{"userId":"$user","purgedAt":"bad"}]""").asJsonArray) }
        assertThrows(IllegalArgumentException::class.java) { GroupPurges.parse(JsonParser.parseString("""[{"userId":"$imId","purgedAt":"$stamp"}]""").asJsonArray) }
    }
    @Test fun damagedStoreIsPreservedForRecovery() {
        val file=File(temporary.newFolder(),"purges.json");file.writeText("broken")
        assertThrows(Exception::class.java) { GroupPurges(file,"owner") }
        assertEquals("broken",file.readText())
    }
}
