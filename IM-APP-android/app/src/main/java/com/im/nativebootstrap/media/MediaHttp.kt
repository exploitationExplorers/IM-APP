package com.im.nativebootstrap.media

import android.content.Context
import coil.disk.DiskCache
import okhttp3.*
import okio.Buffer
import okio.ForwardingSource
import okio.buffer
import java.io.File
import java.io.IOException
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.Semaphore

/** 无业务认证头、无 Cookie；图片与文件分开调度，HTTPS 跳转不能降级。 */
@OptIn(coil.annotation.ExperimentalCoilApi::class)
internal object MediaHttp {
    private fun client(max: Long, concurrent: Int) = OkHttpClient.Builder()
        .dispatcher(Dispatcher().apply { maxRequests = concurrent; maxRequestsPerHost = concurrent })
        .connectTimeout(15, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS).callTimeout(90, TimeUnit.SECONDS)
        .followSslRedirects(false)
        .addNetworkInterceptor { chain ->
            val request = chain.request()
            require(request.url.isHttps && request.url.username.isEmpty() && request.url.password.isEmpty()) { "媒体地址不受支持" }
            MediaMetrics.network()
            val start = System.nanoTime()
            val response = chain.proceed(request)
            val body = response.body ?: return@addNetworkInterceptor response
            if (body.contentLength() > max) { response.close(); throw IOException("媒体超过可下载大小") }
            MediaMetrics.record(MediaCacheIdentity.digest(request.url.toString()), "HEADERS", (System.nanoTime() - start) / 1_000_000)
            response.newBuilder().body(object : ResponseBody() {
                private var total = 0L
                private val stream = object : ForwardingSource(body.source()) {
                    override fun read(sink: Buffer, byteCount: Long): Long {
                        val count = super.read(sink, byteCount)
                        if (count > 0) { total += count; MediaMetrics.downloaded(count); if (total > max) throw IOException("媒体超过可下载大小") }
                        return count
                    }
                }.buffer()
                override fun contentType() = body.contentType()
                override fun contentLength() = body.contentLength()
                override fun source() = stream
            }).build()
        }.build()
    val images: OkHttpClient by lazy { client(32L * 1024 * 1024, 4) }
    private val files by lazy { client(256L * 1024 * 1024, 2) }
    private val calls = ConcurrentHashMap.newKeySet<Call>()
    private val fileSlots = Semaphore(2, true)
    private val guard = Any()
    private val locks = ConcurrentHashMap<String, Pair<Any, Int>>()
    private var lastTrim = 0L
    fun cancelDownloads() { calls.forEach(Call::cancel) }
    fun download(context: Context, url: String, id: String, max: Long, active: () -> Boolean, images: DiskCache?): File {
        val lock = synchronized(guard) { val old = locks[id]; (old?.first ?: Any()).also { locks[id] = it to ((old?.second ?: 0) + 1) } }
        try { synchronized(lock) {
            check(active()) { "媒体会话已变化" }
            val directory = File(context.cacheDir, "media-files-v2").apply { check(mkdirs() || isDirectory) }
            val destination = File(directory, id)
            if (destination.isFile && destination.length() in 1..max) { destination.setLastModified(System.currentTimeMillis()); return destination }
            val part = File(directory, "$id.${UUID.randomUUID()}.part")
            try {
                val snapshot = images?.openSnapshot(id)
                if (snapshot != null) snapshot.use { check(it.data.toFile().length() in 1..max); it.data.toFile().copyTo(part) }
                else {
                    fileSlots.acquire()
                    val call = files.newCall(Request.Builder().url(url).build()); calls.add(call)
                    try { check(active()) { "媒体会话已变化" }; call.execute().use { response ->
                        check(response.isSuccessful) { "媒体读取失败，请稍后重试" }
                        val body = response.body ?: error("媒体响应为空")
                        check(body.contentLength() <= max) { "媒体超过可下载大小" }
                        body.byteStream().use { input -> part.outputStream().use { output ->
                            val buffer = ByteArray(64 * 1024); var total = 0L
                            while (true) {
                                check(active()) { "媒体会话已变化" }
                                val count = input.read(buffer); if (count < 0) break
                                total += count; check(total <= max) { "媒体超过可下载大小" }; output.write(buffer, 0, count)
                            }
                        } }
                    } } finally { calls.remove(call); fileSlots.release() }
                }
                synchronized(guard) { check(active()) { "媒体会话已变化" }; check(part.length() > 0 && part.renameTo(destination)) }
                trim(directory, destination)
                return destination
            } finally { part.delete() }
        } } finally { synchronized(guard) { val entry = locks[id]!!; if (entry.second == 1) locks.remove(id) else locks[id] = entry.first to (entry.second - 1) } }
    }
    private fun trim(directory: File, keep: File) = synchronized(guard) {
        val now = System.currentTimeMillis()
        if (now - lastTrim < 60_000) return@synchronized
        lastTrim = now
        val rows = directory.listFiles().orEmpty().filter { !it.name.endsWith(".part") }
        var bytes = rows.sumOf(File::length)
        rows.sortedBy(File::lastModified).forEach { if (bytes > 256L * 1024 * 1024 && it != keep && locks[it.name] == null) { val size = it.length(); if (it.delete()) bytes -= size } }
    }
    fun clear(context: Context): Long = synchronized(guard) {
        var bytes = 0L
        for (name in listOf("media-files-v2", "media")) {
            File(context.cacheDir, name).listFiles().orEmpty().filter { it.isFile && !it.name.endsWith(".part") }.forEach { val length = it.length(); if (it.delete()) bytes += length }
        }
        bytes
    }
}
