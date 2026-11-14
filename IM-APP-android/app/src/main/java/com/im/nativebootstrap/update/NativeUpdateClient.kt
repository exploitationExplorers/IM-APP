package com.im.nativebootstrap.update

import android.content.Context
import com.google.gson.JsonParser
import com.im.nativebootstrap.BuildConfig
import com.im.nativebootstrap.business.NativeRelease
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection

object NativeUpdateClient {
    val configured: Boolean get() = BuildConfig.NATIVE_UPDATE_MANIFEST_URL.isNotBlank()
    val downloadPage: String get() = BuildConfig.NATIVE_DOWNLOAD_PAGE_URL

    /** 不带业务 Token 读取独立的 HTTPS 清单，每次重定向均重新校验 HTTPS。 */
    fun check(context: Context, currentVersion: Long, ensureActive: () -> Unit = {}): NativeRelease? {
        check(configured) { "尚未配置原生更新入口。" }
        var address = BuildConfig.NATIVE_UPDATE_MANIFEST_URL
        repeat(5) {
            ensureActive()
            val uri = NativeUpdateManifest.https(address)
            val connection = uri.toURL().openConnection() as HttpURLConnection
            connection.connectTimeout = 15_000; connection.readTimeout = 15_000
            connection.instanceFollowRedirects = false
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("Cache-Control", "no-cache")
            try {
                val status = connection.responseCode
                if (status in listOf(301, 302, 303, 307, 308)) {
                    val target = connection.getHeaderField("Location").orEmpty()
                    check(target.isNotBlank()) { "更新入口暂不可用。" }
                    address = uri.resolve(target).toASCIIString()
                } else {
                    check(status == 200) { "更新检查失败，请稍后重试。" }
                    check(connection.contentLengthLong <= 256 * 1024) { "更新清单过大。" }
                    val body = connection.inputStream.use { input ->
                        val output = ByteArrayOutputStream(); val buffer = ByteArray(8192)
                        while (true) {
                            ensureActive()
                            val count = input.read(buffer); if (count < 0) break
                            check(output.size() + count <= 256 * 1024) { "更新清单过大。" }
                            output.write(buffer, 0, count)
                        }
                        output.toString("UTF-8")
                    }
                    return NativeUpdateManifest.parse(JsonParser.parseString(body).asJsonObject, context.packageName, NativeRelease.installedSigners(context), currentVersion)
                }
            } finally { connection.disconnect() }
        }
        error("更新入口重定向过多，请稍后重试。")
    }
}
