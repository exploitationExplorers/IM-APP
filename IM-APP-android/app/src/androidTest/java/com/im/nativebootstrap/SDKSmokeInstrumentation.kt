package com.im.nativebootstrap

import android.app.Activity
import android.app.Application
import android.app.Instrumentation
import android.os.Bundle
import io.openim.android.sdk.OpenIMClient
import io.openim.android.sdk.enums.LogLevel
import io.openim.android.sdk.listener.OnBase
import io.openim.android.sdk.listener.OnConnListener
import io.openim.android.sdk.models.ConversationInfo
import io.openim.android.sdk.models.InitConfig
import open_im_sdk.Open_im_sdk
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** 测试 APK 专属 runner。无登录凭据、无生产地址，断网运行。 */
class SDKSmokeInstrumentation:Instrumentation() {
    override fun onCreate(arguments:Bundle?) { super.onCreate(arguments);start() }
    override fun onStart() {
        val output=Bundle()
        val sdk=OpenIMClient.getInstance()
        try {
            val application=targetContext.applicationContext as Application
            val directory=File(application.filesDir,"sdk-smoke").apply { check(mkdirs()||isDirectory) }
            val version=Open_im_sdk.getSdkVersion()
            check(version.isNotBlank())
            val config=InitConfig("https://127.0.0.1:1","wss://127.0.0.1:1",directory.absolutePath).apply { logLevel=LogLevel.Fatal;isLogStandardOutput=false;logFilePath=directory.absolutePath }
            check(sdk.initSDK(application,config,object:OnConnListener{})) { "SDK init returned false" }
            val status=sdk.loginStatus
            check(status.toLong()!=Open_im_sdk.Logged) { "Smoke unexpectedly logged in" }
            val latch=CountDownLatch(1)
            var errorCode=0
            sdk.conversationManager.getConversationListSplit(object:OnBase<List<ConversationInfo>> {
                override fun onSuccess(data:List<ConversationInfo>) { latch.countDown() }
                override fun onError(code:Int,error:String?) { errorCode=code;latch.countDown() }
            },0,1)
            check(latch.await(15,TimeUnit.SECONDS)) { "SDK query callback timed out" }
            check(errorCode!=0) { "Unauthenticated query did not report resource error" }
            sdk.unInit()
            check(sdk.initSDK(application,config,object:OnConnListener{})) { "SDK reinit returned false" }
            sdk.unInit()
            output.putString("sdkVersion",version)
            output.putInt("unauthenticatedQueryError",errorCode)
            output.putInt("loginStatus",status)
            output.putString("smoke","passed: native version, init, unauthenticated callback, uninit, reinit, uninit")
            finish(Activity.RESULT_OK,output)
        } catch (error:Throwable) {
            try { sdk.unInit() } catch (_:Throwable) {}
            output.putString("smoke","failed")
            output.putString("failureType",error.javaClass.simpleName)
            output.putString("reason",error.message?.take(200))
            finish(Activity.RESULT_CANCELED,output)
        }
    }
}
