package com.im.nativebootstrap.media

import java.util.ArrayDeque

/** 有界、仅本进程诊断；不保存 URL、账号、对象路径或签名。 */
object MediaMetrics {
    private val events = ArrayDeque<String>()
    private var bytes = 0L
    private var requests = 0L
    @Synchronized fun downloaded(count: Long) { bytes += count }
    @Synchronized fun network() { requests++ }
    @Synchronized fun record(id: String, tier: String, elapsedMs: Long) {
        events.addLast("${id.take(10)} $tier ${elapsedMs}ms")
        while (events.size > 60) events.removeFirst()
    }
    @Synchronized fun report(): List<String> = listOf("媒体采样：请求 $requests 次；响应体 $bytes bytes（本进程，不是 CDN 账单）") + events.toList()
    @Synchronized fun reset() { events.clear(); bytes = 0; requests = 0 }
}
