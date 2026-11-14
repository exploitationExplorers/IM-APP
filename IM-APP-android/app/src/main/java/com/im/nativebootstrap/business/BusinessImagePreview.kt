package com.im.nativebootstrap.business

import com.im.nativebootstrap.NativeNotices

import android.graphics.BitmapFactory
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import com.im.nativebootstrap.media.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

@Composable
fun BusinessImagePreview(url:String,onDismiss:()->Unit) {
    val context=LocalContext.current;val scope=rememberCoroutineScope()
    var saving by remember(url){mutableStateOf(false)}
    var pending by remember{mutableStateOf<File?>(null)}
    fun toast(message:String){NativeNotices.show(message)}
    val saveFile=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("image/*")){uri->
        val file=pending;pending=null
        if(uri!=null&&file!=null)scope.launch {
            val result=runCatching{withContext(Dispatchers.IO){context.contentResolver.openOutputStream(uri)?.use{output->file.inputStream().use{it.copyTo(output)}}?:error("保存位置不可用")}}
            toast(result.fold({"图片已保存"},{"保存未完成，请重试"}))
        }
    }
    ImagePreview(url,onDismiss,{
        if(!saving){saving=true;scope.launch {
            val result=runCatching{withContext(Dispatchers.IO){
                val file=MediaLoader.fetch(context,MediaURLs.image(url,ImageVariant.ORIGINAL),32L*1024*1024)
                val bounds=BitmapFactory.Options().apply{inJustDecodeBounds=true};BitmapFactory.decodeFile(file.path,bounds)
                val mime=bounds.outMimeType?:"image/jpeg"
                val extension=android.webkit.MimeTypeMap.getSingleton().getExtensionFromMimeType(mime)?:"jpg"
                val name="易可聊图片-${System.currentTimeMillis()}.$extension"
                if(Build.VERSION.SDK_INT>=29){check(MediaIO.saveToGallery(context,file,name,mime,false));null to name}else file to name
            }}
            saving=false
            result.fold({(file,name)->if(file==null)toast("已保存到相册") else{pending=file;saveFile.launch(name)}},{toast("图片未保存，请重试")})
        }}
    })
}
