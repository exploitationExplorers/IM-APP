package com.im.nativebootstrap.media

import java.io.File
import java.util.UUID

/** 只登记本 App 本次上传的图片，绝不信任聊天消息携带的本地路径。 */
internal class MediaLocalCopies(private val root: File) {
    private val hash = Regex("[0-9a-f]{64}")
    @Synchronized fun put(scope: String, keys: List<String>, source: File, active: () -> Boolean = { true }) {
        require(hash.matches(scope) && keys.all { hash.matches(it) })
        require(source.isFile && source.length() in 1..32L * 1024 * 1024)
        if(!active())return
        val directory=File(root,scope).apply { check(mkdirs()||isDirectory) }
        val name=MediaCacheIdentity.digest(UUID.randomUUID().toString())
        val data=File(directory,"data-$name")
        try {
            source.copyTo(data)
            if(!active())return
            keys.distinct().forEach { File(directory,"key-$it").writeText(name) }
            trim(directory,data)
        } finally { if(!active())data.delete() }
    }
    @Synchronized fun get(scope:String,key:String):File? {
        if(!hash.matches(scope)||!hash.matches(key))return null
        val directory=File(root,scope)
        val pointer=File(directory,"key-$key")
        if(!pointer.isFile||pointer.length()!=64L)return null
        val name=pointer.readText().takeIf(hash::matches) ?: return null
        return File(directory,"data-$name").takeIf { it.isFile&&it.length() in 1..32L*1024*1024 }?.also { it.setLastModified(System.currentTimeMillis()) }
    }
    private fun trim(directory:File,keep:File) {
        val files=directory.listFiles().orEmpty().filter { it.name.startsWith("data-") }.sortedBy(File::lastModified)
        var total=files.sumOf(File::length);var count=files.size
        val old=System.currentTimeMillis()-7L*24*60*60*1000
        files.forEach { if(it!=keep&&(total>128L*1024*1024||count>500||it.lastModified()<old)) {
            val bytes=it.length();if(it.delete()) { total-=bytes;count-- }
        } }
        directory.listFiles().orEmpty().filter { it.name.startsWith("key-") }.forEach {
            val name=it.takeIf { f -> f.length()==64L }?.readText()
            if(name==null||!hash.matches(name)||!File(directory,"data-$name").isFile)it.delete()
        }
    }
    @Synchronized fun discard(scope:String,key:String) {
        if(!hash.matches(scope)||!hash.matches(key))return
        val directory=File(root,scope)
        val pointer=File(directory,"key-$key")
        val name=pointer.takeIf { it.isFile&&it.length()==64L }?.readText()?.takeIf(hash::matches) ?: return
        directory.listFiles().orEmpty().filter { it.isFile&&it.name.startsWith("key-")&&it.length()==64L }.forEach {
            if(it.readText()==name)it.delete()
        }
        File(directory,"data-$name").delete()
    }
    @Synchronized fun alias(scope:String,source:String,destinations:List<String>) {
        val data=get(scope,source) ?: return
        if(destinations.any { !hash.matches(it) })return
        val name=data.name.removePrefix("data-")
        destinations.distinct().forEach { File(data.parentFile,"key-$it").writeText(name) }
    }
    @Synchronized fun clear():Long {
        var bytes=0L
        root.listFiles().orEmpty().filter { it.isDirectory&&hash.matches(it.name) }.forEach { directory ->
            directory.listFiles().orEmpty().filter { it.isFile }.forEach { val size=it.length();if(it.delete())bytes+=size }
            directory.delete()
        }
        return bytes
    }
}
