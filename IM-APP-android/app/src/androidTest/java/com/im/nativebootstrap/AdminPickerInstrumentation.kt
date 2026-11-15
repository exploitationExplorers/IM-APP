package com.im.nativebootstrap

import android.app.Activity
import android.app.Instrumentation
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Rect
import android.os.Bundle
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import com.google.gson.JsonArray
import com.google.gson.JsonObject
import com.im.nativebootstrap.business.*
import kotlinx.coroutines.*
import java.io.File
import java.util.concurrent.CopyOnWriteArrayList

/** 管理员选择页本地交互：不登录、不调用任何业务服务器。 */
class AdminPickerInstrumentation:Instrumentation() {
    override fun onCreate(arguments:Bundle?) {super.onCreate(arguments);start()}
    override fun onStart() {
        val result=Bundle();val scope=CoroutineScope(SupervisorJob()+Dispatchers.Main.immediate)
        var activity:MainActivity?=null
        uiAutomation.serviceInfo=uiAutomation.serviceInfo.apply {flags=flags or android.accessibilityservice.AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS}
        try {
            val saved=CopyOnWriteArrayList<Pair<String,JsonObject>>()
            val members=(1..70).map {obj("id" to "member-$it","role" to "member","nickname" to "成员 ${it.toString().padStart(2,'0')}","groupNickname" to "群昵称 ${it.toString().padStart(2,'0')}","memberRemark" to if(it==1)"备注成员 01" else "")}
            val controller=BusinessController(scope,{method,path,body,query->
                when {
                    method=="PUT"->{check(path.matches(Regex("/groups/fixture-admin-group/members/member-(1|70)/role")));check(body!!.text("role")=="admin");saved+=path to body.deepCopy();com.google.gson.JsonNull.INSTANCE}
                    path=="/group-members"->{
                        val first=query["cursor"].isNullOrBlank();val page=if(first)members.take(35) else members.drop(35)
                        obj("items" to JsonArray().apply {page.forEach{add(it)};if(first){add(obj("id" to "owner","role" to "owner","nickname" to "群主不可选"));add(obj("id" to "existing-admin","role" to "admin","nickname" to "管理员不可选"))}},"hasMore" to first,"nextCursor" to if(first)"page2" else "")
                    }
                    else->error("Unexpected fixture request: $method $path")
                }
            },{_,_,_,_->error("Must not open real chat")},{})
            runOnMainSync {controller.open("admins","fixture-admin-group");controller.open("admin-add","fixture-admin-group")}
            activity=startActivitySync(Intent(targetContext,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
            val screen=activity
            runOnMainSync {screen.setContent {MaterialTheme {
                val configuration=Configuration(LocalConfiguration.current).apply {screenWidthDp=360;fontScale=1.3f}
                val density=LocalDensity.current.density
                CompositionLocalProvider(LocalConfiguration provides configuration,LocalDensity provides Density(density,1.3f)) {
                    val state by controller.state.collectAsState()
                    Column(Modifier.width(360.dp).fillMaxHeight().background(Color.White).statusBarsPadding().navigationBarsPadding()) {
                        Text("新增群组管理员")
                        AdminMemberPicker(state,controller,Modifier.weight(1f))
                    }
                }
            }}}
            await("70 selectable members with fixed confirm") {findText("可选成员 (70)")!=null&&findText("备注成员 01")!=null&&findDescription("确认添加管理员")!=null}
            check(findText("群主不可选")==null&&findText("管理员不可选")==null)
            val button=bounds(findDescription("确认添加管理员")!!)
            check(button.bottom<=screen.resources.displayMetrics.heightPixels&&button.height()>0)
            val avatar=bounds(findDescription("备注成员 01的头像") ?: error("Missing actual avatar"))
            check(avatar.width()>0&&avatar.width()==avatar.height()) {"Avatar bounds are not square: $avatar"}
            val selector=bounds(findDescription("选择备注成员 01") ?: error("Missing circular selection marker"))
            check(selector.width()>0&&selector.width()==selector.height())
            screenshot("initial")
            clickText("备注成员 01")
            await("first member selected") {memberChecked("备注成员 01")&&findDescription("确认添加管理员")?.isEnabled==true}
            repeat(18) {
                if(findText("群昵称 70")==null) {
                    val list=findScrollable(uiAutomation.rootInActiveWindow) ?: error("Missing lazy member list")
                    check(list.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)) {"Member list did not scroll"}
                    waitForIdleSync();SystemClock.sleep(80)
                }
                check(bounds(findDescription("确认添加管理员") ?: error("Confirm scrolled away"))==button) {"Confirm moved with list"}
            }
            await("last member reachable") {findText("群昵称 70")!=null}
            clickText("群昵称 70")
            await("last member selected after scroll") {memberChecked("群昵称 70")&&findDescription("确认添加管理员")?.isEnabled==true}
            screenshot("scrolled-fixed-confirm")
            val editor=findVisible {it.isEditable} ?: error("Missing search editor")
            check(editor.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT,Bundle().apply {putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,"备注成员")}))
            await("local search retains selection") {findText("可选成员 (1)")!=null&&memberChecked("备注成员 01")&&findDescription("确认添加管理员")?.isEnabled==true}
            check(memberChecked("备注成员 01")) {"Search lost selected first member"}
            check(bounds(findDescription("确认添加管理员")!!)==button)
            screenshot("search-selection-retained")
            clickDescription("确认添加管理员")
            await("actual business controller writes both role changes") {saved.size==2&&controller.state.value.route.page=="admins"&&!controller.state.value.loading}
            check(saved.map{it.first}.toSet()==setOf("/groups/fixture-admin-group/members/member-1/role","/groups/fixture-admin-group/members/member-70/role"))
            check(saved.all{it.second.text("role")=="admin"})
            result.putString("adminPicker","passed: actual 70-member picker at360dp/fontScale1.3 renders avatars and circle selectors; fixed confirm stays visible; scroll/search preserve both selections; controller saves only selected member1/member70 as admin")
            result.putString("scope","Local synthetic transport only; no backend account or real group mutation; screenshots do not establish pixel equivalence")
            finish(Activity.RESULT_OK,result)
        } catch(error:Throwable) {
            runCatching {screenshot("failure")}
            runCatching {File(targetContext.cacheDir,"admin-picker-failure.txt").writeText(error.stackTraceToString()+"\n"+tree(uiAutomation.rootInActiveWindow))}
            result.putString("adminPicker","failed: ${error.javaClass.simpleName}: ${error.message}")
            finish(Activity.RESULT_CANCELED,result)
        } finally {scope.cancel();activity?.let {runOnMainSync {it.finish()}}}
    }
    private fun await(label:String,predicate:()->Boolean) {repeat(50) {waitForIdleSync();if(predicate())return;SystemClock.sleep(100)};error("Timed out: $label")}
    private fun find(node:AccessibilityNodeInfo?,predicate:(AccessibilityNodeInfo)->Boolean):AccessibilityNodeInfo? {
        if(node==null)return null
        // Compose 的按钮子文本可能仍是旧缓存；每次从实时节点读取选择/启用状态。
        if(!node.refresh())return null
        if(predicate(node))return node
        for(index in 0 until node.childCount)find(node.getChild(index),predicate)?.let{return it}
        return null
    }
    private fun findVisible(predicate:(AccessibilityNodeInfo)->Boolean):AccessibilityNodeInfo? {
        find(uiAutomation.rootInActiveWindow){it.isVisibleToUser&&predicate(it)}?.let{return it}
        return uiAutomation.windows.firstNotNullOfOrNull {find(it.root){node->node.isVisibleToUser&&predicate(node)}}
    }
    private fun findText(text:String)=findVisible{it.text?.toString()==text}
    private fun findDescription(description:String)=findVisible{it.contentDescription?.toString()==description}
    private fun memberChecked(name:String):Boolean {
        val row=findText(name)?.let{ancestorWithAction(it,AccessibilityNodeInfo.ACTION_CLICK)} ?: return false
        return row.refresh()&&row.isCheckable&&row.isChecked
    }
    private fun findScrollable(root:AccessibilityNodeInfo?)=find(root){it.isScrollable&&it.isVisibleToUser}
    private fun ancestorWithAction(node:AccessibilityNodeInfo,action:Int):AccessibilityNodeInfo? {var current:AccessibilityNodeInfo?=node;while(current!=null){if(current.actionList.any{it.id==action})return current;current=current.parent};return null}
    private fun clickText(text:String) {check((ancestorWithAction(findText(text) ?: error("Missing text $text"),AccessibilityNodeInfo.ACTION_CLICK) ?: error("Not clickable $text")).performAction(AccessibilityNodeInfo.ACTION_CLICK))}
    private fun clickDescription(description:String) {check((ancestorWithAction(findDescription(description) ?: error("Missing description $description"),AccessibilityNodeInfo.ACTION_CLICK) ?: error("Not clickable $description")).performAction(AccessibilityNodeInfo.ACTION_CLICK))}
    private fun bounds(node:AccessibilityNodeInfo)=Rect().also{node.getBoundsInScreen(it)}
    private fun screenshot(name:String) {val bitmap=uiAutomation.takeScreenshot() ?: error("Screenshot unavailable");File(targetContext.cacheDir,"admin-picker-$name.png").outputStream().use {check(bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it))};bitmap.recycle()}
    private fun tree(node:AccessibilityNodeInfo?,depth:Int=0):String {if(node==null)return "null\n";if(depth>18)return "...\n";return buildString {append(" ".repeat(depth));append(node.text);append('/');append(node.contentDescription);append(" checked=");append(node.isChecked);append(" bounds=");append(bounds(node));append('\n');for(index in 0 until node.childCount)append(tree(node.getChild(index),depth+1))}}
}
