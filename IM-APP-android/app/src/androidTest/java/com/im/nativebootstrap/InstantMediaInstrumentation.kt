package com.im.nativebootstrap

import android.app.Activity
import android.app.Instrumentation
import android.content.Intent
import android.graphics.Bitmap
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.im.nativebootstrap.chat.*
import com.im.nativebootstrap.core.AccountIdentity
import com.im.nativebootstrap.media.*
import java.io.File
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** 故意阻塞上传，验证真实控制器先显示本地图片；不登录或请求现网。 */
class InstantMediaInstrumentation:Instrumentation() {
    override fun onCreate(arguments:Bundle?) { super.onCreate(arguments);start() }
    override fun onStart() {
        val result=Bundle();val thread=HandlerThread("instant-media-fixture").apply { start() }
        val queue=Handler(thread.looper);val main=Handler(Looper.getMainLooper())
        val release=CountDownLatch(1);val started=CountDownLatch(1)
        var activity:MainActivity?=null
        var controller:ChatController?=null
        try {
            val base="https://127.0.0.1:1/api/v1";val account="instant-${UUID.randomUUID()}"
            val target=ChatTarget("si_instant",1,"fixture-peer")
            val conversation=ChatConversation(target,"本地图片发送验证","",0)
            val gateway=FixtureGateway(conversation)
            var state by mutableStateOf(ChatState())
            val latest=java.util.concurrent.atomic.AtomicReference(ChatState())
            val chat=ChatController(gateway,{ queue.post(it) },{ delay,action -> queue.postDelayed(action,delay) },{ value -> latest.set(value);main.post { state=value } })
            controller=chat
            MediaLoader.setScope(base,account)
            val source=File(File(targetContext.filesDir,"outgoing").apply { mkdirs() },"instant-${UUID.randomUUID()}.png")
            val picture=Bitmap.createBitmap(240,160,Bitmap.Config.ARGB_8888)
            picture.eraseColor(android.graphics.Color.GREEN)
            source.outputStream().use { picture.compress(Bitmap.CompressFormat.PNG,100,it) };picture.recycle()
            val url="https://127.0.0.1:1/object/instant-${UUID.randomUUID()}.png"
            queue.post {
                chat.attachBusiness(object:ChatBusiness {
                    override val baseUrl=base
                    override fun request(method:String,path:String,body:JsonObject?,query:Map<String,String>)=JsonParser.parseString("""{"canChat":true}""")
                    override fun uploadMedia(media:LocalMedia):UploadedMedia {
                        started.countDown();check(release.await(20,TimeUnit.SECONDS))
                        val value=UploadedMedia(media,url)
                        MediaLoader.rememberUploaded(targetContext,value,base,account)
                        return value
                    }
                })
                chat.start(AccountIdentity(account,"fixture-im"),base,"fixture-token","https://127.0.0.1:1","wss://127.0.0.1:1",File(targetContext.filesDir,"native-chat"))
            }
            await("readable fixture store") { latest.get().ready }
            activity=startActivitySync(Intent(targetContext,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
            val screen=activity
            runOnMainSync { screen.setContent { MaterialTheme {
                NativeChatRoom(state,NativeChatCallbacks({}, {}, {_,_,done->done(false)}, {_,done->done(false)}, {}, {_,_,done->done(Result.success(Unit))}, {_,_,done->done(Result.success(Unit))}, {}))
            } } }
            var queued=false
            val at=SystemClock.elapsedRealtime()
            queue.post { chat.open(conversation);chat.sendMedia(LocalMedia(source,"fixture.png","image/png",MediaKind.IMAGE,width=240,height=160)) { queued=it } }
            check(started.await(5,TimeUnit.SECONDS))
            await("local preview and in-bubble loading") { findDescription("图片正在发送")!=null&&greenPixels()>300 }
            val localVisibleMs=SystemClock.elapsedRealtime()-at
            check(queued&&latest.get().messages.size==1&&latest.get().mediaUploads.size==1&&gateway.sends==0)
            check(findText("附件上传中…")==null&&findText("正在处理媒体…")==null)
            check(latest.get().messages.single().seq==0L&&latest.get().messages.single().status!=2)
            screenshot("uploading")
            // 上传仍被阻塞，持续超过 2 秒，证明 UI 没有等网络结束才补气泡。
            SystemClock.sleep(2_100)
            check(findDescription("图片正在发送")!=null&&gateway.sends==0&&greenPixels()>300)
            release.countDown()
            await("durable SDK handoff") { gateway.sends==1&&latest.get().mediaUploads.isEmpty()&&latest.get().outbox.singleOrNull()?.state==OutboxState.SENDING }
            check(latest.get().messages.size==1)
            queue.post { val accepted=gateway.created.copy(status=2,seq=8);gateway.localReceipt=accepted;gateway.sent?.invoke(Result.success(accepted)) }
            await("successful receipt") { latest.get().outbox.isEmpty()&&latest.get().messages.singleOrNull()?.seq==8L&&findDescription("图片正在发送")==null&&greenPixels()>300 }
            check(latest.get().messages.size==1)
            screenshot("complete")
            result.putString("instantMedia","passed: blocked upload >2s renders owned local image and in-bubble loading; no upload banner; durable handoff has one bubble; ACK completes with local image and no network")
            result.putLong("localPreviewVisibleMs",localVisibleMs)
            result.putString("scope","Synthetic local image and blocked uploader; timing is emulator-only, not production upload latency")
            finish(Activity.RESULT_OK,result)
        } catch(error:Throwable) {
            runCatching { screenshot("failure") }
            result.putString("instantMedia","failed: ${error.javaClass.simpleName}: ${error.message}");finish(Activity.RESULT_CANCELED,result)
        } finally {
            release.countDown()
            val ended=CountDownLatch(1)
            queue.post { controller?.logout();ended.countDown() };ended.await(3,TimeUnit.SECONDS)
            thread.quitSafely();MediaLoader.setScope(MediaURLs.DEFAULT_BASE,"anonymous")
            activity?.let { screen -> runOnMainSync { screen.finish() } }
        }
    }
    private class FixtureGateway(val conversation:ChatConversation):ChatGateway {
        @Volatile var sends=0
        @Volatile var sent:((Result<ChatMessage>)->Unit)?=null
        var created=ChatMessage("fixture-sdk-image","[图片]",true,System.currentTimeMillis(),1,0)
        var localReceipt:ChatMessage?=null
        override fun start(userId:String,token:String,api:String,ws:String,directory:File,events:ChatEvents,done:(Result<Unit>)->Unit)=done(Result.success(Unit))
        override fun conversations(offset:Int,count:Int,done:(Result<List<ChatConversation>>)->Unit)=done(Result.success(if(offset==0)listOf(conversation) else emptyList()))
        override fun history(target:ChatTarget,cursor:String?,count:Int,done:(Result<HistoryPage>)->Unit)=done(Result.success(HistoryPage(emptyList(),true)))
        override fun createText(text:String,target:ChatTarget)=error("Fixture must not send text")
        override fun createMedia(media:UploadedMedia,target:ChatTarget):ChatMessage {
            created=created.copy(serialized="""{"clientMsgID":"fixture-sdk-image","contentType":102,"pictureElem":{"sourcePicture":{"url":"${media.url}","width":240,"height":160}}}""")
            return created
        }
        override fun send(target:ChatTarget,serialized:String,done:(Result<ChatMessage>)->Unit) { sent=done;sends++ }
        override fun find(target:ChatTarget,id:String,done:(Result<ChatMessage?>)->Unit)=done(Result.success(localReceipt?.takeIf { it.id==id }))
        override fun foreground(active:Boolean) {}
        override fun shutdown() {}
    }
    private fun await(label:String,predicate:()->Boolean) {
        repeat(70) { waitForIdleSync();if(predicate())return;SystemClock.sleep(100) }
        error("Timed out: $label")
    }
    private fun findText(value:String)=find(uiAutomation.rootInActiveWindow) { it.isVisibleToUser&&it.text?.toString()==value }
    private fun findDescription(value:String)=find(uiAutomation.rootInActiveWindow) { it.isVisibleToUser&&it.contentDescription?.toString()==value }
    private fun find(node:AccessibilityNodeInfo?,predicate:(AccessibilityNodeInfo)->Boolean):AccessibilityNodeInfo? {
        if(node==null)return null
        if(predicate(node))return node
        for(i in 0 until node.childCount)find(node.getChild(i),predicate)?.let { return it }
        return null
    }
    private fun greenPixels():Int {
        val bitmap=uiAutomation.takeScreenshot() ?: return 0
        var count=0
        for(y in 0 until bitmap.height step 4)for(x in 0 until bitmap.width step 4) {
            val color=bitmap.getPixel(x,y)
            if(android.graphics.Color.green(color)>180&&android.graphics.Color.red(color)<70&&android.graphics.Color.blue(color)<70)count++
        }
        bitmap.recycle();return count
    }
    private fun screenshot(name:String) {
        val bitmap=uiAutomation.takeScreenshot() ?: error("Screenshot unavailable")
        File(targetContext.cacheDir,"instant-media-$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG,100,it) };bitmap.recycle()
    }
}
