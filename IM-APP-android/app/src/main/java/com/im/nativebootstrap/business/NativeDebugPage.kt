package com.im.nativebootstrap.business

import com.im.nativebootstrap.NativeNotices

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import com.im.nativebootstrap.BootstrapViewModel
import com.im.nativebootstrap.media.MediaIO
import kotlinx.coroutines.*
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun NativeDebugPage(model:BootstrapViewModel) {
    val context=LocalContext.current;val config=LocalConfiguration.current;val s=config.screenWidthDp/750f
    val scope=rememberCoroutineScope();val lifecycle=LocalLifecycleOwner.current.lifecycle
    val app by model.state.collectAsStateWithLifecycle()
    val endpoints=model.diagnosticEndpoints()
    val targets=remember(endpoints){runCatching{NativeDiagnostics.targets(endpoints)}.getOrDefault(emptyList())}
    var meta by remember{mutableStateOf<DiagnosticMeta?>(null)}
    var probes by remember{mutableStateOf(emptyList<NativeProbe>())}
    var history by remember{mutableStateOf(emptyList<Pair<String,NativeProbe>>())}
    var probing by remember{mutableStateOf(false)}
    var saving by remember{mutableStateOf(false)}
    var now by remember{mutableStateOf(ZonedDateTime.now())}
    val local=remember{context.packageManager.getPackageInfo(context.packageName,0)}
    val muted=Color(0xFF636E86);val ink=Color(0xFF212121);val blue=Color(0xFF0A2FC2)
    fun addSample(probe:NativeProbe) {history=(history+(ZonedDateTime.now().format(DateTimeFormatter.ofPattern("HH:mm:ss")) to probe)).takeLast(10)}
    suspend fun runProbes() {
        if(probing)return
        probing=true
        try {
            meta=withContext(Dispatchers.IO){NativeDiagnostics.metadata(context.applicationContext)}
            probes=coroutineScope{targets.map{(label,url)->async(Dispatchers.IO){NativeDiagnostics.probe(label,url)}}.awaitAll()}
            probes.firstOrNull{it.label=="API"}?.let(::addSample)
        }finally{probing=false}
    }
    fun report():List<String> = buildList {
        add("易可聊 · 调试资讯")
        add(now.format(DateTimeFormatter.ISO_OFFSET_DATE_TIME))
        add("聊天号："+NativeDiagnostics.mask(app.profile?.publicId.orEmpty()))
        add("版本号：${local.versionName} APP/Android")
        add("画面尺寸：${config.screenWidthDp} × ${config.screenHeightDp}")
        add("连接：${app.chat.connection}；本地库：${app.chat.store}；同步：${app.chat.sync}；待核对：${app.chat.outbox.size}")
        app.chat.lastSendErrorCode?.let { add("最近发送 SDK 错误码：$it") }
        probes.forEach{add("${it.label} ${it.host} ${it.ms?:"—"} ms ${if(it.ok)"可达" else "未完成"} ${it.detail}")}
        meta?.let{value->add("设备：${value.device}");add("网络：${value.network}");add("储存：${value.storage}");add("媒体："+value.media.joinToString("、"));value.permissions.forEach{add("${it.first}：${it.second}")};value.capabilities.forEach{add("${it.first}：${it.second}")}}
        add("最近 API 采样："+history.joinToString("；"){it.first+" "+it.second.ms+" ms"})
        addAll(com.im.nativebootstrap.media.MediaMetrics.report())
        add("诊断内容已隐藏账号标识，不含密码、令牌、消息、文件路径或带签名地址。")
    }
    fun toast(text:String){NativeNotices.show(text)}
    val saveFile=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("image/png")){uri->if(uri!=null)scope.launch {
        saving=true
        val lines=report()
        val result=runCatching{withContext(Dispatchers.IO){val file=NativeDiagnostics.image(context.applicationContext,lines);try{context.contentResolver.openOutputStream(uri)?.use{output->file.inputStream().use{it.copyTo(output)}}?:error("保存位置不可用")}finally{file.delete()}}}
        saving=false;toast(result.fold({"诊断图已保存"},{"保存未完成，请重试"}))
    }}
    fun saveImage() {
        if(saving)return
        if(Build.VERSION.SDK_INT<29){saveFile.launch("易可聊诊断.png");return}
        val lines=report();saving=true
        scope.launch {
            val result=runCatching{withContext(Dispatchers.IO){val file=NativeDiagnostics.image(context.applicationContext,lines);try{check(MediaIO.saveToGallery(context,file,"易可聊诊断-${System.currentTimeMillis()}.png","image/png",false))}finally{file.delete()}}}
            saving=false;toast(result.fold({"诊断图已保存到相册"},{"保存未完成，请重试"}))
        }
    }
    LaunchedEffect(lifecycle,targets) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            launch{while(isActive){now=ZonedDateTime.now();delay(1000)}}
            launch {
                try{runProbes()}catch(cancelled:CancellationException){throw cancelled}catch(_:Exception){}
                while(isActive){delay(10_000);val url=runCatching{NativeDiagnostics.origin(endpoints.api)+"/health"}.getOrNull()?:continue;val sample=withContext(Dispatchers.IO){NativeDiagnostics.probe("API",url)};addSample(sample)}
            }
        }
    }
    @Composable fun InfoRow(label:String,value:String) {
        Row(Modifier.fillMaxWidth().padding(vertical=(14*s).dp),horizontalArrangement=Arrangement.spacedBy((24*s).dp)) {Text(label,Modifier.width((150*s).dp),fontSize=(26*s).sp,lineHeight=(40*s).sp,color=muted);Text(value,Modifier.weight(1f),fontSize=(26*s).sp,lineHeight=(40*s).sp,color=ink,textAlign=TextAlign.End)}
    }
    Column(Modifier.fillMaxWidth().background(Color.White).padding(start=(28*s).dp,end=(28*s).dp,top=(8*s).dp,bottom=(48*s).dp)) {
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape((12*s).dp)).border(s.dp,Color(0xFFECEFF3),RoundedCornerShape((12*s).dp)).padding(horizontal=(24*s).dp)) {
            InfoRow("聊天号",NativeDiagnostics.mask(app.profile?.publicId.orEmpty()))
            InfoRow("版本号","${local.versionName} APP/Android")
            InfoRow("画面尺寸","${config.screenWidthDp} × ${config.screenHeightDp}")
        }
        Spacer(Modifier.height((24*s).dp))
        if(probes.isEmpty())Text(if(probing)"探测中…" else "暂无探测结果",Modifier.padding(vertical=(24*s).dp),fontSize=(26*s).sp,color=muted)
        probes.forEach{probe->
            Row(Modifier.fillMaxWidth().padding(horizontal=(4*s).dp,vertical=(18*s).dp),verticalAlignment=Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {Text(probe.label,fontSize=(28*s).sp,lineHeight=(40*s).sp,fontWeight=FontWeight.SemiBold,color=ink);Text(probe.host,fontSize=(22*s).sp,lineHeight=(32*s).sp,color=muted)}
                Text("${probe.ms?:"—"} ms",fontSize=(28*s).sp,color=if(probe.ok)ink else Color(0xFFEF4444))
                Box(Modifier.padding(start=(12*s).dp).size((36*s).dp).clip(CircleShape).background(if(probe.ok)Color(0xFF22C55E) else Color(0xFFEF4444)),contentAlignment=Alignment.Center){Text(if(probe.ok)"✓" else "!",fontSize=(22*s).sp,fontWeight=FontWeight.Bold,color=Color.White)}
            }
            androidx.compose.material3.HorizontalDivider(color=Color(0xFFF3F4F7),thickness=s.dp)
        }
        if(history.isNotEmpty())Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).height((220*s).dp).padding(vertical=(12*s).dp),verticalAlignment=Alignment.Bottom,horizontalArrangement=Arrangement.spacedBy((12*s).dp)) {
            val maximum=history.maxOf{it.second.ms?:1}.coerceAtLeast(1)
            history.forEach{(at,probe)->Column(Modifier.width((72*s).dp),horizontalAlignment=Alignment.CenterHorizontally) {
                Box(Modifier.width((28*s).dp).height(((probe.ms?:0)*120f/maximum).coerceAtLeast(8f).times(s).dp).clip(RoundedCornerShape((8*s).dp)).background(if(probe.ok)Color(0xFF93C5FD) else Color(0xFFFCA5A5)))
                Text("${probe.ms?:0}ms",fontSize=(18*s).sp,color=muted)
                Text(at,fontSize=(16*s).sp,color=Color(0xFF9AA3B5))
            }}
        }
        meta?.let{value->
            InfoRow("设备",value.device);InfoRow("私密浏览","不适用（原生应用）");InfoRow("网络状态",value.network);InfoRow("储存空间",value.storage)
            Text("媒体支援",Modifier.padding(top=(28*s).dp,bottom=(12*s).dp),fontSize=(26*s).sp,color=muted)
            FlowRow(horizontalArrangement=Arrangement.spacedBy((10*s).dp),verticalArrangement=Arrangement.spacedBy((10*s).dp)) {value.media.forEach{Text(it,Modifier.clip(RoundedCornerShape((8*s).dp)).background(Color(0xFFF3F4F7)).padding(horizontal=(12*s).dp,vertical=(6*s).dp),fontSize=(20*s).sp,color=Color(0xFF444455))}}
            Spacer(Modifier.height((28*s).dp));(value.permissions+value.capabilities).chunked(2).forEach{pair->Row(horizontalArrangement=Arrangement.spacedBy((24*s).dp)){pair.forEach{(key,value)->Row(Modifier.weight(1f).padding(vertical=(8*s).dp)){Text(key,Modifier.weight(1f),fontSize=(24*s).sp,color=muted);Text(value,fontSize=(24*s).sp,color=ink)}}}}
        }
        InfoRow("本地数据库",app.chat.store.name);InfoRow("同步状态",app.chat.sync.name);InfoRow("聊天连接",app.chat.connection.name);InfoRow("待核对发送",app.chat.outbox.size.toString())
        InfoRow("现在时间",now.format(DateTimeFormatter.ISO_OFFSET_DATE_TIME))
        if(endpoints.imApi.isNotBlank())InfoRow("OpenIM API",NativeDiagnostics.host(endpoints.imApi))
        if(endpoints.imWs.isNotBlank())InfoRow("OpenIM WS",NativeDiagnostics.host(endpoints.imWs))
        Text("HTTP 401/404 仅表示网络可达；WS 握手通过才标记成功。诊断不读取消息原文。",Modifier.padding(vertical=(24*s).dp),fontSize=(22*s).sp,color=muted)
        listOf(Triple(if(saving)"保存中…" else "以图片保存",!saving,{saveImage()}),Triple(if(probing)"探测中…" else "重新探测",!probing,{scope.launch{try{runProbes()}catch(cancelled:CancellationException){throw cancelled}catch(_:Exception){toast("探测未完成，请重试")}};Unit}),Triple("复制摘要",true,{(context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("脱敏诊断",report().joinToString("\n")));toast("已复制诊断摘要")})).forEach{(title,enabled,action)->
            Box(Modifier.fillMaxWidth().padding(top=(16*s).dp).height((80*s).dp).clip(RoundedCornerShape((12*s).dp)).background(if(enabled)blue else Color(0xFFB5BDCF)).clickable(enabled=enabled,onClick=action),contentAlignment=Alignment.Center){Text(title,fontSize=(28*s).sp,color=Color.White)}
        }
    }
}
