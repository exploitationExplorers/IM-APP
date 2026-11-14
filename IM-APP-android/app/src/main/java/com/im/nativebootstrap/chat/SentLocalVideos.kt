package com.im.nativebootstrap.chat

import com.google.gson.Gson
import com.google.gson.JsonParser
import com.im.nativebootstrap.media.LocalMedia
import com.im.nativebootstrap.media.MediaKind
import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption

private data class SentVideo(val messageId:String,val path:String,val name:String,val mime:String,val width:Int,val height:Int,val duration:Long,val snapshotPath:String,val time:Long)
private data class SentVideoDocument(val schema:Int=1,val owner:String="",val entries:List<SentVideo> = emptyList())

/** 仅记录本账号自己入队的视频，不采信远程消息携带的设备路径。 */
class SentLocalVideos(private val file:File,private val owner:String) {
    private val gson=Gson()
    private val directory=File(file.parentFile,"upload-images").canonicalFile
    private var entries:List<SentVideo>
    init {
        entries=if(!file.exists())emptyList() else {
            val raw=JsonParser.parseString(file.readText()).asJsonObject
            check(raw.get("schema")?.asInt==1&&raw.get("owner")?.asString==owner) { "本地视频记录账号不匹配" }
            val values=gson.fromJson(raw,SentVideoDocument::class.java).entries
            check(values.map { it.messageId }.distinct().size==values.size&&values.all { it.messageId.isNotBlank()&&owned(it.path)&&(it.snapshotPath.isBlank()||owned(it.snapshotPath)) }) { "本地视频记录格式无效" }
            values.filter { File(it.path).isFile }
        }
    }
    private fun owned(path:String)=File(path).canonicalFile.parentFile==directory
    @Synchronized fun all():Map<String,LocalMedia> = entries.associate { it.messageId to LocalMedia(File(it.path),it.name,it.mime,MediaKind.VIDEO,duration=it.duration,width=it.width,height=it.height,snapshot=it.snapshotPath.takeIf(String::isNotBlank)?.let(::File)?.takeIf(File::isFile)) }
    @Synchronized fun retainedPaths()=entries.flatMap { listOf(it.path,it.snapshotPath) }.filter(String::isNotBlank).toSet()
    @Synchronized fun put(id:String,media:LocalMedia) {
        require(id.isNotBlank()&&media.kind==MediaKind.VIDEO&&media.file.isFile&&owned(media.file.path)&&(media.snapshot==null||owned(media.snapshot.path)))
        val entry=SentVideo(id,media.file.absolutePath,media.name,media.mime,media.width,media.height,media.duration,media.snapshot?.absolutePath.orEmpty(),System.currentTimeMillis())
        val sorted=(entries.filterNot { it.messageId==id }+entry).sortedByDescending { it.time }
        var bytes=0L
        val keep=sorted.filterIndexed { index,item -> bytes+=File(item.path).length()+File(item.snapshotPath).length();index==0||index<100&&bytes<=512L*1024*1024 }
        persist(keep)
        val retained=keep.flatMap { listOf(it.path,it.snapshotPath) }.toSet()
        sorted.filterNot { old -> keep.any { it.messageId==old.messageId } }.flatMap { listOf(it.path,it.snapshotPath) }.filter { it.isNotBlank()&&it !in retained&&owned(it) }.forEach { File(it).delete() }
        entries=keep
    }
    private fun persist(next:List<SentVideo>) {
        check(file.parentFile!!.mkdirs()||file.parentFile!!.isDirectory)
        val temporary=File(file.parentFile,file.name+".tmp")
        FileOutputStream(temporary).use { it.write(gson.toJson(SentVideoDocument(1,owner,next)).toByteArray());it.fd.sync() }
        Files.move(temporary.toPath(),file.toPath(),StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING)
    }
}
