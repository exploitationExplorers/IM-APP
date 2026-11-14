package com.im.nativebootstrap.business

import com.im.nativebootstrap.NativeNotices

import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.im.nativebootstrap.R
import com.im.nativebootstrap.media.MediaIO
import com.im.nativebootstrap.media.SharedAvatar
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun NativeQrPage(controller:BusinessController,state:BusinessState) {
    val context=LocalContext.current;val s=LocalConfiguration.current.screenWidthDp/750f
    val scope=rememberCoroutineScope();val group=state.route.page=="group-qrcode"
    val data=state.detail;val person=data.child(if(group)"group" else "user")
    val name=person.displayName().ifBlank{if(group)state.route.id else ""};val avatar=person.text("avatar");val payload=data.text("payload")
    var saving by remember{mutableStateOf(false)}
    val toast:(String)->Unit={NativeNotices.show(it)}
    val saveFile=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("image/png")){uri->if(uri!=null)scope.launch {
        saving=true
        val result=runCatching{withContext(Dispatchers.IO){
            val bitmap=qrCardBitmap(context.applicationContext,payload,name,avatar,group)
            try{context.contentResolver.openOutputStream(uri)?.use{check(bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it))}?:error("无法写入图片")}finally{bitmap.recycle()}
        }}
        saving=false;toast(result.fold({"二维码已保存"},{"二维码未保存，请重试"}))
    }}
    fun share() {
        if(saving||payload.isBlank())return
        saving=true
        scope.launch {
            val result=runCatching{withContext(Dispatchers.IO){writeQrCard(context.applicationContext,payload,name,avatar,group)}}
            saving=false
            result.fold({file->runCatching{shareQr(context,file)}.onFailure{toast("分享未完成，请重试")}}, {toast("二维码未生成，请重试")})
        }
    }
    fun save() {
        if(saving||payload.isBlank())return
        if(Build.VERSION.SDK_INT<29){saveFile.launch("易可聊二维码.png");return}
        saving=true
        scope.launch {
            val result=runCatching{withContext(Dispatchers.IO){
                val file=writeQrCard(context.applicationContext,payload,name,avatar,group)
                try{check(MediaIO.saveToGallery(context,file,"易可聊二维码-${System.currentTimeMillis()}.png","image/png",false))}finally{file.delete()}
            }}
            saving=false;toast(result.fold({"已保存到相册"},{"二维码未保存，请重试"}))
        }
    }
    Column(Modifier.fillMaxSize().background(Color.White).statusBarsPadding().navigationBarsPadding()) {
        val side=if(group)72 else 128
        Row(Modifier.fillMaxWidth().height((96*s).dp).padding(horizontal=(32*s).dp),verticalAlignment=Alignment.CenterVertically) {
            Box(Modifier.width((side*s).dp).fillMaxHeight().clickable{controller.back()},contentAlignment=Alignment.CenterStart){Image(painterResource(R.drawable.uni_icon_back),"返回",Modifier.size((44*s).dp))}
            Text(if(group)"群二维码" else "二维码",Modifier.weight(1f),fontSize=(40*s).sp,fontWeight=FontWeight.Bold,color=Color(0xFF212121),textAlign=TextAlign.Center)
            Row(Modifier.width((side*s).dp),horizontalArrangement=Arrangement.End) {
                if(!group)Box(Modifier.size((64*s).dp).clickable{controller.open("scan")},contentAlignment=Alignment.Center){Image(painterResource(R.drawable.uni_icon_scan),"扫一扫",Modifier.size((44*s).dp))}
                Box(Modifier.size((64*s).dp).clickable(enabled=payload.isNotBlank()&&!saving){share()},contentAlignment=Alignment.Center){Image(painterResource(R.drawable.uni_icon_share),"分享",Modifier.size((44*s).dp))}
            }
        }
        if(state.loading||saving)LinearProgressIndicator(Modifier.fillMaxWidth())
        state.error?.let{Text(it+" · 重试",Modifier.fillMaxWidth().clickable{controller.refresh()}.padding(16.dp),color=Color(0xFFDC2828),fontSize=13.sp)}
        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(start=(40*s).dp,end=(40*s).dp,top=(32*s).dp,bottom=((if(group)24 else 48)*s).dp)) {
            Row(Modifier.fillMaxWidth().padding(bottom=(48*s).dp),verticalAlignment=Alignment.CenterVertically) {
                SharedAvatar(avatar,Modifier.size((88*s).dp).clip(CircleShape),group)
                Text(name,Modifier.weight(1f).padding(start=(20*s).dp),fontSize=(34*s).sp,fontWeight=FontWeight.SemiBold,maxLines=1,overflow=TextOverflow.Ellipsis,color=Color(0xFF212121))
            }
            Box(Modifier.fillMaxWidth().heightIn(min=(560*s).dp),contentAlignment=Alignment.Center) {
                if(payload.isNotBlank())QrImage(payload,Modifier.size((560*s).dp))
                else Text(if(state.loading)"加载中..." else "二维码加载失败",fontSize=(28*s).sp,color=Color(0xFF636E86))
            }
            if(group)Text("扫码进群",Modifier.fillMaxWidth().padding(top=(24*s).dp),fontSize=(28*s).sp,color=Color(0xFF9AA3B5),textAlign=TextAlign.Center)
        }
        if(!group)androidx.compose.material3.HorizontalDivider(color=Color(0xFFE1E3EA),thickness=(s).dp)
        Row(Modifier.fillMaxWidth().padding(horizontal=(if(group)80*s else 0f).dp,vertical=(if(group)32*s else 0f).dp),horizontalArrangement=Arrangement.SpaceEvenly) {
            listOf(Triple("保存",R.drawable.uni_icon_download,{save()}),Triple("分享",R.drawable.uni_icon_share,{share()})).forEach{(label,icon,action)->
                Column(Modifier.weight(1f).clickable(enabled=payload.isNotBlank()&&!saving,onClick=action).padding(vertical=((if(group)8 else 28)*s).dp),horizontalAlignment=Alignment.CenterHorizontally) {
                    Image(painterResource(icon),label,Modifier.size(((if(group)48 else 44)*s).dp))
                    Text(label,Modifier.padding(top=((if(group)12 else 8)*s).dp),fontSize=((if(group)26 else 24)*s).sp,color=Color(0xFF636E86))
                }
            }
        }
    }
}
