package com.im.nativebootstrap.media

import android.content.Context
import android.media.MediaPlayer
import android.net.Uri
import android.view.Gravity
import android.widget.FrameLayout
import android.widget.MediaController
import android.widget.VideoView
import java.io.File

/** 视频由系统解码器串流播放；实际 VideoView 被容器居中，保持原始视频比例。 */
class NativeVideoPlayerView(context:Context):FrameLayout(context) {
    private val video=VideoView(context)
    private var active=true
    private var wantsPlayback=true
    var prepared:Boolean=false;private set
    val playbackPosition:Int get()=video.currentPosition
    val playing:Boolean get()=video.isPlaying
    private var bindKey=""
    init {
        setBackgroundColor(android.graphics.Color.BLACK)
        addView(video,LayoutParams(LayoutParams.MATCH_PARENT,LayoutParams.MATCH_PARENT,Gravity.CENTER))
        video.setMediaController(MediaController(context).apply { setAnchorView(this@NativeVideoPlayerView) })
        contentDescription="原生视频播放器"
    }
    fun bind(address:String,source:File?,onPrepared:()->Unit,onRendered:()->Unit,onError:()->Unit,allowedLocalDirectory:File?=null) {
        val key=source?.absolutePath ?: address
        if(key==bindKey)return
        bindKey=key;prepared=false;wantsPlayback=true
        video.stopPlayback()
        video.setOnPreparedListener { player ->
            prepared=true
            player.setOnInfoListener { _,what,_->if(what==MediaPlayer.MEDIA_INFO_VIDEO_RENDERING_START)onRendered();false }
            onPrepared()
            if(active&&wantsPlayback)video.start()
        }
        video.setOnCompletionListener { wantsPlayback=false }
        video.setOnErrorListener { _,_,_->prepared=false;onError();true }
        try {
            if(source!=null) {
                val canonical=source.canonicalFile
                val cached=canonical.toPath().startsWith(context.cacheDir.canonicalFile.toPath())&&canonical.isFile&&canonical.length() in 1..256L*1024*1024
                check(cached||OwnedVideoFiles.verified(canonical,allowedLocalDirectory,File(context.filesDir,"native-chat"))!=null)
                video.setVideoURI(Uri.fromFile(canonical))
            } else {
                check(MediaURLs.remote(address).isNotBlank())
                // Android 的 HTTP MediaSource 默认可能拒绝稳定入口的跨域 302。
                video.setVideoURI(Uri.parse(address),mapOf("android-allow-cross-domain-redirect" to "1"))
            }
        } catch(_:Exception) { onError() }
    }
    fun setPageActive(value:Boolean) {
        if(!value&&active) { wantsPlayback=video.isPlaying||!prepared;video.pause() }
        active=value
        if(value&&prepared&&wantsPlayback)video.start()
    }
    fun release() { video.stopPlayback();prepared=false;bindKey="" }
}
