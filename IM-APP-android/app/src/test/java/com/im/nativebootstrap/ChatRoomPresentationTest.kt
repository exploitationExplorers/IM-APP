package com.im.nativebootstrap

import com.im.nativebootstrap.chat.ChatRoomPresentation
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class ChatRoomPresentationTest {
    @get:Rule val temporary=TemporaryFolder()
    @Test fun dismissalPersistsOnlyForThatConversationAndExactRevision() {
        val file=File(temporary.newFolder(),"presentation.json")
        ChatRoomPresentation(file,"account-a").dismiss("sg_one","pin","message-id|time-1|shared")
        val restored=ChatRoomPresentation(file,"account-a")
        assertTrue(restored.dismissed("sg_one","pin","message-id|time-1|shared"))
        assertFalse(restored.dismissed("sg_two","pin","message-id|time-1|shared"))
        assertFalse(restored.dismissed("sg_one","pin","message-id|time-2|shared"))
        assertFalse(restored.dismissed("sg_one","announcement","message-id|time-1|shared"))
        assertFalse(file.readText().contains("message-id|time-1|shared"))
        assertThrows(IllegalStateException::class.java) { ChatRoomPresentation(file,"account-b") }
    }
    @Test fun aNewAnnouncementShowsAgainAndCorruptPreferenceFileIsPreserved() {
        val file=File(temporary.newFolder(),"presentation.json")
        val store=ChatRoomPresentation(file,"account-a")
        store.dismiss("sg_one","announcement","第一版公告")
        assertTrue(store.dismissed("sg_one","announcement","第一版公告"))
        assertFalse(store.dismissed("sg_one","announcement","第二版公告"))
        val broken="""{"schema":1,"owner":"account-a","values":{"sg_one:pin":13}}"""
        file.writeText(broken)
        assertThrows(IllegalStateException::class.java) { ChatRoomPresentation(file,"account-a") }
        assertEquals(broken,file.readText())
    }
}
