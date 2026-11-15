package com.im.nativebootstrap

import android.app.Activity
import android.app.Application
import android.app.Instrumentation
import android.os.Bundle
import android.os.SystemClock
import androidx.lifecycle.ViewModelStore
import com.im.nativebootstrap.core.*
import com.im.nativebootstrap.data.*
import java.io.File

/** 专用无账号模拟器：旧包内保存加密合成会话，覆盖安装后验证离线启动。 */
class BootstrapOfflineInstrumentation:Instrumentation() {
    private var seed=false
    override fun onCreate(arguments:Bundle?) { seed=arguments?.getString("phase")=="seed";super.onCreate(arguments);start() }
    override fun onStart() {
        val result=Bundle()
        val business=SecureSessionStore(targetContext)
        val im=SecureSessionStore(targetContext,"im_session")
        var models:ViewModelStore?=null
        try {
            val marker=File(targetContext.filesDir,"offline-upgrade-fixture.txt")
            val base="https://127.0.0.1:1/api/v1"
            val owner="offline-upgrade-owner"
            val imId="offline-upgrade-im"
            if(seed) {
                val existing=business.load()
                if(existing!=null)check(marker.isFile&&SessionPersistenceCodec.decode(existing).profile.businessUserId==owner) { "Dedicated test fixture required" }
                else check(im.load()==null) { "Unexpected SDK credentials" }
                business.save(SessionPersistenceCodec.encode(base,TokenPair("synthetic-access","synthetic-refresh",86400),BusinessProfile(owner,"离线升级测试")))
                // 保持只引用旧包中已有类；此阶段在 0.3.4 目标 APK 内执行。
                val raw="""{"schema":1,"owner":"$owner","scope":"${com.im.nativebootstrap.chat.AccountStorage.key(base,owner,imId)}","user":"$imId","token":"synthetic-offline-sdk-token","expiresAt":${System.currentTimeMillis()+86400000},"api":"https://127.0.0.1:1","ws":"wss://127.0.0.1:1"}"""
                im.save(raw)
                marker.writeText("preserve-on-upgrade")
                val original="https://oss-chat-test.xn--jprz53bj9s.com/oss-test/chat/offline-upgrade.png?OSSAccessKeyId=fixture&Signature=old&Expires=1"
                val imageScope=com.im.nativebootstrap.media.MediaCacheIdentity.scope(base,"offline-history-ui")
                val key=com.im.nativebootstrap.media.MediaCacheIdentity.key(original,imageScope,base)
                val saved=File(File(targetContext.cacheDir,"media-files-v2").apply { mkdirs() },key)
                val bitmap=android.graphics.Bitmap.createBitmap(160,120,android.graphics.Bitmap.Config.ARGB_8888).apply { eraseColor(android.graphics.Color.GREEN) }
                saved.outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it) };bitmap.recycle()
                File(targetContext.filesDir,"offline-history-ui-fixture.txt").writeText(original)
                check(!File(targetContext.noBackupFilesDir,"im_session.enc").readText().contains("synthetic-offline-sdk-token"))
                result.putString("offlineBootstrap","seeded: old APK encrypted session and unchanged account scope")
            } else {
                check(marker.readText()=="preserve-on-upgrade")
                val before=im.load()
                check(before!=null && business.load()!=null)
                lateinit var model:BootstrapViewModel
                val began=SystemClock.elapsedRealtime()
                runOnMainSync {
                    models=ViewModelStore()
                    model=BootstrapViewModel(targetContext.applicationContext as Application)
                    models!!.put("offline",model)
                }
                val deadline=began+5000
                while(SystemClock.elapsedRealtime()<deadline && !model.state.value.authenticated)Thread.sleep(20)
                check(model.state.value.authenticated && model.state.value.profile?.businessUserId==owner) { "Cached profile did not open offline" }
                val profileMs=SystemClock.elapsedRealtime()-began
                while(SystemClock.elapsedRealtime()<deadline && model.state.value.chat.store!=StoreStatus.READABLE)Thread.sleep(20)
                check(model.state.value.chat.store==StoreStatus.READABLE) { "Cached SDK session did not open local store" }
                check(im.load()==before && marker.readText()=="preserve-on-upgrade")
                result.putLong("cachedProfileMs",profileMs)
                result.putString("offlineBootstrap","passed: encrypted old-version session preserved across install -r; offline profile and actual SDK store restored")
                runOnMainSync { models?.clear();models=null }
                business.clear();im.clear();marker.delete()
            }
            finish(Activity.RESULT_OK,result)
        } catch(error:Throwable) {
            runOnMainSync { models?.clear() }
            result.putString("offlineBootstrap","failed: ${error.javaClass.simpleName}: ${error.message?.take(180)}")
            finish(Activity.RESULT_CANCELED,result)
        }
    }
}
