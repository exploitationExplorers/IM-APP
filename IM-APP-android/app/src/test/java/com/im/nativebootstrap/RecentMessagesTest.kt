package com.im.nativebootstrap

import com.google.gson.JsonParser
import com.im.nativebootstrap.chat.parseServerRecentMessages
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class RecentMessagesTest {
    @Test fun parsesServerRecentMessagesAndMarksOwnMessages() {
        val root = JsonParser.parseString(
            """{"items":[{"conversationId":"sg_test","messages":[
                {"clientMsgId":"m1","sendId":"u1","preview":"你好","sendTime":10,"seq":2,"contentType":101,
                 "serialized":"{\"clientMsgID\":\"m1\",\"contentType\":101,\"textElem\":{\"content\":\"你好\"}}"}
            ]}]}"""
        )
        val parsed = parseServerRecentMessages(root, "u1")
        val messages = parsed["sg_test"].orEmpty()
        assertEquals(1, messages.size)
        assertEquals("你好", messages.single().text)
        assertEquals(101, messages.single().contentType)
        assertTrue(messages.single().mine)
    }
}
