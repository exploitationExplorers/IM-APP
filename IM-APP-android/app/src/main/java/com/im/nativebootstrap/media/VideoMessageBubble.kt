package com.im.nativebootstrap.media

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun VideoMessageBubble(content:MessageContent,modifier:Modifier=Modifier,localPoster:java.io.File?=null,sending:Boolean=false) {
    val factor=LocalConfiguration.current.screenWidthDp/750f
    var measured by remember(content.thumbnail) { mutableStateOf<Pair<Int,Int>?>(null) }
    val bubbleSize=VideoBubbleGeometry.fit(measured?.first ?: content.width,measured?.second ?: content.height)
    Box(modifier.size((bubbleSize.width*factor).dp,(bubbleSize.height*factor).dp).clip(RoundedCornerShape((12*factor).dp)).background(Color(0xFFE8E8E8)).semantics { contentDescription="视频消息" }) {
        if(content.thumbnail.isNotBlank()||localPoster!=null)RemoteMediaImage(MediaURLs.image(content.thumbnail),Modifier.fillMaxSize(),scale=ContentScale.Crop,description="视频封面",onDimensions={width,height->if(width>0&&height>0)measured=width to height},retryOnTap=false,localDraft=localPoster)
        Canvas(Modifier.align(Alignment.Center).size((64*factor).dp)) {
            val triangle=Path().apply {moveTo(size.width*.25f,size.height*.13f);lineTo(size.width*.83f,size.height*.5f);lineTo(size.width*.25f,size.height*.87f);close()}
            drawPath(triangle,Color(0x44000000))
            drawPath(triangle,Color.White)
        }
        Text(VideoBubbleGeometry.duration(content.duration),Modifier.align(Alignment.BottomCenter).padding(bottom=(16*factor).dp).background(Color(0x73000000),RoundedCornerShape((8*factor).dp)).padding(horizontal=(14*factor).dp,vertical=(4*factor).dp),color=Color.White,fontSize=(24*factor).sp,lineHeight=(31*factor).sp)
        if(sending)CircularProgressIndicator(Modifier.align(Alignment.TopEnd).padding(7.dp).size(18.dp).semantics { contentDescription="视频正在发送" },color=Color.White,strokeWidth=2.dp)
    }
}
