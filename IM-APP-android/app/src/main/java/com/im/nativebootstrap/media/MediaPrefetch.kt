package com.im.nativebootstrap.media

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import com.im.nativebootstrap.PerfLog
import com.im.nativebootstrap.chat.ChatMessage
import com.im.nativebootstrap.chat.ChatTarget
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/**
 * 只预取当前会话已经加载出来的消息。群聊消息超过服务端可见边界后不会再出现，
 * 因此群聊缓存窗口跟服务端保留策略一致，避免把已隐藏消息的媒体长期留在本机。
 */
object MediaPrefetch {
    private const val MAX_IMAGE_BYTES = 16L * 1024 * 1024
    private const val MAX_VOICE_BYTES = 32L * 1024 * 1024
    private const val MAX_VIDEO_BYTES = 20L * 1024 * 1024
    private const val MAX_FILE_BYTES = 5L * 1024 * 1024
    private const val TOTAL_CACHE_BYTES = 512L * 1024 * 1024
    private const val GROUP_TTL_MS = 7L * 24 * 60 * 60 * 1000
    private const val PRIVATE_TTL_MS = 14L * 24 * 60 * 60 * 1000
    private const val MAX_MESSAGES = 200

    private val executor = Executors.newSingleThreadExecutor { task ->
        Thread(task, "native-media-prefetch").apply { isDaemon = true }
    }
    private val queued = ConcurrentHashMap.newKeySet<String>()
    @Volatile private var context: Context? = null
    @Volatile private var enabled = true
    @Volatile private var wifiOnly = true

    fun configure(value: Context, enabled: Boolean, wifiOnly: Boolean) {
        context = value.applicationContext
        this.enabled = enabled
        this.wifiOnly = wifiOnly
        if (!enabled) queued.clear()
    }

    fun clearQueue() {
        queued.clear()
    }

    fun enqueue(target: ChatTarget, messages: List<ChatMessage>) {
        if (!enabled || messages.isEmpty()) return
        val app = context ?: run { PerfLog.mark("media-prefetch:skip","no-context");return }
        val owner = MediaLoader.cacheOwner() ?: run { PerfLog.mark("media-prefetch:skip","no-cache-owner");return }
        val version = MediaLoader.cacheVersion()
        if (wifiOnly && !isWifi(app)) { PerfLog.mark("media-prefetch:skip","wait-wifi");return }
        val now = System.currentTimeMillis()
        val ttl = if (target.sessionType == 3) GROUP_TTL_MS else PRIVATE_TTL_MS
        val ordered = messages.asSequence()
            .filter { it.contentType in setOf(102, 103, 104, 105) }
            .filter { message ->
                val time = normalizeTime(message.time)
                time <= 0L || now - time <= ttl
            }
            .sortedByDescending { normalizeTime(it.time) }
            .take(MAX_MESSAGES)
            .toList()
        val jobs = ordered.flatMap { message -> jobs(target, message) }
        PerfLog.mark("media-prefetch:enqueue","messages=${ordered.size} jobs=${jobs.size}")
        jobs.forEach { job ->
            if (!queued.add(job.id)) return@forEach
            executor.execute {
                try {
                    if (!enabled || !MediaLoader.cacheCurrent(owner, version)) return@execute
                    MediaLoader.fetch(
                        app,
                        job.url,
                        job.maxBytes,
                        MediaCacheMeta(
                            kind = job.kind,
                            quality = job.quality,
                            conversationId = target.conversationId,
                            messageId = job.messageId,
                            group = target.sessionType == 3,
                            url = job.url,
                        ),
                    )
                } catch (_: Exception) {
                    // 单条媒体失败不阻塞其它消息，联网或缓存命中后仍可正常查看。
                } finally {
                    queued.remove(job.id)
                }
            }
        }
        executor.execute {
            runCatching {
                MediaCacheStore.of(app, owner).prune(TOTAL_CACHE_BYTES, GROUP_TTL_MS, PRIVATE_TTL_MS)
            }
        }
    }

    private fun jobs(target: ChatTarget, message: ChatMessage): List<Job> {
        val content = MessageContents.parse(message.serialized, message.text)
        val conversation = target.conversationId
        fun job(url: String, kind: String, quality: String, max: Long): Job? {
            val value = url.trim()
            if (value.isEmpty()) return null
            return Job(
                id = "$conversation|${message.id}|$kind|$quality|$value",
                messageId = message.id,
                url = value,
                kind = kind,
                quality = quality,
                maxBytes = max,
            )
        }
        return when (content.type) {
            102 -> {
                val thumbnail = job(content.thumbnail, "image", "thumbnail", MAX_IMAGE_BYTES)
                val original = job(content.url, "image", "original", MAX_IMAGE_BYTES)
                listOfNotNull(thumbnail, original)
            }
            103 -> listOfNotNull(job(content.url, "voice", "original", MAX_VOICE_BYTES))
            104 -> {
                val cover = job(content.thumbnail, "video", "thumbnail", MAX_IMAGE_BYTES)
                val video = if (content.size in 1..MAX_VIDEO_BYTES) job(content.url, "video", "original", MAX_VIDEO_BYTES) else null
                listOfNotNull(cover, video)
            }
            105 -> listOfNotNull(
                if (content.size in 1..MAX_FILE_BYTES) job(content.url, "file", "original", MAX_FILE_BYTES) else null,
            )
            else -> emptyList()
        }
    }

    private fun isWifi(context: Context): Boolean {
        val manager = context.getSystemService(ConnectivityManager::class.java) ?: return false
        val capabilities = manager.getNetworkCapabilities(manager.activeNetwork) ?: return false
        return capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) ||
            capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
    }

    private fun normalizeTime(value: Long) = if (value in 1..9_999_999_999L) value * 1000 else value

    private data class Job(
        val id: String,
        val messageId: String,
        val url: String,
        val kind: String,
        val quality: String,
        val maxBytes: Long,
    )
}
