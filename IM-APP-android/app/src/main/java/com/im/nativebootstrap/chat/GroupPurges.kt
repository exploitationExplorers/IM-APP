package com.im.nativebootstrap.chat

import com.google.gson.JsonArray
import com.google.gson.JsonParser
import com.im.nativebootstrap.media.MessageContents
import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.time.OffsetDateTime

data class GroupMessagePurge(val userId:String,val beforeMillis:Long)

/** 成员清理只隐藏该发送者在清理时间之前的历史，重新入群后的消息仍可显示。 */
class GroupPurges(private val file:File,private val owner:String) {
    private var values:Map<String,Map<String,Long>> = emptyMap()
    init {
        if(file.exists()) {
            val raw=JsonParser.parseString(file.readText()).asJsonObject
            check(raw.get("schema")?.asInt==1&&raw.get("owner")?.asString==owner) { "成员消息清理记录无效，原文件已保留" }
            val groups=raw.getAsJsonObject("groups") ?: error("成员消息清理记录缺失")
            values=groups.entrySet().associate { (id,items) ->
                require(GroupRetention.supported(id))
                val group=items.asJsonObject.entrySet().associate { (user,time) ->
                    require(businessUserId(user)==user)
                    val millis=time.asLong.also { require(it>0) }
                    user to millis
                }
                id to group
            }
        }
    }
    fun permits(target:ChatTarget,message:ChatMessage):Boolean {
        if(target.sessionType!=3||message.mine)return true
        val rules=values[target.conversationId] ?: return true
        val sender=businessUserId(MessageContents.parse(message.serialized,message.text).senderId)
        val boundary=rules[sender] ?: return true
        val millis=if(message.time in 1 until 10_000_000_000L)message.time*1000 else message.time
        return millis>=boundary
    }
    fun conversation(item:ChatConversation):ChatConversation {
        val latest=item.latestMessage ?: return item
        return if(permits(item.target,latest))item else item.copy(preview="")
    }
    fun merge(conversationId:String,incoming:List<GroupMessagePurge>) {
        require(GroupRetention.supported(conversationId))
        val group=values[conversationId].orEmpty().toMutableMap()
        incoming.forEach { item ->
            require(businessUserId(item.userId)==item.userId&&item.beforeMillis>0)
            group[item.userId]=maxOf(group[item.userId] ?: 0,item.beforeMillis)
        }
        val next=values+ (conversationId to group)
        if(next==values)return
        val groups=com.google.gson.JsonObject().apply { next.forEach { (id,items) -> add(id,com.google.gson.JsonObject().apply { items.forEach { (user,time) -> addProperty(user,time) } }) } }
        val document=jsonBody("schema" to 1,"owner" to owner,"groups" to groups)
        check(file.parentFile!!.mkdirs()||file.parentFile!!.isDirectory)
        val part=File(file.parentFile,file.name+".tmp")
        FileOutputStream(part).use { it.write(document.toString().toByteArray());it.fd.sync() }
        Files.move(part.toPath(),file.toPath(),StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE)
        values=next
    }
    companion object {
        fun parse(items:JsonArray):List<GroupMessagePurge> {
            val seen=mutableSetOf<String>()
            return items.map { value ->
                val raw=value.asJsonObject
                val user=raw.get("userId")?.asString ?: error("清理成员标识缺失")
                require(businessUserId(user)==user&&seen.add(user)) { "清理成员标识无效或重复" }
                val millis=OffsetDateTime.parse(raw.get("purgedAt")?.asString ?: error("清理时间缺失")).toInstant().toEpochMilli()
                require(millis>0) { "清理时间无效" }
                GroupMessagePurge(user,millis)
            }
        }
    }
}
