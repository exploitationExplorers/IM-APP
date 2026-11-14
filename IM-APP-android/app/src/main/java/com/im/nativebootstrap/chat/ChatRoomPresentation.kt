package com.im.nativebootstrap.chat

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest

/** 横幅隐藏只属于当前账号；不修改共享置顶，也不删除原始公告。 */
class ChatRoomPresentation(private val file:File,private val owner:String) {
    private var values=JsonObject()
    init {
        if(file.exists()) {
            val document=JsonParser.parseString(file.readText()).asJsonObject
            check(document.get("schema")?.asInt==1&&document.get("owner")?.asString==owner) { "聊天显示偏好格式无效，原件已保留" }
            values=document.getAsJsonObject("values") ?: error("聊天显示偏好缺失")
            check(values.entrySet().all { it.value.isJsonPrimitive&&it.value.asJsonPrimitive.isString&&Regex("^[0-9a-f]{64}$").matches(it.value.asString) }) { "聊天显示偏好损坏，原件已保留" }
        }
    }
    private fun digest(value:String)=MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString("") { "%02x".format(it) }
    fun dismissed(conversationId:String,kind:String,value:String):Boolean {
        val stored=values.get("$conversationId:$kind")?.asString ?: return false
        return stored==digest(value)
    }
    fun dismiss(conversationId:String,kind:String,value:String) {
        require(kind in setOf("pin","announcement")&&conversationId.isNotBlank()&&value.isNotBlank())
        val next=values.deepCopy().apply { addProperty("$conversationId:$kind",digest(value)) }
        check(file.parentFile!!.mkdirs()||file.parentFile!!.isDirectory)
        val temporary=File(file.parentFile,file.name+".tmp")
        FileOutputStream(temporary).use { it.write(jsonBody("schema" to 1,"owner" to owner,"values" to next).toString().toByteArray());it.fd.sync() }
        Files.move(temporary.toPath(),file.toPath(),StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE)
        values=next
    }
}
