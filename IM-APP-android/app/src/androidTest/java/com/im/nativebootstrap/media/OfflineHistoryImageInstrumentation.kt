package com.im.nativebootstrap.media

import android.app.Activity
import android.app.Instrumentation
import android.content.Intent
import android.graphics.Bitmap
import android.os.Bundle
import android.os.SystemClock
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.Modifier
import com.im.nativebootstrap.MainActivity
import java.io.File
import java.util.UUID

/** 仅合成旧缓存字节，不登录、不访问现网；原始URL只作为缓存候选。 */
class OfflineHistoryImageInstrumentation:Instrumentation() {
    private var restart=false
    override fun onCreate(arguments:Bundle?) { restart=arguments?.getString("restart")=="true";super.onCreate(arguments);start() }
    override fun onStart() {
        val result=Bundle();var activity:MainActivity?=null
        val base="https://127.0.0.1:1/api/v1";val account="offline-history-ui"
        try {
            val fixture=File(targetContext.filesDir,"offline-history-ui-fixture.txt")
            val original=if(restart)fixture.readText().trim() else "https://oss-chat-test.xn--jprz53bj9s.com/oss-test/chat/offline-${UUID.randomUUID()}.png?OSSAccessKeyId=fixture&Signature=old&Expires=1"
            check(original.startsWith("https://oss-chat-test.xn--jprz53bj9s.com/oss-test/chat/offline-"))
            MediaLoader.setScope(base,account)
            val key=MediaCacheIdentity.key(original,MediaCacheIdentity.scope(base,account),base)
            val saved=File(File(targetContext.cacheDir,"media-files-v2").apply { mkdirs() },key)
            if(!restart) {
                val bitmap=Bitmap.createBitmap(160,120,Bitmap.Config.ARGB_8888).apply { eraseColor(android.graphics.Color.GREEN) }
                saved.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG,100,it) };bitmap.recycle()
                fixture.writeText(original)
            }
            check(saved.isFile&&saved.length()>0)
            activity=startActivitySync(Intent(targetContext,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
            val screen=activity
            fun render()=runOnMainSync { screen.setContent { MaterialTheme {
                // 主地址已经变成/object规格地址，远程不可达；已有原始URL字节必须先显示。
                RemoteMediaImage(MediaURLs.image(original,ImageVariant.LIST,base),Modifier.fillMaxSize(),cacheUrls=listOf(original))
            } } }
            MediaMetrics.reset()
            val started=SystemClock.elapsedRealtime()
            render()
            await("cached original appears without transformed URL network") { greenPixels()>1_000 }
            val elapsed=SystemClock.elapsedRealtime()-started
            check(MediaMetrics.report().first().contains("请求 0 次")) { "Cached fallback waited for a remote request" }
            screenshot(if(restart)"restarted" else "cached")
            // 同一沙盒中的其它账号没有该key，不能通过原始URL复用字节。
            MediaLoader.setScope(base,"offline-history-other")
            await("account switch hides prior image") { greenPixels()==0 }
            check(saved.exists()) { "Account switch deleted existing image bytes" }
            MediaLoader.setScope(base,account)
            await("owner returns to disk image") { greenPixels()>1_000 }
            File(targetContext.cacheDir,"offline-history-ui-result.txt").writeText("restart=$restart\nlocalVisibleMs=$elapsed\n${MediaMetrics.report().joinToString("\n")}\n")
            result.putString("offlineHistoryImage","passed: transformed primary uses existing raw-URL bytes before network; account isolation; bytes preserved; restart=$restart")
            result.putLong("localVisibleMs",elapsed)
            finish(Activity.RESULT_OK,result)
        } catch(error:Throwable) {
            runCatching { screenshot("failure") }
            result.putString("offlineHistoryImage","failed: ${error.javaClass.simpleName}: ${error.message}")
            finish(Activity.RESULT_CANCELED,result)
        } finally {
            activity?.let { runOnMainSync { it.finish() } }
            MediaLoader.setScope(MediaURLs.DEFAULT_BASE,"anonymous")
        }
    }
    private fun await(label:String,predicate:()->Boolean) { val deadline=SystemClock.elapsedRealtime()+5_000;while(SystemClock.elapsedRealtime()<deadline) { waitForIdleSync();if(predicate())return;SystemClock.sleep(60) };error("Timed out: $label") }
    private fun greenPixels():Int {
        val bitmap=uiAutomation.takeScreenshot() ?: return 0
        var count=0
        for(y in 0 until bitmap.height step 8)for(x in 0 until bitmap.width step 8) {
            val color=bitmap.getPixel(x,y)
            if(android.graphics.Color.green(color)>180&&android.graphics.Color.red(color)<70&&android.graphics.Color.blue(color)<70)count++
        }
        bitmap.recycle();return count
    }
    private fun screenshot(name:String) {
        val bitmap=uiAutomation.takeScreenshot() ?: error("Screenshot unavailable")
        File(targetContext.cacheDir,"offline-history-ui-$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG,100,it) };bitmap.recycle()
    }
}
