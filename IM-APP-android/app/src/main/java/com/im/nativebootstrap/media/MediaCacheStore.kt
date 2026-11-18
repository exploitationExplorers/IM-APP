package com.im.nativebootstrap.media

import android.content.Context
import com.google.gson.Gson
import com.google.gson.JsonParser
import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap

/** 预取/下载时附带的来源信息，用于按群聊/私聊执行不同保留期。 */
data class MediaCacheMeta(
    val kind: String = "",
    val quality: String = "original",
    val conversationId: String = "",
    val messageId: String = "",
    val group: Boolean = false,
    val url: String = "",
)

internal data class CachedMedia(
    val key: String = "",
    val url: String = "",
    val path: String = "",
    val kind: String = "",
    val quality: String = "",
    val conversationId: String = "",
    val messageId: String = "",
    val group: Boolean = false,
    val size: Long = 0,
    val createdAt: Long = 0,
    val lastAccessAt: Long = 0,
)

/**
 * 账号级持久媒体索引。聊天正文仍由 OpenIM SQLite 保存；这里只保存可重新下载的媒体字节。
 * 目录固定落在 filesDir，避免系统清 cacheDir 后断网媒体全部丢失。
 */
internal class MediaCacheStore internal constructor(
    private val root: File,
    private val owner: String,
) {
    companion object {
        private const val GROUP_TTL_MS = 7L * 24 * 60 * 60 * 1000
        private const val PRIVATE_TTL_MS = 14L * 24 * 60 * 60 * 1000
        private val instances = ConcurrentHashMap<String, MediaCacheStore>()

        fun of(context: Context, owner: String): MediaCacheStore {
            val safe = safeOwner(owner)
            val directory = File(File(context.filesDir, "native-chat"), "$safe/media-cache")
            return instances.computeIfAbsent(directory.absolutePath) { MediaCacheStore(directory, owner) }
        }

        private fun safeOwner(owner: String): String {
            val value = owner.trim()
            if (value.matches(Regex("[0-9a-f]{64}"))) return value
            return MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
                .joinToString("") { "%02x".format(it) }
        }
    }

    private val gson = Gson()
    private val indexFile = File(root, "index.json")
    private val entries = LinkedHashMap<String, CachedMedia>()
    private var loaded = false

    init {
        check(root.mkdirs() || root.isDirectory) { "媒体缓存目录不可用" }
    }

    @Synchronized
    fun target(key: String): File {
        require(key.matches(Regex("[0-9a-f]{64}"))) { "媒体缓存标识无效" }
        return File(root, key)
    }

    @Synchronized
    fun owns(file: File): Boolean = owned(file.path)?.isFile == true

    @Synchronized
    fun find(key: String, now: Long = System.currentTimeMillis()): File? {
        ensureLoaded()
        val entry = entries[key] ?: return null
        val ttl = if (entry.group) GROUP_TTL_MS else PRIVATE_TTL_MS
        if (now - entry.createdAt > ttl) return removeLocked(key)
        val file = owned(entry.path) ?: return removeLocked(key)
        if (!file.isFile || file.length() <= 0L) return removeLocked(key)
        if (entry.lastAccessAt < now) entries[key] = entry.copy(lastAccessAt = now)
        return file
    }

    @Synchronized
    fun register(key: String, url: String, file: File, meta: MediaCacheMeta, now: Long = System.currentTimeMillis()) {
        ensureLoaded()
        val path = owned(file.path) ?: error("媒体缓存路径无效")
        require(path.length() > 0L) { "媒体缓存为空" }
        val previous = entries[key]
        entries[key] = CachedMedia(
            key = key,
            url = url,
            path = path.path,
            kind = meta.kind,
            quality = meta.quality,
            conversationId = meta.conversationId,
            messageId = meta.messageId,
            group = meta.group,
            size = path.length(),
            createdAt = previous?.createdAt ?: now,
            lastAccessAt = now,
        )
        persist()
    }

    @Synchronized
    fun tag(key: String, meta: MediaCacheMeta, now: Long = System.currentTimeMillis()) {
        ensureLoaded()
        val entry = entries[key] ?: return
        entries[key] = entry.copy(
            kind = meta.kind.ifBlank { entry.kind },
            quality = meta.quality.ifBlank { entry.quality },
            conversationId = meta.conversationId.ifBlank { entry.conversationId },
            messageId = meta.messageId.ifBlank { entry.messageId },
            group = meta.group || entry.group,
            lastAccessAt = now,
        )
        persist()
    }

    @Synchronized
    fun prune(
        maxBytes: Long,
        groupTtlMs: Long,
        privateTtlMs: Long,
        now: Long = System.currentTimeMillis(),
    ): Long {
        ensureLoaded()
        var removed = 0L
        var changed = false
        val iterator = entries.entries.iterator()
        while (iterator.hasNext()) {
            val entry = iterator.next().value
            val ttl = if (entry.group) groupTtlMs else privateTtlMs
            val file = owned(entry.path)
            if (file == null || !file.isFile || now - entry.createdAt > ttl) {
                removed += file?.length() ?: 0L
                file?.delete()
                iterator.remove()
                changed = true
            }
        }
        var total = entries.values.sumOf { it.size }
        if (total > maxBytes) {
            for (entry in entries.values.sortedBy { it.lastAccessAt }) {
                if (total <= maxBytes) break
                val file = owned(entry.path)
                removed += file?.length() ?: 0L
                file?.delete()
                entries.remove(entry.key)
                total -= entry.size
                changed = true
            }
        }
        if (changed) persist()
        return removed
    }

    @Synchronized
    fun totalBytes(): Long {
        ensureLoaded()
        return entries.values.sumOf { it.size }
    }

    @Synchronized
    fun clear(): Long {
        ensureLoaded()
        var removed = 0L
        entries.values.forEach { entry ->
            val file = owned(entry.path)
            removed += file?.length() ?: 0L
            file?.delete()
        }
        entries.clear()
        indexFile.delete()
        return removed
    }

    private fun owned(raw: String): File? {
        if (raw.isBlank()) return null
        val file = File(raw)
        if (!file.isAbsolute) return null
        val canonical = runCatching { file.canonicalFile }.getOrNull() ?: return null
        val rootPath = runCatching { root.canonicalFile.toPath() }.getOrNull() ?: return null
        return canonical.takeIf { it.toPath().startsWith(rootPath) }
    }

    private fun removeLocked(key: String): File? {
        entries.remove(key)?.let { entries ->
            owned(entries.path)?.delete()
        }
        persist()
        return null
    }

    private fun ensureLoaded() {
        if (loaded) return
        loaded = true
        runCatching {
            if (!indexFile.isFile) return@runCatching
            val document = JsonParser.parseString(indexFile.readText()).asJsonObject
            if (document.get("schema")?.asInt != 1 || document.get("owner")?.asString != owner) return@runCatching
            document.getAsJsonArray("entries")?.forEach { raw ->
                val entry = gson.fromJson(raw, CachedMedia::class.java)
                if (entry.key.matches(Regex("[0-9a-f]{64}")) && owned(entry.path) != null) entries[entry.key] = entry
            }
        }
    }

    private fun persist() {
        val temporary = File(root, "index.json.tmp")
        val document = mapOf("schema" to 1, "owner" to owner, "entries" to entries.values.toList())
        FileOutputStream(temporary).use { stream ->
            stream.write(gson.toJson(document).toByteArray(Charsets.UTF_8))
            stream.fd.sync()
        }
        Files.move(
            temporary.toPath(),
            indexFile.toPath(),
            StandardCopyOption.REPLACE_EXISTING,
            StandardCopyOption.ATOMIC_MOVE,
        )
    }
}
