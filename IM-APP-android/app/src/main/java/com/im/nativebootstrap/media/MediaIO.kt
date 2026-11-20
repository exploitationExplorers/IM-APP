package com.im.nativebootstrap.media

import android.content.Context
import android.content.Intent
import android.content.ContentValues
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadataRetriever
import android.media.MediaRecorder
import android.media.MediaScannerConnection
import android.media.ExifInterface
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.OpenableColumns
import android.provider.MediaStore
import androidx.core.content.FileProvider
import java.io.File
import java.util.UUID
import java.nio.file.Files
import java.nio.file.StandardCopyOption

object MediaIO {
    fun stageSticker(context:Context,url:String):LocalMedia {
        val source=MediaLoader.fetch(context,MediaURLs.image(url,ImageVariant.ORIGINAL),32L*1024*1024)
        val bounds=BitmapFactory.Options().apply { inJustDecodeBounds=true }
        BitmapFactory.decodeFile(source.path,bounds)
        require(bounds.outWidth>0&&bounds.outHeight>0) { "图片格式不受支持" }
        val mime=bounds.outMimeType ?: "image/jpeg"
        val extension=android.webkit.MimeTypeMap.getSingleton().getExtensionFromMimeType(mime) ?: "jpg"
        val directory=File(context.filesDir,"outgoing").apply { check(mkdirs()||isDirectory) }
        val file=File(directory,"sticker-${UUID.randomUUID()}.$extension")
        source.copyTo(file)
        return LocalMedia(file,"表情.$extension",mime,MediaKind.IMAGE,width=bounds.outWidth,height=bounds.outHeight)
    }
    /**
     * Android 10 及以上写入系统相册，无需申请整个存储目录权限。
     * 返回 true 表示条目已落库并解除 pending（相册可见）；返回 false 表示系统不支持，调用方应回退到文件选择器。
     * 目标机型（小米 HyperOS 等）曾出现「提示已保存、相册里没有」，因此两条通道都做落库回查：
     *  1) MediaStore 插入 → 写字节 → 清 pending → 回查 IS_PENDING/SIZE/_data → 主动触发媒体扫描；
     *  2) 通道 1 任一环节不通过时删除半成品，改为写入公共 Pictures/Movies 目录并扫描，确保文件真实存在。
     */
    fun saveToGallery(context:Context,file:File,name:String,mime:String,video:Boolean):Boolean {
        if(Build.VERSION.SDK_INT<29)return false
        // 源文件必须真实存在且非空：缓存被清理或下载未完成的占位文件不允许静默写入。
        require(file.isFile&&file.length()>0) { if(video)"视频源文件不可用，请重新打开后保存" else "图片源文件不可用，请重新打开后保存" }
        val size=file.length()
        trace(context,"save start name=$name video=$video size=$size")
        val primary=runCatching { saveByMediaStore(context,file,name,mime,video,size) }
        if(primary.getOrNull()==true) { trace(context,"save ok via mediastore");return true }
        primary.exceptionOrNull()?.let { trace(context,"mediastore failed: "+it.message) }
        val fallback=runCatching { saveByFile(context,file,name,mime,video,size) }
        if(fallback.getOrNull()==true) { trace(context,"save ok via file");return true }
        fallback.exceptionOrNull()?.let { trace(context,"file fallback failed: "+it.message) }
        // 两条通道都没有明确错误时，交给文件选择器，避免把「写不进去」伪装成成功。
        primary.exceptionOrNull()?.let { throw it }
        fallback.exceptionOrNull()?.let { throw it }
        return false
    }
    private fun galleryValues(file:File,name:String,mime:String,video:Boolean):ContentValues {
        val now=System.currentTimeMillis()
        return ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME,name)
            put(MediaStore.MediaColumns.MIME_TYPE,mime)
            // 结尾斜杠是规范要求，部分定制系统缺斜杠会把相对路径当成文件名。
            put(MediaStore.MediaColumns.RELATIVE_PATH,(if(video)"Movies/" else "Pictures/")+"易可聊/")
            put(MediaStore.MediaColumns.IS_PENDING,1)
            put(MediaStore.MediaColumns.DATE_ADDED,now/1000)
            put(MediaStore.MediaColumns.DATE_TAKEN,now)
            if(video) {
                // 相册按 DURATION/分辨率建索引：缺字段时部分系统相册不展示该视频或显示 0 秒。
                val retriever=MediaMetadataRetriever()
                try {
                    retriever.setDataSource(file.path)
                    val millis=retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0
                    val width=retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 0
                    val height=retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 0
                    require(millis>0&&width>0&&height>0) { "视频文件不完整，请重新打开后保存" }
                    put(MediaStore.Video.VideoColumns.DURATION,millis)
                    put(MediaStore.MediaColumns.WIDTH,width)
                    put(MediaStore.MediaColumns.HEIGHT,height)
                } finally { retriever.release() }
            } else {
                val bounds=BitmapFactory.Options().apply { inJustDecodeBounds=true }
                BitmapFactory.decodeFile(file.path,bounds)
                if(bounds.outWidth>0&&bounds.outHeight>0) {
                    put(MediaStore.MediaColumns.WIDTH,bounds.outWidth)
                    put(MediaStore.MediaColumns.HEIGHT,bounds.outHeight)
                }
            }
        }
    }
    private fun saveByMediaStore(context:Context,file:File,name:String,mime:String,video:Boolean,size:Long):Boolean {
        val values=galleryValues(file,name,mime,video)
        val collection=if(video)MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY) else MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        val uri=context.contentResolver.insert(collection,values) ?: return false
        try {
            file.inputStream().use { input ->
                (context.contentResolver.openOutputStream(uri,"w") ?: error("系统相册暂不可写入")).use { output ->
                    val buffer=ByteArray(64*1024);var total=0L
                    while(true) {
                        val count=input.read(buffer);if(count<0)break
                        total+=count;output.write(buffer,0,count)
                    }
                    output.flush()
                    check(total==size) { if(video)"视频写入未完成，请重试" else "图片写入未完成，请重试" }
                }
            }
            clearPending(context,uri)
            val (pending,stored,path)=inspect(context,uri)
            check(pending==0) { "系统相册未确认保存，请重试" }
            check(stored<=0L||stored==size) { if(video)"视频保存不完整，请重试" else "图片保存不完整，请重试" }
            if(path.isNotBlank()) {
                val disk=File(path)
                check(disk.isFile&&disk.length()==size) { "相册文件写入不完整，请重试" }
                // 定制系统相册依赖媒体扫描刷新索引，落库后主动扫一次。
                scan(context,path,mime)
            }
            return true
        } catch(error:Exception) {
            runCatching { context.contentResolver.delete(uri,null,null) }
            throw error
        }
    }
    private fun clearPending(context:Context,uri:Uri) {
        val values=ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING,0) }
        if(context.contentResolver.update(uri,values,null,null)<=0)context.contentResolver.update(uri,values,null,null)
    }
    private fun inspect(context:Context,uri:Uri):Triple<Int,Long,String> {
        val pending=MediaStore.MediaColumns.IS_PENDING
        val size=MediaStore.MediaColumns.SIZE
        @Suppress("DEPRECATION") val data=MediaStore.MediaColumns.DATA
        return runCatching {
            context.contentResolver.query(uri,arrayOf(pending,size,data),null,null,null)?.use { cursor ->
                if(!cursor.moveToFirst())return@use null
                Triple(cursor.getInt(0),cursor.getLong(1),if(cursor.getColumnIndex(data)>=0)cursor.getString(2).orEmpty() else "")
            }
        }.getOrNull() ?: Triple(1,-1L,"")
    }
    /** 直写公共目录：通道 1 失败时使用，文件一定真实落在用户可见目录。 */
    private fun saveByFile(context:Context,file:File,name:String,mime:String,video:Boolean,size:Long):Boolean {
        @Suppress("DEPRECATION") val base=Environment.getExternalStoragePublicDirectory(if(video)Environment.DIRECTORY_MOVIES else Environment.DIRECTORY_PICTURES)
        val directory=File(base,"易可聊")
        if(!directory.isDirectory&&!directory.mkdirs())error(if(video)"相册目录不可写入，请重试" else "图片目录不可写入，请重试")
        var target=File(directory,name)
        if(target.exists())target=File(directory,name.substringBeforeLast('.',name)+"-"+System.currentTimeMillis()+"."+name.substringAfterLast('.',"bin"))
        val part=File(directory,"."+target.name+".part")
        try {
            file.inputStream().use { input -> part.outputStream().use { output ->
                val buffer=ByteArray(64*1024);var total=0L
                while(true) {
                    val count=input.read(buffer);if(count<0)break
                    total+=count;output.write(buffer,0,count)
                }
            } }
            check(part.length()==size) { if(video)"视频写入未完成，请重试" else "图片写入未完成，请重试" }
            check(part.renameTo(target)) { if(video)"视频未能写入相册目录，请重试" else "图片未能写入相册目录，请重试" }
        } finally { runCatching { part.delete() } }
        scan(context,target.path,mime)
        return true
    }
    /** 扫描阻塞最多 2.5s：让系统在返回成功前把新文件建好索引。 */
    private fun scan(context:Context,path:String,mime:String) {
        if(path.isBlank())return
        val latch=java.util.concurrent.CountDownLatch(1)
        runCatching {
            MediaScannerConnection.scanFile(context,arrayOf(path),arrayOf(mime)) { _,uri -> if(uri!=null)latch.countDown() else latch.countDown() }
        }.onFailure { latch.countDown() }
        runCatching { latch.await(2500,java.util.concurrent.TimeUnit.MILLISECONDS) }
    }
    /** 保存链路留痕：真机排查「提示已保存但相册没有」时可直接读取，最多保留 64 KB。 */
    private fun trace(context:Context,line:String) {
        runCatching {
            val file=File(context.filesDir,"media-save.log")
            if(file.length()>64*1024)file.delete()
            file.appendText(android.text.format.DateFormat.format("MM-dd HH:mm:ss",System.currentTimeMillis()).toString()+" "+line+"\n")
        }
    }

    /** 识别视频真实容器，避免 mov/webm 内容被存成 .mp4 后相册或播放器无法识别。 */
    fun videoFormat(file:File):Pair<String,String> {
        val retriever=MediaMetadataRetriever()
        return try {
            retriever.setDataSource(file.path)
            val mime=retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_MIMETYPE)?.lowercase().orEmpty()
            when {
                "quicktime" in mime||"mov" in mime -> "mov" to "video/quicktime"
                "webm" in mime -> "webm" to "video/webm"
                "3gpp" in mime -> "3gp" to "video/3gpp"
                "matroska" in mime -> "mkv" to "video/x-matroska"
                "avi" in mime -> "avi" to "video/x-msvideo"
                else -> "mp4" to "video/mp4"
            }
        } catch(_:Exception) { "mp4" to "video/mp4" } finally { retriever.release() }
    }
    /** 自拍源文件已由本 App 写入；移动到私有持久目录后即可入队，不先等待解帧。 */
    fun stageCapturedVideo(context:Context,source:File):LocalMedia {
        require(source.canonicalFile.parentFile==File(context.cacheDir,"media").canonicalFile&&source.name.matches(Regex("camera-[0-9a-f-]{36}\\.mp4"))) { "录像文件不可用" }
        require(source.isFile&&source.length() in 1..256L*1024*1024) { "视频为空或超过 256 MB" }
        val directory=File(context.filesDir,"outgoing").apply { check(mkdirs()||isDirectory) }
        val file=File(directory,UUID.randomUUID().toString()+".mp4")
        Files.move(source.toPath(),file.toPath(),StandardCopyOption.ATOMIC_MOVE)
        return LocalMedia(file,"视频.mp4","video/mp4",MediaKind.VIDEO)
    }
    fun stage(context:Context,uri:Uri,kind:MediaKind,prepareMetadata:Boolean=true):LocalMedia {
        var name="附件"
        context.contentResolver.query(uri,arrayOf(OpenableColumns.DISPLAY_NAME),null,null,null)?.use { cursor -> if(cursor.moveToFirst()) name=cursor.getString(0).orEmpty().ifBlank { "附件" } }
        name=name.substringAfterLast('/').substringAfterLast('\\').take(180)
        val mime=context.contentResolver.getType(uri) ?: "application/octet-stream"
        val directory=File(context.filesDir,"outgoing").apply { check(mkdirs()||isDirectory) }
        val file=File(directory,UUID.randomUUID().toString()+"."+name.substringAfterLast('.',"bin").filter(Char::isLetterOrDigit).take(8))
        try {
            context.contentResolver.openInputStream(uri).use { input ->
                checkNotNull(input) { "无法读取所选文件" }
                file.outputStream().use { output ->
                    val buffer=ByteArray(64*1024);var total=0L
                    while(true) { val size=input.read(buffer);if(size<0)break;total+=size;check(total<=256L*1024*1024) { "附件不能超过 256 MB" };output.write(buffer,0,size) }
                }
            }
            check(file.length()>0) { "文件为空" }
            val selectedKind=if(kind==MediaKind.FILE&&(mime.startsWith("image/")||Regex("\\.(jpe?g|png|gif|webp|bmp|heic|heif|avif)$",RegexOption.IGNORE_CASE).containsMatchIn(name)))MediaKind.IMAGE else kind
            var value=LocalMedia(file,name,mime,selectedKind)
            if(selectedKind==MediaKind.IMAGE) {
                val bounds=BitmapFactory.Options().apply { inJustDecodeBounds=true };BitmapFactory.decodeFile(file.path,bounds)
                check(bounds.outWidth>0&&bounds.outHeight>0) { "所选图片格式不受支持" }
                if(!mime.startsWith("image/"))value=value.copy(mime=bounds.outMimeType ?: "image/jpeg")
                val orientation=runCatching { ExifInterface(file.path).getAttributeInt(ExifInterface.TAG_ORIENTATION,ExifInterface.ORIENTATION_NORMAL) }.getOrDefault(ExifInterface.ORIENTATION_NORMAL)
                val swapped=orientation in setOf(ExifInterface.ORIENTATION_ROTATE_90,ExifInterface.ORIENTATION_ROTATE_270,ExifInterface.ORIENTATION_TRANSPOSE,ExifInterface.ORIENTATION_TRANSVERSE)
                value=value.copy(width=if(swapped)bounds.outHeight else bounds.outWidth,height=if(swapped)bounds.outWidth else bounds.outHeight)
            }
            if(selectedKind==MediaKind.VIDEO) {
                if(!value.mime.startsWith("video/"))value=value.copy(mime=android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substringAfterLast('.',"").lowercase())?.takeIf { it.startsWith("video/") } ?: "video/mp4")
                if(prepareMetadata)value=prepareVideo(value)
            }
            if(selectedKind==MediaKind.VOICE) {
                val retriever=MediaMetadataRetriever()
                try {
                    retriever.setDataSource(file.path)
                    val millis=retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0
                    value=value.copy(duration=maxOf(1,(millis+999)/1000))
                } finally { retriever.release() }
            }
            return value
        } catch(error:Exception) { file.delete();throw error }
    }
    /** 只在后台处理视频；限制封面解码尺寸，保留系统实际输出的旋转方向。 */
    fun prepareVideo(media:LocalMedia):LocalMedia {
        require(media.kind==MediaKind.VIDEO&&media.file.isFile&&media.file.length() in 1..256L*1024*1024) { "视频为空或超过 256 MB" }
        if(media.width>0&&media.height>0&&media.duration>0&&media.snapshot?.isFile==true)return media
        val retriever=MediaMetadataRetriever()
        var temporary:File?=null
        try {
            retriever.setDataSource(media.file.path)
            val millis=retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0
            val width=retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 0
            val height=retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 0
            require(millis>0&&width>0&&height>0) { "视频信息暂不可读取，请重试或重新拍摄" }
            val rotation=retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
            val factor=minOf(1.0,720.0/maxOf(width,height))
            val bitmap=if(Build.VERSION.SDK_INT>=27)retriever.getScaledFrameAtTime(0,MediaMetadataRetriever.OPTION_CLOSEST_SYNC,maxOf(1,(width*factor).toInt()),maxOf(1,(height*factor).toInt()))
                else @Suppress("DEPRECATION") android.media.ThumbnailUtils.createVideoThumbnail(media.file.path,MediaStore.Video.Thumbnails.MINI_KIND)
            requireNotNull(bitmap) { "视频封面暂不可读取，请重试" }
            val cover=File(media.file.parentFile,media.file.nameWithoutExtension+".cover.jpg")
            val temp=File(cover.parentFile,cover.name+".tmp");temporary=temp
            val posterWidth=bitmap.width;val posterHeight=bitmap.height
            try { java.io.FileOutputStream(temp).use { check(bitmap.compress(Bitmap.CompressFormat.JPEG,80,it));it.fd.sync() } } finally { bitmap.recycle() }
            Files.move(temp.toPath(),cover.toPath(),StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING)
            val swapped=rotation%180!=0
            return media.copy(duration=maxOf(1,(millis+999)/1000),width=posterWidth.takeIf { it>0 } ?: if(swapped)height else width,height=posterHeight.takeIf { it>0 } ?: if(swapped)width else height,snapshot=cover)
        } finally { temporary?.delete();retriever.release() }
    }
    fun openFile(context:Context,file:File,name:String) {
        val extension=name.substringAfterLast('.',"").filter(Char::isLetterOrDigit).lowercase()
        val shared=File(file.parentFile,file.name+if(extension.isEmpty()) "" else ".$extension")
        if(!shared.exists()) file.copyTo(shared)
        val uri=FileProvider.getUriForFile(context,context.packageName+".files",shared)
        val mime=android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension) ?: "application/octet-stream"
        val intent=Intent(Intent.ACTION_VIEW).setDataAndType(uri,mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(Intent.createChooser(intent,"打开文件").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}

class VoiceRecorder(private val context:Context) {
    private var recorder:MediaRecorder?=null
    private var file:File?=null
    private var started=0L
    private var released=false
    @Synchronized fun start() {
        check(!released) { "录音页面已关闭" }
        cancel()
        val directory=File(context.filesDir,"outgoing").apply { check(mkdirs()||isDirectory) }
        val output=File(directory,UUID.randomUUID().toString()+".m4a")
        val value=if(Build.VERSION.SDK_INT>=31)MediaRecorder(context) else @Suppress("DEPRECATION") MediaRecorder()
        try {
            value.setAudioSource(MediaRecorder.AudioSource.MIC)
            value.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            value.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            value.setAudioSamplingRate(16000);value.setAudioEncodingBitRate(48000)
            value.setMaxDuration(60_000)
            value.setOutputFile(output.path);value.prepare();value.start()
            recorder=value;file=output;started=android.os.SystemClock.elapsedRealtime()
        } catch(error:Exception) { value.release();output.delete();throw error }
    }
    @Synchronized fun finish():LocalMedia {
        val value=recorder ?: error("录音未开始")
        val output=file ?: error("录音文件不可用")
        val duration=android.os.SystemClock.elapsedRealtime()-started
        try { value.stop() } catch(error:Exception) { output.delete();throw error } finally { value.release();recorder=null;file=null }
        if(duration<650) { output.delete();error("录音太短，请录制片刻后结束") }
        return LocalMedia(output,"语音.m4a","audio/mp4",MediaKind.VOICE,duration=maxOf(1,minOf(60,(duration+999)/1000)))
    }
    @Synchronized fun cancel() { recorder?.let { runCatching { it.stop() };it.release() };recorder=null;file?.delete();file=null }
    @Synchronized fun release() { released=true;cancel() }
}
