package com.im.nativebootstrap.business

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.media.MediaCodecList
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.StatFs
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import java.io.File
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.net.URI
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory

data class DiagnosticEndpoints(val api:String,val imApi:String="",val imWs:String="",val file:String="")
data class NativeProbe(val label:String,val host:String,val ms:Long?,val ok:Boolean,val detail:String="")
data class DiagnosticMeta(val device:String,val network:String,val storage:String,val media:List<String>,val permissions:List<Pair<String,String>>,val capabilities:List<Pair<String,String>>)

/** 探针不附带账号凭据；界面和导出仅保留 host，剥离路径、query、用户标识和原始错误。 */
object NativeDiagnostics {
    fun mask(value:String):String=if(value.length<6)"（已隐藏）" else value.take(2)+"…"+value.takeLast(2)
    fun host(value:String):String=runCatching{val uri=URI(value);if(uri.port>0)uri.host+":"+uri.port else uri.host.orEmpty()}.getOrDefault("")
    fun origin(value:String):String {
        val uri=URI(value)
        require(uri.scheme=="https"&&!uri.host.isNullOrBlank()&&uri.userInfo==null)
        return URI("https",null,uri.host,uri.port,"/",null,null).toASCIIString().trimEnd('/')
    }
    fun targets(endpoints:DiagnosticEndpoints):List<Pair<String,String>> {
        val base=origin(endpoints.api)
        return listOf("App" to "$base/","API" to "$base/health","File" to endpoints.file.ifBlank{"$base/static/avatar-default.svg"},"OpenIM" to endpoints.imApi,"WS" to endpoints.imWs,"百度" to "https://www.baidu.com/","腾讯" to "https://www.qq.com/","微信" to "https://www.wechat.com/").filter{it.second.isNotBlank()}
    }
    private fun safeURI(raw:String):URI {
        val uri=URI(raw)
        require(uri.scheme in listOf("https","wss")&&!uri.host.isNullOrBlank()&&uri.userInfo==null)
        return URI(uri.scheme,null,uri.host,uri.port,uri.path.ifBlank{"/"},null,null)
    }
    fun probe(label:String,url:String):NativeProbe {
        val start=System.nanoTime();val hostname=host(url)
        return try {
            val uri=safeURI(url)
            val status=if(uri.scheme=="wss")webSocket(uri) else {
                val connection=uri.toURL().openConnection() as HttpURLConnection
                connection.connectTimeout=4000;connection.readTimeout=4000;connection.instanceFollowRedirects=false
                connection.requestMethod="GET"
                try{connection.responseCode}finally{connection.disconnect()}
            }
            val ok=if(uri.scheme=="wss")status==101 else status in 100..499
            NativeProbe(label,hostname,(System.nanoTime()-start)/1_000_000,ok,if(uri.scheme=="wss"&&status!=101)"HTTP $status，握手未接受" else "HTTP $status")
        }catch(_:java.net.SocketTimeoutException){NativeProbe(label,hostname,(System.nanoTime()-start)/1_000_000,false,"连接超时")}
        catch(_:Exception){NativeProbe(label,hostname,(System.nanoTime()-start)/1_000_000,false,"连接未完成")}
    }
    private fun webSocket(uri:URI):Int {
        val socket=SSLSocketFactory.getDefault().createSocket() as SSLSocket
        try {
            socket.soTimeout=4000
            socket.sslParameters=socket.sslParameters.apply{endpointIdentificationAlgorithm="HTTPS"}
            socket.connect(InetSocketAddress(uri.host,if(uri.port>0)uri.port else 443),4000)
            socket.startHandshake()
            val nonce=ByteArray(16).also{SecureRandom().nextBytes(it)}
            val key=Base64.getEncoder().encodeToString(nonce)
            val authority=uri.host+if(uri.port>0)":"+uri.port else ""
            val request="GET ${uri.rawPath} HTTP/1.1\r\nHost: $authority\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: $key\r\nSec-WebSocket-Version: 13\r\n\r\n"
            socket.outputStream.write(request.toByteArray(Charsets.US_ASCII));socket.outputStream.flush()
            val bytes=java.io.ByteArrayOutputStream();var tail=0
            while(bytes.size()<16384){val byte=socket.inputStream.read();check(byte>=0);bytes.write(byte);tail=(tail shl 8) or byte;if(tail==0x0D0A0D0A)break}
            val lines=bytes.toString("US-ASCII").split("\r\n")
            val status=lines.firstOrNull()?.split(' ')?.getOrNull(1)?.toIntOrNull() ?: error("invalid handshake")
            if(status==101) {
                val actual=lines.firstOrNull{it.startsWith("Sec-WebSocket-Accept:",true)}?.substringAfter(':')?.trim()
                val expected=Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-1").digest((key+"258EAFA5-E914-47DA-95CA-C5AB0DC85B11").toByteArray(Charsets.US_ASCII)))
                check(actual==expected)
                socket.outputStream.write(byteArrayOf(0x88.toByte(),0x80.toByte(),0,0,0,0));socket.outputStream.flush()
            }
            return status
        }finally{socket.close()}
    }
    fun metadata(context:Context):DiagnosticMeta {
        val manager=context.getSystemService(ConnectivityManager::class.java)
        val caps=manager.getNetworkCapabilities(manager.activeNetwork)
        val transport=when{caps==null->"未连接";caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)->"Wi-Fi";caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)->"移动网络";caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)->"有线网络";else->"其他网络"}
        val network=transport+if(caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)==true)" · 互联网可用" else " · 未确认互联网"
        val stat=StatFs(context.filesDir.absolutePath)
        fun gb(bytes:Long)=String.format(java.util.Locale.ROOT,"%.2f GB",bytes/1073741824.0)
        fun permission(name:String)=if(ContextCompat.checkSelfPermission(context,name)==PackageManager.PERMISSION_GRANTED)"已允许" else "未允许"
        val permissions=listOf("相机" to permission(Manifest.permission.CAMERA),"麦克风" to permission(Manifest.permission.RECORD_AUDIO),"通知" to if(NotificationManagerCompat.from(context).areNotificationsEnabled())"已允许" else "未允许","振动" to permission(Manifest.permission.VIBRATE))
        val codecs=runCatching{MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.filter{!it.isEncoder}.flatMap{it.supportedTypes.toList()}.distinct().sorted().take(24)}.getOrDefault(emptyList())
        val features=listOf("原生界面" to "是","系统版本" to "API ${Build.VERSION.SDK_INT}","相机设备" to if(context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY))"有" else "无","录音设备" to if(context.packageManager.hasSystemFeature(PackageManager.FEATURE_MICROPHONE))"有" else "无")
        return DiagnosticMeta("Android ${Build.VERSION.RELEASE} · ${Build.MANUFACTURER} ${Build.MODEL}",network,"可用 ${gb(stat.availableBytes)} / ${gb(stat.totalBytes)}",listOf("image/jpeg","image/png","image/gif")+codecs,permissions,features)
    }
    fun image(context:Context,lines:List<String>):File {
        val paint=Paint(Paint.ANTI_ALIAS_FLAG).apply{color=Color.rgb(33,33,33);textSize=28f}
        val wrapped=mutableListOf<String>()
        lines.take(120).forEach{line->var remaining=line.take(1000);if(remaining.isEmpty())wrapped+="";while(remaining.isNotEmpty()&&wrapped.size<180){val count=paint.breakText(remaining,true,904f,null).coerceAtLeast(1);wrapped+=remaining.take(count);remaining=remaining.drop(count)}}
        val bitmap=Bitmap.createBitmap(1000,(96+wrapped.size*44).coerceAtLeast(180),Bitmap.Config.RGB_565)
        try {
            val canvas=Canvas(bitmap);canvas.drawColor(Color.WHITE)
            wrapped.forEachIndexed{index,line->canvas.drawText(line,48f,64f+index*44,paint)}
            val directory=File(context.cacheDir,"media").apply{check(mkdirs()||isDirectory)}
            val file=File(directory,"diagnostic-${java.util.UUID.randomUUID()}.png")
            file.outputStream().use{check(bitmap.compress(Bitmap.CompressFormat.PNG,100,it))}
            return file
        }finally{bitmap.recycle()}
    }
}
