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
        try {
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
            clickDescription("表情")
            await("emoji grid") { findText("😀")!=null&&findDescription("收藏表情")!=null }
            val panel=bounds(findDescription("表情面板") ?: error("Missing emoji panel"))
            check(panel.height()>100&&panel.bottom<=screen.resources.displayMetrics.heightPixels) { "Emoji panel is clipped below screen" }
            clickText("😀")
            await("emoji inserted in actual editor") { findEditable()?.text?.toString()?.contains("😀")==true }
            clickDescription("收藏表情")
            await("real sticker load callback") { stickerLoads.get()>0&&findText("点击 + 添加表情")!=null }
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
            await("native video dialog") { runOnMainSync { player=findPlayer(screen.window.decorView) ?: findPlayerFromWindows() };player!=null }
            await("real MediaPlayer prepared") { var ready=false;runOnMainSync { ready=player?.prepared==true };ready }
            var startedAt=0
            runOnMainSync { startedAt=player?.playbackPosition ?: 0 }
            await("actual playback position advances") { var playing=false;runOnMainSync { playing=player?.playing==true&&(player?.playbackPosition ?: 0)>startedAt+250 };playing }
            screenshot("playing")
            check(uiAutomation.performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK))
            await("video released after dismiss") { var stopped=false;runOnMainSync { stopped=player?.prepared==false };stopped }
            fun verifyOwnedPlayback(label:String) {
                clickDescription("视频消息")
                var ownedPlayer:NativeVideoPlayerView?=null
                await("$label opens native player") { runOnMainSync { ownedPlayer=findPlayerFromWindows() };ownedPlayer!=null }
                await("$label local decode prepares") { var ready=false;runOnMainSync { ready=ownedPlayer?.prepared==true };ready }
                await("$label plays private local bytes") { var advancing=false;runOnMainSync { advancing=ownedPlayer?.playing==true&&(ownedPlayer?.playbackPosition ?: 0)>200 };advancing }
                check(uiAutomation.performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK))
                await("$label closes decoder") { var stopped=false;runOnMainSync { stopped=ownedPlayer?.prepared==false };stopped }
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
            verifyOwnedPlayback("acknowledged video without remote download")
            result.putString("localVideoUI","passed: zero-metadata pending video bubble appears with sending indicator; private local bytes play before upload and after ACK under a different uncached remote URL")
            val landscape=portrait.copy(id="video-landscape",serialized=portrait.serialized.replace("video-portrait","video-landscape").replace("\"SnapshotWidth\":160,\"SnapshotHeight\":240","\"SnapshotWidth\":240,\"SnapshotHeight\":160"))
            render(state.copy(messages=listOf(landscape)))
            await("landscape bubble") { findDescription("视频消息")!=null }
            val landscapeRect=bounds(findDescription("视频消息")!!)
            check(landscapeRect.width()>landscapeRect.height()&&kotlin.math.abs(landscapeRect.width().toFloat()/landscapeRect.height()-1.5f)<.03f) { "Landscape ratio changed: $landscapeRect" }
            check(findText("查看本次转发任务进度")==null&&findDescription("转发任务")==null)
            screenshot("landscape-bubble")
            result.putString("videoPlayback","passed: portrait/landscape cover ratio; real bubble click opens native player; locally encoded AVC MP4 prepares and playback position advances; dismiss releases decoder")
            result.putString("chatMediaRegression","passed: emoji click and real local video decode/playback")
            result.putString("scope","Local encoded MP4 placed in account-scoped downloaded-media cache; no backend, remote transport or production video compatibility claimed")
            finish(Activity.RESULT_OK,result)
        } catch(error:Throwable) {
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
        if(view is NativeVideoPlayerView)return view
        if(view is ViewGroup)for(index in 0 until view.childCount)findPlayer(view.getChildAt(index))?.let { return it }
        return null
    }
    private fun await(label:String,predicate:()->Boolean) { repeat(100) { waitForIdleSync();if(predicate())return;SystemClock.sleep(80) };error("Timed out: $label") }
    private fun findText(value:String)=find(uiAutomation.rootInActiveWindow) { it.isVisibleToUser&&it.text?.toString()==value }
    private fun findDescription(value:String)=find(uiAutomation.rootInActiveWindow) { it.isVisibleToUser&&it.contentDescription?.toString()?.split(", ")?.contains(value)==true }
    private fun findEditable()=find(uiAutomation.rootInActiveWindow) { it.isVisibleToUser&&it.isEditable }
    private fun find(node:AccessibilityNodeInfo?,predicate:(AccessibilityNodeInfo)->Boolean):AccessibilityNodeInfo? { if(node==null)return null;if(predicate(node))return node;for(index in 0 until node.childCount)find(node.getChild(index),predicate)?.let { return it };return null }
    private fun clickText(value:String)=click(findText(value) ?: error("Missing text: $value"))
    private fun clickDescription(value:String)=click(findDescription(value) ?: error("Missing description: $value"))
    private fun click(node:AccessibilityNodeInfo) { var current:AccessibilityNodeInfo?=node;while(current!=null) { if(current.actionList.any { it.id==AccessibilityNodeInfo.ACTION_CLICK }) {check(current.performAction(AccessibilityNodeInfo.ACTION_CLICK));return};current=current.parent };error("Missing clickable ancestor") }
    private fun bounds(node:AccessibilityNodeInfo)=Rect().also { node.getBoundsInScreen(it) }
    private fun screenshot(name:String) { val bitmap=uiAutomation.takeScreenshot() ?: error("No screenshot");File(targetContext.cacheDir,"chat-media-$name.png").outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it) };bitmap.recycle() }
}
