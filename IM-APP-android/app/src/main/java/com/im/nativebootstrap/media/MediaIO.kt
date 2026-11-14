package com.im.nativebootstrap.media

import android.content.Context
import android.content.Intent
import android.content.ContentValues
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadataRetriever
import android.media.MediaRecorder
import android.media.ExifInterface
import android.net.Uri
import android.os.Build
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
    /** Android 10 及以上写入系统相册，无需申请整个存储目录权限。 */
    fun saveToGallery(context:Context,file:File,name:String,mime:String,video:Boolean):Boolean {
        if(Build.VERSION.SDK_INT<29)return false
        val collection=if(video)MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY) else MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        val values=ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME,name)
            put(MediaStore.MediaColumns.MIME_TYPE,mime)
            put(MediaStore.MediaColumns.RELATIVE_PATH,if(video)"Movies/易可聊" else "Pictures/易可聊")
            put(MediaStore.MediaColumns.IS_PENDING,1)
        }
        val uri=context.contentResolver.insert(collection,values) ?: error("系统相册暂不可写入")
        try {
            context.contentResolver.openOutputStream(uri)?.use { output -> file.inputStream().use { it.copyTo(output) } } ?: error("系统相册暂不可写入")
            context.contentResolver.update(uri,ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING,0) },null,null)
            return true
        } catch(error:Exception) {
            context.contentResolver.delete(uri,null,null)
            throw error
        }
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
