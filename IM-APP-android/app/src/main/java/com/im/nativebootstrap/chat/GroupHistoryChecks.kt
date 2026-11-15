package com.im.nativebootstrap.chat

import com.google.gson.JsonArray
import com.google.gson.JsonParser
import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption

/** 持久化已向业务服务核对过的群；空水位结果也必须按账号保存，未知群不能据此放行。 */
class GroupHistoryChecks(private val file:File,private val owner:String) {
    private var checked:Set<String> = if(!file.exists())emptySet() else {
        val raw=JsonParser.parseString(file.readText()).asJsonObject
        check(raw.get("schema")?.asInt==1&&raw.get("owner")?.asString==owner)
        val values=raw.getAsJsonArray("conversationIds").map { it.asString }
        check(values.all { GroupRetention.supported(it) }&&values.distinct().size==values.size)
        values.toSet()
    }
    fun all()=checked.toSet()
    fun mark(ids:List<String>) {
        require(ids.all { GroupRetention.supported(it) })
        val next=checked+ids
        val values=JsonArray().apply { next.sorted().forEach(::add) }
        val temp=File(file.parentFile,file.name+".tmp")
        FileOutputStream(temp).use { it.write(jsonBody("schema" to 1,"owner" to owner,"conversationIds" to values).toString().toByteArray());it.fd.sync() }
        Files.move(temp.toPath(),file.toPath(),StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING)
        checked=next
    }
}
