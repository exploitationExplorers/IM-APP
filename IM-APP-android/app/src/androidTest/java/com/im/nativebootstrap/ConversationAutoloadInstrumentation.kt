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

/** 空快照先于同步的本地回归：真实 Controller、真实 UniHome、可控 SDK 与虚拟计时器。 */
class ConversationAutoloadInstrumentation:Instrumentation() {
    override fun onCreate(arguments:Bundle?) {super.onCreate(arguments);start()}

    override fun onStart() {
        val result=Bundle()
        val began=SystemClock.elapsedRealtime()
        val publishes=CopyOnWriteArrayList<Sample>()
        val compositions=CopyOnWriteArrayList<Sample>()
        val steps=CopyOnWriteArrayList<String>()
        val state=mutableStateOf(ChatState())
        val gateway=AutoloadGateway()
        val timers=VirtualTimers()
        var activity:MainActivity?=null
        var models:ViewModelStore?=null
        var controller:ChatController?=null
        fun sample(chat:ChatState)=Sample(SystemClock.elapsedRealtime()-began,timers.now,chat.conversations.map {it.target.conversationId},chat.conversationsLoading,chat.sync)
        fun record(label:String) {steps+="${SystemClock.elapsedRealtime()-began}ms virtual=${timers.now} $label requests=${gateway.queries.size} inFlight=${gateway.inFlight} rows=${state.value.conversations.size} loading=${state.value.conversationsLoading} sync=${state.value.sync}"}
        fun saveEvidence() {
            File(targetContext.cacheDir,"conversation-autoload-publishes.txt").writeText(publishes.joinToString("\n",transform=Sample::line))
            File(targetContext.cacheDir,"conversation-autoload-compositions.txt").writeText(compositions.joinToString("\n",transform=Sample::line))
            File(targetContext.cacheDir,"conversation-autoload-steps.txt").writeText(steps.joinToString("\n")+"\n"+timers.trace.joinToString("\n")+"\n"+gateway.trace.joinToString("\n"))
            File(targetContext.cacheDir,"conversation-autoload-diagnostics.txt").writeText(state.value.conversationDiagnostics.joinToString("\n"))
        }
        uiAutomation.serviceInfo=uiAutomation.serviceInfo.apply {flags=flags or android.accessibilityservice.AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS}
        try {
            check(SecureSessionStore(targetContext).load()==null&&SecureSessionStore(targetContext,"im_session").load()==null) {"Dedicated logged-out test device required"}
            File(targetContext.cacheDir,"conversation-autoload-visible.txt").writeText("")
            val pinned=setOf(17,719,1_503)
            val rows=(1..2_000).map {index->ChatConversation(
                ChatTarget("si_autoload-$index",1,"autoload-peer-$index"),
                "补读会话 ${index.toString().padStart(4,'0')}","本地预览 $index",
                1_700_000_040_000L+index*7L,
                unread=if(index%11==0)1 else 0,pinned=index in pinned,latestSeq=index.toLong(),
            )}
            check(rows.map {it.time/60_000}.distinct().size==1)
            val expected=(listOf(1_503,719,17)+(2_000 downTo 1).filterNot {it in pinned}).map {"si_autoload-$it"}
            lateinit var model:BootstrapViewModel
            lateinit var runtime:ChatController
            runOnMainSync {
                models=ViewModelStore()
                model=BootstrapViewModel(targetContext.applicationContext as Application)
                models!!.put("autoload-ui",model)
                runtime=ChatController(gateway,{it()},{delay,action->timers.schedule(delay,action)},{chat->publishes+=sample(chat);state.value=chat})
                controller=runtime
                runtime.start(AccountIdentity("autoload-business","autoload-im"),"https://autoload.invalid/api/v1","synthetic-token","https://autoload.invalid","wss://autoload.invalid",File(targetContext.cacheDir,"conversation-autoload-fixture"),61)
                gateway.events.connection(ConnectionState.CONNECTED)
                gateway.login(Result.success(Unit))
                check(gateway.queries.size==1)
                gateway.complete(0,emptyList())
            }
            check(state.value.store==StoreStatus.READABLE&&state.value.conversationsEnd&&state.value.conversations.isEmpty())
            check(state.value.sync==SyncStatus.IDLE&&gateway.queries.size==1)
            record("early-query-returned-empty-before-sync")
            activity=startActivitySync(Intent(targetContext,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
            val screen=activity
            runOnMainSync {screen.setContent {MaterialTheme {
                val config=Configuration(LocalConfiguration.current).apply {screenWidthDp=360}
                CompositionLocalProvider(LocalConfiguration provides config) {
                    val chat=state.value
                    SideEffect {compositions+=sample(chat)}
                    Box(Modifier.width(360.dp).fillMaxHeight()) {UniHome(BootstrapState(authenticated=true,chat=chat),model,UniScale(360f),"chat",{}, {})}
                }
            }}}
            await("pre-sync preparing state") {hasText("正在准备会话…")}
            assertNoFalseEmpty()
            runOnMainSync {gateway.events.syncStarted();repeat(50) {gateway.events.syncProgress(it.toLong())}}
            await("syncing empty state") {hasText("正在同步会话…")}
            assertNoFalseEmpty()
            check(gateway.queries.size==1) {"Progress events started duplicate reads before the scheduled retry"}
            record("sync-started-after-empty-query")
            screenshot("syncing-empty")

            runOnMainSync {timers.fireDelay(1_000)}
            check(gateway.queries.size==2&&gateway.inFlight==1) {"1s automatic recovery did not start one local read"}
            assertNoFalseEmpty()
            runOnMainSync {gateway.complete(1,emptyList())}
            await("first retry remains syncing, not falsely empty") {hasText("正在同步会话…")&&!state.value.conversationsLoading}
            assertNoFalseEmpty()
            record("first-automatic-retry-still-empty")
            runOnMainSync {timers.fireDelay(2_000)}
            check(gateway.queries.size==3&&gateway.inFlight==1) {"2s automatic recovery did not start the next local read"}
            check(timers.now==3_000L)
            // 查询在途的 50 次刷新及同步完成只能留下一个待执行刷新。
            runOnMainSync {repeat(50) {runtime.loadConversations(true)};gateway.events.syncFinished()}
            check(gateway.queries.size==3&&gateway.inFlight==1) {"In-flight refreshes ran concurrent SDK reads"}
            record("50-refreshes-and-sync-finish-coalesced")
            runOnMainSync {gateway.complete(2,rows.shuffled(kotlin.random.Random(61)))}
            check(gateway.queries.size==4&&gateway.inFlight==1&&gateway.maxInFlight==1) {"Refreshes did not coalesce into exactly one pending local read"}
            assertOrder(state.value,expected,"automatic full recovery")
            check(state.value.ready&&state.value.store==StoreStatus.READABLE&&state.value.sync==SyncStatus.COMPLETED)
            await("recovered local rows shown without manual refresh") {visibleRows().take(4).map {it.title}==listOf("补读会话 1503","补读会话 0719","补读会话 0017","补读会话 2000")}
            assertNoFalseEmpty()
            val initialTop=stableRows("recovered-with-follow-up-in-flight")
            check(publishes.filter {it.ids.isNotEmpty()}.all {it.ids==expected}) {"Recovery exposed a partial list"}
            screenshot("recovered-2000")

            // 后续完整查询仍在途时，新消息先到；旧查询结果不得覆盖新时间和预览。
            val promoted=rows[4].copy(time=1_700_000_099_900L,latestSeq=20_005,preview="查询期间真正的新消息",unread=2)
            val promotedOrder=expected.take(3)+promoted.target.conversationId+expected.drop(3).filterNot {it==promoted.target.conversationId}
            runOnMainSync {gateway.events.conversations(listOf(promoted))}
            assertOrder(state.value,promotedOrder,"new event during pending read")
            val publishesBeforeStaleReturn=publishes.size
            runOnMainSync {gateway.complete(3,rows.shuffled(kotlin.random.Random(92)))}
            check(!state.value.conversationsLoading&&gateway.queries.size==4&&gateway.inFlight==0)
            assertOrder(state.value,promotedOrder,"stale snapshot cannot overwrite live event")
            check(state.value.conversations.first {it.target==promoted.target}.let {it.time==promoted.time&&it.latestSeq==promoted.latestSeq&&it.preview==promoted.preview})
            check(publishes.drop(publishesBeforeStaleReturn).all {it.ids==promotedOrder})
            await("real message remains first unpinned") {visibleRows().take(4).map {it.title}==listOf("补读会话 1503","补读会话 0719","补读会话 0017","补读会话 0005")}
            val promotedTop=stableRows("live-event-survives-old-query")
            assertBounds(initialTop.take(3),promotedTop.take(3),"pinned rows after new message")
            record("stale-local-read-preserved-new-event")
            screenshot("new-message-protected")

            // 重复未变化通知不触发 changed 回调，也不触发一次无意义重组。
            settle()
            val identical=state.value.conversations.toList()
            val beforeRepeatedPublish=publishes.size
            val beforeRepeatedComposition=compositions.size
            runOnMainSync {repeat(30) {gateway.events.conversations(identical)}}
            settle()
            check(publishes.size==beforeRepeatedPublish) {"Identical SDK events republished UI ${publishes.size-beforeRepeatedPublish} times"}
            check(compositions.size==beforeRepeatedComposition) {"Identical SDK events recomposed the conversation screen"}
            check(gateway.queries.size==4) {"Unchanged SDK events caused local rereads"}
            record("30-identical-2000-row-events-no-ui-publish")

            val metadata=state.value.conversations.map {it.copy(unread=if(it.unread==9)0 else 9)}.shuffled(kotlin.random.Random(12))
            val beforeMetadata=publishes.size
            for((index,batch) in metadata.chunked(250).withIndex()) {
                runOnMainSync {gateway.events.conversations(batch)}
                assertOrder(state.value,promotedOrder,"metadata batch $index")
                assertBounds(promotedTop,stableRows("metadata-$index"),"metadata batch $index")
                assertNoFalseEmpty()
            }
            check(publishes.drop(beforeMetadata).all {it.ids==promotedOrder&&it.ids.size==2_000}) {"Metadata batches changed order or cleared local list"}
            check(state.value.conversations.all {it.unread==9}) {"Not all 2000 metadata changes reached the state"}
            record("all-2000-metadata-updated-order-stable")
            screenshot("metadata-stable")

            // 真实 LazyColumn 滚动多页；时间仅记录合成样本，不给设备性能设虚假阈值。
            val firstVisible=visibleRows().map {it.title}
            val scrollSamples=mutableListOf<Long>()
            repeat(10) {index->
                val list=findVisible {it.isScrollable&&it.actionList.any {action->action.id==AccessibilityNodeInfo.ACTION_SCROLL_FORWARD}} ?: error("Missing actual conversation list")
                val started=SystemClock.elapsedRealtime()
                check(list.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)) {"Conversation list failed to scroll at page $index"}
                val current=stableRows("scroll-page-$index")
                scrollSamples+=SystemClock.elapsedRealtime()-started
                check(current.isNotEmpty()) {"Scrolling produced no visible local rows"}
                assertOrder(state.value,promotedOrder,"scroll page $index")
            }
            check(visibleRows().map {it.title}!=firstVisible) {"Scroll actions did not move the actual list"}
            check(gateway.queries.size==4&&gateway.maxInFlight==1&&gateway.splitCalls==0) {"Scrolling issued extra SDK queries"}
            File(targetContext.cacheDir,"conversation-autoload-scroll.txt").writeText("Synthetic ACTION_SCROLL_FORWARD plus accessibility-settle elapsed ms; not frame time or real-device latency.\n"+scrollSamples.mapIndexed {index,ms->"page=$index sampleMs=$ms"}.joinToString("\n"))
            screenshot("scrolled-local-list")
            record("actual-list-scroll-10-pages-complete")
            result.putString("conversationAutoload","passed: empty local snapshot before sync automatically rereads at1s then2s; actual UniHome recovers2000 rows without manual refresh;50 refreshes and syncFinish coalesce into1 pending read; stale query preserves new event;30 identical2000-row events publish nothing;2000 metadata changes preserve order and top bounds; actual list scrolls10 pages without new queries")
            result.putString("scope","Local synthetic SDK and virtual recovery clock only; no backend/account/history/send operations; scroll timing samples do not establish real-phone frame performance")
            result.putInt("localConversationCount",2_000)
            result.putInt("localQueryCount",gateway.queries.size)
            result.putInt("maxConcurrentQueries",gateway.maxInFlight)
            saveEvidence()
            finish(Activity.RESULT_OK,result)
        } catch(error:Throwable) {
            runCatching {screenshot("failure")}
            runCatching {File(targetContext.cacheDir,"conversation-autoload-failure.txt").writeText(error.stackTraceToString()+"\n"+tree(uiAutomation.rootInActiveWindow))}
            result.putString("conversationAutoload","failed: ${error.javaClass.simpleName}: ${error.message}")
            runCatching {record("failure");saveEvidence()}
            finish(Activity.RESULT_CANCELED,result)
        } finally {runOnMainSync {controller?.logout();models?.clear();activity?.finish()}}
    }

    private data class Sample(val ms:Long,val virtualMs:Long,val ids:List<String>,val loading:Boolean,val sync:SyncStatus) {
        fun line()="${ms}ms virtual=$virtualMs count=${ids.size} loading=$loading sync=$sync order=${ids.joinToString(",")}"
    }
    private data class VisibleRow(val title:String,val bounds:Rect)
    private fun assertOrder(chat:ChatState,expected:List<String>,label:String) {check(chat.conversations.map {it.target.conversationId}==expected) {"Conversation order mismatch: $label"}}
    private fun assertBounds(expected:List<VisibleRow>,current:List<VisibleRow>,label:String) {
        check(expected.map {it.title}==current.map {it.title}) {"Visible row titles changed: $label $expected -> $current"}
        expected.zip(current).forEach {(a,b)->check(abs(a.bounds.top-b.bounds.top)<=2&&abs(a.bounds.bottom-b.bounds.bottom)<=2&&abs(a.bounds.left-b.bounds.left)<=2&&abs(a.bounds.right-b.bounds.right)<=2) {"Visible row bounds changed: $label $a -> $b"}}
    }
    private fun assertNoFalseEmpty() {check(findVisible {node->val text=node.text?.toString().orEmpty();text.contains("暂无对话")||text.contains("点击重试")}==null) {"False empty/retry state shown during automatic local recovery"}}
    private fun hasText(text:String)=findVisible {it.text?.toString()==text}!=null
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
                File(targetContext.cacheDir,"conversation-autoload-visible.txt").appendText("${SystemClock.elapsedRealtime()} $label ${current.joinToString {row->"${row.title}:${row.bounds}"}}\n")
                return current
            }
        }
        error("Visible local rows did not settle: $label $previous")
    }
    private fun visibleRows():List<VisibleRow> {
        val rows=mutableMapOf<String,VisibleRow>();val pattern=Regex("补读会话 \\d{4}")
        fun visit(node:AccessibilityNodeInfo?) {
            if(node==null||!node.refresh())return
            if(node.isVisibleToUser) {
                val rect=bounds(node)
                if(rect.width()>0&&rect.height()>0)pattern.find(node.text?.toString().orEmpty())?.value?.let {title->
                    val prior=rows[title]
                    if(prior==null||rect.width().toLong()*rect.height()<prior.bounds.width().toLong()*prior.bounds.height())rows[title]=VisibleRow(title,rect)
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
    private fun screenshot(name:String) {val image=uiAutomation.takeScreenshot() ?: error("Screenshot unavailable");File(targetContext.cacheDir,"conversation-autoload-$name.png").outputStream().use {check(image.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it))};image.recycle()}
    private fun tree(node:AccessibilityNodeInfo?,depth:Int=0):String {if(node==null)return "null\n";if(depth>18)return "...\n";return buildString {append(" ".repeat(depth));append(node.text);append('/');append(node.contentDescription);append(" bounds=");append(bounds(node));append('\n');for(index in 0 until node.childCount)append(tree(node.getChild(index),depth+1))}}

    private class VirtualTimers {
        data class Timer(val delay:Long,val due:Long,val action:()->Unit,var fired:Boolean=false)
        var now=0L;private set
        private val pending=mutableListOf<Timer>()
        val trace=mutableListOf<String>()
        fun schedule(delay:Long,action:()->Unit) {pending+=Timer(delay,now+delay,action);trace+="schedule virtual=$now delay=$delay"}
        fun fireDelay(delay:Long) {
            val matching=pending.filter {!it.fired&&it.delay==delay}
            check(matching.size==1) {"Expected one recovery timer delay=$delay but found ${matching.size}"}
            val timer=matching.single();timer.fired=true;now=timer.due
            trace+="fire virtual=$now delay=$delay";timer.action()
        }
    }
    private class AutoloadGateway:ChatGateway {
        lateinit var events:ChatEvents
        lateinit var login:(Result<Unit>)->Unit
        private data class Query(val callback:(Result<ConversationSnapshotPage>)->Unit,var completed:Boolean=false)
        private val pending=mutableListOf<Query>()
        val queries:List<Int> get()=pending.indices.toList()
        var inFlight=0;private set
        var maxInFlight=0;private set
        var splitCalls=0;private set
        val trace=mutableListOf<String>()
        override fun start(userId:String,token:String,api:String,ws:String,directory:File,events:ChatEvents,done:(Result<Unit>)->Unit) {this.events=events;login=done}
        override fun initialConversations(count:Int,done:(Result<ConversationSnapshotPage>)->Unit) {pending+=Query(done);inFlight++;maxInFlight=maxOf(maxInFlight,inFlight);trace+="query index=${pending.lastIndex} inFlight=$inFlight"}
        fun complete(index:Int,rows:List<ChatConversation>) {
            val query=pending[index];check(!query.completed);query.completed=true;inFlight--
            trace+="complete index=$index rows=${rows.size} remaining=$inFlight";query.callback(Result.success(ConversationSnapshotPage(rows,true)))
        }
        override fun conversations(offset:Int,count:Int,done:(Result<List<ChatConversation>>)->Unit) {splitCalls++;error("Complete local recovery must not request split conversation pages")}
        override fun history(target:ChatTarget,cursor:String?,count:Int,done:(Result<HistoryPage>)->Unit) {error("No remote history permitted")}
        override fun createText(text:String,target:ChatTarget):ChatMessage=error("No sends permitted")
        override fun send(target:ChatTarget,serialized:String,done:(Result<ChatMessage>)->Unit) {error("No sends permitted")}
        override fun find(target:ChatTarget,id:String,done:(Result<ChatMessage?>)->Unit) {done(Result.success(null))}
        override fun foreground(active:Boolean) {}
        override fun shutdown() {}
    }
}
