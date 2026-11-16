package com.im.nativebootstrap

import android.app.Activity
import android.app.Application
import android.app.Instrumentation
import android.os.Bundle
import io.openim.android.sdk.OpenIMClient
import io.openim.android.sdk.enums.LogLevel
import io.openim.android.sdk.enums.ViewType
import io.openim.android.sdk.listener.OnBase
import io.openim.android.sdk.listener.OnConnListener
import io.openim.android.sdk.models.ConversationInfo
import io.openim.android.sdk.models.InitConfig
import io.openim.android.sdk.models.Message
import io.openim.android.sdk.models.TextElem
import io.openim.android.sdk.models.AttachedInfoElem
import io.openim.android.sdk.models.AdvancedMessage
import io.openim.android.sdk.models.SearchResult
import com.google.gson.JsonParser
import open_im_sdk.Open_im_sdk
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** 测试 APK 专属 runner。无登录凭据、无生产地址，断网运行。 */
class SDKSmokeInstrumentation:Instrumentation() {
    private var offlineRestart=false
    private var fixtureStage="smoke-init"
    override fun onCreate(arguments:Bundle?) { offlineRestart=arguments?.getString("offlineRestart")=="true";super.onCreate(arguments);start() }
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
            verifyOfflineStore(application,sdk,output,offlineRestart)
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
            output.putString("fixtureStage",fixtureStage)
            output.putString("reason",error.message?.take(1600))
            finish(Activity.RESULT_CANCELED,output)
        }
    }
    private fun <T> awaitSdk(start:(OnBase<T>)->Unit):T {
        val done=CountDownLatch(1);var result:Result<T>?=null
        start(object:OnBase<T> {
            override fun onSuccess(data:T) { result=Result.success(data);done.countDown() }
            override fun onError(code:Int,error:String?) { result=Result.failure(IllegalStateException("SDK $fixtureStage failed: $code: ${error.orEmpty().take(1400)}"));done.countDown() }
        })
        check(done.await(30,TimeUnit.SECONDS)) { "SDK $fixtureStage callback timed out" }
        return result!!.getOrThrow()
    }
    private fun verifyOfflineStore(application:Application,sdk:OpenIMClient,output:Bundle,restartOnly:Boolean) {
        val owner="offline-sdk-fixture-owner";val peer="offline-sdk-fixture-peer"
        val directory=File(application.filesDir,"sdk-offline-history-fixture").apply { check(mkdirs()||isDirectory) }
        val marker=File(directory,"inserted-client-id.txt")
        val config=InitConfig("https://127.0.0.1:1","wss://127.0.0.1:1",directory.absolutePath).apply { logLevel=LogLevel.Fatal;isLogStandardOutput=false;logFilePath=directory.absolutePath }
        fun login() {
            fixtureStage="offline-init"
            check(sdk.initSDK(application,config,object:OnConnListener{}))
            fixtureStage="offline-login"
            awaitSdk<String> { sdk.login(it,owner,"synthetic-offline-token") }
            check(sdk.loginStatus.toLong()==Open_im_sdk.Logged)
        }
        login()
        // 真实 Core 的参数拒绝：无收件人时在建表和网络发送前返回，不能永远挂成待核对。
        fixtureStage="offline-send-preflight-rejection"
        val rejected=CountDownLatch(1);var rejectedCode=0
        sdk.messageManager.sendMessageNotOss(object:io.openim.android.sdk.listener.OnMsgSendCallback {
            override fun onSuccess(data:Message) { rejected.countDown() }
            override fun onError(code:Int,error:String?) { rejectedCode=code;rejected.countDown() }
        },Message().apply { clientMsgID="offline-invalid-target";contentType=102;sendID=owner;status=1 },"","",com.im.nativebootstrap.chat.OpenIMSendOptions.push(),false)
        check(rejected.await(10,TimeUnit.SECONDS)&&rejectedCode==10002) { "Unexpected SDK preflight rejection: $rejectedCode" }
        output.putString("sendPreflight","passed: actual SDK rejects missing target with 10002 before submission")
        val conversationId=sdk.conversationManager.getConversationIDBySessionType(peer,1)
        if(!restartOnly&&!marker.isFile) {
            // SDK 的 insert 不为新会话建表；查询不存在的游标由 SDK GetMessage 初始化表。
            fixtureStage="offline-init-conversation-table"
            val initialized=CountDownLatch(1);var missingCode=0;var missingError=""
            sdk.messageManager.getAdvancedHistoryMessageList(object:OnBase<AdvancedMessage> {
                override fun onSuccess(data:AdvancedMessage) { initialized.countDown() }
                override fun onError(code:Int,error:String?) { missingCode=code;missingError=error.orEmpty();initialized.countDown() }
            },conversationId,Message().apply { clientMsgID="offline-fixture-missing-cursor" },1,ViewType.History)
            // 固定 Core 的 gorm not-found 被包装成 UnknownCode(10005)，必须同时验证具体错误。
            check(initialized.await(5,TimeUnit.SECONDS)&&missingCode==10005&&missingError.contains("record not found",ignoreCase=true)) {
                "SDK missing cursor query failed: $missingCode: ${missingError.take(1400)}"
            }
            // 新合成账号尚无 SDK 个人资料，createTextMessage 会尝试读取 sender profile。
            // 官方 insert API 支持公开 Message 模型；由 SDK 分配正式 ID、时间和本地表记录。
            val draft=Message().apply {
                contentType=101;sessionType=1;msgFrom=100;platformID=2
                sendID=peer;recvID=owner;senderNickname="Offline fixture peer";senderFaceUrl=""
                createTime=System.currentTimeMillis();sendTime=createTime;status=2;seq=0
                textElem=TextElem().apply { content="offline native history fixture" }
                attachedInfoElem=AttachedInfoElem()
            }
            // 固定 wrapper 用 StringBase 原样透传 Core json.Marshal(MsgStruct) 的结果。
            fixtureStage="offline-insert"
            val inserted=JsonParser.parseString(awaitSdk<String> { sdk.messageManager.insertSingleMessageToLocalStorage(it,draft,owner,peer) }).asJsonObject
            val insertedId=inserted.get("clientMsgID")?.asString.orEmpty()
            check(insertedId.isNotBlank()&&inserted.get("contentType")?.asInt==101) { "SDK insert returned invalid message JSON" }
            // 插入 API 将会话更新排入 SDK 队列；确认其已持久可查后再 unInit。
            val deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(5)
            var committed=false
            while(System.nanoTime()<deadline&&!committed) {
                fixtureStage="offline-conversation-commit"
                committed=awaitSdk<List<ConversationInfo>> { sdk.conversationManager.getConversationListSplit(it,0,30) }.any { it.conversationID==conversationId }
                if(!committed)Thread.sleep(50)
            }
            check(committed) { "SDK inserted conversation was not persisted" }
            marker.writeText(insertedId)
        }
        check(marker.isFile) { "Run fixture seed before offlineRestart" }
        fixtureStage="offline-logout-before-restart"
        awaitSdk<String> { sdk.logout(it) }
        sdk.unInit();login()
        val expected=marker.readText()
        fixtureStage="offline-restart-search"
        val result=awaitSdk<SearchResult> { sdk.messageManager.searchLocalMessages(it,conversationId,emptyList(),0,emptyList(),listOf(101),0,0,1,40) }
        val rows=result.searchResultItems.orEmpty().filter { it.conversationID==conversationId }.flatMap { it.messageList.orEmpty() }
        check(rows.any { it.clientMsgID==expected&&it.textElem?.content=="offline native history fixture" }) { "Restarted local SDK message was not readable" }
        fixtureStage="offline-gateway-find-by-id"
        val lookup=CountDownLatch(1);var lookedUp:Result<com.im.nativebootstrap.chat.ChatMessage?>?=null
        com.im.nativebootstrap.chat.OpenIMGateway(application).find(com.im.nativebootstrap.chat.ChatTarget(conversationId,1,peer),expected) {
            lookedUp=it;lookup.countDown()
        }
        check(lookup.await(10,TimeUnit.SECONDS)) { "Gateway find callback timed out" }
        val mapped=lookedUp!!.getOrThrow()
        check(mapped?.id==expected&&mapped.text=="offline native history fixture"&&mapped.status==2) { "Gateway find did not map persisted SDK status" }
        output.putString("sendLookup","passed: production gateway finds exact persisted SDK ID, body and status")
        fixtureStage="offline-restart-conversations"
        val conversations=awaitSdk<List<ConversationInfo>> { sdk.conversationManager.getConversationListSplit(it,0,30) }
        check(conversations.any { it.conversationID==conversationId })
        // 同一 runner 也用于旧 APK 建立覆盖升级基线；旧版没有新增 Gateway 方法。
        if(application.packageManager.getPackageInfo(application.packageName,0).longVersionCode>=13) {
        fixtureStage="offline-restart-full-snapshot-gateway"
        val snapshotLatch=CountDownLatch(1)
        var complete:Result<com.im.nativebootstrap.chat.ConversationSnapshotPage>?=null
        val snapshotGateway=com.im.nativebootstrap.chat.OpenIMGateway(application)
        snapshotGateway.initialConversations(30) {
            complete=it;snapshotLatch.countDown()
        }
        try {check(snapshotLatch.await(10,TimeUnit.SECONDS)) {"Full local snapshot gateway callback timed out"}}
        finally {snapshotGateway.shutdown()}
        val full=complete!!.getOrThrow()
        check(full.end&&full.items.any {it.target.conversationId==conversationId&&it.latestMessage?.id==expected}) {"Full snapshot did not include the persisted SDK conversation and exact message"}
        output.putString("fullLocalSnapshot","passed: production gateway getAllConversationList reads persisted SDK conversation and latest ID after loopback-only restart")
        }
        fixtureStage="offline-final-logout"
        awaitSdk<String> { sdk.logout(it) }
        sdk.unInit()
        output.putString("offlineStore","passed: loopback login, official local insert, logout/uninit, relogin, local search and conversations")
        output.putString("offlineRestart",restartOnly.toString())
    }
}
