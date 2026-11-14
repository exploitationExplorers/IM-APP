package com.im.nativebootstrap.business

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.os.Build
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.util.UUID
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** 只解码有界工作图，按圆形取景框裁正方形；上传的是裁剪后的文件。 */
@Composable fun AvatarCropper(uri:Uri,onDismiss:()->Unit,onComplete:(Uri)->Unit) {
    val context=LocalContext.current;val scope=rememberCoroutineScope()
    var bitmap by remember(uri){mutableStateOf<Bitmap?>(null)}
    var error by remember(uri){mutableStateOf("")};var saving by remember(uri){mutableStateOf(false)}
    var zoom by remember(uri){mutableFloatStateOf(1f)};var offset by remember(uri){mutableStateOf(Offset.Zero)}
    var frameSide by remember{mutableFloatStateOf(1f)}
    LaunchedEffect(uri) {
        try{bitmap=withContext(Dispatchers.IO){
            if(Build.VERSION.SDK_INT>=28)ImageDecoder.decodeBitmap(ImageDecoder.createSource(context.contentResolver,uri)){decoder,info,_->
                decoder.allocator=ImageDecoder.ALLOCATOR_SOFTWARE
                val ratio=min(1f,2048f/max(info.size.width,info.size.height))
                decoder.setTargetSize(max(1,(info.size.width*ratio).roundToInt()),max(1,(info.size.height*ratio).roundToInt()))
            }else {
                val bounds=BitmapFactory.Options().apply{inJustDecodeBounds=true}
                context.contentResolver.openInputStream(uri)?.use{BitmapFactory.decodeStream(it,null,bounds)}
                require(bounds.outWidth>0&&bounds.outHeight>0){"图片无法读取"}
                var sample=1;while(bounds.outWidth/sample>2048||bounds.outHeight/sample>2048)sample*=2
                val raw=context.contentResolver.openInputStream(uri)?.use{BitmapFactory.decodeStream(it,null,BitmapFactory.Options().apply{inSampleSize=sample})}?:error("图片无法读取")
                val orientation=runCatching{context.contentResolver.openInputStream(uri)?.use{ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION,ExifInterface.ORIENTATION_NORMAL)}}.getOrNull()
                val matrix=Matrix().apply{when(orientation){2->postScale(-1f,1f);3->postRotate(180f);4->postScale(1f,-1f);5->{postRotate(90f);postScale(-1f,1f)};6->postRotate(90f);7->{postRotate(270f);postScale(-1f,1f)};8->postRotate(270f)}}
                if(matrix.isIdentity)raw else Bitmap.createBitmap(raw,0,0,raw.width,raw.height,matrix,true).also{raw.recycle()}
            }
        }}catch(_:Exception){error="图片无法裁剪，请重新选择。"}
    }
    DisposableEffect(uri){onDispose{bitmap?.recycle()}}
    Dialog(onDismissRequest={if(!saving)onDismiss()},properties=DialogProperties(usePlatformDefaultWidth=false)) {
        Column(Modifier.fillMaxSize().background(Color.Black).systemBarsPadding()) {
            Row(Modifier.fillMaxWidth().height(56.dp),verticalAlignment=Alignment.CenterVertically) {
                TextButton(enabled=!saving,onClick=onDismiss){Text("取消",color=Color.White)}
                Text("移动和缩放图片",Modifier.weight(1f),color=Color.White)
                TextButton(enabled=bitmap!=null&&!saving,onClick={
                    val current=bitmap?:return@TextButton;saving=true
                    scope.launch {
                        try {
                            val result=withContext(Dispatchers.IO){
                                val scale=max(frameSide/current.width,frameSide/current.height)*zoom
                                val side=(frameSide/scale).roundToInt().coerceIn(1,min(current.width,current.height))
                                val x=((current.width-side)/2f-offset.x/scale).roundToInt().coerceIn(0,current.width-side)
                                val y=((current.height-side)/2f-offset.y/scale).roundToInt().coerceIn(0,current.height-side)
                                val crop=Bitmap.createBitmap(current,x,y,side,side)
                                val output=Bitmap.createScaledBitmap(crop,min(1024,side),min(1024,side),true)
                                try {
                                    val file=File(File(context.cacheDir,"media").apply{mkdirs()},"avatar-crop-${UUID.randomUUID()}.jpg")
                                    file.outputStream().use{check(output.compress(Bitmap.CompressFormat.JPEG,92,it))}
                                    Uri.fromFile(file)
                                }finally{if(output!==crop&&output!==current)output.recycle();if(crop!==current)crop.recycle()}
                            }
                            onComplete(result)
                        }catch(_:Exception){error="裁剪未完成，请重试。";saving=false}
                    }
                }){Text(if(saving)"处理中…" else "完成",color=Color.White)}
            }
            Box(Modifier.weight(1f).fillMaxWidth(),contentAlignment=Alignment.Center) {
                val source=bitmap
                if(source==null){if(error.isBlank())CircularProgressIndicator()}
                else Canvas(Modifier.fillMaxSize().pointerInput(source){detectTransformGestures{_,pan,gestureZoom,_->
                    zoom=(zoom*gestureZoom).coerceIn(1f,6f)
                    val scale=max(frameSide/source.width,frameSide/source.height)*zoom
                    val maxX=max(0f,(source.width*scale-frameSide)/2);val maxY=max(0f,(source.height*scale-frameSide)/2)
                    offset=Offset((offset.x+pan.x).coerceIn(-maxX,maxX),(offset.y+pan.y).coerceIn(-maxY,maxY))
                }}) {
                    val side=min(size.width,size.height)*.84f;frameSide=side
                    val center=Offset(size.width/2,size.height/2);val scale=max(side/source.width,side/source.height)*zoom
                    val width=source.width*scale;val height=source.height*scale
                    drawImage(source.asImageBitmap(),dstOffset=IntOffset((center.x-width/2+offset.x).roundToInt(),(center.y-height/2+offset.y).roundToInt()),dstSize=IntSize(width.roundToInt(),height.roundToInt()))
                    val mask=Path().apply{fillType=PathFillType.EvenOdd;addRect(Rect(0f,0f,size.width,size.height));addOval(Rect(center.x-side/2,center.y-side/2,center.x+side/2,center.y+side/2))}
                    drawPath(mask,Color.Black.copy(alpha=.65f));drawCircle(Color.White,radius=side/2,center=center,style=androidx.compose.ui.graphics.drawscope.Stroke(2f))
                }
            }
            if(error.isNotBlank())Text(error,Modifier.padding(20.dp),color=Color.White)
        }
    }
}
