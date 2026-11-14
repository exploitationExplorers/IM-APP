package com.im.nativebootstrap.chat

import com.google.gson.Gson
import com.google.gson.JsonParser
import com.im.nativebootstrap.media.*
import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.UUID

enum class MediaUploadState { UPLOADING, FAILED }
data class PendingMediaUpload(
    val id:String,val target:ChatTarget,val path:String,val name:String,val mime:String,
    val width:Int,val height:Int,val time:Long,val state:MediaUploadState,
    val remoteUrl:String="",val remoteThumbnail:String="",val remoteId:String="",val prepared:ChatMessage?=null,
    val kind:MediaKind=MediaKind.IMAGE,val duration:Long=0,val snapshotPath:String="",
) {
    fun media()=LocalMedia(File(path),name,mime,kind,duration=duration,width=width,height=height,snapshot=snapshotPath.takeIf(String::isNotBlank)?.let(::File)?.takeIf(File::isFile))
    fun placeholder()=if(kind==MediaKind.VIDEO)ChatMessage(id,"[视频]",true,time,1,0,
        """{"clientMsgID":"$id","contentType":104,"videoElem":{"duration":$duration,"snapshotWidth":$width,"snapshotHeight":$height}}}""")
        else ChatMessage(id,"[图片]",true,time,1,0,"""{"clientMsgID":"$id","contentType":102,"pictureElem":{"sourcePicture":{"width":$width,"height":$height}}}""")
}
private data class MediaUploadDocument(val schema:Int=1,val owner:String="",val entries:List<PendingMediaUpload> = emptyList())

/** 上传前先保存本地任务；恢复后只提供手动重试，不猜测已经提交的 SDK 消息。 */
class PendingMediaUploads(private val file:File,private val owner:String,private val retainedPaths:Set<String> = emptySet()) {
    private val gson=Gson()
    private val directory=File(file.parentFile,"upload-images")
    private var entries:List<PendingMediaUpload>
    init {
        entries=if(!file.exists())emptyList() else {
            val raw=JsonParser.parseString(file.readText()).asJsonObject
            check(raw.get("schema")?.asInt==1&&raw.get("owner")?.asString==owner&&raw.get("entries")?.isJsonArray==true) { "上传队列格式无效，原文件已保留" }
            val values=gson.fromJson(raw,MediaUploadDocument::class.java).entries
            check(values.map { it.id }.distinct().size==values.size)
            values.map { it.copy(kind=it.kind ?: MediaKind.IMAGE,snapshotPath=it.snapshotPath.orEmpty(),state=MediaUploadState.FAILED) }.also { normalized ->
                check(normalized.all { it.id.startsWith("upload-")&&it.target.supported()&&it.time>0&&it.kind in setOf(MediaKind.IMAGE,MediaKind.VIDEO)&&(it.kind==MediaKind.VIDEO||it.width>0&&it.height>0)&&File(it.path).canonicalFile.parentFile==directory.canonicalFile&&(it.snapshotPath.isBlank()||File(it.snapshotPath).canonicalFile.parentFile==directory.canonicalFile) }) { "上传任务无效" }
            }
        }
        if(file.exists())persist(entries)
        val referenced=(entries.flatMap { listOf(it.path,it.snapshotPath) }+retainedPaths).map { File(it).name }.toSet()
        val stale=System.currentTimeMillis()-7L*24*60*60*1000
        directory.listFiles().orEmpty().filter { it.isFile&&it.name.matches(Regex("upload-[0-9a-f-]{36}\\.(image|video|cover\\.jpg)"))&&it.name !in referenced&&it.lastModified()<stale }.forEach { it.delete() }
    }
    @Synchronized fun all()=entries.toList()
    fun ownerDirectory()=directory.canonicalPath
    @Synchronized fun put(target:ChatTarget,media:LocalMedia):PendingMediaUpload {
        require(target.supported()&&media.kind in setOf(MediaKind.IMAGE,MediaKind.VIDEO)&&media.file.isFile)
        require(media.file.length() in 1..(if(media.kind==MediaKind.VIDEO)256L else 32L)*1024*1024) { if(media.kind==MediaKind.VIDEO)"视频为空或超过 256 MB" else "图片为空或超过 32 MB" }
        require(media.kind==MediaKind.VIDEO||media.width>0&&media.height>0)
        check(entries.size<100&&entries.sumOf { File(it.path).length() }+media.file.length()<=512L*1024*1024) { "待发送附件较多，请先处理失败草稿" }
        check(directory.mkdirs()||directory.isDirectory)
        val id="upload-"+UUID.randomUUID()
        val local=File(directory,id+if(media.kind==MediaKind.VIDEO)".video" else ".image")
        val outgoing=File(file.parentFile?.parentFile?.parentFile,"outgoing").canonicalFile
        val moved=media.file.canonicalFile.parentFile==outgoing
        if(moved)Files.move(media.file.toPath(),local.toPath(),StandardCopyOption.ATOMIC_MOVE) else media.file.copyTo(local)
        var snapshot:File?=null
        val entry=PendingMediaUpload(id,target,local.absolutePath,media.name,media.mime,media.width,media.height,System.currentTimeMillis(),MediaUploadState.UPLOADING,kind=media.kind,duration=media.duration)
        try { java.io.RandomAccessFile(local,"rw").use { it.fd.sync() };save(entries+entry) } catch(error:Exception) {
            if(moved)Files.move(local.toPath(),media.file.toPath(),StandardCopyOption.ATOMIC_MOVE) else local.delete()
            throw error
        }
        if(media.kind==MediaKind.VIDEO&&media.snapshot?.isFile==true) {
            try {
                val cover=File(directory,id+".cover.jpg");snapshot=cover;media.snapshot.copyTo(cover)
                java.io.RandomAccessFile(cover,"rw").use { it.fd.sync() }
                return update(id) { it.copy(snapshotPath=cover.absolutePath) }!!
            } catch(error:Exception) { snapshot?.delete();return entry }
        }
        return entry
    }
    @Synchronized fun update(id:String,transform:(PendingMediaUpload)->PendingMediaUpload):PendingMediaUpload? {
        val old=entries.firstOrNull { it.id==id } ?: return null
        val next=transform(old)
        require(next.id==id&&next.target==old.target&&next.path==old.path)
        require(next.kind==old.kind&&(next.snapshotPath.isBlank()||File(next.snapshotPath).canonicalFile.parentFile==directory.canonicalFile))
        save(entries.map { if(it.id==id)next else it });return next
    }
    @Synchronized fun remove(id:String,keepFiles:Boolean=false) {
        val entry=entries.firstOrNull { it.id==id } ?: return
        save(entries.filterNot { it.id==id })
        if(!keepFiles)listOf(entry.path,entry.snapshotPath).filter(String::isNotBlank).map(::File).filter { it.canonicalFile.parentFile==directory.canonicalFile }.forEach { it.delete() }
    }
    private fun save(next:List<PendingMediaUpload>) { persist(next);entries=next }
    private fun persist(next:List<PendingMediaUpload>) {
        check(file.parentFile!!.mkdirs()||file.parentFile!!.isDirectory)
        val temp=File(file.parentFile,file.name+".tmp")
        FileOutputStream(temp).use { it.write(gson.toJson(MediaUploadDocument(1,owner,next)).toByteArray());it.fd.sync() }
        Files.move(temp.toPath(),file.toPath(),StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING)
    }
}
