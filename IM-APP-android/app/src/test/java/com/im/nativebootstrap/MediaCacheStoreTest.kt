package com.im.nativebootstrap

import com.im.nativebootstrap.media.MediaCacheMeta
import com.im.nativebootstrap.media.MediaCacheStore
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files

class MediaCacheStoreTest {
    private val day = 24L * 60 * 60 * 1000

    @Test
    fun keepsPrivateLongerThanGroupAndEvictsByAge() {
        val root = Files.createTempDirectory("media-cache-test").toFile()
        try {
            val store = MediaCacheStore(root, "owner")
            val now = 10 * day
            val group = write(root, "group", 10)
            val private = write(root, "private", 10)
            store.register(key('a'), "https://example.test/group", group, MediaCacheMeta(kind = "image", group = true), now - 8 * day)
            store.register(key('b'), "https://example.test/private", private, MediaCacheMeta(kind = "image"), now - 8 * day)

            assertNull(store.find(key('a'), now))
            // Windows 下临时目录可能带 8.3 短路径（ADMINI~1），store 返回 canonical 展开后的路径，统一按 canonical 比较。
            assertEquals(private.canonicalFile, store.find(key('b'), now))
        } finally {
            root.deleteRecursively()
        }
    }

    @Test
    fun pruneEvictsLeastRecentlyUsedWhenOverBudget() {
        val root = Files.createTempDirectory("media-cache-test").toFile()
        try {
            val store = MediaCacheStore(root, "owner")
            val now = 20 * day
            val old = write(root, "old", 10)
            val fresh = write(root, "fresh", 10)
            store.register(key('c'), "https://example.test/old", old, MediaCacheMeta(kind = "file"), now - 2 * day)
            store.register(key('d'), "https://example.test/fresh", fresh, MediaCacheMeta(kind = "file"), now - day)

            assertTrue(store.prune(15, 7 * day, 14 * day, now) >= 10)
            assertNull(store.find(key('c'), now))
            assertEquals(fresh.canonicalFile, store.find(key('d'), now))
            assertTrue(store.totalBytes() <= 15)
        } finally {
            root.deleteRecursively()
        }
    }

    private fun write(root: File, name: String, size: Int): File =
        File(root, name).apply { writeBytes(ByteArray(size) { 1 }) }

    private fun key(value: Char) = value.toString().repeat(64)
}
