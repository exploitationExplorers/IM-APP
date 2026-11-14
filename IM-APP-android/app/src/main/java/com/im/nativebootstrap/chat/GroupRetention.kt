package com.im.nativebootstrap.chat

import com.google.gson.JsonArray
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.time.OffsetDateTime

data class RetentionWatermark(val conversationId:String,val minVisibleSeq:Long,val revision:Long,val updatedAt:String)

/** 业务保留水位是独立的、按环境和账号隔离的持久墓碑，绝不删除 SDK 数据库。 */
class GroupRetention(private val file:File,private val owner:String) {
    private var values:Map<String,RetentionWatermark> = emptyMap()
    init {
        if(file.exists()) {
            val document=JsonParser.parseString(file.readText()).asJsonObject
            check(document.get("schema")?.asInt==1&&document.get("owner")?.asString==owner) { "群历史边界存储格式无效，原件已保留" }
            val array=document.getAsJsonArray("items") ?: error("群历史边界存储缺失")
            val requested=array.map { it.asJsonObject.get("conversationId").asString }.toSet()
            values=parse(array,requested).associateBy(RetentionWatermark::conversationId)
        }
    }
    fun watermark(id:String)=values[id]
    fun permits(target:ChatTarget,message:ChatMessage):Boolean {
        val min=if(target.sessionType==3) values[target.conversationId]?.minVisibleSeq ?: 0 else 0
        return message.seq<=0||message.seq>=min
    }
    fun conversation(item:ChatConversation):ChatConversation {
        val min=values[item.target.conversationId]?.minVisibleSeq ?: return item
        if(item.target.sessionType!=3||item.latestSeq<=0) return item
        return item.copy(preview=if(item.latestSeq<min) "" else item.preview,unread=minOf(item.unread,maxOf(0L,item.latestSeq-min+1).coerceAtMost(Int.MAX_VALUE.toLong()).toInt()))
    }
    fun merge(incoming:List<RetentionWatermark>) {
        val next=values.toMutableMap()
        incoming.forEach { item ->
            val old=next[item.conversationId]
            if(old==null||(item.revision>old.revision&&item.minVisibleSeq>=old.minVisibleSeq)) next[item.conversationId]=item
        }
        if(next==values) return
        val array=JsonArray().apply { next.values.sortedBy { it.conversationId }.forEach { add(jsonBody("conversationId" to it.conversationId,"minVisibleSeq" to it.minVisibleSeq,"revision" to it.revision,"updatedAt" to it.updatedAt)) } }
        val document=jsonBody("schema" to 1,"owner" to owner,"items" to array)
        check(file.parentFile!!.mkdirs()||file.parentFile!!.isDirectory)
        val temporary=File(file.parentFile,file.name+".tmp")
        FileOutputStream(temporary).use { it.write(document.toString().toByteArray());it.fd.sync() }
        Files.move(temporary.toPath(),file.toPath(),StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE)
        values=next
    }
    companion object {
        fun supported(id:String)=Regex("^sg_[0-9a-f]{32}$").matches(id)
        private fun positive(raw:JsonObject,key:String):Long {
            val value=raw.get(key)
            require(value?.isJsonPrimitive==true&&value.asJsonPrimitive.isNumber&&Regex("^[0-9]+$").matches(value.toString())) { "群历史边界不是安全整数" }
            return value.asLong.also { require(it in 1..9_007_199_254_740_991L) }
        }
        fun parse(items:JsonArray,requested:Set<String>):List<RetentionWatermark> {
            require(items.size()<=requested.size) { "群历史边界返回数量异常" }
            val seen=mutableSetOf<String>()
            // 整批验证完成才可落盘，不能部分接受重复或越界会话。
            return items.map { element ->
                val raw=element.asJsonObject
                val id=raw.get("conversationId")?.asString ?: error("缺少会话标识")
                require(id in requested&&supported(id)&&seen.add(id)) { "群历史边界会话异常" }
                val updated=raw.get("updatedAt")?.asString ?: error("缺少边界时间")
                OffsetDateTime.parse(updated)
                RetentionWatermark(id,positive(raw,"minVisibleSeq"),positive(raw,"revision"),updated)
            }
        }
    }
}
