package com.im.nativebootstrap

import org.junit.Assert.*
import org.junit.Test

class HistoryLoadGateTest {
    private val boundary=HistoryLoadSignal(true,true,true,false,false)
    @Test fun initialShortPageAndIdleViewportNeverScanAllHistory() {
        val gate=HistoryLoadGate()
        assertFalse(gate.shouldLoad(boundary.copy(scrolling=false)))
        assertFalse(gate.shouldLoad(boundary.copy(awayFromLatest=false)))
        assertFalse(gate.shouldLoad(boundary.copy(nearOldest=false)))
    }
    @Test fun repeatedCallbacksCannotRepeatOneBoundaryRequestButNewGestureCanRetry() {
        val gate=HistoryLoadGate()
        assertTrue(gate.shouldLoad(boundary))
        assertFalse(gate.shouldLoad(boundary.copy(loading=true)))
        assertFalse(gate.shouldLoad(boundary))
        assertFalse(gate.shouldLoad(boundary))
        assertFalse(gate.shouldLoad(boundary.copy(scrolling=false)))
        assertTrue(gate.shouldLoad(boundary))
    }
    @Test fun sameFlingCanPrefetchNextPageAndIdleCompletionCanFinishTheViewport() {
        val gate=HistoryLoadGate()
        assertTrue(gate.shouldLoad(boundary.copy(progress=1,messageCount=40)))
        assertFalse(gate.shouldLoad(boundary.copy(progress=1,messageCount=40,loading=true)))
        assertTrue(gate.shouldLoad(boundary.copy(progress=2,messageCount=80)))
        assertFalse(gate.shouldLoad(boundary.copy(progress=2,messageCount=80)))
        assertTrue(gate.shouldLoad(boundary.copy(progress=3,messageCount=120,scrolling=false)))
        assertFalse(gate.shouldLoad(boundary.copy(progress=3,messageCount=120,scrolling=false)))
        assertFalse(gate.shouldLoad(boundary.copy(progress=4,messageCount=160,scrolling=false,nearOldest=false)))
        assertFalse(gate.shouldLoad(boundary.copy(progress=5,messageCount=200,scrolling=false)))
    }
    @Test fun boundedFilteredPagesCannotScanAnEntireDatabaseOrRestartOnLiveMessage() {
        val gate=HistoryLoadGate()
        assertTrue(gate.shouldLoad(boundary.copy(messageCount=40)))
        (1L..3L).forEach { assertTrue(gate.shouldLoad(boundary.copy(progress=it,messageCount=40,scrolling=false))) }
        assertFalse(gate.shouldLoad(boundary.copy(progress=4,messageCount=40,scrolling=false)))
        assertFalse(gate.shouldLoad(boundary.copy(progress=4,messageCount=41,scrolling=false,nearOldest=false)))
        assertFalse(gate.shouldLoad(boundary.copy(progress=5,messageCount=42,scrolling=false)))
    }
    @Test fun continuingScrollToNextBoundaryPagesAgainAndRespectsEnd() {
        val gate=HistoryLoadGate()
        assertTrue(gate.shouldLoad(boundary))
        assertFalse(gate.shouldLoad(boundary.copy(nearOldest=false)))
        assertTrue(gate.shouldLoad(boundary))
        assertFalse(gate.shouldLoad(boundary.copy(scrolling=false)))
        assertFalse(gate.shouldLoad(boundary.copy(end=true)))
    }
}
