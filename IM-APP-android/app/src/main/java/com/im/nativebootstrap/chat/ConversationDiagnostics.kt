package com.im.nativebootstrap.chat

import java.security.MessageDigest
import java.util.UUID

/** 只在本机保留有界列表变化记录，不记录账号、会话原始 ID、昵称或消息正文。 */
class ConversationDiagnostics(private val clock:()->Long={System.nanoTime()/1_000_000}) {
    private val lines=ArrayDeque<String>()
    private var started=clock()
    private var salt=UUID.randomUUID().toString()
    fun reset() {lines.clear();started=clock();salt=UUID.randomUUID().toString()}
    fun report()=lines.toList()
    private fun add(value:String) {lines.addLast("+${(clock()-started).coerceAtLeast(0)}ms $value");while(lines.size>64)lines.removeFirst()}
    private fun alias(id:String)=MessageDigest.getInstance("SHA-256").digest((salt+id).toByteArray()).take(4).joinToString(""){"%02x".format(it)}
    fun phase(source:String) {add(source)}
    fun input(source:String,rows:List<ChatConversation>) {
        val milliseconds=rows.count {it.time>=10_000_000_000L}
        val seconds=rows.count {it.time in 1 until 10_000_000_000L}
        add("$source rows=${rows.size} ms=$milliseconds sec=$seconds zero=${rows.size-milliseconds-seconds}")
    }
    fun changed(source:String,before:List<ChatConversation>,next:List<ChatConversation>) {
        if(before==next)return
        val previous=before.associateBy {it.target.conversationId}
        val positions=before.mapIndexed {index,item->item.target.conversationId to index}.toMap()
        val current=next.associateBy {it.target.conversationId}
        val changed=next.filter {item->previous[item.target.conversationId]?.let {it!=item}==true}
        val added=next.count {it.target.conversationId !in previous}
        val removed=before.count {it.target.conversationId !in current}
        val moved=next.withIndex().count {(index,item)->positions[item.target.conversationId]?.let{it!=index}==true}
        val time=changed.count {previous[it.target.conversationId]?.time!=it.time}
        val pin=changed.count {previous[it.target.conversationId]?.pinned!=it.pinned}
        val message=changed.count {previous[it.target.conversationId]?.latestMessage?.id!=it.latestMessage?.id}
        val first=next.take(8).joinToString(",") {"${alias(it.target.conversationId)}:${if(it.pinned)1 else 0}:${it.time}"}
        add("publish/$source rows=${next.size} add=$added remove=$removed move=$moved time=$time pin=$pin message=$message first=$first")
    }
}
