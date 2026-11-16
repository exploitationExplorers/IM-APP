package com.im.nativebootstrap

import android.app.Activity
import android.app.Instrumentation
import android.content.Intent
import android.graphics.Rect
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.os.Bundle
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.view.accessibility.AccessibilityNodeInfo
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.im.nativebootstrap.chat.*
import com.im.nativebootstrap.media.*
import java.io.File
import java.util.concurrent.atomic.AtomicInteger

/** 实际点击聊天输入/表情/视频，并使用本地编码的 AVC MP4 检查平台解码和播放推进。 */
class ChatMediaRegressionInstrumentation:Instrumentation() {
    override fun onCreate(arguments:Bundle?) { super.onCreate(arguments);start() }
    override fun onStart() {
        val result=Bundle();var activity:MainActivity?=null
        val fixtureBase="https://127.0.0.1:1/api/v1";val account="chat-media-regression"
        uiAutomation.serviceInfo=uiAutomation.serviceInfo.apply {flags=flags or android.accessibilityservice.AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS}
        try {
            File(targetContext.cacheDir,"chat-media-clicks.txt").writeText("")
            File(targetContext.cacheDir,"chat-media-player-samples.txt").writeText("")
            MediaLoader.setScope(fixtureBase,account)
            val url="https://127.0.0.1:1/object/regression-video.mp4"
            val video=File(File(targetContext.cacheDir,"media-files-v2").apply { mkdirs() },MediaLoader.id(url))
            encodeVideo(video)
            val portrait=ChatMessage("video-portrait","[视频]",false,System.currentTimeMillis(),2,10,serialized="""{"clientMsgID":"video-portrait","contentType":104,"sendID":"fixture-peer","VideoElem":{"VideoURL":"$url","SnapshotWidth":160,"SnapshotHeight":240,"Duration":3}}""",sender="视频测试")
            val target=ChatTarget("si_media-regression",1,"fixture-peer")
            val state=ChatState(ready=true,loggedIn=true,connection=ConnectionState.CONNECTED,active=ChatConversation(target,"媒体回归","",0),historyEnd=true,messages=listOf(portrait))
            val stickerLoads=AtomicInteger();val stickerSends=AtomicInteger()
            val callbacks=NativeChatCallbacks({}, {}, {_,_,done->done(false)}, {_,done->done(false)}, {}, {_,_,done->done(Result.success(Unit))}, {_,_,done->done(Result.success(Unit))}, {},
                onLoadStickers={page,done->stickerLoads.incrementAndGet();done(Result.success(ChatPickerPage(items=emptyList(),page=page,end=true)))},
                onSendSticker={_,done->stickerSends.incrementAndGet();done(Result.failure(IllegalStateException("Fixture does not send")))})
            activity=startActivitySync(Intent(targetContext,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
            val screen=activity
            fun render(value:ChatState=state) { runOnMainSync { screen.setContent { MaterialTheme { NativeChatRoom(value,callbacks);NativeNoticeHost() } } } }
            render()
            await("input and video") { findEditable()!=null&&findDescription("视频消息")!=null }
            val input=findEditable() ?: error("Missing message editor")
            check(input.performAction(AccessibilityNodeInfo.ACTION_FOCUS))
            check(input.performAction(AccessibilityNodeInfo.ACTION_CLICK))
            // 真正唤出 IME，再切面板；测试环境若禁用 IME 不能冒充键盘路径通过。
            await("system keyboard shown") { var visible=false;runOnMainSync { visible=ViewCompat.getRootWindowInsets(screen.window.decorView)?.isVisible(WindowInsetsCompat.Type.ime())==true };visible }
            diagnostic("before-emoji",screen)
            clickDescription("表情")
            diagnostic("after-emoji-click",screen)
            await("emoji grid") { findText("😀")!=null&&findDescription("收藏表情")!=null }
            repeat(12) {
                waitForIdleSync()
                check(findText("😀")!=null&&findDescription("收藏表情")!=null) { "Emoji panel dismissed itself while drawing tab icons" }
                SystemClock.sleep(100)
            }
            val panel=bounds(findDescription("表情面板") ?: error("Missing emoji panel"))
            check(panel.height()>100&&panel.bottom<=screen.resources.displayMetrics.heightPixels) { "Emoji panel is clipped below screen" }
            clickText("😀")
            await("emoji inserted in actual editor") { findEditable()?.text?.toString()?.contains("😀")==true }
            waitForIdleSync()
            clickDescription("收藏表情")
            try { await("real sticker load callback") { stickerLoads.get()>0&&findText("点击 + 添加表情")!=null } }
            catch(error:Throwable) { diagnostic("sticker-load-failure-${stickerLoads.get()}",screen);throw error }
            check(stickerSends.get()==0)
            screenshot("emoji-panel")
            clickDescription("关闭表情面板")
            await("emoji panel closed") { findDescription("收藏表情")==null }
            result.putString("emojiInteraction","passed: real IME to panel; visible grid; selected emoji enters editor; favorites tab loads real callback")

            val portraitRect=bounds(findDescription("视频消息") ?: error("Missing portrait video bubble"))
            check(portraitRect.height()>portraitRect.width()&&kotlin.math.abs(portraitRect.width().toFloat()/portraitRect.height()-160f/240)<.03f) { "Portrait video bubble lost cover ratio: $portraitRect" }
            screenshot("portrait-bubble")
            clickDescription("视频消息")
            var player:NativeVideoPlayerView?=null
            awaitMedia("native video dialog") { runOnMainSync { player=findPlayer(screen.window.decorView) ?: findPlayerFromWindows() };player!=null }
            awaitMedia("real MediaPlayer prepared") { samplePlayback("cached-preparing",player).first }
            val startedAt=samplePlayback("cached-baseline",player).third
            awaitMedia("actual playback position advances") { val sample=samplePlayback("cached-playing",player);sample.first&&sample.second&&sample.third>startedAt+250 }
            screenshot("playing")
            // 原生 MediaController 会先消费系统 Back；直接点预览返回按钮验证释放。
            clickText("‹")
            awaitMedia("video released after dismiss") { !samplePlayback("cached-released",player).first }
            fun verifyOwnedPlayback(label:String) {
                clickDescription("视频消息")
                var ownedPlayer:NativeVideoPlayerView?=null
                awaitMedia("$label opens native player") { runOnMainSync { ownedPlayer=findPlayerFromWindows() };ownedPlayer!=null }
                awaitMedia("$label local decode prepares") { samplePlayback("$label preparing",ownedPlayer).first }
                val baseline=samplePlayback("$label baseline",ownedPlayer).third
                awaitMedia("$label plays private local bytes") { val sample=samplePlayback(label,ownedPlayer);sample.first&&sample.second&&sample.third>baseline+250 }
                // MediaController 的浮层可先消费系统 Back；点预览自己的返回按钮才验证关闭播放器。
                clickText("‹")
                awaitMedia("$label closes decoder") { !samplePlayback("$label released",ownedPlayer).first }
            }
            val owner=File(targetContext.filesDir,"native-chat/"+"c".repeat(64)+"/upload-images").apply { mkdirs() }
            val uploadID="upload-"+java.util.UUID.randomUUID()
            val owned=File(owner,"$uploadID.video");video.copyTo(owned,true)
            val pending=PendingMediaUpload(id=uploadID,target=target,path=owned.path,name="fixture.mp4",mime="video/mp4",width=0,height=0,time=System.currentTimeMillis(),state=MediaUploadState.UPLOADING,kind=MediaKind.VIDEO)
            render(state.copy(messages=listOf(pending.placeholder()),mediaUploads=listOf(pending),mediaOwnerDirectory=owner.path))
            await("video placeholder before metadata and upload") { findDescription("视频消息")!=null&&findDescription("视频正在发送")!=null }
            screenshot("video-pending-before-cover")
            verifyOwnedPlayback("pending video before upload")
            val acknowledged=portrait.copy(id="video-local-ack",serialized=portrait.serialized.replace("video-portrait","video-local-ack").replace(url,"https://127.0.0.1:1/object/not-in-download-cache.mp4"))
            render(state.copy(messages=listOf(acknowledged),localSentMedia=mapOf(acknowledged.id to pending.media()),mediaOwnerDirectory=owner.path))
            await("ACK leaves local mapping and removes uploading spinner") { findDescription("视频消息")!=null&&findDescription("视频正在发送")==null }
            screenshot("video-local-sent")
            verifyOwnedPlayback("acknowledged video without remote download")
            result.putString("localVideoUI","passed: zero-metadata pending video bubble appears with sending indicator; private local bytes play before upload and after ACK under a different uncached remote URL")
            val landscape=portrait.copy(id="video-landscape",serialized=portrait.serialized.replace("video-portrait","video-landscape").replace("\"SnapshotWidth\":160,\"SnapshotHeight\":240","\"SnapshotWidth\":240,\"SnapshotHeight\":160"))
            render(state.copy(messages=listOf(landscape)))
            // setContent 后旧竖屏节点可能仍在可访问树中；等待新横屏布局提交再测量。
            await("landscape bubble") {
                findDescription("视频消息")?.let { node -> val rect=bounds(node);rect.width()>rect.height()&&kotlin.math.abs(rect.width().toFloat()/rect.height()-240f/160)<.03f }==true
            }
            val landscapeRect=bounds(findDescription("视频消息")!!)
            check(landscapeRect.width()>landscapeRect.height()&&kotlin.math.abs(landscapeRect.width().toFloat()/landscapeRect.height()-1.5f)<.03f) { "Landscape ratio changed: $landscapeRect" }
            check(findText("查看本次转发任务进度")==null&&findDescription("转发任务")==null)
            screenshot("landscape-bubble")
            result.putString("videoPlayback","passed: portrait/landscape cover ratio; real bubble click opens native player; locally encoded AVC MP4 prepares and playback position advances; dismiss releases decoder")
            result.putString("chatMediaRegression","passed: emoji click and real local video decode/playback")
            result.putString("scope","Local encoded MP4 placed in account-scoped downloaded-media cache; no backend, remote transport or production video compatibility claimed")
            finish(Activity.RESULT_OK,result)
        } catch(error:Throwable) {
            activity?.let { runCatching { diagnostic("failed-stage",it) } }
            runCatching { screenshot("failure") }
            result.putString("chatMediaRegression","failed: ${error.javaClass.simpleName}: ${error.message}")
            finish(Activity.RESULT_CANCELED,result)
        } finally {
            activity?.let { screen->runOnMainSync { screen.finish() } }
            MediaLoader.setScope(MediaURLs.DEFAULT_BASE,"anonymous")
        }
    }
    private fun encodeVideo(file:File) {
        val width=160;val height=240;val frames=45
        val codec=MediaCodec.createEncoderByType("video/avc")
        val muxer=MediaMuxer(file.absolutePath,MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
        var muxing=false;var track=-1;var frame=0;var sentEnd=false;var complete=false
        try {
            val format=MediaFormat.createVideoFormat("video/avc",width,height).apply {
                setInteger(MediaFormat.KEY_COLOR_FORMAT,MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible)
                setInteger(MediaFormat.KEY_BIT_RATE,128_000);setInteger(MediaFormat.KEY_FRAME_RATE,15);setInteger(MediaFormat.KEY_I_FRAME_INTERVAL,1)
            }
            codec.configure(format,null,null,MediaCodec.CONFIGURE_FLAG_ENCODE);codec.start()
            val info=MediaCodec.BufferInfo();val deadline=SystemClock.elapsedRealtime()+20_000
            while(!complete&&SystemClock.elapsedRealtime()<deadline) {
                if(!sentEnd) {
                    val index=codec.dequeueInputBuffer(10_000)
                    if(index>=0) {
                        if(frame==frames) { codec.queueInputBuffer(index,0,0,frame*1_000_000L/15,MediaCodec.BUFFER_FLAG_END_OF_STREAM);sentEnd=true }
                        else {
                            val image=codec.getInputImage(index) ?: error("Encoder does not expose a YUV input image")
                            image.planes.forEachIndexed { planeIndex,plane->
                                val planeWidth=if(planeIndex==0)width else width/2;val planeHeight=if(planeIndex==0)height else height/2
                                val value=(if(planeIndex==0)70+(frame%10)*7 else 128).toByte()
                                for(y in 0 until planeHeight)for(x in 0 until planeWidth)plane.buffer.put(y*plane.rowStride+x*plane.pixelStride,value)
                            }
                            codec.queueInputBuffer(index,0,width*height*3/2,frame*1_000_000L/15,0);frame++
                        }
                    }
                }
                var output=codec.dequeueOutputBuffer(info,10_000)
                while(output>=0) {
                    val buffer=codec.getOutputBuffer(output) ?: error("Encoded buffer missing")
                    if(info.size>0&&(info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG)==0) { check(muxing);buffer.position(info.offset);buffer.limit(info.offset+info.size);muxer.writeSampleData(track,buffer,info) }
                    complete=(info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM)!=0
                    codec.releaseOutputBuffer(output,false);output=codec.dequeueOutputBuffer(info,0)
                }
                if(output==MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) { check(!muxing);track=muxer.addTrack(codec.outputFormat);muxer.start();muxing=true }
            }
            check(complete&&muxing) { "Local AVC encoding did not complete" }
        } finally { runCatching { codec.stop() };codec.release();if(muxing)runCatching { muxer.stop() };muxer.release() }
        check(file.isFile&&file.length()>0)
    }
    private fun findPlayerFromWindows():NativeVideoPlayerView? {
        // Compose Dialog 使用独立 DecorView；使用公开 API 检查真正的播放视图。
        return if(android.os.Build.VERSION.SDK_INT>=29)android.view.inspector.WindowInspector.getGlobalWindowViews().firstNotNullOfOrNull(::findPlayer) else null
    }
    private fun findPlayer(view:View):NativeVideoPlayerView? {
        if(view is NativeVideoPlayerView&&view.isAttachedToWindow&&view.visibility==View.VISIBLE)return view
        if(view is ViewGroup)for(index in 0 until view.childCount)findPlayer(view.getChildAt(index))?.let { return it }
        return null
    }
    private fun await(label:String,predicate:()->Boolean) { repeat(100) { waitForIdleSync();if(predicate())return;SystemClock.sleep(80) };error("Timed out: $label") }
    // 视频开始即持续绘帧，等待 UI 完全空闲可能直到短视频播完才返回。
    private fun awaitMedia(label:String,predicate:()->Boolean) {
        val deadline=SystemClock.elapsedRealtime()+8_000
        while(SystemClock.elapsedRealtime()<deadline) { if(predicate())return;SystemClock.sleep(40) }
        error("Timed out: $label")
    }
    private fun samplePlayback(label:String,player:NativeVideoPlayerView?):Triple<Boolean,Boolean,Int> {
        var sample=Triple(false,false,0)
        var identity=0
        runOnMainSync { if(player!=null) { identity=System.identityHashCode(player);sample=Triple(player.prepared,player.playing,player.playbackPosition) } }
        File(targetContext.cacheDir,"chat-media-player-samples.txt").appendText("${SystemClock.elapsedRealtime()} $label player=$identity prepared=${sample.first} playing=${sample.second} position=${sample.third}\n")
        return sample
    }
    // MediaController 可成为活动窗口；返回按钮仍在下层可见的预览窗口中。
    private fun findVisible(predicate:(AccessibilityNodeInfo)->Boolean):AccessibilityNodeInfo? {
        val visible:(AccessibilityNodeInfo)->Boolean={it.isVisibleToUser&&it.packageName?.toString()==targetContext.packageName&&predicate(it)}
        return find(uiAutomation.rootInActiveWindow,visible) ?: uiAutomation.windows.firstNotNullOfOrNull {find(it.root,visible)}
    }
    private fun findText(value:String)=findVisible {it.text?.toString()==value}
    private fun findDescription(value:String)=findVisible {it.contentDescription?.toString()?.split(", ")?.contains(value)==true}
    private fun findEditable()=findVisible {it.isEditable}
    private fun find(node:AccessibilityNodeInfo?,predicate:(AccessibilityNodeInfo)->Boolean):AccessibilityNodeInfo? { if(node==null)return null;if(predicate(node))return node;for(index in 0 until node.childCount)find(node.getChild(index),predicate)?.let { return it };return null }
    private fun clickText(value:String)=click(findText(value) ?: error("Missing text: $value"))
    private fun clickDescription(value:String)=click(findDescription(value) ?: error("Missing description: $value"))
    private fun click(node:AccessibilityNodeInfo) { var current:AccessibilityNodeInfo?=node;while(current!=null) { File(targetContext.cacheDir,"chat-media-clicks.txt").appendText("candidate package=${current.packageName} class=${current.className} text=${current.text} desc=${current.contentDescription} bounds=${bounds(current)} actions=${current.actionList.joinToString { it.id.toString() }}\n");if(current.actionList.any { it.id==AccessibilityNodeInfo.ACTION_CLICK }) {check(current.performAction(AccessibilityNodeInfo.ACTION_CLICK));return};current=current.parent };error("Missing clickable ancestor") }
    private fun bounds(node:AccessibilityNodeInfo)=Rect().also { node.getBoundsInScreen(it) }
    private fun screenshot(name:String) { val bitmap=uiAutomation.takeScreenshot() ?: error("No screenshot");File(targetContext.cacheDir,"chat-media-$name.png").outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it) };bitmap.recycle() }
    private fun diagnostic(name:String,screen:MainActivity) {
        waitForIdleSync()
        screenshot(name)
        val tree=StringBuilder()
        runOnMainSync {
            val decor=screen.window.decorView
            tree.append("activity=${System.identityHashCode(screen)} decor=${decor.width}x${decor.height} ime=${ViewCompat.getRootWindowInsets(decor)?.isVisible(WindowInsetsCompat.Type.ime())} focus=${decor.findFocus()?.javaClass?.simpleName} finishing=${screen.isFinishing} destroyed=${screen.isDestroyed}\n")
        }
        fun node(value:AccessibilityNodeInfo?,depth:Int) {
            if(value==null)return
            tree.append(" ".repeat(depth)).append(value.className).append(" package=").append(value.packageName).append(" text=").append(value.text).append(" desc=").append(value.contentDescription).append(" state=").append(if(android.os.Build.VERSION.SDK_INT>=30)value.stateDescription else "unknown").append(" visible=").append(value.isVisibleToUser).append(" bounds=").append(bounds(value)).append(" actions=").append(value.actionList.joinToString { it.id.toString() }).append('\n')
            for(index in 0 until value.childCount)node(value.getChild(index),depth+1)
        }
        node(uiAutomation.rootInActiveWindow,0)
        uiAutomation.windows.forEach {window->tree.append("window id=${window.id} layer=${window.layer} active=${window.isActive}\n");node(window.root,0)}
        File(targetContext.cacheDir,"chat-media-$name.txt").writeText(tree.toString())
    }
}
