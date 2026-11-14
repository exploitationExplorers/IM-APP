package com.im.nativebootstrap.business

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.im.nativebootstrap.R
import com.im.nativebootstrap.chat.ChatMessage
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

data class NativeSettingsState(val noDisturb:Boolean=false,val message:Boolean=true,val voice:Boolean=true,val sound:Boolean=true,val vibration:Boolean=false,val enterToSend:Boolean=true)

/** 本机非敏感偏好持久化；实时提醒与输入键盘直接读取，不伪造系统推送注册。 */
class NativeSettings(private val context:Context) {
    private val prefs=context.getSharedPreferences("native_chat_settings_v1",Context.MODE_PRIVATE)
    private val mutable=MutableStateFlow(read())
    val state=mutable.asStateFlow()
    private fun read()=NativeSettingsState(prefs.getBoolean("noDisturb",false),prefs.getBoolean("message",true),prefs.getBoolean("voice",true),prefs.getBoolean("sound",true),prefs.getBoolean("vibration",false),prefs.getBoolean("enterToSend",true))
    fun set(key:String,value:Boolean) {
        require(key in setOf("noDisturb","message","voice","sound","vibration","enterToSend"))
        prefs.edit().putBoolean(key,value).apply();mutable.value=read()
        if(key=="message"&&!value || key=="noDisturb"&&value)(context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancelAll()
    }
    fun incoming(message:ChatMessage,foreground:Boolean) {
        val settings=state.value
        if(settings.noDisturb)return
        if(foreground) {
            if(settings.sound)runCatching{val tone=ToneGenerator(AudioManager.STREAM_NOTIFICATION,45);tone.startTone(ToneGenerator.TONE_PROP_BEEP,120);android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({tone.release()},220)}
            if(settings.vibration&&ContextCompat.checkSelfPermission(context,Manifest.permission.VIBRATE)==PackageManager.PERMISSION_GRANTED)runCatching{(context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator).vibrate(VibrationEffect.createOneShot(120,VibrationEffect.DEFAULT_AMPLITUDE))}
            return
        }
        if(!settings.message)return
        if(Build.VERSION.SDK_INT>=33&&ContextCompat.checkSelfPermission(context,Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)return
        val manager=context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(NotificationChannel("native_messages","新消息",NotificationManager.IMPORTANCE_DEFAULT))
        val intent=context.packageManager.getLaunchIntentForPackage(context.packageName)
        val pending=intent?.let{android.app.PendingIntent.getActivity(context,0,it,android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE)}
        val notification=NotificationCompat.Builder(context,"native_messages").setSmallIcon(R.drawable.uni_logo).setContentTitle(message.sender.ifBlank{"易可聊"}).setContentText(message.text).setAutoCancel(true).setContentIntent(pending).build()
        manager.notify(message.id.hashCode(),notification)
    }
}
