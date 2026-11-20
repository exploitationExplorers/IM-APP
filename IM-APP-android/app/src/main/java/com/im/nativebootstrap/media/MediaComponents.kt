package com.im.nativebootstrap.media

import android.graphics.Bitmap
import android.graphics.drawable.Animatable
import android.media.MediaPlayer
import androidx.compose.animation.core.Animatable as ComposeAnimatable
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
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
import kotlinx.coroutines.launch

@Composable
fun RemoteMediaImage(url:String,modifier:Modifier=Modifier,edge:Int=360,scale:ContentScale=ContentScale.Fit,description:String="图片",fallbackRes:Int?=null,fallbackUrls:List<String> = emptyList(),localDraft:java.io.File?=null,onDimensions:(Int,Int)->Unit={_,_->},retryOnTap:Boolean=true,cacheUrls:List<String> = emptyList(),boxBackground:Color=Color(0xFFE9EDF4)) {
    val context=LocalContext.current
    val access by MediaLoader.access.collectAsState()
    val candidates=remember(url,fallbackUrls) { (listOf(url)+fallbackUrls).filter(String::isNotBlank).distinct() }
    val cachedCandidates=remember(candidates,cacheUrls) { (candidates+cacheUrls).filter(String::isNotBlank).distinct() }
    var visual by remember(cachedCandidates,edge,access) { mutableStateOf(cachedCandidates.firstNotNullOfOrNull { MediaLoader.peek(it,edge) }) }
    var failure by remember(url,edge,access) { mutableStateOf(false) }
    var retry by remember(url) { mutableIntStateOf(0) }
    val dimensionsCallback by rememberUpdatedState(onDimensions)
    LaunchedEffect(visual) { visual?.let { value ->
        val width=value.bitmap?.width ?: value.animation?.intrinsicWidth ?: 0
        val height=value.bitmap?.height ?: value.animation?.intrinsicHeight ?: 0
        if(width>0&&height>0)dimensionsCallback(width,height)
    } }
    LaunchedEffect(candidates,cachedCandidates,edge,retry,access,localDraft) {
        val started=System.nanoTime()
        failure=false
        if(visual==null) {
            if(localDraft!=null) {
                try { visual=MediaLoader.loadOwnedDraft(context,localDraft,edge) }
                catch(cancelled:CancellationException) { throw cancelled }
                catch(_:Exception) { failure=true }
            }
            if(visual!=null)return@LaunchedEffect
            for(candidate in cachedCandidates) {
                try { visual=MediaLoader.cached(context,candidate,edge) }
                catch(cancelled:CancellationException) { throw cancelled }
                catch(_:Exception) { /* 坏缓存不阻塞其他同消息候选。 */ }
                if(visual!=null)return@LaunchedEffect
            }
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
    Box(modifier.background(boxBackground),contentAlignment=Alignment.Center) {
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
    val candidates=remember(transformed,url) {
        (listOf(transformed,MediaURLs.remote(url),MediaURLs.remote(url,com.im.nativebootstrap.data.RuntimeEndpoints.DEFAULT_API_BASE_URL)))
            .filter(String::isNotBlank).distinct()
    }
    if(transformed.isEmpty()) Image(painterResource(if(group)R.drawable.uni_group_default else R.drawable.uni_avatar_default),"头像",modifier.clip(CircleShape),contentScale=ContentScale.Crop)
    else RemoteMediaImage(candidates.first(),modifier.clip(CircleShape),128,ContentScale.Crop,"头像",if(group)R.drawable.uni_group_default else R.drawable.uni_avatar_default,fallbackUrls=candidates.drop(1),cacheUrls=listOf(url))
}

/** 单页的缩放/平移状态：Compose 状态字段，手势写入即可触发重组。 */
private class PreviewTransform {
    var zoom by mutableFloatStateOf(1f)
    var panX by mutableFloatStateOf(0f)
    var panY by mutableFloatStateOf(0f)
}

/**
 * 大图查看（对齐 uniapp image-viewer / viewer）：
 * 顶部返回 + 发送者/时间 + 页码；左右滑动切换；两侧箭头；双指缩放 1–4x、放大后可单指拖动；
 * 右下角 −/+ 缩放按钮；底部提示「双指缩放 · 左右滑动切换」；打开淡入；
 * 底部 删除 / 保存 / 转发（有消息上下文时展示，与视频查看页一致）。
 */
@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
fun ImagePreview(urls:List<String>,initial:Int=0,onDismiss:()->Unit,onSave:(String)->Unit,sender:String="",time:String="",onDelete:(()->Unit)?=null,onForward:(()->Unit)?=null,saving:Boolean=false) {
    val list=remember(urls) { urls.filter(String::isNotBlank).distinct() }
    if(list.isEmpty()) { LaunchedEffect(Unit) { onDismiss() };return }
    val state=rememberPagerState(initialPage=initial.coerceIn(0,list.lastIndex)) { list.size }
    val current=state.currentPage
    val transforms=remember(list) { List(list.size) { PreviewTransform() } }
    val scope=rememberCoroutineScope()
    var zoomed by remember { mutableStateOf(false) }
    // 打开淡入：alpha 0→1，200ms
    val enter=remember { ComposeAnimatable(0f) }
    LaunchedEffect(Unit) { enter.animateTo(1f,tween(200)) }
    Dialog(onDismissRequest=onDismiss,properties=DialogProperties(usePlatformDefaultWidth=false)) {
        // 提示宿主同时挂在大图窗口：保存结果在预览层打开时就能看到，不必等退出预览。
        com.im.nativebootstrap.NativeNoticeHost()
        Box(Modifier.fillMaxSize().background(Color.Black).graphicsLayer(alpha=enter.value)) {
            HorizontalPager(state=state,modifier=Modifier.fillMaxSize(),userScrollEnabled=!zoomed) { page ->
                val url=list[page]
                val transform=transforms[page]
                // 只在双指或已放大时接管手势：单指横滑留给 pager 翻页。
                val gesture=Modifier.pointerInput(url) {
                    awaitEachGesture {
                        awaitFirstDown(requireUnconsumed=false)
                        var started=false
                        do {
                            val event=awaitPointerEvent()
                            val multi=event.changes.size>=2
                            if(multi||transform.zoom>1.001f) {
                                val change=event.calculateZoom();val pan=event.calculatePan()
                                transform.zoom=(transform.zoom*change).coerceIn(1f,4f)
                                if(transform.zoom<=1.001f) { transform.panX=0f;transform.panY=0f } else { transform.panX+=pan.x;transform.panY+=pan.y }
                                event.changes.forEach { it.consume() }
                                started=true
                            }
                        } while(event.changes.any { it.pressed })
                        if(!started&&transform.zoom>1.001f) { transform.zoom=1f;transform.panX=0f;transform.panY=0f }
                    }
                }
                LaunchedEffect(page,transform.zoom>1.001f) { if(state.currentPage==page) zoomed=transform.zoom>1.001f }
                RemoteMediaImage(MediaURLs.image(url,ImageVariant.PREVIEW),Modifier.fillMaxSize().then(gesture).graphicsLayer(scaleX=transform.zoom,scaleY=transform.zoom,translationX=transform.panX,translationY=transform.panY),960,cacheUrls=listOf(url),boxBackground=Color.Black)
            }
            Row(Modifier.align(Alignment.TopCenter).fillMaxWidth().statusBarsPadding().height(58.dp).padding(horizontal=4.dp),verticalAlignment=Alignment.CenterVertically) {
                TextButton(onClick=onDismiss) { Text("‹",color=Color.White,fontSize=28.sp) }
                Column(Modifier.weight(1f)) {
                    if(sender.isNotBlank())Text(sender,color=Color.White,fontSize=15.sp,maxLines=1,overflow=androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                    if(time.isNotBlank())Text(time,color=Color(0xFFBBBBBB),fontSize=12.sp)
                }
                if(list.size>1)Text("${current+1} / ${list.size}",Modifier.padding(end=16.dp),color=Color(0xFFDDDDDD),fontSize=12.sp)
            }
            // 两侧翻页箭头（与 uniapp image-viewer 的 viewer-arrow 一致），放大时禁用避免与拖拽冲突。
            if(list.size>1) {
                val prevEnabled=current>0&&!zoomed
                val nextEnabled=current<list.lastIndex&&!zoomed
                Box(Modifier.align(Alignment.CenterStart).padding(start=2.dp).size(34.dp).clickable(enabled=prevEnabled) { scope.launch { state.animateScrollToPage(current-1) } },contentAlignment=Alignment.Center) {
                    Text("‹",color=if(prevEnabled)Color.White else Color(0x66FFFFFF),fontSize=30.sp)
                }
                Box(Modifier.align(Alignment.CenterEnd).padding(end=2.dp).size(34.dp).clickable(enabled=nextEnabled) { scope.launch { state.animateScrollToPage(current+1) } },contentAlignment=Alignment.Center) {
                    Text("›",color=if(nextEnabled)Color.White else Color(0x66FFFFFF),fontSize=30.sp)
                }
            }
            val hasBar=onDelete!=null||onForward!=null
            val barInset=if(hasBar)62.dp else 20.dp
            // 右下角 −/+ 缩放按钮（对齐 uniapp PreviewImageSlide 的 preview-zoom）
            Row(Modifier.align(Alignment.BottomEnd).navigationBarsPadding().padding(end=12.dp,bottom=barInset),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                listOf("−" to -1f,"+" to 1f).forEach { (label,delta) ->
                    Box(Modifier.size(32.dp).clip(CircleShape).background(Color(0xCC333333)).clickable {
                        val transform=transforms[current]
                        scope.launch {
                            animate(transform.zoom,(transform.zoom+delta).coerceIn(1f,4f),animationSpec=tween(160)) { value,_ -> transform.zoom=value }
                            if(transform.zoom<=1.001f) { transform.zoom=1f;transform.panX=0f;transform.panY=0f }
                        }
                    },contentAlignment=Alignment.Center) { Text(label,color=Color.White,fontSize=18.sp) }
                }
            }
            Text("双指缩放 · 左右滑动切换",Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom=barInset),color=Color(0xFFAAAAAA),fontSize=12.sp)
            if(hasBar)Row(Modifier.align(Alignment.BottomCenter).fillMaxWidth().navigationBarsPadding().height(56.dp),horizontalArrangement=Arrangement.SpaceAround,verticalAlignment=Alignment.CenterVertically) {
                val actions=listOf(
                    Triple<(() -> Unit)?,Pair<Int,String>,Boolean>(onDelete,R.drawable.uni_video_trash to "删除",false),
                    Triple<(() -> Unit)?,Pair<Int,String>,Boolean>({ onSave(list[current]) },R.drawable.uni_video_download to "保存",true),
                    Triple<(() -> Unit)?,Pair<Int,String>,Boolean>(onForward,R.drawable.uni_video_forward to "转发",false)
                ).filter { it.first!=null }
                actions.forEach { (action,icon,isSave) -> Box(Modifier.width(72.dp).fillMaxHeight().clickable(enabled=!(isSave&&saving),onClick={ action?.invoke() }),contentAlignment=Alignment.Center) {
                    // 保存进行中在原位显示进度，避免「点了没反应」。
                    if(isSave&&saving)CircularProgressIndicator(Modifier.size(20.dp),color=Color.White,strokeWidth=2.dp)
                    else Image(painterResource(icon.first),icon.second,Modifier.size(24.dp),contentScale=ContentScale.Fit)
                } }
            }
            else TextButton(onClick={ onSave(list[current]) },enabled=!saving,modifier=Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom=8.dp)) { if(saving)CircularProgressIndicator(Modifier.size(18.dp),color=Color.White,strokeWidth=2.dp) else Text("保存原图",color=Color.White) }
        }
    }
}

@Composable
fun VideoPreview(url:String,onDismiss:()->Unit,onError:(String)->Unit,poster:String="",sender:String="视频",time:String="",onSave:(()->Unit)?=null,onForward:(()->Unit)?=null,onDelete:(()->Unit)?=null,localFile:java.io.File?=null,localPoster:java.io.File?=null,allowedLocalDirectory:java.io.File?=null,saving:Boolean=false) {
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
                ?: listOf(address,url,MediaURLs.remote(url,access.base)).filter(String::isNotBlank).firstNotNullOfOrNull { MediaLoader.cachedFile(context,it) }
        }
        sourceReady=true
    }
    DisposableEffect(url,access,lifecycle) {
        val observer=LifecycleEventObserver { _,_ -> view?.setPageActive(lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer);view?.release() }
    }
    Dialog(onDismissRequest=onDismiss,properties=DialogProperties(usePlatformDefaultWidth=false)) {
        com.im.nativebootstrap.NativeNoticeHost()
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
                        if(poster.isNotBlank()||localPoster!=null)RemoteMediaImage(MediaURLs.image(poster),Modifier.fillMaxSize(),960,retryOnTap=false,localDraft=localPoster,boxBackground=Color.Black)
                        CircularProgressIndicator(Modifier.size(32.dp),color=Color.White,strokeWidth=2.dp)
                    }
                }
                error?.let { Text(it,Modifier.align(Alignment.Center).background(Color(0xAA000000)).clickable { view?.release();error=null;rendered=false;attempt++ }.padding(16.dp),color=Color.White) }
            }
            if(onSave!=null||onForward!=null||onDelete!=null)Row(Modifier.fillMaxWidth().height(56.dp),horizontalArrangement=Arrangement.SpaceAround,verticalAlignment=Alignment.CenterVertically) {
                listOf(Triple(onDelete,R.drawable.uni_video_trash,"删除"),Triple(onSave,R.drawable.uni_video_download,"保存"),Triple(onForward,R.drawable.uni_video_forward,"转发")).forEach { (action,icon,label) ->
                    if(action!=null)Box(Modifier.width(72.dp).fillMaxHeight().clickable(enabled=!(saving&&label=="保存"),onClick=action),contentAlignment=Alignment.Center) {
                        if(saving&&label=="保存")CircularProgressIndicator(Modifier.size(20.dp),color=Color.White,strokeWidth=2.dp)
                        else Image(painterResource(icon),label,Modifier.size(24.dp),contentScale=ContentScale.Fit)
                    }
                }
            }
        }
    }
}

/** 生命周期由聊天页持有，离开房间或切换语音时释放。 */
class VoicePlayer {
    private var player:MediaPlayer?=null
    fun stop() { player?.release();player=null }
    fun play(source:String,onEnd:()->Unit,onError:()->Unit) {
        stop()
        val raw=source.trim()
        val address=when {
            raw.startsWith("file://") -> raw.removePrefix("file://")
            raw.startsWith("/") -> raw
            else -> MediaURLs.remote(raw)
        }
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
