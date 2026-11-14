package com.im.nativebootstrap.media

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.ColorFilter
import android.graphics.ImageDecoder
import android.graphics.Movie
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.Rect
import android.graphics.drawable.Animatable
import android.graphics.drawable.Drawable
import android.os.Build
import android.os.SystemClock
import android.view.View
import android.view.ViewTreeObserver
import android.widget.ImageView
import androidx.annotation.RequiresApi
import java.io.File
import kotlin.math.max
import kotlin.math.roundToInt

data class MediaVisual(val bitmap:Bitmap?=null,val animation:Drawable?=null,val note:String="")

/** 动图只保留编码数据和当前解码帧，不预解全部帧。 */
internal object AnimatedMedia {
    fun encodedAnimation(file:File,mime:String?):Boolean {
        if(mime=="image/gif")return true
        if(mime!="image/webp")return false
        val header=ByteArray(24)
        val count=file.inputStream().use { it.read(header) }
        return count>=21&&String(header,0,4,Charsets.US_ASCII)=="RIFF"&&String(header,8,4,Charsets.US_ASCII)=="WEBP"&&String(header,12,4,Charsets.US_ASCII)=="VP8X"&&(header[20].toInt() and 2)!=0
    }
    fun decode(file:File,edge:Int,width:Int,height:Int,mime:String?):Drawable? {
        if(Build.VERSION.SDK_INT>=28)return modern(file,edge)
        // 旧 Movie 解码器无法对源帧采样；限制其源帧和压缩数据大小，超限保留静态预览。
        if(mime!="image/gif"||width.toLong()*height>4_194_304||file.length()>8L*1024*1024)return null
        @Suppress("DEPRECATION")
        val movie=Movie.decodeFile(file.path) ?: error("动图解码失败")
        require(movie.width()>0&&movie.height()>0)
        return MovieFrames(movie,edge.coerceIn(32,1280))
    }
    @RequiresApi(28)
    private fun modern(file:File,edge:Int):Drawable = ImageDecoder.decodeDrawable(ImageDecoder.createSource(file)) { decoder,info,_ ->
        val ratio=max(info.size.width,info.size.height).toFloat()/edge.coerceIn(32,1280)
        if(ratio>1)decoder.setTargetSize(max(1,(info.size.width/ratio).roundToInt()),max(1,(info.size.height/ratio).roundToInt()))
        decoder.allocator=ImageDecoder.ALLOCATOR_SOFTWARE
        decoder.setOnPartialImageListener { false }
    }
}

@Suppress("DEPRECATION")
private class MovieFrames(private val movie:Movie,edge:Int):Drawable(),Animatable {
    private val paint=Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    private val ratio=minOf(1f,edge.toFloat()/max(movie.width(),movie.height()))
    private var running=false
    private var origin=0L
    private var frameTime=0
    private val frame=object:Runnable {
        override fun run() {
            if(!running)return
            frameTime=((SystemClock.uptimeMillis()-origin)%movie.duration().coerceAtLeast(100)).toInt()
            invalidateSelf()
            scheduleSelf(this,SystemClock.uptimeMillis()+33)
        }
    }
    override fun draw(canvas:Canvas) {
        movie.setTime(frameTime)
        val checkpoint=canvas.save()
        canvas.translate(bounds.left.toFloat(),bounds.top.toFloat())
        canvas.scale(bounds.width().toFloat()/movie.width(),bounds.height().toFloat()/movie.height())
        movie.draw(canvas,0f,0f,paint)
        canvas.restoreToCount(checkpoint)
    }
    override fun start() { if(!running) { running=true;origin=SystemClock.uptimeMillis()-frameTime;scheduleSelf(frame,SystemClock.uptimeMillis()+33);invalidateSelf() } }
    override fun stop() { running=false;unscheduleSelf(frame) }
    override fun isRunning()=running
    override fun getIntrinsicWidth()=max(1,(movie.width()*ratio).roundToInt())
    override fun getIntrinsicHeight()=max(1,(movie.height()*ratio).roundToInt())
    override fun setAlpha(alpha:Int) { paint.alpha=alpha;invalidateSelf() }
    override fun setColorFilter(colorFilter:ColorFilter?) { paint.colorFilter=colorFilter;invalidateSelf() }
    @Deprecated("Framework drawable opacity")
    override fun getOpacity()=PixelFormat.TRANSLUCENT
}

/** 同时检查页面生命周期、窗口焦点和实际裁剪区域，列表外缓存项不继续播放。 */
internal class AnimatedMediaView(context:Context):ImageView(context) {
    private val visibleBounds=Rect()
    private var pageActive=false
    private var attached=false
    private var playing=false
    private var bound:Drawable?=null
    private val visibilityCheck=ViewTreeObserver.OnPreDrawListener { syncPlayback();true }
    fun bind(drawable:Drawable,crop:Boolean,description:String,active:Boolean) {
        if(bound!==drawable) {
            (bound as? Animatable)?.stop()
            bound=drawable;playing=false
            setImageDrawable(drawable)
        }
        contentDescription=description
        scaleType=if(crop)ScaleType.CENTER_CROP else ScaleType.FIT_CENTER
        pageActive=active
        syncPlayback()
    }
    fun setPageActive(active:Boolean) { pageActive=active;syncPlayback() }
    private fun syncPlayback() {
        val visible=attached&&pageActive&&windowVisibility==View.VISIBLE&&hasWindowFocus()&&isShown&&width>0&&height>0&&getGlobalVisibleRect(visibleBounds)&&!visibleBounds.isEmpty
        if(visible==playing)return
        playing=visible
        (bound as? Animatable)?.let { if(visible)it.start() else it.stop() }
    }
    override fun onAttachedToWindow() {
        super.onAttachedToWindow();attached=true
        viewTreeObserver.addOnPreDrawListener(visibilityCheck)
        syncPlayback()
    }
    override fun onDetachedFromWindow() {
        attached=false;syncPlayback()
        if(viewTreeObserver.isAlive)viewTreeObserver.removeOnPreDrawListener(visibilityCheck)
        super.onDetachedFromWindow()
    }
    override fun onWindowVisibilityChanged(visibility:Int) { super.onWindowVisibilityChanged(visibility);syncPlayback() }
    override fun onWindowFocusChanged(hasWindowFocus:Boolean) { super.onWindowFocusChanged(hasWindowFocus);syncPlayback() }
    fun release() { pageActive=false;syncPlayback();(bound as? Animatable)?.stop();setImageDrawable(null);bound=null }
}
