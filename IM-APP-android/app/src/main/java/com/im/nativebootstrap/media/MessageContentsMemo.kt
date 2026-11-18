package com.im.nativebootstrap.media

/**
 * MessageContents.parse / isPinSync 的进程内 LRU 备忘。
 *
 * 聊天列表滑动会反复组合/重组同一批消息；群聊 snapshotFlow 每帧也会触发兜底解析。
 * JSON 解析在主线程执行，同一条消息的 serialized 永不变化，重复解析是纯浪费，
 * 大 payload（多规格图片 URL、引用消息嵌套 JSON）单次解析可达数毫秒，直接造成掉帧。
 *
 * 键为 serialized 全文 + fallback（fallback 只影响解析结果中的 text 字段，需一并入键）；
 * 值为不可变 data class，跨调用共享安全。
 */
internal object MessageContentsMemo {
    private const val CAPACITY = 256

    private val parseCache = object : LinkedHashMap<Pair<String, String>, MessageContent>(64, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Pair<String, String>, MessageContent>) = size > CAPACITY
    }
    private val pinCache = object : LinkedHashMap<String, Boolean>(64, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Boolean>) = size > CAPACITY
    }

    fun parse(serialized: String, fallback: String, compute: (String, String) -> MessageContent): MessageContent {
        // 短文本（纯文本消息通常 <32 字符或无结构）解析本身极便宜，绕过缓存减少键分配。
        if (serialized.length < 32) return compute(serialized, fallback)
        val key = serialized to fallback
        synchronized(parseCache) { parseCache[key]?.let { return it } }
        val value = compute(serialized, fallback)
        synchronized(parseCache) { parseCache[key] = value }
        return value
    }

    fun isPinSync(serialized: String, compute: (String) -> Boolean): Boolean {
        if (serialized.length < 32) return compute(serialized)
        synchronized(pinCache) { pinCache[serialized]?.let { return it } }
        val value = compute(serialized)
        synchronized(pinCache) { pinCache[serialized] = value }
        return value
    }
}
