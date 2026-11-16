package com.im.nativebootstrap

import com.im.nativebootstrap.chat.ChatConversation
import com.im.nativebootstrap.chat.ChatTarget
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UnreadBadgeTest {
    private fun row(id:String,unread:Int,muted:Boolean=false)=ChatConversation(ChatTarget(id,1,"peer-$id"),id,"",1,unread=unread,muted=muted)

    @Test fun chatTabCountsOnlyNonMutedUnreadAndFallsBackToMutedDot() {
        val mixed=chatUnreadSummary(listOf(row("a",2),row("b",5,muted=true)))
        assertEquals(2,mixed.count)
        assertFalse(mixed.mutedOnly)

        val mutedOnly=chatUnreadSummary(listOf(row("a",0),row("b",5,muted=true)))
        assertEquals(0,mutedOnly.count)
        assertTrue(mutedOnly.mutedOnly)
    }
}
