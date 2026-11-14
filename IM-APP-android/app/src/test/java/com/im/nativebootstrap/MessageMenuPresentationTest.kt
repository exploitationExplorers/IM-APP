package com.im.nativebootstrap

import com.im.nativebootstrap.chat.*
import org.junit.Assert.*
import org.junit.Test

class MessageMenuPresentationTest {
    @Test fun uncertainSendNeverOffersRetryOrActionsThatCouldDuplicateOrDiscardIt() {
        for(state in listOf(OutboxState.PENDING,OutboxState.SENDING,OutboxState.UNCERTAIN)) {
            val actions=messageMenuEntries(MessageMenuContext(101,true,false,canRecall=true,delivery=state)).map { it.action }
            assertEquals(listOf(MessageMenuAction.RECONCILE,MessageMenuAction.COPY,MessageMenuAction.SELECT_TEXT),actions)
        }
    }
    @Test fun explicitlyFailedSendOffersRetryWhileKeepingReconciliationAvailable() {
        val actions=messageMenuEntries(MessageMenuContext(101,true,false,delivery=OutboxState.FAILED)).map { it.action }
        assertTrue(actions.contains(MessageMenuAction.RETRY))
        assertTrue(actions.contains(MessageMenuAction.RECONCILE))
        assertFalse(actions.contains(MessageMenuAction.FORWARD))
        assertFalse(actions.contains(MessageMenuAction.DELETE))
    }
    @Test fun textMenuMatchesLegacyOrderWithOnePinEntry() {
        val entries=messageMenuEntries(MessageMenuContext(101,true,false,canRecall=true))
        assertEquals(listOf("撤回","转发","引用","复制","选择文字","收藏","置顶","删除","多选"),entries.map { it.label })
        assertTrue(entries.none { it.wide })
        assertEquals(1,entries.count { it.action==MessageMenuAction.PIN })
        assertEquals("取消置顶",messageMenuEntries(MessageMenuContext(101,true,false,pinned=true)).single { it.action==MessageMenuAction.PIN }.label)
    }
    @Test fun imageMenuProvidesRealSaveAndStickerActionsBeforeFavorite() {
        val actions=messageMenuEntries(MessageMenuContext(102,false,false)).map { it.action }
        assertEquals(listOf(MessageMenuAction.FORWARD,MessageMenuAction.QUOTE,MessageMenuAction.SAVE_IMAGE,MessageMenuAction.ADD_STICKER,MessageMenuAction.FAVORITE,MessageMenuAction.PIN,MessageMenuAction.DELETE,MessageMenuAction.MULTI),actions)
        assertFalse(actions.contains(MessageMenuAction.COPY))
    }
    @Test fun ordinaryGroupMemberCannotSeeModerationActions() {
        val entries=messageMenuEntries(MessageMenuContext(101,false,true,senderInGroup=true))
        assertTrue(entries.any { it.action==MessageMenuAction.REPORT })
        assertTrue(entries.any { it.action==MessageMenuAction.MENTION })
        assertTrue(entries.none { it.wide||it.action in setOf(MessageMenuAction.MUTE,MessageMenuAction.UNMUTE,MessageMenuAction.RECALL) })
    }
    @Test fun managementActionsOccupyFullWidthAndSwitchWhenSenderHasLeft() {
        val member=messageMenuEntries(MessageMenuContext(101,false,true,canManage=true,canRecall=true,senderInGroup=true,muted=true))
        assertEquals(listOf(MessageMenuAction.KICK_AND_DELETE,MessageMenuAction.KICK),member.filter { it.wide }.map { it.action })
        assertTrue(member.any { it.action==MessageMenuAction.UNMUTE })
        assertFalse(member.any { it.action==MessageMenuAction.MUTE })
        val left=messageMenuEntries(MessageMenuContext(101,false,true,canManage=true))
        assertEquals(listOf(MessageMenuAction.PURGE),left.filter { it.wide }.map { it.action })
        assertFalse(left.any { it.action==MessageMenuAction.MENTION })
        assertEquals(left.size,left.map { it.action }.distinct().size)
    }
}
