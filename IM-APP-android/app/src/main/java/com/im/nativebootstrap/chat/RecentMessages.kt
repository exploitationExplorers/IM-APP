package com.im.nativebootstrap.chat

import com.google.gson.JsonElement
import com.im.nativebootstrap.media.number
import com.im.nativebootstrap.media.string

/**
 * 解析后端 /im/conversations/recent-messages 的返回。
 * 后端已经把 OpenIM content 展开成客户端可直接渲染的 serialized。
 */
internal fun parseServerRecentMessages(root: JsonElement, ownIMId: String): Map<String, List<ChatMessage>> {
    val items = runCatching { root.asJsonObject.getAsJsonArray("items") }.getOrNull() ?: return emptyMap()
    val result = LinkedHashMap<String, List<ChatMessage>>()
    items.forEach { element ->
        val conversation = runCatching { element.asJsonObject }.getOrNull() ?: return@forEach
        val conversationId = conversation.string("conversationId")
        if (conversationId.isBlank()) return@forEach
        val messages = conversation.get("messages")
            ?.takeIf { it.isJsonArray }
            ?.asJsonArray
            ?.mapNotNull { raw ->
                val message = runCatching { raw.asJsonObject }.getOrNull() ?: return@mapNotNull null
                val id = message.string("clientMsgId").ifBlank { message.string("clientMsgID") }
                val serialized = message.string("serialized")
                if (id.isBlank() || serialized.isBlank()) return@mapNotNull null
                val senderId = message.string("sendId").ifBlank { message.string("sendID") }
                ChatMessage(
                    id = id,
                    text = message.string("preview"),
                    mine = senderId.isNotBlank() && senderId == ownIMId,
                    time = message.number("sendTime"),
                    status = 2,
                    seq = message.number("seq"),
                    serialized = serialized,
                    sender = message.string("senderNickname"),
                    contentType = message.number("contentType").toInt(),
                    senderId = senderId,
                )
            }
            .orEmpty()
        result[conversationId] = messages
    }
    return result
}
