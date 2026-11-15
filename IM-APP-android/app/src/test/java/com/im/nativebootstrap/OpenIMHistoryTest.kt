package com.im.nativebootstrap

import com.im.nativebootstrap.chat.*
import io.openim.android.sdk.models.AdvancedMessage
import io.openim.android.sdk.models.Message
import io.openim.android.sdk.models.AttachedInfoElem
import org.junit.Assert.*
import org.junit.Test
import org.junit.Rule
import org.junit.rules.TemporaryFolder
import java.io.File

class OpenIMHistoryTest {
    @get:Rule val temporary=TemporaryFolder()
    @Test fun sdkGapErrorStillReturnsLocalMessagesWithoutPretendingHistoryIsComplete() {
        val row=Message().apply { clientMsgID="local-message";status=2;seq=25 }
        val partial=AdvancedMessage().apply { errCode=100;isEnd=true;messageList=listOf(row) }
        val result=OpenIMHistoryResults.page(partial) { ChatMessage(it.clientMsgID,"local",false,1,it.status,it.seq.toLong()) }.getOrThrow()
        assertEquals("local-message",result.messages.single().id)
        assertFalse(result.end)
        partial.messageList=emptyList()
        assertTrue(OpenIMHistoryResults.page(partial) { error("no row") }.isFailure)
        partial.errCode=0
        assertTrue(OpenIMHistoryResults.page(partial) { error("no row") }.getOrThrow().end)
    }
    @Test fun emptyVerifiedRetentionResultPersistsPerAccountWithoutOpeningUnknownGroups() {
        val file=File(temporary.newFolder(),"group-history-checks.json")
        val known="sg_12345678123412341234123456789abc"
        val unknown="sg_abcdef12123412341234123456789abc"
        GroupHistoryChecks(file,"owner").mark(listOf(known))
        val restored=GroupHistoryChecks(file,"owner")
        assertTrue(known in restored.all());assertFalse(unknown in restored.all())
        assertThrows(IllegalStateException::class.java) { GroupHistoryChecks(file,"other-owner") }
        assertTrue(file.isFile)
    }
    @Test fun localSearchPreviewNeverExposesPrivateBurnMessagesThatOnlyFullHistoryFilters() {
        val row=Message().apply { clientMsgID="burn-message";status=2;seq=40 }
        assertTrue(OpenIMHistoryResults.previewSafe(row))
        row.attachedInfoElem=AttachedInfoElem().apply { isPrivateChat=true;burnDuration=30 }
        assertFalse(OpenIMHistoryResults.previewSafe(row))
        row.attachedInfoElem=null
        row.attachedInfo="""{"isPrivateChat":true,"burnDuration":30}"""
        assertFalse(OpenIMHistoryResults.previewSafe(row))
        row.attachedInfo="""{"IsPrivateChat":true}"""
        assertFalse(OpenIMHistoryResults.previewSafe(row))
        row.attachedInfo="""{"isPrivateChat":false}"""
        assertTrue(OpenIMHistoryResults.previewSafe(row))
        row.attachedInfo="malformed"
        assertFalse(OpenIMHistoryResults.previewSafe(row))
    }
    @Test fun nullAttachedMetadataFromCoreKeepsOrdinaryRowsButNeverOverridesTypedPrivateFlag() {
        val row=Message().apply { clientMsgID="plain-message";status=2;attachedInfo="null" }
        assertTrue(OpenIMHistoryResults.previewSafe(row))
        row.attachedInfoElem=AttachedInfoElem().apply { isPrivateChat=true }
        assertFalse(OpenIMHistoryResults.previewSafe(row))
        row.attachedInfoElem=null
        row.attachedInfo="[]"
        assertFalse(OpenIMHistoryResults.previewSafe(row))
        row.attachedInfo="{"
        assertFalse(OpenIMHistoryResults.previewSafe(row))
    }
}
