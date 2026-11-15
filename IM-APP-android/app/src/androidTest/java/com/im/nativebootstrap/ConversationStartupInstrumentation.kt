package com.im.nativebootstrap

import android.app.Activity
import android.app.Application
import android.app.Instrumentation
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Rect
import android.os.Bundle
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModelStore
import com.im.nativebootstrap.chat.*
import com.im.nativebootstrap.core.AccountIdentity
import com.im.nativebootstrap.core.SecureSessionStore
import com.im.nativebootstrap.core.StoreStatus
import com.im.nativebootstrap.core.SyncStatus
import java.io.File
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.math.abs

/** 合成 SDK 驱动生产 Controller 和会话页，检查启动期间的完整快照与可见顺序。 */
class ConversationStartupInstrumentation:Instrumentation() {
    override fun onCreate(arguments:Bundle?) {super.onCreate(arguments);start()}

    override fun onStart() {
        val result=Bundle()
        var activity:MainActivity?=null
        var models:ViewModelStore?=null
        var controller:ChatController?=null
        val began=SystemClock.elapsedRealtime()
        val publishes=CopyOnWriteArrayList<Published>()
        val frames=CopyOnWriteArrayList<Published>()
        val gateway=StartupGateway()
        val state=mutableStateOf(ChatState())
        val timers=mutableListOf<Pair<Long,()->Unit>>()
        uiAutomation.serviceInfo=uiAutomation.serviceInfo.apply {flags=flags or android.accessibilityservice.AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS}
        try {
            // 专用无账号设备；不清理真实凭据，也不让 ViewModel 恢复任何服务端会话。
            check(SecureSessionStore(targetContext).load()==null&&SecureSessionStore(targetContext,"im_session").load()==null) {"Dedicated logged-out test device required"}
            File(targetContext.cacheDir,"conversation-startup-publishes.txt").writeText("")
            File(targetContext.cacheDir,"conversation-startup-frames.txt").writeText("")
            File(targetContext.cacheDir,"conversation-startup-visible.txt").writeText("")
            val fixtures=(1..243).map { index ->
                ChatConversation(
                    ChatTarget("si_startup-$index",1,"startup-peer-$index"),
                    "启动会话 ${index.toString().padStart(3,'0')}","本地消息 $index",
                    1_800_000_000_000L+index*73L,
                    unread=if(index%7==0)2 else 0,
                    pinned=index in setOf(11,97,203),
                    latestSeq=index.toLong(),
                )
            }
            // 243 个最新时间均在同一分钟；不能依赖界面 HH:mm 字符串决定顺序。
            check(fixtures.map {it.time/60_000}.distinct().size==1)
            val expected=(listOf(203,97,11)+(243 downTo 1).filterNot {it in setOf(11,97,203)}).map {"si_startup-$it"}
            val fixtureRows=fixtures.associateBy {it.target.conversationId}
            lateinit var model:BootstrapViewModel
            lateinit var runtime:ChatController
            runOnMainSync {
                models=ViewModelStore()
                model=BootstrapViewModel(targetContext.applicationContext as Application)
                models!!.put("startup-ui",model)
                runtime=ChatController(gateway,{it()},{delay,action->timers+=delay to action},{next->
                    publishes+=Published(SystemClock.elapsedRealtime()-began,next.conversations.map {it.target.conversationId})
                    state.value=next
                })
                controller=runtime
                runtime.start(AccountIdentity("startup-fixture-business","startup-fixture-im"),"https://startup.invalid/api/v1","synthetic-token","https://startup.invalid","wss://startup.invalid",File(targetContext.cacheDir,"conversation-startup-fixture"),43)
                gateway.events.connection(ConnectionState.DISCONNECTED)
                gateway.events.syncStarted()
                // 元数据通知甚至可早于 SDK 登录成功，不得把其中少数行当成首屏。
                gateway.events.conversations(listOf(fixtures[5],fixtures[202],fixtures[1]))
                gateway.login(Result.success(Unit))
            }
            check(gateway.snapshots.size==1&&gateway.pages.isEmpty()) {"Startup must request one complete local snapshot, not a split page"}
            activity=startActivitySync(Intent(targetContext,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
            val screen=activity
            runOnMainSync {screen.setContent {MaterialTheme {
                val configuration=Configuration(LocalConfiguration.current).apply {screenWidthDp=360}
                CompositionLocalProvider(LocalConfiguration provides configuration) {
                    val chat=state.value
                    SideEffect {frames+=Published(SystemClock.elapsedRealtime()-began,chat.conversations.map {it.target.conversationId})}
                    Box(Modifier.width(360.dp).fillMaxHeight()) {
                        UniHome(BootstrapState(authenticated=true,chat=chat),model,UniScale(360f),"chat",{}, {})
                    }
                }
            }}}
            settle()
            check(publishes.none {it.ids.isNotEmpty()}&&frames.none {it.ids.isNotEmpty()}&&visibleRows().isEmpty()) {"SDK subset appeared before the complete local snapshot"}
            for(batch in fixtures.shuffled(kotlin.random.Random(42)).chunked(41).take(3)) {
                runOnMainSync {gateway.events.conversations(batch.map {it.copy(unread=it.unread+1)})}
                settle()
                check(publishes.none {it.ids.isNotEmpty()}&&frames.none {it.ids.isNotEmpty()}&&visibleRows().isEmpty()) {"Early metadata batch leaked a partial startup list"}
            }
            val snapshotCompletedAt=SystemClock.elapsedRealtime()-began
            runOnMainSync {gateway.snapshots[0](Result.success(ConversationSnapshotPage(fixtures.shuffled(kotlin.random.Random(84)),true)))}
            await("complete offline first screen") {state.value.conversations.size==243&&state.value.store==StoreStatus.READABLE&&state.value.ready&&!state.value.conversationsLoading}
            check(state.value.connection==ConnectionState.DISCONNECTED&&state.value.sync==SyncStatus.RUNNING) {"Offline local read incorrectly waited for syncFinished"}
            assertOrder(state.value,expected,"initial local snapshot")
            check(publishes.filter {it.ids.isNotEmpty()}.all {it.ids==expected}) {"Initial publication was partial or reordered"}
            check(publishes.first {it.ids.isNotEmpty()}.ms>=snapshotCompletedAt)
            await("top local rows rendered") {visibleRows().take(4).map {it.title}==listOf("启动会话 203","启动会话 097","启动会话 011","启动会话 243")}
            val initialTop=stableRows("initial")
            screenshot("offline-full-first-screen")

            // 同一分钟不同毫秒，乱序批量未读更新不能变成最近活动。
            for((index,batch) in fixtures.shuffled(kotlin.random.Random(93)).chunked(29).withIndex()) {
                runOnMainSync {gateway.events.conversations(batch.map {it.copy(unread=if(index%2==0)0 else 5)})}
                assertOrder(state.value,expected,"metadata batch $index")
                val current=stableRows("metadata-$index")
                assertSameBounds(initialTop,current,"metadata batch $index")
            }

            // 同步完成触发完整本地重读，返回乱序但内容相同的行仍保持同样首屏。
            runOnMainSync {gateway.events.syncFinished()}
            check(gateway.snapshots.size==2&&gateway.pages.isEmpty()) {"Sync refresh reverted to a partial conversation page"}
            check(state.value.conversations.size==243)
            runOnMainSync {gateway.snapshots[1](Result.success(ConversationSnapshotPage(fixtures.shuffled(kotlin.random.Random(15)),true)))}
            await("complete refreshed snapshot") {!state.value.conversationsLoading&&state.value.sync==SyncStatus.COMPLETED}
            assertOrder(state.value,expected,"sync refresh")
            assertSameBounds(initialTop,stableRows("sync-refresh"),"sync refresh")
            check(publishes.filter {it.ids.isNotEmpty()}.all {it.ids==expected}) {"Metadata or refresh published an unexpected order"}
            check(frames.filter {it.ids.isNotEmpty()}.all {it.ids==expected}) {"Metadata or refresh composed a temporary wrong order"}
            screenshot("stable-after-sync-refresh")

            // 真正新消息应正常升到置顶会话之后，不能靠冻结列表掩盖错序。
            val promoted=fixtureRows.getValue("si_startup-5").copy(time=1_800_000_059_900L,latestSeq=10_005,preview="真正的新消息",unread=1)
            val updatedExpected=expected.take(3)+listOf(promoted.target.conversationId)+expected.drop(3).filterNot {it==promoted.target.conversationId}
            runOnMainSync {gateway.events.conversations(listOf(promoted))}
            assertOrder(state.value,updatedExpected,"real latest-message update")
            await("new message becomes first unpinned row") {visibleRows().take(4).map {it.title}==listOf("启动会话 203","启动会话 097","启动会话 011","启动会话 005")}
            stableRows("real-message")
            screenshot("real-message-promoted")
            // 用实际列表滚动触及最后一行，无分页点击和额外 SDK 查询。
            for(step in 0 until 80) {
                if(visibleRows().any {it.title=="启动会话 001"})break
                val list=findVisible {it.isScrollable&&it.actionList.any {action->action.id==AccessibilityNodeInfo.ACTION_SCROLL_FORWARD}} ?: error("Missing actual conversation scroll list")
                check(list.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)) {"Full local list stopped before final conversation"}
                waitForIdleSync();SystemClock.sleep(80)
            }
            await("last local conversation reachable") {visibleRows().any {it.title=="启动会话 001"}}
            check(findVisible {it.text?.toString()=="加载更多会话"}==null)
            check(gateway.snapshots.size==2&&gateway.pages.isEmpty()) {"Scrolling complete local rows caused another conversation query"}
            stableRows("last-local-row")
            screenshot("last-local-conversation")
            result.putString("conversationStartup","passed: actual Controller and UniHome render all243 local rows atomically despite pre-snapshot SDK batches; offline without syncFinished;9 shuffled metadata batches and full sync refresh preserve order and top bounds; real latest message promotes after3 pinned rows; actual scroll reaches last row without split-page query")
            result.putString("scope","Synthetic SDK only; no login/backend network calls; elapsed publication/composition samples are local regression evidence, not real-device performance benchmarks")
            result.putInt("localConversationCount",243)
            result.putLong("firstNonemptyPublishMs",publishes.first {it.ids.isNotEmpty()}.ms)
            finish(Activity.RESULT_OK,result)
        } catch(error:Throwable) {
            runCatching {screenshot("failure")}
            runCatching {File(targetContext.cacheDir,"conversation-startup-failure.txt").writeText(error.stackTraceToString()+"\n"+tree(uiAutomation.rootInActiveWindow))}
            result.putString("conversationStartup","failed: ${error.javaClass.simpleName}: ${error.message}")
            finish(Activity.RESULT_CANCELED,result)
        } finally {
            File(targetContext.cacheDir,"conversation-startup-publishes.txt").writeText(publishes.joinToString("\n") {"${it.ms}ms count=${it.ids.size} order=${it.ids.joinToString(",")}"})
            File(targetContext.cacheDir,"conversation-startup-frames.txt").writeText(frames.joinToString("\n") {"${it.ms}ms count=${it.ids.size} order=${it.ids.joinToString(",")}"})
            File(targetContext.cacheDir,"conversation-startup-diagnostics.txt").writeText(state.value.conversationDiagnostics.joinToString("\n"))
            runOnMainSync {controller?.logout();models?.clear();activity?.finish()}
        }
    }

    private data class Published(val ms:Long,val ids:List<String>)
    private data class VisibleRow(val title:String,val bounds:Rect)
    private fun assertOrder(state:ChatState,expected:List<String>,label:String) {
        check(state.conversations.map {it.target.conversationId}==expected) {"Conversation order mismatch: $label"}
    }
    private fun assertSameBounds(expected:List<VisibleRow>,current:List<VisibleRow>,label:String) {
        check(current.map {it.title}==expected.map {it.title}) {"Top visible titles changed: $label $expected -> $current"}
        expected.zip(current).forEach {(before,after)->check(abs(before.bounds.top-after.bounds.top)<=2&&abs(before.bounds.bottom-after.bounds.bottom)<=2&&abs(before.bounds.left-after.bounds.left)<=2&&abs(before.bounds.right-after.bounds.right)<=2) {"Top row moved: $label $before -> $after"}}
    }
    private fun settle() {repeat(3) {waitForIdleSync();SystemClock.sleep(70)}}
    private fun await(label:String,predicate:()->Boolean) {repeat(60) {waitForIdleSync();if(predicate())return;SystemClock.sleep(100)};error("Timed out: $label")}
    private fun stableRows(label:String):List<VisibleRow> {
        var previous=emptyList<VisibleRow>();var equal=0
        repeat(50) {
            waitForIdleSync();SystemClock.sleep(70)
            val current=visibleRows()
            if(current.isNotEmpty()&&current==previous)equal++ else equal=0
            previous=current
            if(equal>=3) {
                File(targetContext.cacheDir,"conversation-startup-visible.txt").appendText("${SystemClock.elapsedRealtime()} $label ${current.joinToString {row->"${row.title}:${row.bounds}"}}\n")
                return current
            }
        }
        error("Visible conversation rows did not settle: $label $previous")
    }
    private fun visibleRows():List<VisibleRow> {
        val rows=mutableMapOf<String,VisibleRow>()
        val title=Regex("启动会话 \\d{3}")
        fun visit(node:AccessibilityNodeInfo?) {
            if(node==null||!node.refresh())return
            if(node.isVisibleToUser) {
                val rect=bounds(node)
                if(rect.width()>0&&rect.height()>0)title.find(node.text?.toString().orEmpty())?.value?.let {text->
                    val prior=rows[text]
                    if(prior==null||rect.width().toLong()*rect.height()<prior.bounds.width().toLong()*prior.bounds.height())rows[text]=VisibleRow(text,rect)
                }
            }
            for(index in 0 until node.childCount)visit(node.getChild(index))
        }
        visit(uiAutomation.rootInActiveWindow)
        return rows.values.sortedBy {it.bounds.top}
    }
    private fun findVisible(predicate:(AccessibilityNodeInfo)->Boolean):AccessibilityNodeInfo? {
        fun find(node:AccessibilityNodeInfo?):AccessibilityNodeInfo? {
            if(node==null||!node.refresh())return null
            if(node.isVisibleToUser&&predicate(node))return node
            for(index in 0 until node.childCount)find(node.getChild(index))?.let {return it}
            return null
        }
        return find(uiAutomation.rootInActiveWindow)
    }
    private fun bounds(node:AccessibilityNodeInfo)=Rect().also {node.getBoundsInScreen(it)}
    private fun screenshot(name:String) {val bitmap=uiAutomation.takeScreenshot() ?: error("Screenshot unavailable");File(targetContext.cacheDir,"conversation-startup-$name.png").outputStream().use {check(bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it))};bitmap.recycle()}
    private fun tree(node:AccessibilityNodeInfo?,depth:Int=0):String {if(node==null)return "null\n";if(depth>18)return "...\n";return buildString {append(" ".repeat(depth));append(node.text);append('/');append(node.contentDescription);append(" bounds=");append(bounds(node));append('\n');for(index in 0 until node.childCount)append(tree(node.getChild(index),depth+1))}}

    private class StartupGateway:ChatGateway {
        lateinit var events:ChatEvents
        lateinit var login:(Result<Unit>)->Unit
        val snapshots=mutableListOf<(Result<ConversationSnapshotPage>)->Unit>()
        val pages=mutableListOf<Pair<Int,Int>>()
        override fun start(userId:String,token:String,api:String,ws:String,directory:File,events:ChatEvents,done:(Result<Unit>)->Unit) {this.events=events;login=done}
        override fun initialConversations(count:Int,done:(Result<ConversationSnapshotPage>)->Unit) {snapshots+=done}
        override fun conversations(offset:Int,count:Int,done:(Result<List<ChatConversation>>)->Unit) {pages+=offset to count;error("Complete local snapshot must not request a split page")}
        override fun history(target:ChatTarget,cursor:String?,count:Int,done:(Result<HistoryPage>)->Unit) {error("Conversation list must not request remote history")}
        override fun createText(text:String,target:ChatTarget):ChatMessage=error("No real sends permitted")
        override fun send(target:ChatTarget,serialized:String,done:(Result<ChatMessage>)->Unit) {error("No real sends permitted")}
        override fun find(target:ChatTarget,id:String,done:(Result<ChatMessage?>)->Unit) {done(Result.success(null))}
        override fun foreground(active:Boolean) {}
        override fun shutdown() {}
    }
}
