package com.im.nativebootstrap.chat

import com.google.gson.JsonElement
import com.google.gson.JsonObject

/** 由账号会话注入；仅从控制器的 IO 队列调用，令牌不进入媒体下载请求。 */
interface ChatBusiness {
    val baseUrl: String
    fun request(method: String, path: String, body: JsonObject? = null, query: Map<String, String> = emptyMap()): JsonElement
    fun uploadMedia(media:com.im.nativebootstrap.media.LocalMedia)=com.im.nativebootstrap.media.ChatMediaUploader.upload(this,media)
    fun prepareMedia(media:com.im.nativebootstrap.media.LocalMedia)=media
    fun rememberForwardMedia(source:ChatMessage,preserved:JsonObject) {}
}
data class ChatInviteResult(val nextAction:String,val groupId:String)

enum class ChatAction {
    FAVORITE, RECALL, DELETE_LOCAL, PIN_SELF, PIN_SHARED, UNPIN, OPEN_PIN, OPEN_MESSAGE, MENTION,
    MUTE_10_MIN, MUTE_1_HOUR, MUTE_12_HOURS, MUTE_1_DAY, MUTE_7_DAYS, MUTE_30_DAYS,
    UNMUTE, KICK, KICK_AND_DELETE, PURGE,
}

internal fun ChatAction.muteSeconds():Int? = when(this) {
    ChatAction.MUTE_10_MIN -> 600
    ChatAction.MUTE_1_HOUR -> 3600
    ChatAction.MUTE_12_HOURS -> 43200
    ChatAction.MUTE_1_DAY -> 86400
    ChatAction.MUTE_7_DAYS -> 604800
    ChatAction.MUTE_30_DAYS -> 2592000
    else -> null
}

fun businessUserId(imId: String): String {
    val value = imId.trim().lowercase()
    if (Regex("^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$").matches(value)) return value
    if (!Regex("^[0-9a-f]{32}$").matches(value)) return ""
    return "${value.take(8)}-${value.substring(8,12)}-${value.substring(12,16)}-${value.substring(16,20)}-${value.substring(20)}"
}

internal fun jsonBody(vararg pairs: Pair<String, Any?>) = JsonObject().apply {
    pairs.forEach { (key, value) -> when(value) {
        is String -> addProperty(key,value)
        is Number -> addProperty(key,value)
        is Boolean -> addProperty(key,value)
        is JsonElement -> add(key,value)
        null -> Unit
        else -> error("不受支持的请求字段")
    } }
}
