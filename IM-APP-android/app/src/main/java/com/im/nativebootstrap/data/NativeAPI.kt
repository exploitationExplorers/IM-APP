package com.im.nativebootstrap.data

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL

object RuntimeEndpoints {
    const val DEFAULT_API_BASE_URL = "https://www.xn--jprz53bj9s.com/api/v1"
}

// 凭据不是 data class，默认 toString 不会打印字段。
class TokenPair(val accessToken: String, val refreshToken: String, val expiresIn: Long)
class BusinessProfile(val businessUserId: String, val nickname: String, val publicId: String = "", val phoneMasked: String = "")
class AuthResult(val tokens: TokenPair, val profile: BusinessProfile) {
    val businessUserId: String get() = profile.businessUserId
    val nickname: String get() = profile.nickname
}
class IMCredentials(val imUserId: String, val token: String, val platform: Int, val expireSec: Long, val apiAddr: String, val wsAddr: String)

data class SMSReceipt(val retryAfterSec: Int, val expiresIn: Int)
class APIRequest(val url: String, val headers: Map<String, String>, val body: String = "", val method: String = "POST")
class APIResponse(val status: Int, val body: String)
fun interface HTTPTransport { fun execute(request: APIRequest): APIResponse }
class APIException(message: String) : Exception(message)

class URLConnectionTransport : HTTPTransport {
    override fun execute(request: APIRequest): APIResponse {
        val connection = URL(request.url).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = request.method
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 15_000
            connection.readTimeout = 15_000
            connection.doOutput = request.method != "GET"
            request.headers.forEach { (key, value) -> connection.setRequestProperty(key, value) }
            if (connection.doOutput) connection.outputStream.use { it.write(request.body.toByteArray(Charsets.UTF_8)) }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val body = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            return APIResponse(status, body)
        } finally {
            connection.disconnect()
        }
    }
}

/** 默认使用现有服务的 HTTPS 入口，开发入口可显式覆盖；禁止降级 HTTP。 */
class NativeAPI(baseURL: String = RuntimeEndpoints.DEFAULT_API_BASE_URL, private val transport: HTTPTransport = URLConnectionTransport()) {
    private val base: String
    init {
        val uri = URI(baseURL.trim())
        require(uri.scheme == "https" && !uri.host.isNullOrBlank() && uri.userInfo == null && uri.query == null && uri.fragment == null) {
            "请填写 HTTPS 服务地址，不包含账号、query 或 fragment"
        }
        val path = uri.path.orEmpty().trimEnd('/')
        require(path.isEmpty() || path == "/api/v1") { "服务地址路径应为空或 /api/v1" }
        base = "${uri.scheme}://${uri.rawAuthority}/api/v1"
    }

    fun passwordLogin(countryCode: String, phone: String, password: String, deviceId: String): AuthResult =
        parseAuth(post("/auth/login", fields("countryCode" to countryCode, "phone" to phone, "password" to password, "deviceId" to deviceId)))

    fun smsLogin(countryCode: String, phone: String, code: String, deviceId: String): AuthResult =
        parseAuth(post("/auth/login/sms", fields("countryCode" to countryCode, "phone" to phone, "code" to code, "deviceId" to deviceId)))

    fun profile(accessToken: String): BusinessProfile = parseProfile(request("/me", token = accessToken, method = "GET"))

    fun sendSms(countryCode: String, phone: String, deviceId: String): SMSReceipt {
        val value = post("/auth/sms/send", fields("countryCode" to countryCode, "phone" to phone, "scene" to "login", "deviceId" to deviceId))
        return SMSReceipt(value.number("retryAfterSec").toInt(), value.number("expiresIn").toInt())
    }

    fun refreshToken(refreshToken: String, deviceId: String): TokenPair =
        parseTokens(post("/auth/token/refresh", fields("refreshToken" to refreshToken, "deviceId" to deviceId)))

    // 仅保留后续 SDK 适配接口；业务登录流程不调用，避免额外签发 IM Token。
    fun imToken(accessToken: String): IMCredentials {
        val body = JsonObject().apply { addProperty("platformId", 2) }
        val value = post("/im/token", body, accessToken)
        val platform = value.number("platform").toInt()
        if (platform != 2) throw APIException("IM 平台号与 Android 请求不一致")
        val api = value.string("apiAddr")
        val ws = value.string("wsAddr")
        fun validEndpoint(url: String, scheme: String): Boolean {
            val uri = URI(url)
            return uri.scheme == scheme && !uri.host.isNullOrBlank() && uri.userInfo == null && uri.fragment == null && uri.query == null
        }
        if (!validEndpoint(api, "https") || !validEndpoint(ws, "wss")) throw APIException("IM 地址必须为无账号或查询参数的 HTTPS / WSS 地址")
        val expiry = value.number("expireSec")
        if (expiry <= 0) throw APIException("IM 凭据有效期无效")
        return IMCredentials(value.string("userId"), value.string("token"), platform, expiry, api, ws)
    }

    private fun post(path: String, data: JsonObject, token: String? = null): JsonObject = request(path, data, token)

    private fun request(path: String, data: JsonObject? = null, token: String? = null, method: String = "POST"): JsonObject {
        val headers = mutableMapOf("Accept" to "application/json")
        if (data != null) headers["Content-Type"] = "application/json"
        if (token != null) headers["Authorization"] = "Bearer $token"
        val response = transport.execute(APIRequest(base + path, headers, data?.toString().orEmpty(), method))
        val secrets = listOfNotNull(token) + listOf("password", "code", "accessToken", "refreshToken").mapNotNull { name ->
            data?.get(name)?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isString }?.asString
        }
        val envelope = try { JsonParser.parseString(response.body).takeIf { it.isJsonObject }?.asJsonObject } catch (_: Exception) { null }
        if (response.status !in 200..299) {
            val message = if (response.status in 400..499) serverMessage(envelope, secrets) else null
            throw APIException(message ?: "请求失败（HTTP ${response.status}）")
        }
        try {
            if (envelope == null) throw APIException("服务返回了无法解析的数据")
            if (envelope.number("code") != 0L) throw APIException(serverMessage(envelope, secrets) ?: "服务未接受请求，请检查账号或稍后重试")
            val result = envelope.get("data")
            if (result == null || !result.isJsonObject) throw APIException("服务响应缺少结果")
            return result.asJsonObject
        } catch (e: APIException) {
            throw e
        } catch (_: Exception) {
            throw APIException("服务返回了无法解析的数据")
        }
    }

    private fun serverMessage(envelope: JsonObject?, secrets: List<String>): String? {
        val field = envelope?.get("message") ?: return null
        if (!field.isJsonPrimitive || !field.asJsonPrimitive.isString) return null
        var message = field.asString.replace(Regex("[\\p{Cc}\\p{Cf}]"), " ").trim()
        secrets.filter { it.isNotBlank() }.forEach { message = message.replace(it, "（已隐藏）") }
        // 只显示短业务提示；不回显 JSON、HTML 或疑似凭据内容。
        if (message.isBlank() || Regex("(?i)(access[ _-]?token|refresh[ _-]?token|authorization|bearer|eyJ[A-Za-z0-9_-]{8,}\\.|[{}<>])").containsMatchIn(message)) return null
        message = message.replace(Regex("[A-Za-z0-9_+/=-]{32,}"), "（已隐藏）")
        return message.take(160)
    }

    private fun parseAuth(value: JsonObject): AuthResult {
        val user = value.get("user")?.takeIf { it.isJsonObject }?.asJsonObject ?: throw APIException("服务响应缺少用户")
        return AuthResult(parseTokens(value), parseProfile(user))
    }
    private fun parseProfile(value: JsonObject): BusinessProfile = BusinessProfile(
        value.string("id"), value.string("nickname", allowBlank = true), value.optionalString("publicId"), value.optionalString("phoneMasked"),
    )
    private fun parseTokens(value: JsonObject): TokenPair {
        val expiry = value.number("expiresIn")
        if (expiry <= 0) throw APIException("业务凭据有效期无效")
        return TokenPair(value.string("accessToken"), value.string("refreshToken"), expiry)
    }
    private fun fields(vararg entries: Pair<String, String>): JsonObject = JsonObject().apply {
        entries.forEach { (key, value) -> addProperty(key, value) }
    }
}

private fun JsonObject.string(key: String, allowBlank: Boolean = false): String {
    val field = get(key)
    if (field == null || !field.isJsonPrimitive || !field.asJsonPrimitive.isString || (!allowBlank && field.asString.isBlank())) throw APIException("服务响应字段缺失：$key")
    return field.asString
}
private fun JsonObject.optionalString(key: String): String {
    val field = get(key)
    if (field == null || field.isJsonNull) return ""
    return string(key, allowBlank = true)
}
private fun JsonObject.number(key: String): Long {
    val field = get(key)
    if (field == null || !field.isJsonPrimitive || !field.asJsonPrimitive.isNumber) throw APIException("服务响应字段缺失：$key")
    return try { field.asBigDecimal.longValueExact() } catch (_: ArithmeticException) {
        throw APIException("服务响应整数无效：$key")
    }
}
