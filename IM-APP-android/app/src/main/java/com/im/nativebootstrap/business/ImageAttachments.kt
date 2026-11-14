package com.im.nativebootstrap.business

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import com.im.nativebootstrap.BootstrapViewModel
import com.im.nativebootstrap.media.RemoteMediaImage

data class ImageAttachment(val id:String,val url:String)

/** 图片先完成业务签名上传；提交时仅发送 fileId，失败不会填入无效占位。 */
@OptIn(ExperimentalLayoutApi::class)
@Composable fun ImageAttachments(model:BootstrapViewModel,key:Any,initial:List<ImageAttachment> = emptyList(),change:(List<ImageAttachment>,Boolean)->Unit) {
    var images by remember(key){mutableStateOf(initial)}
    var busy by remember(key){mutableStateOf(false)}
    var note by remember(key){mutableStateOf("")}
    var preview by remember(key){mutableStateOf<String?>(null)}
    val s=LocalConfiguration.current.screenWidthDp/750f
    val picker=rememberLauncherForActivityResult(ActivityResultContracts.GetContent()){uri->if(uri!=null){
        busy=true;change(images,true)
        model.uploadBusinessImage(uri,"image"){result->
            busy=false
            result.fold({images=images+ImageAttachment(it.id,it.url);note=""},{note=it.message?:"图片上传失败"})
            change(images,false)
        }
    }}
    FlowRow(Modifier.fillMaxWidth().padding(top=(24*s).dp,bottom=(10*s).dp),horizontalArrangement=Arrangement.spacedBy((16*s).dp),verticalArrangement=Arrangement.spacedBy((16*s).dp)) {
        images.forEach{image->Box(Modifier.size((160*s).dp).clip(RoundedCornerShape((12*s).dp)).background(Color(0xFFF3F4F7))) {
            RemoteMediaImage(image.url,Modifier.fillMaxSize().clickable{preview=image.url},scale=ContentScale.Crop)
            Text("×",Modifier.align(Alignment.TopEnd).size((40*s).dp).background(Color.Black.copy(alpha=.55f)).clickable(enabled=!busy){images=images.filterNot{it==image};change(images,false)}.wrapContentSize(),fontSize=(28*s).sp,color=Color.White)
        }}
        if(images.size<9)Column(Modifier.size((160*s).dp).clip(RoundedCornerShape((12*s).dp)).background(Color(0xFFF3F4F7)).clickable(enabled=!busy){picker.launch("image/*")},verticalArrangement=Arrangement.Center,horizontalAlignment=Alignment.CenterHorizontally){Text(if(busy)"…" else "+",fontSize=(48*s).sp,color=Color(0xFF8A8F9C));Text(if(busy)"上传中" else "图片",fontSize=(22*s).sp,color=Color(0xFF8A8F9C))}
    }
    if(note.isNotBlank())Text(note,Modifier.padding(horizontal=18.dp),color=Color(0xFFDC2828),fontSize=13.sp)
    preview?.let{BusinessImagePreview(it){preview=null}}
}
