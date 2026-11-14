package com.im.nativebootstrap.media

import android.graphics.Bitmap
import android.graphics.drawable.Animatable
import android.media.MediaPlayer
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.im.nativebootstrap.R
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.currentCoroutineContext

@Composable
fun RemoteMediaImage(url:String,modifier:Modifier=Modifier,edge:Int=360,scale:ContentScale=ContentScale.Fit,description:String="图片",fallbackRes:Int?=null,fallbackUrls:List<String> = emptyList(),localDraft:java.io.File?=null,onDimensions:(Int,Int)->Unit={_,_->},retryOnTap:Boolean=true) {
    val context=LocalContext.current
    val access by MediaLoader.access.collectAsState()
    val candidates=remember(url,fallbackUrls) { (listOf(url)+fallbackUrls).filter(String::isNotBlank).distinct() }
    var visual by remember(candidates,edge,access) { mutableStateOf(candidates.firstNotNullOfOrNull { MediaLoader.peek(it,edge) }) }
    var failure by remember(url,edge,access) { mutableStateOf(false) }
    var retry by remember(url) { mutableIntStateOf(0) }
    val dimensionsCallback by rememberUpdatedState(onDimensions)
    LaunchedEffect(visual) { visual?.let { value ->
        val width=value.bitmap?.width ?: value.animation?.intrinsicWidth ?: 0
        val height=value.bitmap?.height ?: value.animation?.intrinsicHeight ?: 0
        if(width>0&&height>0)dimensionsCallback(width,height)
    } }
    LaunchedEffect(candidates,edge,retry,access,localDraft) {
        val started=System.nanoTime()
        failure=false
        if(visual==null) {
            if(localDraft!=null) {
                try { visual=MediaLoader.loadOwnedDraft(context,localDraft,edge) }
                catch(cancelled:CancellationException) { throw cancelled }
                catch(_:Exception) { failure=true }
            }
            if(visual!=null)return@LaunchedEffect
            for(candidate in candidates) {
                try {
                    visual=withTimeout(20_000) { MediaLoader.load(context,candidate,edge) }
                    withFrameNanos { MediaMetrics.record(MediaLoader.id(candidate),"FRAME_SCHEDULED",(System.nanoTime()-started)/1_000_000) }
                    break
                } catch(_:TimeoutCancellationException) { currentCoroutineContext().ensureActive() }
                catch(cancelled:CancellationException) { throw cancelled }
                catch(_:Exception) { /* 缩略图失效时尝试消息中另一远程规格。 */ }
            }
            failure=visual==null
        }
    }
    DisposableEffect(visual?.animation) { val drawable=visual?.animation;onDispose { (drawable as? Animatable)?.stop() } }
    Box(modifier.background(Color(0xFFE9EDF4)),contentAlignment=Alignment.Center) {
        val animation=visual?.animation
        if(animation!=null) {
            val lifecycle=LocalLifecycleOwner.current.lifecycle
            val holder=remember { arrayOfNulls<AnimatedMediaView>(1) }
            DisposableEffect(lifecycle) {
                val observer=LifecycleEventObserver { _,_ -> holder[0]?.setPageActive(lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) }
                lifecycle.addObserver(observer)
                onDispose { lifecycle.removeObserver(observer);holder[0]?.release();holder[0]=null }
            }
            AndroidView(factory={ AnimatedMediaView(it).also { view -> holder[0]=view } },modifier=Modifier.fillMaxSize(),onRelease={ it.release() },update={ holder[0]=it;it.bind(animation,scale==ContentScale.Crop,description,lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) })
        }
        else if(visual?.bitmap!=null) Image(visual!!.bitmap!!.asImageBitmap(),description,Modifier.fillMaxSize(),contentScale=scale)
        else if(fallbackRes!=null) Image(painterResource(fallbackRes),description,Modifier.fillMaxSize().clickable(enabled=failure) { retry++ },contentScale=scale)
        else if(failure)Text(if(retryOnTap)"加载失败\n点按重试" else "封面暂不可用",if(retryOnTap)Modifier.clickable { retry++ } else Modifier,color=Color(0xFF8A94A6))
        else CircularProgressIndicator(Modifier.size(22.dp),color=Color(0xFF8A94A6),strokeWidth=2.dp)
        if(visual?.note?.isNotEmpty()==true)Text(visual!!.note,Modifier.align(Alignment.BottomCenter).background(Color(0x99000000)).padding(4.dp),color=Color.White,fontSize=10.sp)
    }
}

@Composable
fun SharedAvatar(url:String,modifier:Modifier=Modifier,group:Boolean=false) {
    val transformed=remember(url) { MediaURLs.image(url,ImageVariant.AVATAR) }
    if(transformed.isEmpty()) Image(painterResource(if(group)R.drawable.uni_group_default else R.drawable.uni_avatar_default),"头像",modifier.clip(CircleShape),contentScale=ContentScale.Crop)
    else RemoteMediaImage(transformed,modifier.clip(CircleShape),128,ContentScale.Crop,"头像",if(group)R.drawable.uni_group_default else R.drawable.uni_avatar_default)
}

@Composable
fun ImagePreview(url:String,onDismiss:()->Unit,onSave:()->Unit,previous:(()->Unit)?=null,next:(()->Unit)?=null,position:String="") {
    var zoom by remember(url) { mutableFloatStateOf(1f) }
    var offsetX by remember(url) { mutableFloatStateOf(0f) }
    var offsetY by remember(url) { mutableFloatStateOf(0f) }
    Dialog(onDismissRequest=onDismiss,properties=DialogProperties(usePlatformDefaultWidth=false)) {
        Box(Modifier.fillMaxSize().background(Color.Black)) {
            RemoteMediaImage(MediaURLs.image(url,ImageVariant.PREVIEW),Modifier.fillMaxSize().pointerInput(url) { detectTransformGestures { _,pan,change,_ ->
                zoom=(zoom*change).coerceIn(1f,4f)
                offsetX=if(zoom==1f)0f else offsetX+pan.x;offsetY=if(zoom==1f)0f else offsetY+pan.y
            } }.graphicsLayer(scaleX=zoom,scaleY=zoom,translationX=offsetX,translationY=offsetY),960)
            Row(Modifier.align(Alignment.TopCenter).fillMaxWidth().padding(12.dp),horizontalArrangement=Arrangement.SpaceBetween) {
                TextButton(onClick=onDismiss) { Text("关闭",color=Color.White) }
                TextButton(onClick=onSave) { Text("保存原图",color=Color.White) }
            }
            if(previous!=null||next!=null)Row(Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(16.dp),horizontalArrangement=Arrangement.SpaceBetween,verticalAlignment=Alignment.CenterVertically) {
                TextButton(onClick={ previous?.invoke() },enabled=previous!=null) { Text("上一张",color=if(previous!=null)Color.White else Color.Gray) }
                Text(position,color=Color.White)
                TextButton(onClick={ next?.invoke() },enabled=next!=null) { Text("下一张",color=if(next!=null)Color.White else Color.Gray) }
            }
        }
    }
}

@Composable
fun VideoPreview(url:String,onDismiss:()->Unit,onError:(String)->Unit,poster:String="",sender:String="视频",time:String="",onSave:(()->Unit)?=null,onForward:(()->Unit)?=null,onDelete:(()->Unit)?=null,localFile:java.io.File?=null,localPoster:java.io.File?=null,allowedLocalDirectory:java.io.File?=null) {
    val context=LocalContext.current
    val access by MediaLoader.access.collectAsState()
    val address=remember(url,access) { MediaURLs.playback(url,access.base) }
    var view by remember(url) { mutableStateOf<NativeVideoPlayerView?>(null) }
    var cached by remember(url,access) { mutableStateOf<java.io.File?>(null) }
    var sourceReady by remember(url,access) { mutableStateOf(false) }
    var rendered by remember(url,access) { mutableStateOf(false) }
    var attempt by remember(url) { mutableIntStateOf(0) }
    var error by remember(url) { mutableStateOf<String?>(null) }
    val lifecycle=LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(address,access,localFile,allowedLocalDirectory) {
        sourceReady=false
        cached=withContext(Dispatchers.IO) {
            localFile?.let { OwnedVideoFiles.verified(it,allowedLocalDirectory,java.io.File(context.filesDir,"native-chat")) }
                ?: listOf(address,MediaURLs.remote(url,access.base)).filter(String::isNotBlank).map { java.io.File(context.cacheDir,"media-files-v2/"+MediaLoader.id(it,access)) }.firstOrNull { it.isFile&&it.length() in 1..256L*1024*1024 }
        }
        sourceReady=true
    }
    DisposableEffect(url,access,lifecycle) {
        val observer=LifecycleEventObserver { _,_ -> view?.setPageActive(lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer);view?.release() }
    }
    Dialog(onDismissRequest=onDismiss,properties=DialogProperties(usePlatformDefaultWidth=false)) {
        Column(Modifier.fillMaxSize().background(Color.Black).statusBarsPadding().navigationBarsPadding()) {
            Row(Modifier.fillMaxWidth().height(58.dp).padding(horizontal=4.dp),verticalAlignment=Alignment.CenterVertically) {
                TextButton(onClick=onDismiss) { Text("‹",color=Color.White,fontSize=28.sp) }
                Column(Modifier.weight(1f)) { Text(sender,color=Color.White,fontSize=15.sp,maxLines=1);if(time.isNotBlank())Text(time,color=Color(0xFFBBBBBB),fontSize=12.sp) }
            }
            Box(Modifier.weight(1f).fillMaxWidth(),contentAlignment=Alignment.Center) {
                if(sourceReady&&address.isEmpty()&&cached==null)Text("视频地址无效",color=Color.White)
                else {
                    if(sourceReady)key(address,access,attempt,cached) { AndroidView(factory={ NativeVideoPlayerView(it).also { player->
                        view=player
                        player.setPageActive(lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED))
                        player.bind(address,cached,{}, { rendered=true }, { error="视频暂无法播放，点击重试";onError(error!!) },allowedLocalDirectory)
                    } },modifier=Modifier.fillMaxSize(),onRelease={ it.release() }) }
                    if(!rendered&&error==null)Box(Modifier.fillMaxSize(),contentAlignment=Alignment.Center) {
                        if(poster.isNotBlank()||localPoster!=null)RemoteMediaImage(MediaURLs.image(poster),Modifier.fillMaxSize(),960,retryOnTap=false,localDraft=localPoster)
                        CircularProgressIndicator(Modifier.size(32.dp),color=Color.White,strokeWidth=2.dp)
                    }
                }
                error?.let { Text(it,Modifier.align(Alignment.Center).background(Color(0xAA000000)).clickable { view?.release();error=null;rendered=false;attempt++ }.padding(16.dp),color=Color.White) }
            }
            if(onSave!=null||onForward!=null||onDelete!=null)Row(Modifier.fillMaxWidth().height(56.dp),horizontalArrangement=Arrangement.SpaceAround,verticalAlignment=Alignment.CenterVertically) {
                listOf(Triple(onDelete,R.drawable.uni_video_trash,"删除"),Triple(onSave,R.drawable.uni_video_download,"保存"),Triple(onForward,R.drawable.uni_video_forward,"转发")).forEach { (action,icon,label) -> if(action!=null)Box(Modifier.width(72.dp).fillMaxHeight().clickable(onClick=action),contentAlignment=Alignment.Center) { Image(painterResource(icon),label,Modifier.size(24.dp),contentScale=ContentScale.Fit) } }
            }
        }
    }
}

/** 生命周期由聊天页持有，离开房间或切换语音时释放。 */
class VoicePlayer {
    private var player:MediaPlayer?=null
    fun stop() { player?.release();player=null }
    fun play(url:String,onEnd:()->Unit,onError:()->Unit) {
        stop()
        val address=MediaURLs.remote(url)
        if(address.isEmpty()) { onError();return }
        val value=MediaPlayer();player=value
        try {
            value.setDataSource(address)
            value.setOnPreparedListener { it.start() }
            value.setOnCompletionListener { stop();onEnd() }
            value.setOnErrorListener { _,_,_ -> stop();onError();true }
            value.prepareAsync()
        } catch(_:Exception) { stop();onError() }
    }
}
