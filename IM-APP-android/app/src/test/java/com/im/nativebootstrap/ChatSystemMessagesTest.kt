package com.im.nativebootstrap

import com.im.nativebootstrap.chat.ChatSystemMessages
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class ChatSystemMessagesTest {
    @Test fun groupNoticesKeepNamesAndHideTheInternalAdminAccount() {
        val invite="""{"contentType":1509,"notificationElem":{"detail":{"opUser":{"userID":"imAdmin","nickname":"imAdmin"},"invitedUserList":[{"userID":"one","nickname":"小明"},{"nickname":"小王"}]}}}"""
        assertEquals("小明、小王 加入了群聊",ChatSystemMessages.format(invite,"群主本人"))
        val admin="""{"ContentType":1517,"NotificationElem":{"Detail":"{\"OpUser\":{\"UserID\":\"operator\",\"Nickname\":\"操作者\"},\"GroupMemberList\":[{\"UserID\":\"one\",\"Nickname\":\"小明\"}]}"}}"""
        assertEquals("操作者 将 我的备注 设为管理员",ChatSystemMessages.format(admin) { if(it=="one")"我的备注" else "" })
        assertEquals("新群创建成功，一起来聊天吧",ChatSystemMessages.format("""{"contentType":1501}"""))
        assertEquals("",ChatSystemMessages.format("""{"contentType":1502,"content":"private-json"}"""))
    }
    @Test fun friendAndMuteNoticesUseTheOldVisibleWording() {
        assertEquals("你们已成为好友，现在可以开始聊天了",ChatSystemMessages.format("""{"contentType":1204}"""))
        val mute="""{"ContentType":1514,"SenderNickname":"imAdmin","NotificationElem":{"Detail":{"OpUser":{"UserID":"imAdmin"}}}}"""
        assertEquals("真正群主: [全体禁言]",ChatSystemMessages.format(mute,"真正群主"))
        assertEquals("",ChatSystemMessages.format("invalid json"))
    }
    @Test fun lastSeenUsesOnlyRealStatusAndValidServerTimestamps() {
        val now=Instant.parse("2026-11-13T12:00:00Z").toEpochMilli()
        assertEquals("在线",ChatSystemMessages.lastSeen("",true,now))
        assertEquals("",ChatSystemMessages.lastSeen("invalid",false,now))
        assertEquals("5分钟前在线",ChatSystemMessages.lastSeen("2026-11-13T11:55:00Z",false,now))
        assertEquals("昨天在线",ChatSystemMessages.lastSeen("2026-11-12T00:00:00Z",false,now))
        assertEquals("很久未上线",ChatSystemMessages.lastSeen("2026-09-01T12:00:00Z",false,now))
    }
}
