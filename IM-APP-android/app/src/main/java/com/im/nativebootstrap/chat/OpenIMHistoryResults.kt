package com.im.nativebootstrap.chat

import io.openim.android.sdk.models.AdvancedMessage
import io.openim.android.sdk.models.Message
import com.google.gson.JsonParser

internal object OpenIMHistoryResults {
    fun previewSafe(message:Message):Boolean {
        if(message.clientMsgID.isNullOrBlank()||message.status>=4||message.attachedInfoElem?.isPrivateChat==true)return false
        val encoded=message.attachedInfo.orEmpty()
        if(encoded.isBlank())return true
        // 本地搜索不执行 Core 高级历史的阅后即焚过滤；私聊记录统一交完整 SDK 渠道处理。
        return runCatching {
            val parsed=JsonParser.parseString(encoded)
            // Core 将空 AttachedInfoElem 指针编码成 JSON null，代表没有附加元数据。
            if(parsed.isJsonNull)true else {
                val raw=parsed.asJsonObject
                listOf("isPrivateChat","IsPrivateChat").none { raw.get(it)?.asBoolean==true }
            }
        }.getOrDefault(false)
    }
    fun page(value:AdvancedMessage,map:(Message)->ChatMessage):Result<HistoryPage> {
        val local=value.messageList.orEmpty().filter { !it.clientMsgID.isNullOrBlank()&&it.status<4 }.map(map)
        return if(value.errCode!=0&&local.isEmpty())Result.failure(ChatFailure(value.errCode))
        else Result.success(HistoryPage(local,value.errCode==0&&value.isEnd,value.lastMinSeq))
    }
}
