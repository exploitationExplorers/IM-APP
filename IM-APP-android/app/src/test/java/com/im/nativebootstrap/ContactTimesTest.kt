package com.im.nativebootstrap

import com.im.nativebootstrap.business.*
import java.time.Instant
import java.time.ZoneId
import org.junit.Assert.*
import org.junit.Test

class ContactTimesTest {
    private val now=Instant.parse("2026-11-13T05:08:00Z")
    private val zone=ZoneId.of("Asia/Shanghai")
    @Test fun friendEventsUseLocalCalendarAndMeridiem() {
        assertEquals("今天 下午 1:08",contactEventTime(now.toString(),now,zone))
        assertEquals("昨天 上午 12:10",contactEventTime("2026-11-11T16:10:00Z",now,zone))
        assertEquals("2025年8月3日 上午 9:06",contactEventTime("2025-08-03T01:06:00Z",now,zone))
        assertEquals("",contactEventTime("malformed",now,zone))
    }
    @Test fun lastSeenDoesNotInventStatusForMissingValues() {
        assertEquals("",contactLastSeen("",now))
        assertEquals("",contactLastSeen("malformed",now))
        assertEquals("刚刚在线",contactLastSeen(now.plusSeconds(60).toString(),now))
        assertEquals("5分钟前在线",contactLastSeen(now.minusSeconds(300).toString(),now))
        assertEquals("昨天在线",contactLastSeen(now.minusSeconds(90000).toString(),now))
        assertEquals("很久未上线",contactLastSeen(now.minusSeconds(2592001).toString(),now))
    }
}
