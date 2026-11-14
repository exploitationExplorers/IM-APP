package com.im.nativebootstrap.business

import com.im.nativebootstrap.NativeNotices

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.im.nativebootstrap.BootstrapViewModel
import com.im.nativebootstrap.R
import com.im.nativebootstrap.update.NativeUpdateClient
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

@Composable
fun NativeAboutPage(model:BootstrapViewModel,onLegal:(String)->Unit) {
    val context=LocalContext.current;val s=LocalConfiguration.current.screenWidthDp/750f
    val scope=rememberCoroutineScope()
    val local=remember{context.packageManager.getPackageInfo(context.packageName,0)}
    var checking by remember{mutableStateOf(false)}
    var downloading by remember{mutableStateOf(false)}
    var release by remember{mutableStateOf<NativeRelease?>(null)}
    var ready by remember{mutableStateOf<File?>(null)}
    var notice by remember{mutableStateOf("")}
    LaunchedEffect(notice){if(notice.isNotBlank()){NativeNotices.show(notice);notice=""}}
    var attached by remember{mutableStateOf(true)}
    DisposableEffect(Unit){attached=true;onDispose{attached=false}}
    fun checked(result:Result<NativeRelease?>) {
        if(!attached)return
        checking=false
        result.fold({candidate->if(candidate==null)NativeNotices.show("当前渠道暂无新安装包") else release=candidate},{notice=it.message?:"检查更新失败，请稍后重试。"})
    }
    fun install(file:File) {
        runCatching{NativeRelease.install(context,file)}.fold({opened->if(!opened)notice="允许安装后，请返回此页点击安装。"},{notice=it.message?:"系统安装器暂不可用。"})
    }
    Column(Modifier.fillMaxWidth().background(Color.White).padding(top=(160*s).dp,bottom=(40*s).dp),horizontalAlignment=Alignment.CenterHorizontally) {
        Image(painterResource(R.drawable.uni_logo),"易可聊",Modifier.size((160*s).dp).clip(RoundedCornerShape((28*s).dp)))
        Text("易可聊",Modifier.padding(top=(32*s).dp),fontSize=(36*s).sp,lineHeight=(52*s).sp,fontWeight=FontWeight.Bold,color=Color(0xFF212121))
        Text("v"+local.versionName.orEmpty().removePrefix("v"),Modifier.padding(top=(12*s).dp),fontSize=(26*s).sp,lineHeight=(40*s).sp,color=Color(0xFF3A4558))
        Box(Modifier.padding(top=(48*s).dp).height((80*s).dp).widthIn(min=(240*s).dp).clip(RoundedCornerShape((12*s).dp)).background(Color(0xFF0A2FC2)).clickable(enabled=!checking&&!downloading) {
            val apk=ready
            if(apk!=null)install(apk) else {
                checking=true;notice=""
                if(NativeUpdateClient.configured)scope.launch {
                    val jobContext=currentCoroutineContext()
                    try {checked(Result.success(withContext(Dispatchers.IO){NativeUpdateClient.check(context.applicationContext,NativeRelease.installedVersion(local)){jobContext.ensureActive()}}))}
                    catch(cancelled:CancellationException){throw cancelled}
                    catch(error:Exception){checked(Result.failure(error))}
                } else {checking=false;notice="原生内测更新入口尚未开放，请从工作人员提供的原生下载页获取安装包。"}
            }
        }.padding(horizontal=(48*s).dp),contentAlignment=Alignment.Center) {Text(if(checking)"检查中..." else if(downloading)"正在下载并核验..." else if(ready!=null)"安装更新" else "检查更新",fontSize=(28*s).sp,lineHeight=(44*s).sp,fontWeight=FontWeight.SemiBold,color=Color.White)}
        Row(Modifier.padding(top=(40*s).dp),horizontalArrangement=Arrangement.spacedBy((32*s).dp)) {
            Text("用户协议",Modifier.clickable{onLegal("agreement")},fontSize=(28*s).sp,color=Color(0xFF0A2FC2))
            Text("隐私政策",Modifier.clickable{onLegal("privacy")},fontSize=(28*s).sp,color=Color(0xFF0A2FC2))
        }
        if(NativeUpdateClient.downloadPage.isNotBlank())Text("官方下载页",Modifier.padding(top=(24*s).dp).clickable {
            runCatching{context.startActivity(Intent(Intent.ACTION_VIEW,Uri.parse(NativeUpdateClient.downloadPage)))}.onFailure{notice="请稍后重试，或联系工作人员获取下载入口。"}
        },fontSize=(26*s).sp,color=Color(0xFF0A2FC2))
    }
    release?.let{candidate->AlertDialog(onDismissRequest={release=null},title={Text("发现新版本")},text={Text(listOf(candidate.versionName,candidate.changelog).filter{it.isNotBlank()}.joinToString("\n"))},confirmButton={TextButton(onClick={
        release=null;downloading=true;notice=""
        scope.launch {
            val jobContext=currentCoroutineContext()
            try {
                val file=withContext(Dispatchers.IO){NativeRelease.downloadCompatible(context.applicationContext,candidate){jobContext.ensureActive()}}
                jobContext.ensureActive()
                if(attached){ready=file;install(file)}
            } catch(cancelled:CancellationException){throw cancelled}
            catch(error:Exception){if(attached)notice=error.message?:"下载或校验失败，请稍后重试。"}
            finally{if(attached)downloading=false}
        }
    }){Text("下载安装包")}},dismissButton={TextButton(onClick={release=null}){Text("稍后")}})}
}
