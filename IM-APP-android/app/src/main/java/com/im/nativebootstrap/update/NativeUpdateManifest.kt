package com.im.nativebootstrap.update

import com.google.gson.JsonObject
import com.im.nativebootstrap.business.NativeRelease
import java.net.URI

/** 独立原生内测分发清单，不与 uni-app 的 canary/test/prod 发布记录共用。 */
object NativeUpdateManifest {
    const val CHANNEL = "native-staging"
    private val sha256 = Regex("^[0-9a-fA-F]{64}$")

    fun https(raw: String): URI {
        val uri = URI(raw)
        require(uri.scheme == "https" && !uri.host.isNullOrBlank() && uri.userInfo == null && uri.fragment == null) { "更新地址必须为 HTTPS。" }
        return uri
    }

    fun parse(value: JsonObject, applicationId: String, installedSigners: Set<String>, currentVersion: Long): NativeRelease? {
        fun text(key: String) = value.get(key)?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isString }?.asString.orEmpty()
        fun number(key: String) = value.get(key)?.asBigDecimal?.longValueExact() ?: error("更新清单缺少 $key")
        require(number("schemaVersion") == 1L && text("platform") == "android" && text("channel") == CHANNEL) { "更新清单格式或渠道不匹配。" }
        require(text("applicationId") == applicationId && text("releaseFamily") == NativeRelease.FAMILY) { "更新清单不属于当前原生应用。" }
        val signers = value.getAsJsonArray("certificateSha256")?.map { it.asString.lowercase() }?.toSet().orEmpty()
        require(signers.isNotEmpty() && signers.all { sha256.matches(it) } && signers == installedSigners.map { it.lowercase() }.toSet()) { "更新清单签名与当前应用不匹配，请联系工作人员。" }
        val version = number("versionCode")
        require(version in 1..2_100_000_000L) { "更新版本号无效。" }
        if (version <= currentVersion) return null
        val name = text("versionName")
        require(name.isNotBlank() && name.length <= 32) { "更新版本信息不完整。" }
        val digest = text("sha256").lowercase()
        val size = number("sizeBytes")
        require(sha256.matches(digest) && size in 1..NativeRelease.MAX_BYTES) { "更新安装包校验信息不完整。" }
        return NativeRelease(version, name, https(text("downloadUrl")).toASCIIString(), text("changelog").take(2000), digest, size)
    }
}
