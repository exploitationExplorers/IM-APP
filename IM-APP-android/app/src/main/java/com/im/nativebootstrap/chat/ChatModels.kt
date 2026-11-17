package com.im.nativebootstrap.chat

import java.io.File
import java.net.URI
import java.security.MessageDigest

data class ChatTarget(val conversationId: String, val sessionType: Int, val userId: String = "", val groupId: String = "") {
    fun supported() = (sessionType == 1 && userId.isNotBlank()) || (sessionType == 3 && groupId.isNotBlank())
}
data class PinnedChatMessage(val clientMsgID:String,val preview:String,val senderNickname:String,val messageType:String,val scope:String="self",val pinnedAt:Long=System.currentTimeMillis())
data class ChatMention(val userId:String,val name:String)
data class ChatMentionChoice(val userId:String,val name:String,val displayName:String=name,val avatar:String="")
data class ChatMentionPage(val items:List<ChatMentionChoice>,val nextCursor:String,val end:Boolean,val canAtAll:Boolean=false)

data class ChatGroupMember(val userId:String,val role:String,val muted:Boolean,val name:String="")

data class ChatMessageMenu(val canManage:Boolean=false,val senderInGroup:Boolean=false,val muted:Boolean=false,val canRecall:Boolean=false,val publicName:String="")
data class ChatConversation(val target: ChatTarget, val title: String, val preview: String, val time: Long, val unread: Int = 0, val pinned: Boolean = false, val avatar: String = "", val latestSeq: Long = 0, val muted: Boolean = false, val pinnedMessage:PinnedChatMessage?=null,val latestMessage:ChatMessage?=null)
data class ChatMessage(
    val id: String,
    val text: String,
    val mine: Boolean,
    val time: Long,
    val status: Int = 2,
    val seq: Long = 0,
    val serialized: String = "",
    val sender: String = "",
    // 在 SDK 映射阶段整理一次，列表/群成员清理不再重复解析 serialized。
    val contentType: Int = 0,
    val senderId: String = "",
    val pinSync: Boolean = false,
)
data class HistoryPage(val messages: List<ChatMessage>, val end: Boolean, val lastMinSeq: Int = 0)
data class ConversationSnapshotPage(val items: List<ChatConversation>, val end: Boolean)
data class ChatSearchPage(val messages: List<ChatMessage>, val page: Int, val end: Boolean)
data class ChatGlobalHit(val conversation:ChatConversation,val message:ChatMessage)
data class ChatGlobalSearchPage(val hits:List<ChatGlobalHit>,val page:Int,val end:Boolean)
data class ChatPickerItem(val id:String,val title:String,val type:String,val content:String="",val avatar:String="",val nickname:String=title)
data class ChatPickerPage(val items:List<ChatPickerItem>,val page:Int,val nextCursor:String="",val end:Boolean)
class ChatFailure(val code: Int) : Exception("聊天请求未完成（$code），可稍后重试。")
enum class ConnectionState { IDLE, CONNECTING, CONNECTED, DISCONNECTED, AUTH_REQUIRED }

interface ChatEvents {
    fun peerStatus(userId:String,online:Boolean) {}
    fun connection(state: ConnectionState)
    fun conversations(items: List<ChatConversation>)
    /** 同步进行中的本地完整快照；先于登录/最终同步完成展示，后续仍以正式快照校准。 */
    fun conversationSnapshot(items: List<ChatConversation>) { conversations(items) }
    fun messages(items: List<Pair<ChatTarget, ChatMessage>>)
    fun liveMessages(items: List<Pair<ChatTarget, ChatMessage>>) { messages(items) }
    fun tombstone(id: String, deleted: Boolean)
    fun syncStarted()
    fun syncProgress(progress:Long) {}
    fun syncFinished()
    fun syncFailed()
    fun read(ids: List<String>) {}
    fun pin(target:ChatTarget,pinned:PinnedChatMessage?) {}
    fun groupChanged(groupId:String) {}
}
interface ChatGateway {
    fun watchPeer(userId:String?,done:(Result<Boolean?>)->Unit) { done(Result.success(null)) }
    fun start(userId: String, token: String, api: String, ws: String, directory: File, events: ChatEvents, done: (Result<Unit>) -> Unit)
    fun conversations(offset: Int, count: Int, done: (Result<List<ChatConversation>>) -> Unit)
    fun initialConversations(count:Int,done:(Result<ConversationSnapshotPage>)->Unit) {
        conversations(0,count) { result -> done(result.map { ConversationSnapshotPage(it,it.size<count) }) }
    }
    fun history(target: ChatTarget, cursor: String?, count: Int, done: (Result<HistoryPage>) -> Unit)
    fun localHistory(target:ChatTarget,page:Int,count:Int,done:(Result<HistoryPage>)->Unit) { done(Result.failure(UnsupportedOperationException("本地历史查询不可用"))) }
    fun localHistory(target:ChatTarget,page:Int,count:Int,anchorTimeSeconds:Long,done:(Result<HistoryPage>)->Unit) = localHistory(target,page,count,done)
    fun createText(text: String, target: ChatTarget): ChatMessage
    fun send(target: ChatTarget, serialized: String, done: (Result<ChatMessage>) -> Unit)
    fun find(target: ChatTarget, id: String, done: (Result<ChatMessage?>) -> Unit)
    fun foreground(active: Boolean)
    fun shutdown()
    fun createQuote(text: String, quote: ChatMessage, target: ChatTarget): ChatMessage = throw UnsupportedOperationException("引用消息不可用")
    fun createMedia(media: com.im.nativebootstrap.media.UploadedMedia, target: ChatTarget): ChatMessage = throw UnsupportedOperationException("媒体消息不可用")
    fun peer(imId: String, group: Boolean, done: (Result<ChatConversation>) -> Unit) { done(Result.failure(UnsupportedOperationException("会话不可用"))) }
    fun markRead(target: ChatTarget, done: (Result<Unit>) -> Unit) { done(Result.success(Unit)) }
    fun deleteLocal(target: ChatTarget, id: String, done: (Result<Unit>) -> Unit) { done(Result.failure(UnsupportedOperationException("删除不可用"))) }
    fun setConversation(target: ChatTarget, pinned: Boolean?, muted: Boolean?, done: (Result<Unit>) -> Unit) { done(Result.failure(UnsupportedOperationException("设置不可用"))) }
    fun reconnect(done: (Result<Unit>) -> Unit) { done(Result.failure(UnsupportedOperationException("重连不可用"))) }
    fun clearHistory(target: ChatTarget, done: (Result<Unit>) -> Unit) { done(Result.failure(UnsupportedOperationException("本地清理不可用"))) }
    fun search(target: ChatTarget, keyword: String, types: List<Int>, page: Int, count: Int, done: (Result<ChatSearchPage>) -> Unit) { done(Result.failure(UnsupportedOperationException("搜索不可用"))) }
    fun pinMessage(target:ChatTarget,pinned:PinnedChatMessage?,done:(Result<Unit>)->Unit) { done(Result.failure(UnsupportedOperationException("置顶不可用"))) }
    fun createPinSync(target:ChatTarget,pinned:PinnedChatMessage?,old:PinnedChatMessage?):ChatMessage = throw UnsupportedOperationException("置顶同步不可用")
    fun createMention(text:String,mentions:List<Pair<String,String>>,quote:ChatMessage?,target:ChatTarget):ChatMessage = throw UnsupportedOperationException("提及消息不可用")
    fun createCard(imId:String,businessId:String,nickname:String,avatar:String,target:ChatTarget):ChatMessage = throw UnsupportedOperationException("名片不可用")
    fun createRemoteImage(url:String,target:ChatTarget):ChatMessage = throw UnsupportedOperationException("图片发送不可用")
    fun hideConversation(target:ChatTarget,done:(Result<Unit>)->Unit) { done(Result.failure(UnsupportedOperationException("隐藏会话不可用"))) }
    fun searchAll(keyword:String,page:Int,count:Int,done:(Result<ChatGlobalSearchPage>)->Unit) { done(Result.failure(UnsupportedOperationException("全局搜索不可用"))) }
    fun createForward(source:ChatMessage,snapshot:com.google.gson.JsonObject,target:ChatTarget):ChatMessage = throw UnsupportedOperationException("转发不可用")
    fun groupMember(target:ChatTarget,userId:String,done:(Result<ChatGroupMember?>)->Unit) { done(Result.failure(UnsupportedOperationException("成员资料不可用"))) }
    fun groupMembers(target:ChatTarget,userIds:List<String>,done:(Result<List<ChatGroupMember>>)->Unit) { done(Result.failure(UnsupportedOperationException("成员资料不可用"))) }
}

object ChatEndpoints {
    private const val DEFAULT_ORIGIN = "https://www.xn--jprz53bj9s.com"
    fun normalize(businessBase: String, address: String, websocket: Boolean): String {
        val business = URI(businessBase.trim())
        val uri = URI(address.trim())
        require(uri.userInfo == null && uri.query == null && uri.fragment == null && !uri.host.isNullOrBlank()) { "聊天地址格式不受支持" }
        val scheme = if (websocket) "wss" else "https"
        if (uri.scheme == scheme) return uri.toASCIIString()
        val defaultBusiness = business.scheme == "https" && business.host.equals("www.xn--jprz53bj9s.com", true) && business.port in listOf(-1,443)
        val oldScheme = if (websocket) "ws" else "http"
        val oldPath = if (websocket) "/openim-ws" else "/openim-api"
        require(defaultBusiness && uri.scheme == oldScheme && uri.host == "8.154.44.197" && uri.port in listOf(-1,80) && uri.path in listOf(oldPath,oldPath+"/")) { "聊天服务必须使用 HTTPS / WSS" }
        return (if (websocket) DEFAULT_ORIGIN.replace("https://", "wss://") else DEFAULT_ORIGIN) + oldPath
    }
}
object AccountStorage {
    fun key(environment: String, businessId: String, imId: String): String = MessageDigest.getInstance("SHA-256").digest((URI(environment.trim()).normalize().toASCIIString().trimEnd('/') + "\u0000" + businessId + "\u0000" + imId).toByteArray()).joinToString("") { "%02x".format(it) }
    fun directory(root: File, environment: String, businessId: String, imId: String) = File(root, key(environment,businessId,imId)).apply { check(mkdirs() || isDirectory) }
}
fun mergeConversations(old: List<ChatConversation>, incoming: List<ChatConversation>, authoritative: Boolean = false): List<ChatConversation> {
    // 同时间沿用已显示的次序；分页和增量通知不应把新见到的会话插到同时间行前面。
    val rows = old.associateByTo(linkedMapOf()) { it.target.conversationId }
    var changed=false
    var needsSort=false
    for(index in 1 until old.size) {
        val a=old[index-1];val b=old[index]
        if((!a.pinned&&b.pinned)||(a.pinned==b.pinned&&a.time<b.time)) {needsSort=true;break}
    }
    incoming.forEach { next ->
        val previous = rows[next.target.conversationId]
        if ((authoritative || previous == null || next.time >= previous.time)&&previous!=next) {
            changed=true
            if(previous==null||previous.time!=next.time||previous.pinned!=next.pinned)needsSort=true
            rows[next.target.conversationId] = next
        }
    }
    if(!changed&&!needsSort)return old
    return if(needsSort)rows.values.sortedWith(compareByDescending<ChatConversation> { it.pinned }.thenByDescending { it.time }) else rows.values.toList()
}
private val messageOrder = compareBy<ChatMessage> { it.time }.thenBy { it.id }

private fun preferredMessage(previous: ChatMessage, next: ChatMessage): ChatMessage =
    when {
        previous.serialized.isNotBlank() && next.serialized.isBlank() -> previous
        previous.serialized.isBlank() && next.serialized.isNotBlank() -> next
        previous.seq > next.seq || (previous.status == 2 && next.status != 2) -> previous
        else -> next
    }

fun mergeMessages(old: List<ChatMessage>, incoming: List<ChatMessage>): List<ChatMessage> {
    if (incoming.isEmpty()) return old
    val fresh = incoming.filter { it.id.isNotBlank() }
    if (fresh.isEmpty()) return old
    val incomingById = LinkedHashMap<String, ChatMessage>(fresh.size)
    fresh.forEach { next ->
        val previous = incomingById[next.id]
        incomingById[next.id] = if (previous != null) preferredMessage(previous, next) else next
    }
    if (old.isEmpty()) return incomingById.values.sortedWith(messageOrder)
    val oldById = old.associateBy { it.id }
    if (oldById.size != old.size) return mergeMessagesSlow(old, incomingById)

    val allExisting = incomingById.keys.all { it in oldById }
    if (allExisting) {
        var timeChanged = false
        val replaced = old.map { previous ->
            val next = incomingById[previous.id]
            if (next == null) previous
            else {
                if (next.time != previous.time) timeChanged = true
                preferredMessage(previous, next)
            }
        }
        // 同一时间位置的送达/已读/状态更新不需要重新排序。
        if (!timeChanged) return replaced
    } else if (incomingById.keys.none { it in oldById } && incomingById.values.all { it.time > old.last().time }) {
        // 实时消息最常见的路径：全部是新消息且时间在尾部，直接追加。
        return old + incomingById.values.sortedWith(messageOrder)
    }
    return mergeMessagesSlow(old, incomingById)
}

private fun mergeMessagesSlow(old: List<ChatMessage>, incoming: Map<String, ChatMessage>): List<ChatMessage> {
    val result = old.associateBy { it.id }.toMutableMap()
    incoming.values.forEach { next ->
        val previous = result[next.id]
        result[next.id] = if (previous != null) preferredMessage(previous, next) else next
    }
    return result.values.sortedWith(messageOrder)
}

/** 撤回/删除标记只需要覆盖近期可见记录，避免长会话把墓碑集合无限放大。 */
internal class TombstoneWindow(private val limit: Int) {
    private val values = LinkedHashMap<String, Boolean>()
    operator fun get(id: String): Boolean? = values[id]
    operator fun contains(id: String): Boolean = values.containsKey(id)
    operator fun set(id: String, deleted: Boolean) {
        values.remove(id)
        values[id] = deleted
        while (values.size > limit) values.remove(values.keys.first())
    }
    fun containsKey(id: String): Boolean = values.containsKey(id)
    fun clear() = values.clear()
    val size: Int get() = values.size
}
