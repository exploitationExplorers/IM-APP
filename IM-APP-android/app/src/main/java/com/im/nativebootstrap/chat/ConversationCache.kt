package com.im.nativebootstrap.chat

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import com.google.gson.Gson
import java.io.File

/** 会话列表首屏缓存（对齐 YanChat 的 Room 会话缓存）：登录前先渲染，SDK 权威快照到达后对账。 */
interface ConversationCache {
    fun load():List<ChatConversation>
    fun save(rows:List<ChatConversation>)
    fun close() {}
}

@Entity(tableName="conversation_cache")
internal data class ConversationEntity(
    @PrimaryKey val conversationId:String,
    val sessionType:Int, val userId:String, val groupId:String,
    val title:String, val preview:String, val time:Long, val unread:Int, val pinned:Boolean,
    val avatar:String, val latestSeq:Long, val muted:Boolean, val joinRequestPending:Boolean, val atType:Int,
    val latestMessageJson:String?,
) {
    fun toConversation(gson:Gson)=ChatConversation(
        target=ChatTarget(conversationId,sessionType,userId,groupId),title=title,preview=preview,time=time,
        unread=unread,pinned=pinned,avatar=avatar,latestSeq=latestSeq,muted=muted,
        latestMessage=latestMessageJson?.let { runCatching { gson.fromJson(it, ChatMessage::class.java) }.getOrNull() },
        joinRequestPending=joinRequestPending,atType=atType,
    )
    companion object {
        fun from(row:ChatConversation,gson:Gson)=ConversationEntity(
            conversationId=row.target.conversationId,sessionType=row.target.sessionType,
            userId=row.target.userId,groupId=row.target.groupId,title=row.title,preview=row.preview,
            time=row.time,unread=row.unread,pinned=row.pinned,avatar=row.avatar,latestSeq=row.latestSeq,
            muted=row.muted,joinRequestPending=row.joinRequestPending,atType=row.atType,
            latestMessageJson=row.latestMessage?.let(gson::toJson),
        )
    }
}

@Dao
internal interface ConversationDao {
    @Query("SELECT * FROM conversation_cache ORDER BY pinned DESC, time DESC LIMIT 2000")
    fun load():List<ConversationEntity>
    @Insert(onConflict=OnConflictStrategy.REPLACE)
    fun upsert(rows:List<ConversationEntity>)
    @Query("DELETE FROM conversation_cache WHERE conversationId IN (:ids)")
    fun delete(ids:List<String>)
    @Query("DELETE FROM conversation_cache")
    fun clear()
}

@Database(entities=[ConversationEntity::class],version=1,exportSchema=false)
internal abstract class ConversationDatabase:RoomDatabase() {
    abstract fun conversationDao():ConversationDao
}

/** Room 版缓存：内存里保留上次快照做增量对账，只有变化行才写库。 */
class RoomConversationCache private constructor(private val database:ConversationDatabase):ConversationCache {
    private val gson=Gson()
    private val dao=database.conversationDao()
    private var lastSaved:Map<String,ChatConversation>?=null
    override fun load():List<ChatConversation> {
        val rows=dao.load().mapNotNull { runCatching { it.toConversation(gson) }.getOrNull() }
        lastSaved=rows.associateBy { it.target.conversationId }
        return rows
    }
    override fun save(rows:List<ChatConversation>) {
        val target=rows.take(MAX_ROWS)
        val previous=lastSaved
        if(previous==null) {
            database.runInTransaction { dao.clear();dao.upsert(target.map { ConversationEntity.from(it,gson) }) }
            lastSaved=target.associateBy { it.target.conversationId }
            return
        }
        val targetIds=target.mapTo(HashSet()) { it.target.conversationId }
        val removed=previous.keys.filter { it !in targetIds }
        val changed=target.filter { previous[it.target.conversationId]!=it }
        if(removed.isEmpty()&&changed.isEmpty())return
        database.runInTransaction {
            if(removed.isNotEmpty())dao.delete(removed)
            if(changed.isNotEmpty())dao.upsert(changed.map { ConversationEntity.from(it,gson) })
        }
        lastSaved=target.associateBy { it.target.conversationId }
    }
    override fun close()=database.close()
    companion object {
        private const val MAX_ROWS=2_000
        fun open(context:Context,directory:File):ConversationCache =
            RoomConversationCache(Room.databaseBuilder(context,ConversationDatabase::class.java,File(directory,"conversation-cache.db").absolutePath).fallbackToDestructiveMigration().build())
    }
}
