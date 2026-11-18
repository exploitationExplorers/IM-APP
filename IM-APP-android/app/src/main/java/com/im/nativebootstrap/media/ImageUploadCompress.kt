package com.im.nativebootstrap.media

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import androidx.exifinterface.media.ExifInterface
import java.io.File

/**
 * 服务端直传表单策略单文件上限 20MB（server oss.go MaxFormUploadBytes / minio.go SetContentLengthRange）。
 * 超限图片在发送前本地降采样 + JPEG 重编码，对用户无感；压缩副本落在缓存目录，原文件不动。
 * 仅处理 IMAGE 且超过触发阈值的情况，其余原样返回。
 */
object ImageUploadCompress {
    private const val SERVER_LIMIT_BYTES = 20L * 1024 * 1024
    private const val TRIGGER_BYTES = 18L * 1024 * 1024
    private val MAX_SIDES = intArrayOf(4096, 3072, 2048, 1440)
    private val QUALITIES = intArrayOf(88, 80, 70, 60)

    fun compressIfNeeded(media: LocalMedia, cacheDir: File): LocalMedia {
        if (media.kind != MediaKind.IMAGE || media.file.length() <= TRIGGER_BYTES) return media
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(media.file.absolutePath, bounds)
        check(bounds.outWidth > 0 && bounds.outHeight > 0) { "图片暂不可读取，请重试" }
        val rotation = runCatching {
            when (ExifInterface(media.file.absolutePath).rotationDegrees) { 90 -> 90; 180 -> 180; 270 -> 270; else -> 0 }
        }.getOrDefault(0)
        var produced: File? = null
        loop@ for (maxSide in MAX_SIDES) for (quality in QUALITIES) {
            val candidate = render(media.file, bounds.outWidth, bounds.outHeight, rotation, maxSide, quality, cacheDir) ?: continue
            produced = candidate
            if (candidate.length() <= SERVER_LIMIT_BYTES) break@loop
        }
        val compressed = produced?.takeIf { it.length() <= SERVER_LIMIT_BYTES } ?: error("图片过大暂无法压缩，请重试")
        val dims = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(compressed.absolutePath, dims)
        return LocalMedia(
            compressed, "${media.file.nameWithoutExtension}.jpg", "image/jpeg", MediaKind.IMAGE,
            width = dims.outWidth.coerceAtLeast(0), height = dims.outHeight.coerceAtLeast(0),
            duration = media.duration, snapshot = media.snapshot,
        )
    }

    private fun render(source: File, rawW: Int, rawH: Int, rotation: Int, maxSide: Int, quality: Int, cacheDir: File): File? {
        var sample = 1
        while (maxOf(rawW, rawH) / (sample * 2) >= maxSide) sample *= 2
        val raw = BitmapFactory.decodeFile(source.absolutePath, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return null
        val rotated = if (rotation != 0) Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height, Matrix().apply { postRotate(rotation.toFloat()) }, true) else raw
        val scaled = if (maxOf(rotated.width, rotated.height) > maxSide) {
            val scale = maxSide.toFloat() / maxOf(rotated.width, rotated.height)
            Bitmap.createScaledBitmap(rotated, (rotated.width * scale).toInt().coerceAtLeast(1), (rotated.height * scale).toInt().coerceAtLeast(1), true)
        } else rotated
        val out = File(cacheDir, "upload-compress-${System.nanoTime()}.jpg")
        val ok = runCatching { out.outputStream().use { scaled.compress(Bitmap.CompressFormat.JPEG, quality, it) } }.isSuccess
        if (scaled !== rotated && scaled !== raw) scaled.recycle()
        if (rotated !== raw) rotated.recycle()
        raw.recycle()
        if (!ok) { out.delete(); return null }
        return out
    }
}
