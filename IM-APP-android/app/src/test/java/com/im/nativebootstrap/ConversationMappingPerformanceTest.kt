package com.im.nativebootstrap

import com.im.nativebootstrap.business.orderByRecentConversations
import com.im.nativebootstrap.chat.ConversationMappingQueue
import com.im.nativebootstrap.chat.ConversationDiagnostics
import com.im.nativebootstrap.chat.ChatConversation
import com.im.nativebootstrap.chat.ChatTarget
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class ConversationMappingPerformanceTest {
    @Test fun mappingRunsOffCallerThreadAndPreservesArrivalOrder() {
        val queue=ConversationMappingQueue();val owner=queue.bind("synthetic-owner")
        val caller=Thread.currentThread();val seen=mutableListOf<Int>();val done=CountDownLatch(1)
        try {
            repeat(60) {index->queue.execute(owner) {active->
                assertNotSame(caller,Thread.currentThread());assertTrue(active())
                seen+=index;if(index==59)done.countDown()
            }}
            assertTrue(done.await(3,TimeUnit.SECONDS));assertEquals((0..59).toList(),seen)
        } finally {queue.close()}
    }
    @Test fun switchedAccountDoesNotWaitForOldWorkAndRejectsOldDelivery() {
        val queue=ConversationMappingQueue();val old=queue.bind("old-owner")
        val entered=CountDownLatch(1);val release=CountDownLatch(1);val staleFinished=CountDownLatch(1)
        val fresh=CountDownLatch(1);var staleDelivered=false
        try {
            queue.execute(old) {active->
                entered.countDown()
                // 模拟不能立即中断的旧解码；新账号必须使用独立的队列。
                while(release.count>0)try {release.await()}catch(_:InterruptedException) {}
                if(active())staleDelivered=true
                staleFinished.countDown()
            }
            assertTrue(entered.await(3,TimeUnit.SECONDS))
            val current=queue.bind("new-owner")
            queue.execute(old) {staleDelivered=true}
            queue.execute(current) {active->assertTrue(active());assertEquals("new-owner",current.userId);fresh.countDown()}
            assertTrue(fresh.await(3,TimeUnit.SECONDS))
            release.countDown();assertTrue(staleFinished.await(3,TimeUnit.SECONDS))
            assertFalse(staleDelivered)
        } finally {release.countDown();queue.close()}
    }
    @Test fun contactRankingMatchesLegacyOrderWithLinearIdentityReads() {
        val order=(1..5000).map {"id-$it"}.reversed()+"id-3"
        val rows=(1..5000).map {"id-$it"}.shuffled(kotlin.random.Random(16))+listOf("unknown-a","unknown-b")
        var reads=0
        val sorted=orderByRecentConversations(rows,order) {reads++;it}
        assertEquals(rows.size,reads)
        assertEquals((1..5000).map {"id-$it"}.reversed()+listOf("unknown-a","unknown-b"),sorted)
        assertEquals(rows.sortedBy {order.indexOf(it).takeIf {rank->rank>=0} ?: Int.MAX_VALUE},sorted)
    }
    @Test fun unchangedDiagnosticsReuseImmutableReportAndOnlyNewLinesInvalidateIt() {
        val trace=ConversationDiagnostics {0}
        val rows=(1..5000).map {ChatConversation(ChatTarget("id-$it",1,"peer-$it"),"private","private",it.toLong())}
        trace.changed("local-snapshot",emptyList(),rows)
        val report=trace.report()
        repeat(100) {trace.changed("state",rows,rows);assertSame(report,trace.report())}
        trace.phase("sync-start")
        assertNotSame(report,trace.report())
        assertEquals(1,report.size)
    }
}
