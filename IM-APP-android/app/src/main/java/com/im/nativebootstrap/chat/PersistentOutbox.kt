package com.im.nativebootstrap.chat

import com.google.gson.Gson
import com.google.gson.JsonParser
import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption

enum class OutboxState { PENDING, SENDING, UNCERTAIN, FAILED, ACCEPTED }
data class OutboxEntry(val id: String, val target: ChatTarget, val message: ChatMessage, val state: OutboxState, val updatedAt: Long)
private class OutboxDocument(val schema: Int = 1, val owner: String = "", val entries: List<OutboxEntry> = emptyList())

/** 自有私有文件，不触碰 SDK 表；落盘成功后调用者才可发送。损坏时保留原件并阻止发送。 */
class PersistentOutbox(private val file: File, private val owner: String) {
    private val gson = Gson()
    private var entries: List<OutboxEntry>
    init {
        entries = if (!file.exists()) emptyList() else {
            val raw=JsonParser.parseString(file.readText()).asJsonObject
            check(raw.get("schema")?.asInt==1 && raw.get("owner")?.asString==owner && raw.get("entries")?.isJsonArray==true) { "待发箱格式无效" }
            raw.getAsJsonArray("entries").forEach { item ->
                val entry=item.asJsonObject
                check(entry.get("state")?.asString in OutboxState.entries.map { it.name } && entry.get("updatedAt")?.asLong?.let { it>0 }==true)
                listOf("id","target","message").forEach { check(entry.has(it)&&!entry.get(it).isJsonNull) }
                val target=entry.getAsJsonObject("target")
                check(listOf("conversationId","sessionType","userId","groupId").all { target.has(it)&&!target.get(it).isJsonNull })
                val message=entry.getAsJsonObject("message")
                check(listOf("id","text","mine","time","status","seq","serialized","sender").all { message.has(it)&&!message.get(it).isJsonNull })
            }
            val doc = gson.fromJson(raw, OutboxDocument::class.java)
            check(doc.schema == 1 && doc.owner == owner) { "待发箱账号或格式不匹配" }
            check(doc.entries.map { it.id }.distinct().size==doc.entries.size) { "待发箱消息重复" }
            check(doc.entries.all { it.id.isNotBlank() && it.message.id == it.id && it.target.supported() && it.message.serialized.isNotBlank() }) { "待发箱记录无效" }
            doc.entries.map { if (it.state in listOf(OutboxState.PENDING,OutboxState.SENDING)) it.copy(state = OutboxState.UNCERTAIN) else it }
        }
        if (file.exists()) persist(entries)
    }
    @Synchronized fun all(): List<OutboxEntry> = entries.toList()
    @Synchronized fun put(target: ChatTarget, message: ChatMessage): OutboxEntry {
        require(target.supported() && message.id.isNotBlank() && message.serialized.isNotBlank())
        require(entries.none { it.id == message.id })
        val entry = OutboxEntry(message.id,target,message,OutboxState.PENDING,System.currentTimeMillis())
        val next = entries + entry
        persist(next)
        entries = next
        return entry
    }
    @Synchronized fun update(id: String, state: OutboxState, message: ChatMessage? = null) {
        val current = entries.firstOrNull { it.id == id } ?: return
        require(message==null || message.id==id) { "发送回调消息不匹配" }
        if (current.state == OutboxState.ACCEPTED && state != OutboxState.ACCEPTED) return
        val allowed=when(current.state) {
            OutboxState.PENDING -> setOf(OutboxState.SENDING,OutboxState.UNCERTAIN)
            OutboxState.SENDING -> setOf(OutboxState.UNCERTAIN,OutboxState.FAILED,OutboxState.ACCEPTED)
            OutboxState.UNCERTAIN -> setOf(OutboxState.FAILED,OutboxState.ACCEPTED)
            OutboxState.FAILED -> setOf(OutboxState.SENDING,OutboxState.UNCERTAIN,OutboxState.ACCEPTED)
            OutboxState.ACCEPTED -> setOf(OutboxState.ACCEPTED)
        }
        require(state==current.state || state in allowed) { "待发状态不能跳转" }
        val next = entries.map { if (it.id == id) it.copy(state=state,message=message ?: it.message,updatedAt=System.currentTimeMillis()) else it }
        persist(next)
        entries=next
    }
    @Synchronized fun confirmed(id: String) {
        if(entries.none { it.id==id }) return
        val next=entries.filterNot { it.id==id }
        persist(next)
        entries=next
    }
    private fun persist(value: List<OutboxEntry>) {
        check(file.parentFile!!.mkdirs() || file.parentFile!!.isDirectory)
        val temporary = File(file.parentFile,file.name+".tmp")
        FileOutputStream(temporary).use { stream -> stream.write(gson.toJson(OutboxDocument(1,owner,value)).toByteArray(Charsets.UTF_8));stream.fd.sync() }
        Files.move(temporary.toPath(),file.toPath(),StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE)
    }
}
