package com.im.nativebootstrap.media

import android.content.Context

/** 离线页面截图用的受控缓存；生产代码不包含合成数据入口。 */
@OptIn(coil.annotation.ExperimentalCoilApi::class)
object MediaFixture {
    fun seed(context: Context, url: String, bytes: ByteArray, mime: String) {
        val cache = MediaLoader.encodedCache(context)!!
        val id = MediaLoader.id(url)
        cache.remove(id)
        val editor = cache.openEditor(id) ?: error("Fixture editor unavailable")
        try {
            val now = System.currentTimeMillis()
            editor.metadata.toFile().writeText("$now\n$now\n1\n3\nContent-Type: $mime\nCache-Control: public, max-age=31536000, immutable\nContent-Length: ${bytes.size}\n")
            editor.data.toFile().writeBytes(bytes)
            editor.commit()
        } catch (error: Throwable) { editor.abort(); throw error }
    }
    fun remove(context: Context, url: String) { MediaLoader.encodedCache(context)?.remove(MediaLoader.id(url)) }
    fun exists(context: Context, url: String): Boolean = MediaLoader.encodedCache(context)?.openSnapshot(MediaLoader.id(url))?.use { true } ?: false
}
