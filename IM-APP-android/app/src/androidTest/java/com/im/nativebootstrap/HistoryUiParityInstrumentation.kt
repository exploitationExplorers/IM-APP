package com.im.nativebootstrap

import android.app.Activity
import android.app.Instrumentation
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Rect
import android.os.Bundle
import android.os.SystemClock
import android.view.InputDevice
import android.view.MotionEvent
import android.view.accessibility.AccessibilityNodeInfo
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import com.google.gson.JsonArray
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.im.nativebootstrap.business.*
import com.im.nativebootstrap.chat.*
import kotlinx.coroutines.*
import java.io.File
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.abs

/** 只使用本地合成传输；检查真实设置行、通讯录和聊天 Composable 的交互。 */
class HistoryUiParityInstrumentation:Instrumentation() {
    override fun onCreate(arguments:Bundle?) {super.onCreate(arguments);start()}
    override fun onStart() {
        val result=Bundle()
        val scope=CoroutineScope(SupervisorJob()+Dispatchers.Main.immediate)
        var activity:MainActivity?=null
        uiAutomation.serviceInfo=uiAutomation.serviceInfo.apply {flags=flags or android.accessibilityservice.AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS}
        try {
            File(targetContext.cacheDir,"history-ui-anchor-samples.txt").writeText("")
            File(targetContext.cacheDir,"history-ui-contact-requests.txt").writeText("")
            activity=startActivitySync(Intent(targetContext,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
            val screen=activity
            val settings=java.util.concurrent.atomic.AtomicReference(obj("requireFriendApproval" to false,"requireGroupApproval" to false))
            val saved=CopyOnWriteArrayList<JsonObject>()
            val privacy=BusinessController(scope,{method,path,body,_->
                check(path=="/me/privacy-settings") {"Unexpected privacy request: $path"}
                if(method=="POST") {settings.set(body!!.deepCopy());saved+=body.deepCopy()} else check(method=="GET")
                settings.get().deepCopy()
            },{_,_,_,_->error("No real chat permitted")},{})
            runOnMainSync {privacy.open("privacy")}
            runOnMainSync {screen.setContent {MaterialTheme {
                val configuration=Configuration(LocalConfiguration.current).apply {screenWidthDp=360;fontScale=1.3f}
                val density=LocalDensity.current.density
                CompositionLocalProvider(LocalConfiguration provides configuration,LocalDensity provides Density(density,1.3f)) {
                    val state by privacy.state.collectAsState()
                    Column(Modifier.width(360.dp).fillMaxHeight().background(Color.White).statusBarsPadding().navigationBarsPadding()) {
                        Text("隐私交互验证 · 360dp / 字体 1.3")
                        PrivacyToggleRow("加我为好友需验证",state.detail.flag("requireFriendApproval",true),state.privacyEditable) {privacy.savePrivacy("requireFriendApproval",it)}
                        PrivacyToggleRow("邀请我加入群聊需验证",state.detail.flag("requireGroupApproval",true),state.privacyEditable) {privacy.savePrivacy("requireGroupApproval",it)}
                    }
                }
            }}}
            await("both unchecked privacy switches") {
                listOf("加我为好友需验证","邀请我加入群聊需验证").all {findDescription(it)?.let {node->node.isCheckable&&!node.isChecked&&node.isEnabled}==true}
            }
            for(title in listOf("加我为好友需验证","邀请我加入群聊需验证")) {
                val rect=bounds(findDescription(title)!!)
                check(rect.width()>0&&rect.height()>0&&rect.left>=0&&rect.right<=screen.resources.displayMetrics.widthPixels) {"Privacy switch clipped: $title $rect"}
            }
            screenshot("privacy-off-360-font130")
            clickDescription("邀请我加入群聊需验证")
            await("group setting saved and reloaded") {saved.size==1&&privacy.state.value.privacyEditable&&privacy.state.value.detail.flag("requireGroupApproval")&&findDescription("邀请我加入群聊需验证")?.isChecked==true}
            check(!saved.last().flag("requireFriendApproval",true)) {"Group switch changed friend setting"}
            clickDescription("邀请我加入群聊需验证")
            await("group setting can be disabled again") {saved.size==2&&privacy.state.value.privacyEditable&&!privacy.state.value.detail.flag("requireGroupApproval",true)&&findDescription("邀请我加入群聊需验证")?.isChecked==false}
            clickDescription("加我为好友需验证")
            await("friend switch independently saved") {saved.size==3&&privacy.state.value.detail.flag("requireFriendApproval")&&privacy.state.value.privacyEditable}
            check(!saved.last().flag("requireGroupApproval",true)) {"Friend switch changed group setting"}
            screenshot("privacy-saved")
            result.putString("privacySwitches","passed: both actual switches visible when off at 360dp/fontScale1.3; clicks persist both boolean fields and reload confirmed settings")

            val contactPages=AtomicInteger()
            val contactCursors=CopyOnWriteArrayList<String>()
            val directory=BusinessController(scope,{method,path,_,query->
                check(method=="GET"||path=="/friend-requests/sync")
                when(path) {
                    "/contacts"->{
                        val cursor=query["cursor"].orEmpty();contactCursors+=cursor
                        val count=contactPages.incrementAndGet()
                        contactDiagnostic("REQUEST$count cursor='$cursor'")
                        val first=cursor.isBlank();val people=(if(first)1..24 else 25..40).joinToString(",") {"""{"id":"fixture-contact-$it","nickname":"分页联系人 $it"}"""}
                        JsonParser.parseString("""{"items":[$people],"total":${if(first)80 else 0},"hasMore":$first,"nextCursor":"${if(first)"next" else ""}"}""")
                    }
                    "/groups"->JsonArray()
                    "/friend-requests/sync"->obj("pending" to JsonArray(),"recent" to JsonArray())
                    else->error("Unexpected directory fixture: $path")
                }
            },{_,_,_,_->error("No real chat permitted")},{})
            runOnMainSync {screen.setContent {MaterialTheme {Box(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {ContactsHome(directory)}}}}
            await("initial contact count") {findText("联络人 (80)")!=null&&directory.state.value.items.size==24}
            repeat(5) {waitForIdleSync();SystemClock.sleep(100)}
            contactDiagnostic("INITIAL pages=${contactPages.get()} cursors=$contactCursors items=${directory.state.value.items.size} loading=${directory.state.value.loading}\n"+tree(uiAutomation.rootInActiveWindow))
            check(contactCursors.toList()==listOf("")) {"Initial idle directory repeated requests: $contactCursors"}
            repeat(16) {step->
                if(directory.state.value.items.size<40) {
                    contactDiagnostic("SCROLL_FORWARD$step pages=${contactPages.get()} cursors=$contactCursors items=${directory.state.value.items.size} loading=${directory.state.value.loading}")
                    scrollDirectory(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)
                }
            }
            await("zero-total second contact page") {directory.state.value.items.size==40&&!directory.state.value.loading}
            repeat(5) {waitForIdleSync();SystemClock.sleep(100)}
            contactDiagnostic("SECOND_PAGE pages=${contactPages.get()} cursors=$contactCursors items=${directory.state.value.items.size} loading=${directory.state.value.loading}\n"+tree(uiAutomation.rootInActiveWindow))
            check(contactPages.get()==2&&contactCursors.toList()==listOf("","next")) {"Unexpected contact requests: count=${contactPages.get()} cursors=$contactCursors"}
            check(directory.state.value.total==80)
            repeat(16) {if(findText("联络人 (80)")==null)scrollDirectory(AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD)}
            await("preserved contact heading after pagination") {findText("联络人 (80)")!=null}
            check(contactPages.get()==2) {"Returning to directory heading unexpectedly refreshed: $contactCursors"}
            check(findText("联络人 (0)")==null)
            screenshot("contact-pagination-count")
            result.putString("contactPagination","passed: actual directory scroll loads page2(total=0), retains first-page total80 and renders the preserved heading")

            // 先通过列表动作回到绝对顶部，再以真实触摸跨过用户下拉阈值。
            for(step in 0 until 16) {
                val list=findVisible {it.isScrollable&&it.actionList.any {action->action.id==AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD}} ?: break
                if(!list.performAction(AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD))break
                waitForIdleSync();SystemClock.sleep(120)
            }
            await("directory absolute top before user refresh") {findText("新的朋友")!=null}
            repeat(5) {waitForIdleSync();SystemClock.sleep(100)}
            check(contactCursors.toList()==listOf("","next")) {"Programmatic return to top refreshed directory: $contactCursors"}
            contactDiagnostic("USER_PULL_BEGIN pages=${contactPages.get()} cursors=$contactCursors items=${directory.state.value.items.size}")
            swipe(screen,older=true)
            await("one real user pull refresh") {contactPages.get()>=3&&directory.state.value.items.size==24&&!directory.state.value.loading}
            repeat(5) {waitForIdleSync();SystemClock.sleep(100)}
            contactDiagnostic("USER_PULL_END pages=${contactPages.get()} cursors=$contactCursors items=${directory.state.value.items.size}\n"+tree(uiAutomation.rootInActiveWindow))
            check(contactPages.get()==3&&contactCursors.toList()==listOf("","next","")) {"User pull triggered extra requests: $contactCursors"}
            screenshot("directory-user-pull-refresh")
            result.putString("userPullRefresh","passed: real touch pull beyond threshold at directory top adds exactly one first-page request; remains exactly3 total requests after500ms idle")

            val historyCalls=AtomicInteger()
            val target=ChatTarget("si_history-ui-fixture",1,"history-fixture-peer")
            fun messages(first:Int,last:Int)=(first..last).map {
                val text="历史消息 ${it.toString().padStart(3,'0')}"
                ChatMessage("history-$it",text,false,1_700_000_000_000L+it*60_000L,seq=it.toLong(),serialized="""{"clientMsgID":"history-$it","contentType":101,"textElem":{"content":"$text"}}""",sender="历史测试")
            }
            val history=mutableStateOf(ChatState(ready=true,loggedIn=true,connection=ConnectionState.CONNECTED,active=ChatConversation(target,"连续历史交互验证","",0),messages=messages(161,200)))
            var finishPage:(()->Unit)?=null
            val callbacks=NativeChatCallbacks({}, {
                check(finishPage==null) {"Concurrent duplicate history request"}
                historyCalls.incrementAndGet()
                history.value=history.value.copy(historyLoading=true)
                finishPage={
                    val current=history.value
                    val first=current.messages.first().id.removePrefix("history-").toInt()
                    check(first>1)
                    val next=messages(maxOf(1,first-40),first-1)+current.messages
                    finishPage=null
                    history.value=current.copy(messages=next,historyLoading=false,historyEnd=next.size==200,historyRevision=current.historyRevision+1)
                }
            },{_,_,done->done(false)},{_,done->done(false)},{},{_,_,done->done(Result.success(Unit))},{_,_,done->done(Result.success(Unit))},{})
            runOnMainSync {screen.setContent {MaterialTheme {NativeChatRoom(history.value,callbacks)}}}
            await("initial recent message") {findText("历史消息 200")!=null}
            repeat(6) {waitForIdleSync();SystemClock.sleep(100)}
            check(historyCalls.get()==0) {"Initial idle chat scanned history without user scroll"}
            check(findText("点击加载更早消息")==null)
            for(page in 1..4) {
                repeat(16) {
                    if(historyCalls.get()<page) {swipe(screen,older=true);waitForIdleSync()}
                }
                await("automatic history request $page") {historyCalls.get()==page&&history.value.historyLoading}
                // 主线程 idle 不代表 fling 或 Accessibility 快照已停止，先取连续稳定的真实可见位置。
                val (text,before)=stableHistoryAnchor("before-page$page",screen) {"size=${history.value.messages.size} calls=${historyCalls.get()} loading=${history.value.historyLoading}"}
                anchorDiagnostic("before-page$page text=$text rect=$before size=${history.value.messages.size} calls=${historyCalls.get()}")
                runOnMainSync {(finishPage ?: error("Missing pending history page"))()}
                await("page$page data committed") {history.value.messages.size==40+page*40&&!history.value.historyLoading}
                val (_,after)=stableHistoryAnchor("after-page$page",screen,text) {"size=${history.value.messages.size} calls=${historyCalls.get()} loading=${history.value.historyLoading}"}
                anchorDiagnostic("after-page$page text=$text rect=$after size=${history.value.messages.size} calls=${historyCalls.get()}")
                check(abs(after.top-before.top)<=8&&abs(after.bottom-before.bottom)<=8) {"History anchor jumped: $text $before -> $after"}
                check(findText("点击加载更早消息")==null&&findText("读取历史中…")==null)
                check(historyCalls.get()==page) {"Idle page completion scanned another page"}
                if(page==1)screenshot("history-anchor-page1")
            }
            check(history.value.messages.size==200&&history.value.historyEnd)
            screenshot("history-200-messages")
            result.putString("continuousHistory","passed: actual chat starts40 without idle scan; user scroll automatically loads4 older pages to200; prepends keep visible message bounds within8px; no click-to-load text or duplicate page request")

            runOnMainSync {screen.setContent {MaterialTheme {
                val scale=UniScale(LocalConfiguration.current.screenWidthDp.toFloat())
                Column(Modifier.fillMaxSize().background(Color.White).statusBarsPadding().navigationBarsPadding().padding(24.dp),verticalArrangement=Arrangement.spacedBy(24.dp)) {
                    Text("未读角标验证")
                    Row(horizontalArrangement=Arrangement.spacedBy(32.dp),verticalAlignment=Alignment.CenterVertically) {
                        listOf(1,52,100).forEach {NativeUnreadBadge(it,scale)}
                        NativeUnreadBadge(52,scale,muted=true)
                    }
                }
            }}}
            await("all unread badges") {listOf("未读 1","未读 52","未读 99+").all {findDescription(it)!=null}}
            val badges=listOf("未读 1","未读 52","未读 99+").map {bounds(findDescription(it)!!)}
            check(badges.all {it.width()>0&&abs(it.width()-it.height())<=1}) {"Unread badge became a vertical pill: $badges"}
            check(badges.map {it.width()}.distinct().size==1) {"Conversation unread badge size changes with count: $badges"}
            check(findText("99+")!=null)
            val muted=bounds(findDescription("免打扰，有未读消息") ?: error("Missing muted unread dot"))
            check(abs(muted.width()-muted.height())<=1&&muted.width() in 1 until badges.first().width()/2) {"Muted unread marker is not a smaller circular dot: $muted"}
            screenshot("unread-circles")
            result.putString("unreadBadges","passed: actual1/52/99+ badges have equal square circle bounds and show99+ cap; muted unread uses a smaller circular dot")
            result.putString("historyUiParity","passed: local synthetic privacy/contact/history/unread interactions")
            result.putString("scope","No account login, backend or remote history request; excludes real-phone frame timing and pixel equivalence")
            finish(Activity.RESULT_OK,result)
        } catch(error:Throwable) {
            runCatching {screenshot("failure")}
            runCatching {File(targetContext.cacheDir,"history-ui-failure.txt").writeText(error.stackTraceToString()+"\n"+tree(uiAutomation.rootInActiveWindow))}
            result.putString("historyUiParity","failed: ${error.javaClass.simpleName}: ${error.message}")
            finish(Activity.RESULT_CANCELED,result)
        } finally {scope.cancel();activity?.let {runOnMainSync {it.finish()}}}
    }
    private fun await(label:String,predicate:()->Boolean) {
        repeat(50) {waitForIdleSync();if(predicate())return;SystemClock.sleep(100)}
        File(targetContext.cacheDir,"history-ui-timeout.txt").writeText(label+"\n"+tree(uiAutomation.rootInActiveWindow))
        error("Timed out: $label")
    }
    private fun find(node:AccessibilityNodeInfo?,predicate:(AccessibilityNodeInfo)->Boolean):AccessibilityNodeInfo? {
        if(node==null)return null
        if(!node.refresh())return null
        if(predicate(node))return node
        for(index in 0 until node.childCount)find(node.getChild(index),predicate)?.let {return it}
        return null
    }
    private fun findVisible(predicate:(AccessibilityNodeInfo)->Boolean):AccessibilityNodeInfo? {
        find(uiAutomation.rootInActiveWindow) {it.isVisibleToUser&&predicate(it)}?.let {return it}
        return uiAutomation.windows.firstNotNullOfOrNull {find(it.root) {node->node.isVisibleToUser&&predicate(node)}}
    }
    private fun findText(text:String)=findVisible {it.text?.toString()==text}
    private fun findDescription(text:String)=findVisible {it.contentDescription?.toString()==text}
    private fun contactDiagnostic(value:String) {File(targetContext.cacheDir,"history-ui-contact-requests.txt").appendText("${SystemClock.uptimeMillis()} $value\n")}
    private fun scrollDirectory(action:Int) {
        val list=findVisible {it.isScrollable&&it.actionList.any {item->item.id==action}} ?: error("Directory list missing scroll action $action")
        check(list.performAction(action)) {"Directory list rejected scroll action $action"}
        waitForIdleSync();SystemClock.sleep(120)
    }
    private fun clickDescription(description:String) {
        var node=findDescription(description) ?: error("Missing switch: $description")
        while(node.actionList.none {it.id==AccessibilityNodeInfo.ACTION_CLICK})node=node.parent ?: error("Switch has no click: $description")
        check(node.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {"Switch click rejected: $description"}
    }
    private fun visibleHistoryTexts():List<AccessibilityNodeInfo> {
        val list=mutableListOf<AccessibilityNodeInfo>()
        fun collect(node:AccessibilityNodeInfo?) {
            if(node==null)return
            if(!node.refresh())return
            if(node.isVisibleToUser&&node.text?.toString()?.startsWith("历史消息 ")==true)list+=node
            for(index in 0 until node.childCount)collect(node.getChild(index))
        }
        collect(uiAutomation.rootInActiveWindow)
        return list
    }
    private fun stableHistoryAnchor(label:String,screen:Activity,requested:String?=null,state:()->String):Pair<String,Rect> {
        var previous:Map<String,Rect>?=null
        var stable=0
        repeat(55) {sample->
            waitForIdleSync()
            val visible=visibleHistoryTexts().associate {it.text.toString() to bounds(it)}
            anchorSample("$label sample$sample ${state()} visible=$visible")
            stable=if(visible.isNotEmpty()&&visible==previous)stable+1 else 0
            previous=visible
            if(stable>=5) {
                val chosen=if(requested!=null)visible.entries.firstOrNull {it.key==requested} else visible.entries.firstOrNull {it.value.top>screen.resources.displayMetrics.heightPixels/4&&it.value.bottom<screen.resources.displayMetrics.heightPixels*3/4}
                if(chosen!=null)return chosen.key to Rect(chosen.value)
            }
            SystemClock.sleep(100)
        }
        anchorDiagnostic("UNSTABLE $label requested=$requested ${state()}")
        error("Visible message positions did not settle: $label requested=$requested")
    }
    private fun anchorSample(value:String) {File(targetContext.cacheDir,"history-ui-anchor-samples.txt").appendText("${SystemClock.uptimeMillis()} $value\n")}
    private fun anchorDiagnostic(value:String) {anchorSample(value+"\n"+tree(uiAutomation.rootInActiveWindow))}
    private fun bounds(node:AccessibilityNodeInfo)=Rect().also {node.getBoundsInScreen(it)}
    private fun swipe(screen:Activity,older:Boolean) {
        val metrics=screen.resources.displayMetrics
        val x=metrics.widthPixels*.56f
        val first=metrics.heightPixels*(if(older).33f else .76f)
        val last=metrics.heightPixels*(if(older).76f else .33f)
        val start=SystemClock.uptimeMillis()
        fun event(action:Int,y:Float) {MotionEvent.obtain(start,SystemClock.uptimeMillis(),action,x,y,0).also {it.source=InputDevice.SOURCE_TOUCHSCREEN;sendPointerSync(it);it.recycle()}}
        event(MotionEvent.ACTION_DOWN,first)
        for(step in 1..18) {SystemClock.sleep(20);event(MotionEvent.ACTION_MOVE,first+(last-first)*step/18)}
        event(MotionEvent.ACTION_UP,last)
        waitForIdleSync()
    }
    private fun screenshot(name:String) {
        val bitmap=uiAutomation.takeScreenshot() ?: error("Screenshot unavailable")
        File(targetContext.cacheDir,"history-ui-$name.png").outputStream().use {check(bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it))}
        bitmap.recycle()
    }
    private fun tree(node:AccessibilityNodeInfo?,depth:Int=0):String {
        if(node==null)return "null\n"
        if(depth>18)return "...\n"
        return buildString {
            append(" ".repeat(depth));append(node.text);append(" /");append(node.contentDescription);append(" checked=");append(node.isChecked);append(" bounds=");append(bounds(node));append('\n')
            for(index in 0 until node.childCount)append(tree(node.getChild(index),depth+1))
        }
    }
}
