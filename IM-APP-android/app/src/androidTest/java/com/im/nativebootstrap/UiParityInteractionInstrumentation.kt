package com.im.nativebootstrap

import android.app.Activity
import android.app.Instrumentation
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Rect
import android.os.Bundle
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.Modifier
import com.google.gson.JsonParser
import com.im.nativebootstrap.business.BusinessController
import com.im.nativebootstrap.business.ContactsHome
import com.im.nativebootstrap.chat.*
import kotlinx.coroutines.*
import java.io.File
import java.util.concurrent.CopyOnWriteArrayList

/** 独立合成资料交互验证，不登录、不连接业务或 IM 服务。 */
class UiParityInteractionInstrumentation:Instrumentation() {
    override fun onCreate(arguments:Bundle?) { super.onCreate(arguments);start() }
    override fun onStart() {
        val result=Bundle()
        uiAutomation.serviceInfo=uiAutomation.serviceInfo.apply { flags=flags or android.accessibilityservice.AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS }
        val scope=CoroutineScope(SupervisorJob()+Dispatchers.Main.immediate)
        var activity:MainActivity?=null
        try {
            val people=(1..40).joinToString(",") { """{"id":"contact-$it","nickname":"通讯录好友 $it"}""" }
            val groups=(1..3).joinToString(",") { """{"id":"group-$it","name":"滚动群卡 $it","status":"active"}""" }
            val controller=BusinessController(scope,{method,path,_,_->
                check(method=="GET"||path=="/friend-requests/sync") { "Unexpected fixture mutation" }
                JsonParser.parseString(when(path) {
                    "/contacts" -> """{"items":[$people],"total":40,"hasMore":false}"""
                    "/groups" -> "[$groups]"
                    "/friend-requests/sync" -> """{"pending":[],"recent":[]}"""
                    else -> error("Unexpected fixture request: $path")
                })
            },{_,_,_,_->error("Fixture must not open a real chat")},{})
            activity=startActivitySync(Intent(targetContext,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
            val screen=activity
            runOnMainSync { screen.setContent { MaterialTheme {
                Box(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) { ContactsHome(controller) }
            } } }
            await("directory loaded") { findText("新的朋友")!=null&&findText("滚动群卡 3")!=null }
            val fixedSearch=bounds(findText("搜索") ?: error("Missing search"))
            val shortcut=findText("新的朋友") ?: error("Missing shortcut")
            val scrollable=ancestorWithAction(shortcut,AccessibilityNodeInfo.ACTION_SCROLL_FORWARD) ?: error("Directory shortcuts are outside the scrolling list")
            check(scrollable.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)) { "Directory did not scroll" }
            await("shortcuts scrolled away") { findText("新的朋友")==null&&find(uiAutomation.rootInActiveWindow) { it.isVisibleToUser&&it.text?.toString()?.startsWith("通讯录好友 ")==true }!=null }
            check(bounds(findText("搜索") ?: error("Search scrolled away"))==fixedSearch) { "Search must remain fixed" }
            repeat(3) {
                val list=findScrollable(uiAutomation.rootInActiveWindow) ?: error("Missing contact scroll container")
                check(list.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD))
                waitForIdleSync();SystemClock.sleep(120)
            }
            check(findText("滚动群卡 1")==null) { "Group cards stayed fixed above the list" }
            check(bounds(findText("搜索") ?: error("Search disappeared"))==fixedSearch)
            screenshot("contacts-scrolled")
            result.putString("directory","passed: shortcuts and group cards scroll with contacts; search stays fixed")

            val target=ChatTarget("si_menu-fixture",1,userId="fixture-peer")
            val message=ChatMessage("fixture-menu-message","菜单行为验证文本",true,System.currentTimeMillis(),seq=10,
                serialized="""{"clientMsgID":"fixture-menu-message","contentType":101,"textElem":{"content":"菜单行为验证文本"},"sendID":"fixture-self"}""",sender="测试发送者")
            val actions=CopyOnWriteArrayList<ChatAction>()
            val state=ChatState(ready=true,loggedIn=true,connection=ConnectionState.CONNECTED,active=ChatConversation(target,"菜单交互验证","",1),historyEnd=true,messages=listOf(message))
            val recalls=CopyOnWriteArrayList<String>()
            val callbacks=NativeChatCallbacks({}, {}, {_,_,done->done(false)}, {_,done->done(false)}, {},
                {_,action,done->actions+=action;done(Result.success(Unit))}, {_,_,done->done(Result.success(Unit))}, {},
                onRecall={value,_,done->recalls+=value.id;done(Result.failure(IllegalStateException("撤回失败测试")))})
            runOnMainSync { screen.setContent { MaterialTheme { NativeChatRoom(state,callbacks);NativeNoticeHost() } } }
            await("chat loaded") { findText(message.text)!=null }
            val day=bounds(findText("今天") ?: error("Missing date separator"))
            val messageBounds=bounds(findText(message.text) ?: error("Missing message"))
            check(day.bottom<=messageBounds.top) { "Date separator must be above the first message of its day" }
            fun openMenu() {
                await("message bubble available for long press") { findText(message.text)!=null }
                val bubble=ancestorWithAction(findText(message.text) ?: error("Message missing"),AccessibilityNodeInfo.ACTION_LONG_CLICK) ?: error("Message does not expose long press")
                check(bubble.performAction(AccessibilityNodeInfo.ACTION_LONG_CLICK))
                await("message menu") { findText("复制")!=null&&findText("引用")!=null&&findText("多选")!=null }
            }
            openMenu();screenshot("message-menu")
            click("复制")
            await("copy menu dismissed") { findText("复制")==null }
            runOnMainSync {
                val clipboard=targetContext.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                check(clipboard.primaryClip?.getItemAt(0)?.text?.toString()==message.text) { "Copy did not reach system clipboard" }
            }
            await("centered operation notice") { findText("已复制")!=null }
            val noticeRect=bounds(findText("已复制")!!)
            check(kotlin.math.abs(noticeRect.centerY()-screen.resources.displayMetrics.heightPixels/2)<100) { "Short operation notice is not centered: $noticeRect" }
            screenshot("centered-copy-notice")
            await("notice disappears automatically") { findText("已复制")==null }
            openMenu();click("选择文字")
            await("text selection dialog") { findText("复制全部")!=null }
            click("复制全部")
            await("text selection dismissed") { findText("复制全部")==null }
            openMenu();click("撤回")
            await("recall confirmation") { findText("确定撤回这条消息？")!=null }
            click("确定")
            await("recall failure centered notice") { recalls==listOf(message.id)&&findText("撤回失败测试")!=null }
            check(kotlin.math.abs(bounds(findText("撤回失败测试")!!).centerY()-screen.resources.displayMetrics.heightPixels/2)<100)
            await("recall failure disappears") { findText("撤回失败测试")==null }
            check(findText(message.text)!=null) { "Recall failure removed the message" }
            openMenu();click("引用")
            await("quoted message") { findText("回复 测试发送者：${message.text}")!=null }
            openMenu();click("收藏")
            await("favorite callback") { actions.contains(ChatAction.FAVORITE) }
            openMenu();click("置顶")
            await("pin scope") { findText("仅为我置顶")!=null }
            click("仅为我置顶")
            await("pin callback") { actions.contains(ChatAction.PIN_SELF) }
            openMenu();click("多选")
            await("multi toolbar") { findText("删除(1)")!=null&&findText("转发(1)")!=null }
            screenshot("message-multi")
            click("删除(1)")
            await("multi delete confirmation") { findText("删除 1 条本地消息？")!=null }
            click("删除")
            await("delete callback") { actions.contains(ChatAction.DELETE_LOCAL) }
            check(actions.count { it==ChatAction.DELETE_LOCAL }==1) { "Selection dispatched duplicate delete" }
            result.putString("messageMenu","passed: long press, system copy/selection, centered 3s notice, failed recall callback leaves message and expires notice, quote, favorite callback, pin scope/callback, multi toolbar and one delete dispatch")
            result.putString("scope","Synthetic local UI callbacks only; production server actions and media permissions are not exercised")
            finish(Activity.RESULT_OK,result)
        } catch(error:Throwable) {
            runCatching { screenshot("failure") }
            result.putString("interaction","failed: ${error.javaClass.simpleName}: ${error.message}")
            finish(Activity.RESULT_CANCELED,result)
        } finally {
            scope.cancel()
            activity?.let { screen->runOnMainSync { screen.finish() } }
        }
    }
    private fun await(label:String,predicate:()->Boolean) {
        repeat(40) { waitForIdleSync();if(predicate())return;SystemClock.sleep(100) }
        error("Timed out: $label")
    }
    private fun findText(text:String):AccessibilityNodeInfo? {
        val predicate:(AccessibilityNodeInfo)->Boolean={ it.isVisibleToUser&&it.text?.toString()==text }
        find(uiAutomation.rootInActiveWindow,predicate)?.let { return it }
        return uiAutomation.windows.firstNotNullOfOrNull { find(it.root,predicate) }
    }
    private fun find(node:AccessibilityNodeInfo?,predicate:(AccessibilityNodeInfo)->Boolean):AccessibilityNodeInfo? {
        if(node==null)return null
        if(predicate(node))return node
        for(index in 0 until node.childCount)find(node.getChild(index),predicate)?.let { return it }
        return null
    }
    private fun ancestorWithAction(node:AccessibilityNodeInfo,action:Int):AccessibilityNodeInfo? {
        var current:AccessibilityNodeInfo?=node
        while(current!=null) {
            if(current.actionList.any { it.id==action })return current
            current=current.parent
        }
        return null
    }
    private fun findScrollable(node:AccessibilityNodeInfo?)=find(node) { it.isScrollable&&it.isVisibleToUser }
    private fun click(text:String) {
        val label=findText(text) ?: error("Missing action: $text")
        val clickable=ancestorWithAction(label,AccessibilityNodeInfo.ACTION_CLICK) ?: error("Action is not clickable: $text")
        check(clickable.performAction(AccessibilityNodeInfo.ACTION_CLICK)) { "Action did not execute: $text" }
    }
    private fun bounds(node:AccessibilityNodeInfo)=Rect().also { node.getBoundsInScreen(it) }
    private fun screenshot(name:String) {
        val bitmap=uiAutomation.takeScreenshot() ?: error("Screenshot unavailable")
        File(targetContext.cacheDir,"ui-interaction-$name.png").outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it) }
        bitmap.recycle()
    }
}
