package com.im.nativebootstrap.chat

import com.google.gson.Gson
import com.google.gson.JsonParser
import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.UUID

data class PreparedForward(val target:ChatTarget,val message:ChatMessage,val attempted:Boolean=false,val accepted:Boolean=false)
data class PendingForward(val id:String,val sourceConversationId:String,val sources:List<ChatMessage>,val selection:ChatForwardSelection,
    val status:String="queued",val plan:List<PreparedForward> = emptyList(),val remoteTaskIds:List<String> = emptyList(),val createdAt:Long=System.currentTimeMillis(),
    val failureStage:String="",val failureCode:Int?=null) {
    val idempotencyKey:String get()=id.removePrefix("local-forward-")
    fun progress()=ChatForwardProgress(id,status,if(plan.isEmpty())sources.size*selection.targets.size else plan.size,plan.count { it.accepted },if(status=="failed")1 else 0,if(plan.isEmpty())sources.size*selection.targets.size else plan.count { !it.accepted })
}
private data class ForwardDocument(val schema:Int=1,val owner:String="",val entries:List<PendingForward> = emptyList())

/** 先记录幂等键、目标和快照再关闭选择页；中断任务仅由用户触发恢复。 */
class PendingForwards(private val file:File,private val owner:String) {
    private val gson=Gson()
    private var entries:List<PendingForward>
    init {
        entries=if(!file.exists())emptyList() else {
            val raw=JsonParser.parseString(file.readText()).asJsonObject
            check(raw.get("schema")?.asInt==1&&raw.get("owner")?.asString==owner&&raw.get("entries")?.isJsonArray==true)
            gson.fromJson(raw,ForwardDocument::class.java).entries.also { values ->
                check(values.map { it.id }.distinct().size==values.size)
                check(values.all { it.id.startsWith("local-forward-")&&it.sourceConversationId.isNotBlank()&&it.sources.size in 1..100&&it.plan.all { p -> p.target.supported()&&p.message.id.isNotBlank() } })
            }.map { it.copy(status=if(it.status in setOf("queued","processing"))"failed" else it.status,failureStage=it.failureStage.orEmpty()) }
        }
        if(file.exists())persist(entries)
    }
    @Synchronized fun all()=entries.toList()
    @Synchronized fun put(source:String,messages:List<ChatMessage>,selection:ChatForwardSelection):PendingForward {
        require(messages.size in 1..100)
        check(entries.count { it.status!="completed" }<100) { "待处理转发较多，请先查看转发记录" }
        val entry=PendingForward("local-forward-"+UUID.randomUUID(),source,messages,selection)
        val active=entries.filter { it.status!="completed" }
        val completed=entries.filter { it.status=="completed"&&System.currentTimeMillis()-it.createdAt<=7L*24*60*60*1000 }.takeLast(100)
        save((active+completed+entry).sortedBy { it.createdAt })
        return entry
    }
    @Synchronized fun update(id:String,transform:(PendingForward)->PendingForward):PendingForward? {
        val old=entries.firstOrNull { it.id==id } ?: return null
        val next=transform(old);require(next.id==old.id)
        save(entries.map { if(it.id==id)next else it });return next
    }
    private fun save(next:List<PendingForward>) { persist(next);entries=next }
    private fun persist(next:List<PendingForward>) {
        check(file.parentFile!!.mkdirs()||file.parentFile!!.isDirectory)
        val temp=File(file.parentFile,file.name+".tmp")
        FileOutputStream(temp).use { it.write(gson.toJson(ForwardDocument(1,owner,next)).toByteArray());it.fd.sync() }
        Files.move(temp.toPath(),file.toPath(),StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING)
    }
}
