package com.im.nativebootstrap.business

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import android.content.Context
import android.net.Uri
import android.graphics.BitmapFactory
import com.google.zxing.BinaryBitmap
import com.google.zxing.MultiFormatReader
import com.google.zxing.RGBLuminanceSource
import com.google.zxing.common.HybridBinarizer

fun readQr(context:Context,uri:Uri):String {
    val bounds=BitmapFactory.Options().apply{inJustDecodeBounds=true}
    context.contentResolver.openInputStream(uri)?.use{BitmapFactory.decodeStream(it,null,bounds)}
    require(bounds.outWidth>0&&bounds.outHeight>0){"请选择有效图片"}
    var sample=1
    while(bounds.outWidth/sample>2048||bounds.outHeight/sample>2048)sample*=2
    val bitmap=context.contentResolver.openInputStream(uri)?.use{BitmapFactory.decodeStream(it,null,BitmapFactory.Options().apply{inSampleSize=sample})}?:error("图片无法读取")
    try {
        val pixels=IntArray(bitmap.width*bitmap.height);bitmap.getPixels(pixels,0,bitmap.width,0,0,bitmap.width,bitmap.height)
        return MultiFormatReader().decode(BinaryBitmap(HybridBinarizer(RGBLuminanceSource(bitmap.width,bitmap.height,pixels)))).text
    }catch(error:Exception){throw IllegalArgumentException("图片中未识别到二维码，请选择清晰的完整二维码图片",error)}finally{bitmap.recycle()}
}

fun qrCardBitmap(context:Context,payload:String,name:String,avatar:String,group:Boolean):Bitmap {
    val bitmap=Bitmap.createBitmap(750,if(group)840 else 776,Bitmap.Config.ARGB_8888)
    val canvas=android.graphics.Canvas(bitmap);canvas.drawColor(android.graphics.Color.WHITE)
    val paint=android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
    val face=runCatching{com.im.nativebootstrap.media.MediaLoader.bitmap(context,avatar,128)}.getOrNull()
    paint.color=android.graphics.Color.rgb(10,47,194);canvas.drawCircle(84f,84f,44f,paint)
    if(face!=null) {
        canvas.save();val circle=android.graphics.Path().apply{addCircle(84f,84f,44f,android.graphics.Path.Direction.CW)};canvas.clipPath(circle)
        canvas.drawBitmap(face,null,android.graphics.RectF(40f,40f,128f,128f),paint);canvas.restore()
    } else {
        paint.color=android.graphics.Color.WHITE;paint.textSize=36f;paint.typeface=android.graphics.Typeface.create(android.graphics.Typeface.DEFAULT,android.graphics.Typeface.BOLD);paint.textAlign=android.graphics.Paint.Align.CENTER
        canvas.drawText(name.take(1).ifBlank{if(group)"群" else "?"},84f,84f-(paint.ascent()+paint.descent())/2,paint)
    }
    paint.color=android.graphics.Color.rgb(33,33,33);paint.textSize=34f;paint.typeface=android.graphics.Typeface.create(android.graphics.Typeface.DEFAULT,android.graphics.Typeface.BOLD);paint.textAlign=android.graphics.Paint.Align.LEFT
    var label=name
    while(label.length>1&&paint.measureText(label+"…")>562f)label=label.dropLast(1)
    canvas.drawText(if(label==name)label else label+"…",148f,84f-(paint.ascent()+paint.descent())/2,paint)
    val qr=qrBitmap(payload)
    try{canvas.drawBitmap(qr,null,android.graphics.RectF(95f,176f,655f,736f),null)}finally{qr.recycle()}
    if(group){paint.color=android.graphics.Color.rgb(154,163,181);paint.textSize=28f;paint.typeface=android.graphics.Typeface.DEFAULT;paint.textAlign=android.graphics.Paint.Align.CENTER;canvas.drawText("扫码进群",375f,760f-paint.ascent(),paint)}
    return bitmap
}

fun writeQrCard(context:Context,payload:String,name:String,avatar:String,group:Boolean):java.io.File {
    val folder=java.io.File(context.cacheDir,"media").apply{mkdirs()}
    val file=java.io.File(folder,"qrcode-${java.util.UUID.randomUUID()}.png")
    val bitmap=qrCardBitmap(context,payload,name,avatar,group)
    try{file.outputStream().use{check(bitmap.compress(Bitmap.CompressFormat.PNG,100,it))}}finally{bitmap.recycle()}
    return file
}
fun shareQr(context:Context,file:java.io.File) {
    val uri=androidx.core.content.FileProvider.getUriForFile(context,context.packageName+".files",file)
    val intent=android.content.Intent(android.content.Intent.ACTION_SEND).apply{type="image/png";putExtra(android.content.Intent.EXTRA_STREAM,uri);clipData=android.content.ClipData.newRawUri("二维码",uri);addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)}
    context.startActivity(android.content.Intent.createChooser(intent,"分享二维码"))
}

fun qrBitmap(payload:String):Bitmap {
        val matrix=QRCodeWriter().encode(payload,BarcodeFormat.QR_CODE,768,768,mapOf(EncodeHintType.CHARACTER_SET to "UTF-8",EncodeHintType.MARGIN to 2))
        val colors=IntArray(matrix.width*matrix.height){index->if(matrix[index%matrix.width,index/matrix.width])android.graphics.Color.BLACK else android.graphics.Color.WHITE}
        return Bitmap.createBitmap(colors,matrix.width,matrix.height,Bitmap.Config.ARGB_8888)
}
@Composable fun QrImage(payload:String,modifier:Modifier=Modifier) {
    val bitmap=remember(payload) {runCatching{qrBitmap(payload)}.getOrNull()}
    androidx.compose.runtime.DisposableEffect(bitmap){onDispose{bitmap?.recycle()}}
    if(bitmap!=null)Image(bitmap.asImageBitmap(),"二维码",modifier)
    else androidx.compose.material3.Text("二维码暂不可用，请刷新重试。")
}
