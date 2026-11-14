package com.im.nativebootstrap.chat

import io.openim.android.sdk.models.OfflinePushInfo

/** SDK 将 null 序列化为空字符串；必须传完整对象，和旧 App 的发送协议一致。 */
internal object OpenIMSendOptions {
    fun push() = OfflinePushInfo().apply {
        title = "你收到一条新消息"
        desc = ""
        ex = ""
        setiOSPushSound("+1")
        setiOSBadgeCount(true)
    }
    fun uploaded(type: Int) = type in setOf(102, 103, 104, 105)
}
