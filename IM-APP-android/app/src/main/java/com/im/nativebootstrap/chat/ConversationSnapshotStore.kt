package com.im.nativebootstrap.chat

import com.google.gson.Gson
import com.google.gson.JsonParser
import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption

/**
 * 会话列表首屏快照（对齐 YanChat Room 会话缓存的效果）：
 * 登录/SDK 就绪前先渲染上一轮会话行，SDK 权威快照到达后对账替换。
 * 缓存只是加速层，损坏或账号不匹配时静默丢弃重建，绝不阻断聊天。
 */
class ConversationSnapshotStore(private val file:File, private val owner:String):ConversationCache {
    private val gson=Gson()
    override fun load():List<ChatConversation> {
        if(!file.exists())return emptyList()
        return runCatching {
            val raw=JsonParser.parseString(file.readText()).asJsonObject
            check(raw.get("schema")?.asInt==1&&raw.get("owner")?.asString==owner)
            val items=raw.getAsJsonArray("items")?:return emptyList()
            items.mapNotNull { element -> runCatching { gson.fromJson(element, CachedConversation::class.java)?.toConversation() }.getOrNull() }
                .filter { it.target.supported()&&it.title.isNotBlank() }
                .take(MAX_ROWS)
        }.getOrDefault(emptyList())
    }
    override fun save(rows:List<ChatConversation>) {
        val items=rows.asSequence().filter { it.target.supported() }.take(MAX_ROWS).map(CachedConversation::from).toList()
        val document=gson.toJson(StoredDocument(1,owner,items))
        runCatching {
            val parent=file.parentFile ?: return
            check(parent.mkdirs()||parent.isDirectory)
            val temporary=File(parent,file.name+".tmp")
            FileOutputStream(temporary).use { it.write(document.toByteArray());it.fd.sync() }
            Files.move(temporary.toPath(),file.toPath(),StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE)
        }
    }
    internal data class StoredDocument(val schema:Int,val owner:String,val items:List<CachedConversation>)
    internal data class CachedConversation(
        val conversationId:String="",val sessionType:Int=0,val userId:String="",val groupId:String="",
        val title:String="",val preview:String="",val time:Long=0,val unread:Int=0,val pinned:Boolean=false,
        val avatar:String="",val latestSeq:Long=0,val muted:Boolean=false,val joinRequestPending:Boolean=false,val atType:Int=0,
        val latestMessage:CachedMessage?=null,
    ) {
        fun toConversation()=ChatConversation(
            target=ChatTarget(conversationId,sessionType,userId,groupId),title=title,preview=preview,time=time,
            unread=unread,pinned=pinned,avatar=avatar,latestSeq=latestSeq,muted=muted,
            latestMessage=latestMessage?.toMessage(),joinRequestPending=joinRequestPending,atType=atType,
        )
        companion object {
            fun from(row:ChatConversation)=CachedConversation(
                conversationId=row.target.conversationId,sessionType=row.target.sessionType,
                userId=row.target.userId,groupId=row.target.groupId,title=row.title,preview=row.preview,
                time=row.time,unread=row.unread,pinned=row.pinned,avatar=row.avatar,latestSeq=row.latestSeq,
                muted=row.muted,joinRequestPending=row.joinRequestPending,atType=row.atType,
                latestMessage=row.latestMessage?.let(CachedMessage::from),
            )
        }
    }
    internal data class CachedMessage(
        val id:String="",val text:String="",val mine:Boolean=false,val time:Long=0,val status:Int=2,val seq:Long=0,
        val serialized:String="",val sender:String="",val contentType:Int=0,val senderId:String="",
    ) {
        fun toMessage()=ChatMessage(id,text,mine,time,status,seq,serialized,sender,contentType,senderId)
        companion object {
            fun from(message:ChatMessage)=CachedMessage(
                id=message.id,text=message.text,mine=message.mine,time=message.time,status=message.status,seq=message.seq,
                serialized=message.serialized.take(MAX_SERIALIZED),sender=message.sender,
                contentType=message.contentType,senderId=message.senderId,
            )
        }
    }
    companion object {
        private const val MAX_ROWS=500
        private const val MAX_SERIALIZED=8_192
    }
}
