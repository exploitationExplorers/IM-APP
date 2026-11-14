package com.im.nativebootstrap.media

import android.app.Activity
import android.app.Instrumentation
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.drawable.Animatable
import android.os.SystemClock
import android.view.View
import android.widget.FrameLayout
import java.io.File
import java.security.MessageDigest

/** 由统一实机 runner 调用；缓存合成 GIF，不发起任何网络请求。 */
object AnimatedMediaSmoke {
    fun verify(instrumentation:Instrumentation,activity:Activity):String {
        val context=instrumentation.targetContext
        val url="https://media-fixture.invalid/native-animation.gif"
        val key=MessageDigest.getInstance("SHA-256").digest(url.toByteArray()).joinToString("") { "%02x".format(it) }
        val file=File(context.cacheDir,"media/$key").apply { parentFile!!.mkdirs() }
        // 两个 1 × 1 帧：红色、蓝色，每帧 100 ms，循环；GIF 原字节无服务端转码。
        val hex="47494638396101000100800000ff00000000ff"+
            "21ff0b4e45545343415045322e300301000000"+
            "21f904000a0000002c0000000001000100000202440100"+
            "21f904000a0000002c00000000010001000002024c01003b"
        file.writeBytes(hex.chunked(2).map { it.toInt(16).toByte() }.toByteArray())
        MediaFixture.seed(context,url,file.readBytes(),"image/gif")
        var image:AnimatedMediaView?=null
        var root:FrameLayout?=null
        val bitmap=Bitmap.createBitmap(64,64,Bitmap.Config.ARGB_8888)
        try {
            val loaded=MediaLoader.visual(context,url,64)
            val drawable=loaded.animation ?: error("GIF was reduced to a static preview")
            val animation=drawable as? Animatable ?: error("GIF decoder did not return an animation")
            instrumentation.runOnMainSync {
                val view=AnimatedMediaView(activity)
                val container=FrameLayout(activity)
                container.addView(view,FrameLayout.LayoutParams(128,128))
                activity.setContentView(container)
                view.bind(drawable,false,"合成 GIF 验证",true)
                image=view;root=container
            }
            instrumentation.waitForIdleSync()
            val colors=mutableSetOf<Int>()
            repeat(12) {
                SystemClock.sleep(35)
                instrumentation.runOnMainSync {
                    bitmap.eraseColor(Color.TRANSPARENT)
                    val canvas=Canvas(bitmap)
                    canvas.scale(64f/image!!.width.coerceAtLeast(1),64f/image!!.height.coerceAtLeast(1))
                    image!!.draw(canvas)
                    colors+=bitmap.getPixel(32,32)
                }
            }
            check(Color.RED in colors&&Color.BLUE in colors) { "GIF frames did not advance: colors=$colors drawable=${drawable.javaClass.simpleName} running=${animation.isRunning}" }
            instrumentation.runOnMainSync { image!!.setPageActive(false);check(!animation.isRunning) { "GIF kept playing after the page stopped" } }
            instrumentation.runOnMainSync { image!!.setPageActive(true);root!!.invalidate() }
            instrumentation.waitForIdleSync()
            instrumentation.runOnMainSync { check(animation.isRunning) { "Visible GIF did not resume" };image!!.visibility=View.INVISIBLE;root!!.invalidate() }
            instrumentation.waitForIdleSync()
            instrumentation.runOnMainSync { check(!animation.isRunning) { "Invisible GIF kept playing" };image!!.release() }
            return "passed: native red/blue frames, page stop/resume, invisible stop, no network"
        } finally {
            instrumentation.runOnMainSync { image?.release() }
            bitmap.recycle();file.delete();MediaFixture.remove(context,url)
        }
    }
}
