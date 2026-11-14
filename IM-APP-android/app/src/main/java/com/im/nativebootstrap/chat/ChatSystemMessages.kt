package com.im.nativebootstrap.chat

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.im.nativebootstrap.media.*

/** 沿用旧版 im-notification.ts；未知通知不展示协议 JSON 或管理账号。 */
object ChatSystemMessages {
    fun format(serialized:String,ownerName:String="群主",resolve:(String)->String={ "" }):String=runCatching {
        val raw=JsonParser.parseString(serialized).asJsonObject
        val type=raw.number("contentType","ContentType").toInt()
        if(type in setOf(1201,1204))return@runCatching "你们已成为好友，现在可以开始聊天了"
        val detail=parseObject(raw.obj("notificationElem","NotificationElem").field("detail","Detail")) ?: parseObject(raw.field("content","Content")) ?: JsonObject()
        fun admin(user:JsonObject)=user.string("userID","UserID")=="imAdmin"||user.string("nickname","Nickname")=="imAdmin"
        fun name(user:JsonObject,fallback:String=""):String {
            if(admin(user))return ownerName.ifBlank { fallback.ifBlank { "群主" } }
            return resolve(user.string("userID","UserID")).trim().ifBlank { user.string("nickname","Nickname").trim().ifBlank { fallback } }
        }
        fun names(vararg fields:String):String {
            val list=detail.field(*fields)?.takeIf { it.isJsonArray }?.asJsonArray ?: return ""
            return list.mapNotNull { it.takeIf { value -> value.isJsonObject }?.asJsonObject }.joinToString("、") { name(it,"成员") }
        }
        val opUser=detail.obj("opUser","OpUser")
        val op=name(opUser,raw.string("senderNickname","SenderNickname").replace("imAdmin",ownerName.ifBlank { "群主" }))
        when(type) {
            1501 -> "新群创建成功，一起来聊天吧"
            1504 -> name(detail.obj("quitUser","QuitUser"),"成员")+" 退出了群聊"
            1507 -> if(op.isNotBlank())"$op 将群主转让给 ${names("groupMemberList","GroupMemberList","memberList","MemberList").ifBlank { "新群主" }}" else "群主已转让"
            1508 -> names("kickedUserList","KickedUserList").ifBlank { "成员" }.let { if(op.isNotBlank())"${op}把${it}移除群聊" else "${it}被移除群聊" }
            1509 -> names("invitedUserList","InvitedUserList").ifBlank { "成员" }.let { if(admin(opUser)||op.isBlank())"$it 加入了群聊" else "$op 邀请 $it 加入群聊" }
            1510 -> name(detail.obj("entrantUser","EntrantUser"),names("memberList","MemberList").ifBlank { "成员" })+" 加入了群聊"
            1511 -> if(op.isNotBlank())"$op 解散了群聊" else "群聊已解散"
            1512 -> name(detail.obj("mutedUser","MutedUser"),"成员").let { if(op.isNotBlank())"$op 禁言了 $it" else "$it 被禁言" }
            1513 -> name(detail.obj("mutedUser","MutedUser"),"成员").let { if(op.isNotBlank())"$op 取消了 $it 的禁言" else "$it 被取消禁言" }
            1514 -> if(op.isNotBlank())"$op: [全体禁言]" else "[全体禁言]"
            1515 -> if(op.isNotBlank())"$op: [取消全体禁言]" else "[取消全体禁言]"
            1517 -> names("groupMemberList","GroupMemberList","memberList","MemberList").ifBlank { "成员" }.let { if(op.isNotBlank())"$op 将 $it 设为管理员" else "$it 成为管理员" }
            1518 -> names("groupMemberList","GroupMemberList","memberList","MemberList").ifBlank { "成员" }.let { if(op.isNotBlank())"$op 将 $it 取消管理员" else "$it 被取消管理员" }
            1519 -> if(op.isNotBlank())"$op 修改了群公告" else "群公告已更新"
            1520 -> if(op.isNotBlank())"$op 修改了群名称" else "群名称已修改"
            else -> ""
        }
    }.getOrDefault("")
    fun lastSeen(iso:String,online:Boolean,now:Long=System.currentTimeMillis()):String {
        if(online)return "在线"
        val time=runCatching { java.time.OffsetDateTime.parse(iso).toInstant().toEpochMilli() }.getOrNull() ?: return ""
        val diff=(now-time).coerceAtLeast(0)
        return when { diff<60_000 -> "刚刚在线";diff<3_600_000 -> "${diff/60_000}分钟前在线";diff<86_400_000 -> "今天在线";diff<172_800_000 -> "昨天在线";diff<604_800_000 -> "1周内有上线";diff<2_592_000_000 -> "1个月内有上线";else -> "很久未上线" }
    }
}
