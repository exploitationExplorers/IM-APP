package com.im.nativebootstrap.media

import java.net.URI
import java.net.URLDecoder
import java.security.MessageDigest

/** 只在受控存储规则内分离对象与临时授权；未知地址逐字节保留身份。 */
object MediaCacheIdentity {
    private val stores = mapOf(
        "oss-chat.whs188.xin" to listOf("/im-app-production/chat/", "/oss-test/chat/"),
        "oss-chat-test.xn--jprz53bj9s.com" to listOf("/im-app-production/chat/", "/oss-test/chat/"),
        "oss-business.whs188.xin" to listOf("/im-app-production/business/", "/oss-test/business/"),
        "oss-business-test.xn--jprz53bj9s.com" to listOf("/im-app-production/business/", "/oss-test/business/")
    )
    private val temporaryAuth = setOf("ossaccesskeyid", "signature", "expires", "security-token",
        "x-oss-access-key-id", "x-oss-signature", "x-oss-expires", "x-oss-date", "x-oss-security-token",
        "x-oss-credential", "x-oss-signature-version", "x-oss-additional-headers",
        "x-amz-algorithm", "x-amz-credential", "x-amz-date", "x-amz-expires", "x-amz-signedheaders",
        "x-amz-signature", "x-amz-security-token")
    fun digest(value: String): String = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }
    fun scope(base: String, account: String) = digest("media-v2\n${base.trim().trimEnd('/')}\n$account")
    fun key(url: String, scope: String, base: String): String = digest("$scope\n${canonical(url, base)}")
    internal fun canonical(raw: String, base: String): String = runCatching {
        val uri = URI(raw)
        val host = uri.host.orEmpty().lowercase()
        val origin = URI(base)
        val sameOrigin = uri.scheme.equals(origin.scheme, true) && host == origin.host.orEmpty().lowercase() && uri.port == origin.port
        val objectRoute = sameOrigin && uri.rawPath.orEmpty().startsWith("/object/")
        val capability = sameOrigin && uri.rawPath == "/api/v1/public/oss-media"
        val controlledStore = stores[host]?.any { uri.rawPath.orEmpty().startsWith(it) } == true
        if (!objectRoute && !capability && !controlledStore) return raw.substringBefore('#')
        val pairs = uri.rawQuery.orEmpty().split('&').filter(String::isNotEmpty).filter { part ->
            // capability 的 token 仍参与身份，绝不泛化剥掉业务鉴权。
            capability || URLDecoder.decode(part.substringBefore('='), "UTF-8").lowercase() !in temporaryAuth
        }
        val names=pairs.map { URLDecoder.decode(it.substringBefore('='),"UTF-8") }
        // 重复参数的先后可能影响服务端语义，不能通过排序将它们合并。
        if(names.distinct().size!=names.size)return raw.substringBefore('#')
        val query=pairs.sorted().joinToString("&")
        "${uri.scheme.lowercase()}://${uri.rawAuthority.lowercase()}${uri.rawPath.orEmpty()}" + if (query.isEmpty()) "" else "?$query"
    }.getOrDefault(raw)
}
