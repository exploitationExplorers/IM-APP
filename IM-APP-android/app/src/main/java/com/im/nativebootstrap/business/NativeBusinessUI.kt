package com.im.nativebootstrap.business

import com.im.nativebootstrap.AppTheme
import com.im.nativebootstrap.C
import com.im.nativebootstrap.NativeNotices

import android.content.Intent
import android.provider.Settings
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.google.gson.JsonObject
import com.im.nativebootstrap.BootstrapViewModel
import com.im.nativebootstrap.data.BusinessProfile
import com.im.nativebootstrap.R
import com.im.nativebootstrap.media.SharedAvatar
import com.im.nativebootstrap.NativeChatArchive
import com.im.nativebootstrap.NativeFavoriteContent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import kotlinx.coroutines.launch

// 必须是 getter：顶层 val 会把浅色值一次性快照，深色切换后不再跟随。
private val Blue get()=C.primaryText
private val Body get()=C.text
private val Muted get()=C.faint
private val Page get()=C.page
private val Red get()=C.danger
private val routeTitles=mapOf("contacts" to "通讯录","mine" to "个人中心","requests" to "新的朋友","add-friend" to "添加朋友","add-group" to "添加群聊","friend" to "好友资料","user" to "个人资料","friend-remark" to "设置备注","friend-tags" to "设置标签","tags" to "标签","tag-members" to "标签详情","groups" to "群聊天","create-group" to "创建群聊","group" to "群组详情","group-admin" to "群管理","members" to "群成员","member" to "成员资料","invite" to "邀请朋友","admins" to "群管理员","join-requests" to "入群申请","group-name" to "群聊名称","group-id" to "修改群号","group-remark" to "群备注","group-nickname" to "我在本群的昵称","announcements" to "群公告","announcement-edit" to "发布群公告","group-qrcode" to "群二维码","profile" to "个人资料","edit-nickname" to "修改昵称","edit-bio" to "个性签名","edit-chat-id" to "修改聊天号","qrcode" to "我的二维码","favorites" to "我的收藏","notifications" to "通知设置","chat-settings" to "聊天设置","privacy" to "隐私","blacklist" to "黑名单","security" to "安全","general" to "通用","feedback" to "意见反馈","about" to "关于我们","debug" to "调试资讯","deletion" to "注销账号","report-user" to "举报用户","report-group" to "举报群聊","report-group-submit" to "举报群聊","common-groups" to "共同群聊","emotions" to "我的表情","scan" to "扫一扫","scan-result" to "扫码结果","scan-group-result" to "群聊扫码结果","onboarding" to "完善资料","admin-add" to "添加管理员","tag-add-members" to "添加标签成员","reset-password" to "重置密码","forgot-password" to "忘记密码","mass-assistant" to "群发助手","mass-select" to "选择收件人","mass-targets" to "收件人","mass-compose" to "发送消息")

@Composable private fun scale()=LocalConfiguration.current.screenWidthDp/750f
@Composable private fun OriginalIcon(name:String,modifier:Modifier=Modifier) {
    val context=LocalContext.current
    val id=remember(name){context.resources.getIdentifier(name,"drawable",context.packageName)}
    if(id!=0)Image(painterResource(id),null,modifier,contentScale=ContentScale.Fit)
}
@Composable private fun RowItem(title:String,value:String="",icon:String="",red:Boolean=false,enabled:Boolean=true,chevron:Boolean=true,onClick:()->Unit) {
    val s=scale()
    Row(Modifier.fillMaxWidth().heightIn(min=(96*s).dp).background(C.card).clickable(enabled=enabled,onClick=onClick).padding(horizontal=(32*s).dp,vertical=(20*s).dp),verticalAlignment=Alignment.CenterVertically) {
        if(icon.isNotBlank()){OriginalIcon(icon,Modifier.size((40*s).dp));Spacer(Modifier.width((16*s).dp))}
        Text(title,Modifier.weight(1f),fontSize=(30*s).sp,color=if(!enabled)Muted else if(red)Red else Body)
        if(value.isNotBlank())Text(value,Modifier.widthIn(max=(310*s).dp).padding(start=8.dp),fontSize=(28*s).sp,color=Muted,maxLines=1,overflow=TextOverflow.Ellipsis)
        if(enabled&&chevron) { Spacer(Modifier.width(8.dp));OriginalIcon("uni_mine_icon_chevron",Modifier.size((32*s).dp)) }
    }
}
@Composable private fun ProfileRow(title:String,value:String="",red:Boolean=false,chevron:Boolean=true,onClick:()->Unit) {
    val s=scale()
    Row(Modifier.fillMaxWidth().heightIn(min=(96*s).dp).background(C.card).clickable(onClick=onClick).padding(horizontal=(40*s).dp,vertical=(20*s).dp),verticalAlignment=Alignment.CenterVertically) {
        Text(title,fontSize=(34*s).sp,lineHeight=(48*s).sp,color=if(red)Red else Body)
        Text(value,Modifier.weight(1f).padding(start=(24*s).dp),fontSize=(34*s).sp,lineHeight=(48*s).sp,color=C.hint,maxLines=1,overflow=TextOverflow.Ellipsis,textAlign=androidx.compose.ui.text.style.TextAlign.End)
        if(chevron)OriginalIcon("uni_mine_icon_chevron",Modifier.padding(start=(8*s).dp).size((40*s).dp))
    }
}
@Composable private fun GeneralRow(title:String,value:String="",enabled:Boolean=true,onClick:()->Unit) {
    val s=scale()
    Row(Modifier.fillMaxWidth().heightIn(min=(96*s).dp).background(C.card).clickable(enabled=enabled,onClick=onClick).padding(horizontal=(32*s).dp,vertical=(28*s).dp),verticalAlignment=Alignment.CenterVertically) {
        Text(title,Modifier.weight(1f),fontSize=(30*s).sp,lineHeight=(44*s).sp,color=Body)
        if(value.isNotBlank())Text(value,fontSize=(28*s).sp,lineHeight=(40*s).sp,color=C.hint)
        OriginalIcon("uni_mine_icon_chevron",Modifier.padding(start=(16*s).dp).size((32*s).dp))
    }
}
@Composable private fun ContactsMenuRow(title:String,icon:String,badge:Int=0,onClick:()->Unit) {
    val s=scale()
    Row(Modifier.fillMaxWidth().height((96*s).dp).clickable(onClick=onClick).padding(horizontal=(40*s).dp),verticalAlignment=Alignment.CenterVertically) {
        OriginalIcon(icon,Modifier.size((40*s).dp))
        Text(title,Modifier.weight(1f).padding(start=(16*s).dp),fontSize=(34*s).sp,lineHeight=(48*s).sp,color=Body)
        if(badge>0)Box(Modifier.padding(end=(8*s).dp).height((32*s).dp).widthIn(min=(32*s).dp).clip(RoundedCornerShape((16*s).dp)).background(Color(0xFFEF4343)),contentAlignment=Alignment.Center){Text(if(badge>99)"99+" else badge.toString(),fontSize=(18*s).sp,lineHeight=(32*s).sp,color=Color.White,maxLines=1,softWrap=false,textAlign=androidx.compose.ui.text.style.TextAlign.Center,style=TextStyle(platformStyle=androidx.compose.ui.text.PlatformTextStyle(includeFontPadding=false)))}
        OriginalIcon("uni_icon_chevron",Modifier.size((40*s).dp))
    }
}
@Composable private fun DividerLine() { HorizontalDivider(color=C.field,thickness=.5.dp) }
@Composable private fun Section(text:String) { Text(text,Modifier.fillMaxWidth().background(Page).padding(horizontal=18.dp,vertical=12.dp),fontSize=13.sp,color=Muted) }
@Composable private fun Action(text:String,enabled:Boolean=true,red:Boolean=false,onClick:()->Unit) {
    Box(Modifier.fillMaxWidth().padding(horizontal=20.dp,vertical=10.dp).height(46.dp).clip(RoundedCornerShape(8.dp)).background(if(enabled)if(red)Red else C.primary else C.placeholder).clickable(enabled=enabled,onClick=onClick),contentAlignment=Alignment.Center) { Text(text,color=Color.White,fontSize=16.sp) }
}
/** H5 primary-btn：96rpx 高、8rpx 圆角、#0A2FC2 底、28rpx 半粗白字；horizontal 为两侧边距（rpx） */
@Composable private fun PrimaryButton(text:String,enabled:Boolean=true,horizontal:Int=40,onClick:()->Unit) {
    val s=scale()
    Box(Modifier.fillMaxWidth().padding(start=(horizontal*s).dp,end=(horizontal*s).dp,top=(16*s).dp,bottom=(16*s).dp).height((96*s).dp).clip(RoundedCornerShape((8*s).dp)).background(C.primary.copy(alpha=if(enabled)1f else .7f)).clickable(enabled=enabled,onClick=onClick),contentAlignment=Alignment.Center){Text(text,color=Color.White,fontSize=(28*s).sp,fontWeight=FontWeight.SemiBold)}
}
@Composable private fun Input(label:String,value:String,change:(String)->Unit,secret:Boolean=false,multiline:Boolean=false) {
    var reveal by remember(label){mutableStateOf(false)}
    Column(Modifier.fillMaxWidth().background(C.card).padding(horizontal=20.dp,vertical=12.dp)) {
        if(label.isNotBlank())Text(label,fontSize=13.sp,color=Muted,modifier=Modifier.padding(bottom=10.dp))
        Row(verticalAlignment=Alignment.CenterVertically){BasicTextField(value,change,Modifier.weight(1f).heightIn(min=32.dp).padding(vertical=6.dp),textStyle=TextStyle(fontSize=16.sp,color=Body),cursorBrush=SolidColor(Blue),singleLine=!multiline,visualTransformation=if(secret&&!reveal)PasswordVisualTransformation() else VisualTransformation.None,keyboardOptions=KeyboardOptions(keyboardType=if(secret)KeyboardType.Password else KeyboardType.Text));if(secret)TextButton(onClick={reveal=!reveal}){Text(if(reveal)"隐藏" else "显示",fontSize=12.sp)}}
        DividerLine()
    }
}
@Composable private fun PersonRow(person:JsonObject,subtitle:String="",trailing:(@Composable ()->Unit)?=null,onClick:()->Unit) {
    val s=scale()
    Row(Modifier.fillMaxWidth().background(C.card).clickable(onClick=onClick).padding(horizontal=(40*s).dp,vertical=(20*s).dp),verticalAlignment=Alignment.CenterVertically) {
        SharedAvatar(person.text("avatar").ifBlank {person.text("Avatar")},Modifier.size((88*s).dp).clip(CircleShape))
        Column(Modifier.weight(1f).padding(start=(24*s).dp)) {
            Text(person.displayName(),fontSize=(32*s).sp,color=Body,maxLines=1,overflow=TextOverflow.Ellipsis)
            if(subtitle.isNotBlank())Text(subtitle,Modifier.padding(top=5.dp),fontSize=12.sp,color=Muted,maxLines=2)
        }
        trailing?.invoke()
    }
}
@Composable private fun SearchBox(initial:String="",placeholder:String="搜索",auto:Boolean=false,original:Boolean=false,search:(String)->Unit) {
    var value by remember(initial){mutableStateOf(initial)}
    LaunchedEffect(value){if(auto&&value!=initial){kotlinx.coroutines.delay(300);search(value)}}
    if(original) {
        val s=scale()
        Row(Modifier.fillMaxWidth().padding(horizontal=(40*s).dp,vertical=(16*s).dp).height((72*s).dp).clip(RoundedCornerShape((8*s).dp)).background(C.field).padding(start=(32*s).dp,end=(24*s).dp),verticalAlignment=Alignment.CenterVertically) {
            Canvas(Modifier.size(16.dp).padding(end=(2*s).dp)) {val stroke=2.dp.toPx();val radius=size.minDimension*.31f;drawCircle(C.faint,radius,androidx.compose.ui.geometry.Offset(radius+stroke/2,radius+stroke/2),style=androidx.compose.ui.graphics.drawscope.Stroke(stroke));drawLine(C.faint,androidx.compose.ui.geometry.Offset(radius*1.8f,radius*1.8f),androidx.compose.ui.geometry.Offset(size.width-stroke/2,size.height-stroke/2),stroke,androidx.compose.ui.graphics.StrokeCap.Round)}
            Spacer(Modifier.width((16*s).dp))
            BasicTextField(value,{value=it},Modifier.weight(1f),singleLine=true,textStyle=TextStyle(fontSize=(28*s).sp,lineHeight=(28*s).sp,color=Body),decorationBox={inner->Box(Modifier.fillMaxWidth(),contentAlignment=Alignment.CenterStart){if(value.isEmpty())Text(placeholder,fontSize=(28*s).sp,lineHeight=(28*s).sp,color=C.hint);inner()}})
            if(value.isNotBlank())Text("×",Modifier.padding(start=(8*s).dp).size((40*s).dp).clip(CircleShape).background(C.placeholder).clickable{value=""}.wrapContentSize(),fontSize=(28*s).sp,color=Color.White)
        }
        return
    }
    Row(Modifier.fillMaxWidth().padding(horizontal=20.dp,vertical=8.dp).clip(RoundedCornerShape(5.dp)).background(C.field).padding(horizontal=14.dp,vertical=10.dp),verticalAlignment=Alignment.CenterVertically) {
        Text("⌕",color=Muted,fontSize=21.sp,modifier=Modifier.padding(end=8.dp))
        BasicTextField(value,{value=it},Modifier.weight(1f),singleLine=true,textStyle=TextStyle(fontSize=14.sp,color=Body),decorationBox={inner->Box {if(value.isEmpty())Text(placeholder,fontSize=14.sp,color=Muted);inner()} })
        if(!auto)Text("搜索",Modifier.clickable{search(value)}.padding(start=12.dp),fontSize=14.sp,color=Blue)
    }
}

internal fun <T> orderByRecentConversations(items:List<T>,chatOrder:List<String>,identity:(T)->String):List<T> {
    val ranks=HashMap<String,Int>(chatOrder.size)
    chatOrder.forEachIndexed {index,id->ranks.putIfAbsent(id,index)}
    // 只解析每个联系人一次，缺失项保持原顺序，不在比较器中反复扫描全部会话。
    return items.map {it to (ranks[identity(it)] ?: Int.MAX_VALUE)}.sortedBy {it.second}.map {it.first}
}

@Composable fun ContactsHome(controller:BusinessController,chatOrder:List<String> = emptyList()) {
    val state by controller.state.collectAsStateWithLifecycle()
    var sortOpen by remember{mutableStateOf(false)}
    val list=rememberLazyListState()
    val nearEnd by remember { derivedStateOf {
        val layout=list.layoutInfo
        layout.totalItemsCount>0&&(layout.visibleItemsInfo.lastOrNull()?.index ?: -1)>=layout.totalItemsCount-3
    } }
    val s=scale()
    val contacts=remember(state.items,state.sort,chatOrder) {
        if(state.sort=="chat")orderByRecentConversations(state.items,chatOrder) {it.identifier()} else state.items
    }
    LaunchedEffect(Unit){controller.root("contacts");controller.refresh()}
    LaunchedEffect(nearEnd,state.cursor,state.hasMore,state.loading,state.error) {
        if(nearEnd&&state.hasMore&&!state.loading&&state.error==null)controller.refresh(true)
    }
    Column(Modifier.fillMaxSize().background(C.card)) {
        SearchBox(state.keyword,auto=true,original=true){controller.query(it)}
        // 搜索栏固定，目录入口、群卡和联系人共用一个滚动容器。
        NativePullRefresh(state.loading,{controller.refresh()},Modifier.weight(1f)) {LazyColumn(Modifier.fillMaxSize(),state=list) {
        item(key="directory-shortcuts",contentType="shortcuts") { Column {
            ContactsMenuRow("新的朋友","uni_menu_new_friend",state.friendRequests){controller.open("requests")}
            ContactsMenuRow("标签","uni_menu_tag"){controller.open("tags")}
            ContactsMenuRow("群聊天","uni_menu_group"){controller.open("groups")}
        } }
        if(state.groups.isNotEmpty())item(key="directory-groups",contentType="groups") { Column(Modifier.fillMaxWidth().background(C.field).padding(horizontal=(40*s).dp,vertical=(16*s).dp),verticalArrangement=Arrangement.spacedBy((16*s).dp)) {
            state.groups.take(3).forEach{group->
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape((8*s).dp)).background(C.card).clickable{controller.openChat(group,true)}.padding((16*s).dp),verticalAlignment=Alignment.CenterVertically) {
                    SharedAvatar(group.text("avatar").ifBlank{group.text("Avatar")},Modifier.size((96*s).dp).clip(CircleShape),true)
                    Text(group.displayName(),Modifier.weight(1f).padding(start=(32*s).dp),fontSize=(34*s).sp,color=Body,maxLines=1,overflow=TextOverflow.Ellipsis)
                }
            }
            if(state.groups.size>3)Text("展开所有群聊 (${state.groups.size})",Modifier.fillMaxWidth().clickable{controller.open("groups")}.padding(vertical=(16*s).dp).wrapContentWidth(),fontSize=(26*s).sp,color=Blue)
        } }
        item(key="directory-heading",contentType="heading") { Column {
        Spacer(Modifier.fillMaxWidth().height((48*s).dp).background(C.field))
        Spacer(Modifier.height((16*s).dp))
        Row(Modifier.fillMaxWidth().padding(horizontal=(40*s).dp,vertical=(8*s).dp).height((48*s).dp),horizontalArrangement=Arrangement.SpaceBetween,verticalAlignment=Alignment.CenterVertically) {
            Text("联络人 (${state.total})",fontSize=(28*s).sp,color=Body,fontWeight=FontWeight.Bold)
            Box {Text(when(state.sort){"name"->"名字 ▾";"chat"->"最近聊天 ▾";else->"最近加入(默认) ▾"},Modifier.clickable{sortOpen=true},fontSize=(24*s).sp,color=C.hint)
                DropdownMenu(sortOpen,{sortOpen=false}){listOf("recent" to "最近加入(默认)","name" to "名字","chat" to "最近聊天").forEach{(key,label)->DropdownMenuItem(text={Text(label)},onClick={sortOpen=false;controller.query(state.keyword,key)})}}
            }
        }
        BusinessStatus(state,controller)
        } }
            items(contacts,key={"contact:"+it.identifier()},contentType={"contact"}) { person -> Row(Modifier.fillMaxWidth().height((128*s).dp).clickable{controller.open("friend",person.identifier())}.padding(horizontal=(40*s).dp),verticalAlignment=Alignment.CenterVertically) {
                SharedAvatar(person.text("avatar"),Modifier.size((96*s).dp).clip(CircleShape));Text(person.displayName(),Modifier.weight(1f).padding(start=(32*s).dp),fontSize=(34*s).sp,color=Body,maxLines=1,overflow=TextOverflow.Ellipsis)
            } }
            item(key="directory-footer",contentType="footer") { ListFooter(state,controller,"暂无联系人");if(!state.loading&&!state.hasMore&&state.items.isNotEmpty())Text("没有更多了",Modifier.fillMaxWidth().padding(vertical=(30*s).dp).wrapContentWidth(),fontSize=(24*s).sp,color=Muted) }
        }}
    }
}

@Composable fun MineHome(controller:BusinessController,profile:BusinessProfile?,logout:()->Unit) {
    val state by controller.state.collectAsStateWithLifecycle()
    val s=scale();var confirm by remember{mutableStateOf(false)}
    LaunchedEffect(Unit){controller.root("mine");controller.refresh()}
    val user=state.detail
    Column(Modifier.fillMaxSize().background(Page).verticalScroll(rememberScrollState())) {
        Box(Modifier.fillMaxWidth().background(C.primary)) {
            val ctx=LocalContext.current;val hero=remember{ctx.resources.getIdentifier("uni_mine_header","drawable",ctx.packageName)}
            if(hero!=0)Image(painterResource(hero),null,Modifier.matchParentSize(),contentScale=ContentScale.Crop)
            Text("个人中心",Modifier.padding(start=(40*s).dp,top=(16*s).dp),fontSize=(48*s).sp,fontWeight=FontWeight.Bold,color=Color.White)
            Row(Modifier.fillMaxWidth().padding(start=(48*s).dp,end=(48*s).dp,top=(144*s).dp,bottom=(48*s).dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.SpaceBetween) {
                Column(horizontalAlignment=Alignment.CenterHorizontally) {
                    SharedAvatar(user.text("avatar").ifBlank{profile?.avatar.orEmpty()},Modifier.size((160*s).dp).clip(CircleShape).border((4*s).dp,Color.White,CircleShape))
                    Text(user.text("nickname").ifBlank{profile?.nickname.orEmpty()},Modifier.width((160*s).dp).padding(top=(8*s).dp),fontSize=(32*s).sp,lineHeight=(48*s).sp,textAlign=androidx.compose.ui.text.style.TextAlign.Center,fontWeight=FontWeight.Bold,color=Color.White,maxLines=1,overflow=TextOverflow.Ellipsis)
                }
                Row {
                    OriginalIcon("uni_mine_icon_edit",Modifier.size((64*s).dp).clickable{controller.open("profile")}.padding((12*s).dp))
                    OriginalIcon("uni_mine_icon_qrcode",Modifier.size((64*s).dp).clickable{controller.open("qrcode")}.padding((12*s).dp))
                }
            }
        }
        listOf(Triple("我的收藏","favorites","favorites"),Triple("通知设置","notifications","notifications"),Triple("聊天设置","chat_settings","chat-settings"),Triple("隐私","privacy","privacy"),Triple("安全","security","security"),Triple("通用","general","general")).forEach{(label,icon,page)->RowItem(label,icon="uni_mine_icon_$icon"){controller.open(page)}}
        Spacer(Modifier.height((16*s).dp))
        RowItem("退出",icon="uni_mine_icon_logout",red=true,chevron=false){confirm=true}
        BusinessStatus(state,controller)
    }
    if(confirm)AlertDialog(onDismissRequest={confirm=false},title={Text("提示")},text={Text("确定退出登录吗？")},confirmButton={TextButton(onClick={confirm=false;logout()}){Text("确认")}},dismissButton={TextButton(onClick={confirm=false}){Text("取消")}})
}

@Composable private fun BusinessStatus(state:BusinessState,controller:BusinessController) {
    if(state.loading)LinearProgressIndicator(Modifier.fillMaxWidth(),color=Blue)
    state.error?.let{Text(it+" · 重试",Modifier.fillMaxWidth().clickable{controller.refresh()}.padding(16.dp),color=Red,fontSize=13.sp)}
}
@Composable private fun ListFooter(state:BusinessState,controller:BusinessController,empty:String="暂无内容") {
    if(!state.loading&&state.items.isEmpty()&&state.error==null)Text(empty,Modifier.fillMaxWidth().padding(28.dp).wrapContentWidth(),color=Muted,fontSize=14.sp)
    if(state.hasMore)Text("加载更多",Modifier.fillMaxWidth().clickable{controller.refresh(true)}.padding(18.dp).wrapContentWidth(),color=Blue,fontSize=14.sp)
}

@Composable fun NativeBusinessPage(controller:BusinessController,model:BootstrapViewModel,onLegal:(String)->Unit) {
    val state by controller.state.collectAsStateWithLifecycle()
    val preferences by model.settings.state.collectAsStateWithLifecycle()
    val r=state.route;val d=state.detail
    val pageScale=scale()
    if(r.page=="friend"){NativeFriendDetail(state,controller,model);return}
    if(r.page=="qrcode"||r.page=="group-qrcode"){NativeQrPage(controller,state);return}
    if(r.page=="forgot-password") {NativeAuthPage("forgot",model,com.im.nativebootstrap.data.RuntimeEndpoints.DEFAULT_API_BASE_URL,{controller.back()},onLegal);return}
    if(r.page in listOf("group-media","group-search-history")) {
        NativeChatArchive(if(r.page=="group-media")"图片、视频和文件" else "搜索聊天记录",r.page=="group-media",{controller.back()}, { keyword,types,page,count,done->
            model.searchPeerMessages(r.context,true,keyword,types,page,count,done)
        },{message->model.openPeerMessage(r.context,true,"群聊","",message)});return
    }
    var confirm by remember(r){mutableStateOf<Pair<String,()->Unit>?>(null)}
    var muteTarget by remember(r){mutableStateOf<Pair<String,JsonObject>?>(null)}
    var removeTarget by remember(r){mutableStateOf<Pair<String,JsonObject>?>(null)}
    // 添加朋友/添加群聊/创建群聊页状态（布局与交互对标 H5 对应页面）
    var addFriendKeyword by remember(r){mutableStateOf("")}
    var addFriendSearched by remember(r){mutableStateOf(false)}
    var addGroupId by remember(r){mutableStateOf("")}
    var createGroupStep by remember(r){mutableStateOf(false)}
    var createGroupName by remember(r){mutableStateOf("")}
    var createGroupSelected by remember(r){mutableStateOf(emptySet<String>())}
    val createGroupChosen=remember(r){mutableStateMapOf<String,JsonObject>()}
    var createGroupSortMenu by remember(r){mutableStateOf(false)}
    fun submitAddGroupJoin(){
        val id=addGroupId.trim()
        if(!Regex("^(qun_[A-Za-z0-9]{6,20}|\\d+)$").matches(id)){controller.reportError("请输入正确的群号");return}
        controller.joinGroup(id)
    }
    var modal by remember(r){mutableStateOf<Pair<String,(String)->Unit>?>(null)}
    var modalText by remember(r){mutableStateOf("")}
    var attachments by remember(r){mutableStateOf(emptyList<ImageAttachment>())}
    var attaching by remember(r){mutableStateOf(false)}
    val context=LocalContext.current
    val scope=rememberCoroutineScope()
    val qrAlbum=rememberLauncherForActivityResult(ActivityResultContracts.GetContent()){uri->if(uri!=null)scope.launch {
        try{val raw=kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO){readQr(context,uri)};controller.resolveQr(raw)}catch(error:Exception){controller.reportError(error.message?:"二维码未识别")}
    }}
    val qrScanner=rememberLauncherForActivityResult(ScanContract()){result->result.contents?.let(controller::resolveQr)}
    val notificationPermission=rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()){}
    var uploadNote by remember(r){mutableStateOf("")};var uploading by remember(r){mutableStateOf(false)}
    var uploadPurpose by remember(r){mutableStateOf("avatar")}
    var newAvatarId by remember(r){mutableStateOf("")};var newAvatarUrl by remember(r){mutableStateOf("")}
    var cropUri by remember(r){mutableStateOf<android.net.Uri?>(null)}
    fun acceptImage(uri:android.net.Uri) {
        uploading=true
        model.uploadBusinessImage(uri,uploadPurpose){result->uploading=false;result.fold({uploaded->
            when(r.page){"profile"->controller.saveProfile(d.text("nickname").ifBlank{"我"},d.text("bio"),uploaded.id);"onboarding"->{newAvatarId=uploaded.id;newAvatarUrl=uploaded.url};"emotions"->controller.mutate("POST","/stickers",obj("fileId" to uploaded.id));"group"->controller.mutate("POST","/groups/settings/update",obj("groupId" to r.id,"avatarFileId" to uploaded.id))}
            uploadNote=""
        },{uploadNote=it.message?:"上传失败"})}
    }
    val imagePicker=rememberLauncherForActivityResult(ActivityResultContracts.GetContent()){uri->if(uri!=null){if(uploadPurpose=="avatar")cropUri=uri else acceptImage(uri)}}
    cropUri?.let{uri->AvatarCropper(uri,{cropUri=null}){cropped->cropUri=null;acceptImage(cropped)}}
    Column(Modifier.fillMaxSize().background(if(r.page in listOf("general","security","reset-password","about","notifications","chat-settings","privacy","debug")) (if(AppTheme.dark)C.page else Color.White) else Page).statusBarsPadding().navigationBarsPadding().imePadding()) {
        Row(Modifier.fillMaxWidth().height((96*pageScale).dp).background(C.card).padding(horizontal=(32*pageScale).dp),verticalAlignment=Alignment.CenterVertically) {
            Box(Modifier.width((72*pageScale).dp).fillMaxHeight().clickable{if(r.page=="create-group"&&createGroupStep)createGroupStep=false else controller.back()},contentAlignment=Alignment.CenterStart){Image(painterResource(R.drawable.uni_icon_back),"返回",Modifier.size((44*pageScale).dp))}
            Text(if(r.page=="create-group"&&!createGroupStep)"选择联络人" else routeTitles[r.page].orEmpty(),Modifier.weight(1f),fontSize=(40*pageScale).sp,fontWeight=FontWeight.Bold,textAlign=androidx.compose.ui.text.style.TextAlign.Center,color=Body)
            val myIds=setOfNotNull(model.state.value.profile?.businessUserId,model.state.value.profile?.publicId)
            val canInviteMembers=r.page=="members"&&state.items.firstOrNull{it.identifier() in myIds}?.text("role") in listOf("owner","admin")
            Box(Modifier.widthIn(min=(72*pageScale).dp),contentAlignment=Alignment.CenterEnd){
                if(r.page=="tags")Text("新增",Modifier.clickable{modal="新建标签" to { name->controller.mutate("POST","/contact-tags",obj("name" to name)) };modalText=""},color=Blue,fontSize=(28*pageScale).sp)
                else if(canInviteMembers)Text("新增",Modifier.clickable{controller.open("invite",r.id)},color=Blue,fontSize=(28*pageScale).sp)
                else if(r.page=="add-friend"||r.page=="add-group")Image(painterResource(R.drawable.uni_icon_scan),"扫一扫",Modifier.size((48*pageScale).dp).clickable{qrScanner.launch(ScanOptions().setDesiredBarcodeFormats(ScanOptions.QR_CODE).setCaptureActivity(NativeScanActivity::class.java).setBeepEnabled(false))})
                else if(r.page=="create-group"&&!createGroupStep)Box(Modifier.widthIn(min=(104*pageScale).dp).height((64*pageScale).dp).clip(RoundedCornerShape((8*pageScale).dp)).background(if(createGroupSelected.isNotEmpty())C.primary else C.line).clickable(enabled=createGroupSelected.isNotEmpty()){
                    val me=model.state.value.profile?.nickname?.ifBlank{"我"}?:"我"
                    val draft=(listOf(me)+createGroupChosen.values.filter{it.identifier() in createGroupSelected}.map{it.displayName()}).joinToString("、")
                    createGroupName=if(draft.length>50)draft.take(47)+"..." else draft
                    createGroupStep=true
                },contentAlignment=Alignment.Center){Text(if(createGroupSelected.isEmpty())"确认" else "确认(${createGroupSelected.size})",fontSize=(28*pageScale).sp,color=if(createGroupSelected.isNotEmpty())Color.White else C.hint,fontWeight=FontWeight.SemiBold)}
            }
        }
        BusinessStatus(state,controller)
        if(uploading)LinearProgressIndicator(Modifier.fillMaxWidth(),color=Blue)
        if(uploadNote.isNotBlank())Section(uploadNote)
        if(r.page=="security")Security(state,controller,Modifier.weight(1f))
        else if(r.page=="announcements")NativeAnnouncements(state,controller,model,Modifier.weight(1f))
        else if(r.page=="admin-add")AdminMemberPicker(state,controller,Modifier.weight(1f))
        else NativePullRefresh(state.loading,{controller.refresh()},Modifier.weight(1f)) {Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            when(r.page) {
                "mass-assistant","mass-select","mass-targets","mass-compose" -> MassPage(r.page,model,controller)
                "scan" -> {
                    Section("扫描朋友或群聊的二维码")
                    Action("扫一扫"){qrScanner.launch(ScanOptions().setDesiredBarcodeFormats(ScanOptions.QR_CODE).setCaptureActivity(NativeScanActivity::class.java).setBeepEnabled(false))}
                    RowItem("从相册选择"){qrAlbum.launch("image/*")}
                    RowItem("我的二维码"){controller.open("qrcode")}
                    var raw by remember{mutableStateOf("")};Input("也可粘贴二维码内容或链接",raw,{raw=it},multiline=true)
                    Action("识别",raw.isNotBlank()&&!state.loading){controller.resolveQr(raw)}
                }
                "scan-result" -> {
                    val user=d.child("user");PersonRow(user,user.text("publicId")){}
                    if(d.text("relation")=="friend")Action("发送消息"){controller.openChat(user)}
                    else {var message by remember(r){mutableStateOf("")};Input("验证信息",message,{message=it});Action("添加朋友",!state.loading){controller.mutate("POST","/friend-requests",obj("toUserId" to user.identifier(),"message" to message))}}
                }
                "scan-group-result" -> {
                    val group=d.child("group");PersonRow(group,"群号："+group.identifier()){}
                    if(d.text("nextAction")=="enter")Action("进入群聊"){controller.openChat(group,true)}
                    else {var remark by remember(r){mutableStateOf("")};Input("申请说明",remark,{remark=it});Action(if(d.text("nextAction")=="apply")"申请入群" else "加入群聊",!state.loading){controller.mutate("POST","/groups/qrcode/join",obj("token" to r.context,"payload" to r.context,"remark" to remark))}}
                }
                "add-friend" -> {
                    // 布局对标 H5 add-friend：灰底圆角搜索框 + 结果卡片 + 验证信息 + 发送按钮，底部固定「搜索」
                    Row(Modifier.fillMaxWidth().padding(start=(40*pageScale).dp,end=(40*pageScale).dp,top=(16*pageScale).dp,bottom=(24*pageScale).dp).height((72*pageScale).dp).clip(RoundedCornerShape((8*pageScale).dp)).background(C.field).padding(start=(32*pageScale).dp,end=(24*pageScale).dp),verticalAlignment=Alignment.CenterVertically) {
                        Text("⌕",color=C.hint,fontSize=(30*pageScale).sp)
                        Spacer(Modifier.width((16*pageScale).dp))
                        BasicTextField(addFriendKeyword,{addFriendKeyword=it},Modifier.weight(1f),singleLine=true,textStyle=TextStyle(fontSize=(28*pageScale).sp,lineHeight=(28*pageScale).sp,color=Body),cursorBrush=SolidColor(Blue),keyboardOptions=KeyboardOptions(imeAction=androidx.compose.ui.text.input.ImeAction.Search),keyboardActions=androidx.compose.foundation.text.KeyboardActions(onSearch={if(addFriendKeyword.isNotBlank()){addFriendSearched=true;controller.searchUser(addFriendKeyword)}}),decorationBox={inner->Box(Modifier.fillMaxWidth(),contentAlignment=Alignment.CenterStart){if(addFriendKeyword.isEmpty())Text("搜索聊天号",fontSize=(28*pageScale).sp,lineHeight=(28*pageScale).sp,color=C.hint);inner()}})
                    }
                    if(d.identifier().isNotBlank()) {
                        Row(Modifier.fillMaxWidth().clickable{controller.open("user",d.identifier())}.padding(horizontal=(40*pageScale).dp,vertical=(24*pageScale).dp),verticalAlignment=Alignment.CenterVertically) {
                            SharedAvatar(d.text("avatar"),Modifier.size((96*pageScale).dp).clip(CircleShape))
                            Column(Modifier.weight(1f).padding(start=(32*pageScale).dp)) {
                                Text(d.displayName(),fontSize=(34*pageScale).sp,color=Body,maxLines=1,overflow=TextOverflow.Ellipsis)
                                Text("聊天号: ${d.text("publicId")}",Modifier.padding(top=(4*pageScale).dp),fontSize=(24*pageScale).sp,color=C.hint)
                            }
                            Text("›",fontSize=(40*pageScale).sp,color=C.faint)
                        }
                        var message by remember(r){mutableStateOf("你好，我想加你为好友")}
                        Box(Modifier.fillMaxWidth().padding(top=(24*pageScale).dp).height(1.dp).background(C.field))
                        Text("验证信息",Modifier.padding(start=(40*pageScale).dp,top=(24*pageScale).dp),fontSize=(28*pageScale).sp,color=C.hint)
                        BasicTextField(message,{message=it},Modifier.fillMaxWidth().padding(start=(40*pageScale).dp,end=(40*pageScale).dp,top=(16*pageScale).dp).height((80*pageScale).dp).clip(RoundedCornerShape((8*pageScale).dp)).background(C.field).padding(horizontal=(32*pageScale).dp),singleLine=true,textStyle=TextStyle(fontSize=(28*pageScale).sp,lineHeight=(28*pageScale).sp,color=Body),cursorBrush=SolidColor(Blue),decorationBox={inner->Box(Modifier.fillMaxSize(),contentAlignment=Alignment.CenterStart){if(message.isEmpty())Text("填写验证说明",fontSize=(28*pageScale).sp,lineHeight=(28*pageScale).sp,color=C.hint);inner()}})
                        Spacer(Modifier.height((16*pageScale).dp))
                        PrimaryButton("发送好友申请",!state.loading){controller.mutate("POST","/friend-requests",obj("toUserId" to d.identifier(),"message" to message)){res->
                            val status=(res as? JsonObject)?.text("status").orEmpty()
                            NativeNotices.show(if(status=="accepted")"已添加好友" else "已发送好友申请")
                            controller.back()
                        }}
                    }
                    if(addFriendSearched&&d.identifier().isBlank()&&!state.loading)Text("未找到该用户，请确认聊天号是否正确",Modifier.fillMaxWidth().padding(top=(80*pageScale).dp),fontSize=(26*pageScale).sp,color=C.hint,textAlign=androidx.compose.ui.text.style.TextAlign.Center)
                }
                "add-group" -> {
                    // 布局对标 H5 add-group：灰底圆角输入框 + 提示文案，「加入群聊」按钮紧跟其后（非固定底部）
                    Row(Modifier.fillMaxWidth().padding(start=(40*pageScale).dp,end=(40*pageScale).dp,top=(16*pageScale).dp).height((72*pageScale).dp).clip(RoundedCornerShape((8*pageScale).dp)).background(C.field).padding(horizontal=(32*pageScale).dp),verticalAlignment=Alignment.CenterVertically) {
                        BasicTextField(addGroupId,{addGroupId=it.take(28)},Modifier.weight(1f),singleLine=true,textStyle=TextStyle(fontSize=(28*pageScale).sp,lineHeight=(28*pageScale).sp,color=Body),cursorBrush=SolidColor(Blue),keyboardOptions=KeyboardOptions(imeAction=androidx.compose.ui.text.input.ImeAction.Done),keyboardActions=androidx.compose.foundation.text.KeyboardActions(onDone={submitAddGroupJoin()}),decorationBox={inner->Box(Modifier.fillMaxWidth(),contentAlignment=Alignment.CenterStart){if(addGroupId.isEmpty())Text("请输入群号",fontSize=(28*pageScale).sp,lineHeight=(28*pageScale).sp,color=C.hint);inner()}})
                    }
                    Text("输入对方群资料里的群号。右上角仍可扫群二维码。",Modifier.padding(start=(40*pageScale).dp,end=(40*pageScale).dp,top=(16*pageScale).dp),fontSize=(24*pageScale).sp,color=C.hint,lineHeight=(36*pageScale).sp)
                    PrimaryButton(if(state.loading)"加入中..." else "加入群聊",!state.loading){submitAddGroupJoin()}
                }
                "requests" -> {
                    state.items.forEach{request->
                        val from=request.child("fromUser");val pending=request.text("status")=="pending"
                        PersonRow(from,request.text("message"),trailing={
                            if(pending)Row {TextButton(onClick={controller.mutate("POST","/friend-requests/${encoded(request.identifier())}/accept")}){Text("接受",color=Blue)};TextButton(onClick={controller.mutate("POST","/friend-requests/${encoded(request.identifier())}/reject")}){Text("拒绝",color=Muted)}}
                            else Text(if(request.text("status")=="accepted")"已添加" else "已拒绝",color=Muted,fontSize=12.sp)
                        }){controller.open("user",from.identifier())}
                    };ListFooter(state,controller,"暂无好友申请")
                }
                "friend","user" -> {
                    PersonRow(d,d.text("publicId")){}
                    if(d.text("bio").isNotBlank())RowItem("个性签名",d.text("bio"),enabled=false){}
                    if(r.page=="friend"||d.flag("_isFriend")) {
                        RowItem("备注",d.text("remark")){controller.open("friend-remark",r.id)}
                        RowItem("标签",elements(d.get("tags")).joinToString("、"){it.text("name")}){controller.open("friend-tags",r.id,seed=d)}
                        RowItem("共同群聊",elements(d.get("commonGroups")).size.toString()){controller.open("common-groups",r.id)}
                        RowItem("成为好友时间",d.text("friendSince"),enabled=false){}
                        RowItem("最近上线",d.text("lastSeenAt"),enabled=false){}
                        Action("发消息",!state.loading){controller.openChat(d)}
                        RowItem(if(d.flag("isBlocked"))"移出黑名单" else "加入黑名单",red=true){confirm=(if(d.flag("isBlocked"))"移出黑名单？" else "加入黑名单后将不再收到对方的消息，是否继续？") to {controller.mutate(if(d.flag("isBlocked"))"DELETE" else "POST","/contacts/${encoded(r.id)}/block")}}
                        RowItem("删除好友",red=true){confirm="删除后将从通讯录移除该好友。" to {controller.mutate("DELETE","/contacts/${encoded(r.id)}",backAfter=true)}}
                    } else {
                        var message by remember(r){mutableStateOf("")};Input("验证信息",message,{message=it})
                        Action("添加朋友",!state.loading){controller.mutate("POST",if(r.context.isBlank())"/friend-requests" else "/group-friend-requests",obj("toUserId" to r.id,"message" to message).apply {if(r.context.isNotBlank())addProperty("groupId",r.context)})}
                    }
                    RowItem("举报用户"){controller.open("report-user",r.id)}
                }
                "friend-remark" -> {
                    var value by remember(r,d){mutableStateOf(d.text("remark"))};Input("备注名",value,{value=it})
                    Action("保存",!state.loading){controller.mutate("PATCH","/contacts/${encoded(r.id)}",obj("remark" to value),true)}
                }
                "tags","tag-members","friend-tags" -> {
                    if(r.page=="tags") {
                        state.items.forEach{tag->RowItem(tag.text("name"),tag.text("memberCount")){controller.open("tag-members",tag.identifier(),tag.text("name"))}}
                    } else if(r.page=="tag-members") {
                        RowItem("标签名称",r.context){modal="修改标签名称" to {name->controller.mutate("PATCH","/contact-tags/${encoded(r.id)}",obj("name" to name))};modalText=r.context}
                        state.items.forEach{p->PersonRow(p){controller.open("friend",p.identifier())}}
                        RowItem("添加成员"){controller.open("tag-add-members",r.id)}
                        var removing by remember(r){mutableStateOf(false)};var removed by remember(r){mutableStateOf(emptySet<String>())}
                        RowItem(if(removing)"取消移除成员" else "移除成员"){removing=!removing;removed=emptySet()}
                        if(removing){state.items.forEach{p->CheckRow(p.displayName(),p.identifier() in removed){checked->removed=if(checked)removed+p.identifier() else removed-p.identifier()}};Action("移除选中成员（${removed.size}）",removed.isNotEmpty()&&!state.loading){confirm="从该标签移除选中成员，不删除好友，是否继续？" to {controller.removeTagMembers(r.id,removed);removing=false}}}
                        RowItem("删除标签",red=true){confirm="删除标签不会删除好友，是否继续？" to {controller.mutate("DELETE","/contact-tags/${encoded(r.id)}",backAfter=true)}}
                    } else {
                        var selected by remember(r){mutableStateOf(elements(d.get("tags")).map{it.identifier()}.toSet())}
                        RowItem("新建标签"){modal="新建标签" to {name->controller.mutate("POST","/contact-tags",obj("name" to name)){created->if(created.isJsonObject)selected=selected+created.asJsonObject.identifier()}};modalText=""}
                        state.items.forEach{tag->CheckRow(tag.text("name"),tag.identifier() in selected){selected=if(it)selected+tag.identifier() else selected-tag.identifier()}}
                        Action("保存",!state.loading){controller.mutate("PATCH","/contacts/${encoded(r.id)}",obj("tagIds" to selected),true)}
                    }
                    ListFooter(state,controller,"暂无标签")
                }
                "groups","common-groups" -> {
                    if(r.page=="groups") {
                        Row(Modifier.fillMaxWidth().background(C.card).padding(horizontal=(24*pageScale).dp)){listOf("owner" to "我建立的","member" to "我加入的").forEach{(role,label)->Column(Modifier.weight(1f).clickable{controller.query(role)},horizontalAlignment=Alignment.CenterHorizontally){Text(label,Modifier.padding(vertical=(28*pageScale).dp),fontSize=(30*pageScale).sp,fontWeight=if(state.keyword==role)FontWeight.SemiBold else FontWeight.Normal,color=if(state.keyword==role)Body else C.hint);Box(Modifier.fillMaxWidth(.6f).height((4*pageScale).dp).background(if(state.keyword==role)C.primaryText else Color.Transparent))}}}
                    }
                    state.items.filter{it.text("status")!="dismissed"}.forEach{group->Row(Modifier.fillMaxWidth().background(C.card).clickable{controller.openChat(group,true)}.padding(horizontal=(28*pageScale).dp,vertical=(24*pageScale).dp),verticalAlignment=Alignment.CenterVertically){
                        SharedAvatar(group.text("avatar"),Modifier.size((80*pageScale).dp).clip(RoundedCornerShape((12*pageScale).dp)),true)
                        Text(group.displayName().ifBlank{"群聊"},Modifier.weight(1f).padding(start=(20*pageScale).dp),fontSize=(30*pageScale).sp,color=Body,maxLines=1,overflow=TextOverflow.Ellipsis)
                        val role=group.text("role");if(role in setOf("owner","admin")){val color=if(role=="owner")C.hint else Blue;Text(if(role=="owner")"群主" else "管理员",Modifier.padding(start=(12*pageScale).dp).clip(RoundedCornerShape((6*pageScale).dp)).border(pageScale.dp,color,RoundedCornerShape((6*pageScale).dp)).padding(horizontal=(10*pageScale).dp,vertical=(2*pageScale).dp),fontSize=(22*pageScale).sp,color=color)}
                        Text("›",Modifier.padding(start=(12*pageScale).dp),fontSize=(36*pageScale).sp,color=C.placeholder)
                    }}
                    ListFooter(state,controller,"无群组")
                }
                "create-group" -> {
                    if(createGroupStep) {
                        // 第二步（对标 H5 create.vue）：群头像 + 群名称(50字计数) + 成员宫格，底部固定「创建」
                        androidx.activity.compose.BackHandler{createGroupStep=false}
                        Column(Modifier.fillMaxWidth().padding(top=(48*pageScale).dp,bottom=(32*pageScale).dp),horizontalAlignment=Alignment.CenterHorizontally){SharedAvatar("",Modifier.size((160*pageScale).dp).clip(CircleShape))}
                        Column(Modifier.fillMaxWidth().padding(horizontal=(40*pageScale).dp)) {
                            BasicTextField(createGroupName,{createGroupName=it.take(50)},Modifier.fillMaxWidth().height((96*pageScale).dp).clip(RoundedCornerShape((8*pageScale).dp)).background(C.field).padding(horizontal=(32*pageScale).dp),singleLine=true,textStyle=TextStyle(fontSize=(32*pageScale).sp,lineHeight=(32*pageScale).sp,color=Body),cursorBrush=SolidColor(Blue),decorationBox={inner->Box(Modifier.fillMaxSize(),contentAlignment=Alignment.CenterStart){if(createGroupName.isEmpty())Text("请输入群名称",fontSize=(32*pageScale).sp,lineHeight=(32*pageScale).sp,color=C.hint);inner()}})
                            Row(Modifier.fillMaxWidth().padding(top=(12*pageScale).dp),horizontalArrangement=Arrangement.SpaceBetween){Text("群组名称最多 50 个字",fontSize=(24*pageScale).sp,color=C.hint);Text("${createGroupName.length}/50",fontSize=(24*pageScale).sp,color=C.hint)}
                            Text("群成员 (${createGroupSelected.size+1})",Modifier.padding(top=(40*pageScale).dp,bottom=(24*pageScale).dp),fontSize=(28*pageScale).sp,fontWeight=FontWeight.Bold,color=Body)
                            val me=model.state.value.profile
                            val memberRows=(listOf(me?.avatar.orEmpty() to (me?.nickname?.ifBlank{"我"}?:"我"))+createGroupChosen.values.filter{it.identifier() in createGroupSelected}.map{it.text("avatar") to it.displayName()}).chunked(4)
                            memberRows.forEach{row->Row(Modifier.fillMaxWidth().padding(bottom=(24*pageScale).dp),horizontalArrangement=Arrangement.spacedBy((32*pageScale).dp)){row.forEach{(avatar,name)->Column(Modifier.width((120*pageScale).dp),horizontalAlignment=Alignment.CenterHorizontally){SharedAvatar(avatar,Modifier.size((96*pageScale).dp).clip(CircleShape));Text(name,Modifier.padding(top=(8*pageScale).dp),fontSize=(22*pageScale).sp,color=Body,maxLines=1,overflow=TextOverflow.Ellipsis)}}}}
                        }
                    } else {
                        // 第一步（对标 H5 选择联络人）：已选 chips + 搜索 + 计数/排序下拉 + 圆圈勾选列表
                        if(createGroupSelected.isNotEmpty())Column(Modifier.fillMaxWidth().padding(start=(40*pageScale).dp,end=(40*pageScale).dp,top=(8*pageScale).dp,bottom=(16*pageScale).dp)){createGroupChosen.values.filter{it.identifier() in createGroupSelected}.chunked(4).forEach{row->Row(Modifier.fillMaxWidth().padding(bottom=(16*pageScale).dp),horizontalArrangement=Arrangement.spacedBy((16*pageScale).dp)){row.forEach{person->Row(Modifier.clip(RoundedCornerShape(999.dp)).background(C.field).clickable{createGroupSelected=createGroupSelected-person.identifier()}.padding(start=(4*pageScale).dp,end=(12*pageScale).dp,top=(4*pageScale).dp,bottom=(4*pageScale).dp),verticalAlignment=Alignment.CenterVertically){SharedAvatar(person.text("avatar"),Modifier.size((48*pageScale).dp).clip(CircleShape));Text(person.displayName(),Modifier.padding(start=(8*pageScale).dp).widthIn(max=(160*pageScale).dp),fontSize=(24*pageScale).sp,color=Body,maxLines=1,overflow=TextOverflow.Ellipsis)}}}}}
                        SearchBox(auto=true,original=true,placeholder="搜索"){controller.query(it)}
                        Row(Modifier.fillMaxWidth().padding(start=(40*pageScale).dp,end=(40*pageScale).dp,top=(8*pageScale).dp,bottom=(16*pageScale).dp),horizontalArrangement=Arrangement.SpaceBetween,verticalAlignment=Alignment.CenterVertically) {
                            Text("联络人 (${state.items.size})",fontSize=(28*pageScale).sp,fontWeight=FontWeight.Bold,color=Body)
                            Box {
                                Row(Modifier.clickable{createGroupSortMenu=true},verticalAlignment=Alignment.CenterVertically){Text(when(state.sort){"name"->"名字";"chat"->"最近聊天";else->"最近加入(默认)"},fontSize=(24*pageScale).sp,color=C.hint);Text(" ▼",fontSize=(18*pageScale).sp,color=C.hint)}
                                DropdownMenu(createGroupSortMenu,{createGroupSortMenu=false}){listOf("recent" to "最近加入(默认)","name" to "名字","chat" to "最近聊天").forEach{(sort,label)->DropdownMenuItem(text={Text(label,color=if((if(state.sort.isBlank())"recent" else state.sort)==sort)Blue else Body)},onClick={createGroupSortMenu=false;controller.query(state.keyword,sort)})}}
                            }
                        }
                        state.items.forEach{p->createGroupChosen[p.identifier()]=p
                            Row(Modifier.fillMaxWidth().height((128*pageScale).dp).clickable{val id=p.identifier();createGroupSelected=if(id in createGroupSelected)createGroupSelected-id else createGroupSelected+id}.padding(horizontal=(40*pageScale).dp),verticalAlignment=Alignment.CenterVertically) {
                                SharedAvatar(p.text("avatar"),Modifier.size((96*pageScale).dp).clip(CircleShape))
                                Text(p.displayName(),Modifier.weight(1f).padding(start=(32*pageScale).dp),fontSize=(34*pageScale).sp,color=Body,maxLines=1,overflow=TextOverflow.Ellipsis)
                                CircleCheck(p.identifier() in createGroupSelected)
                            }
                        }
                        ListFooter(state,controller,"暂无可选联系人")
                    }
                }
                "invite","tag-add-members" -> {
                    var selected by remember(r){mutableStateOf(emptySet<String>())}
                    val existing=d.get("existingMembers")?.takeIf{it.isJsonArray}?.asJsonArray?.map{it.asString}?.toSet().orEmpty()
                    SearchBox(state.keyword,auto=true){controller.query(it)}
                    Row {listOf("recent" to "最近加入","name" to "名字","chat" to "最近聊天").forEach{(sort,label)->TextButton(onClick={controller.query(state.keyword,sort)}){Text(label)}}}
                    TextButton(onClick={val available=state.items.map{it.identifier()}.filterNot{it in existing}.toSet();selected=if(available.isNotEmpty()&&available.all{it in selected})selected-available else selected+available}){Text("全选 / 取消当前页")}
                    val chatOrder=model.state.value.chat.conversations.filter{it.target.sessionType==1}.map{com.im.nativebootstrap.chat.businessUserId(it.target.userId)}
                    val people=if(state.sort=="chat")state.items.sortedBy{chatOrder.indexOf(it.identifier()).takeIf{index->index>=0}?:Int.MAX_VALUE} else state.items
                    people.forEach{p->PersonRow(p,trailing={Checkbox(p.identifier() in selected||p.identifier() in existing,{checked->if(p.identifier() !in existing)selected=if(checked)selected+p.identifier() else selected-p.identifier()},enabled=p.identifier() !in existing,colors=CheckboxDefaults.colors(checkedColor=Blue))}){if(p.identifier() !in existing)selected=if(p.identifier() in selected)selected-p.identifier() else selected+p.identifier()}}
                    ListFooter(state,controller,"暂无可选联系人")
                    Action("确认（${selected.size}）",selected.isNotEmpty()&&!state.loading) {
                        if(r.page=="invite")controller.mutate("POST","/groups/${encoded(r.id)}/invitations",obj("userIds" to selected),true) else controller.addTagMembers(r.id,selected)
                    }
                }
                "group-admin" -> GroupAdmin(state,controller)
                "group" -> NativeGroupDetail(state,controller,model,{uploadPurpose="avatar";imagePicker.launch("image/*")},!uploading){text,action->confirm=text to action}
                "members","admins" -> {
                    SearchBox(state.keyword){controller.query(it)}
                    if(r.page=="admins")RowItem("添加管理员"){controller.open("admin-add",r.id)}
                    val memberMyIds=setOfNotNull(model.state.value.profile?.businessUserId,model.state.value.profile?.publicId)
                    val memberMyRole=state.items.firstOrNull{it.identifier() in memberMyIds}?.text("role")
                    val memberCanManage=memberMyRole in listOf("owner","admin")
                    // 与 H5 members.vue 的 canActOn 一致：owner 可管 admin/member，admin 只可管 member；群主和自己不可操作
                    fun canActOn(p:JsonObject)=memberCanManage&&p.identifier() !in memberMyIds&&p.text("role")!="owner"&&(memberMyRole=="owner"||p.text("role")=="member")
                    val visibleMembers=state.items.filter{(r.page!="admins"||it.text("role") in listOf("owner","admin"))&&(state.keyword.isBlank()||it.displayName().contains(state.keyword,true))}
                    // 人数标识（对标 H5「群成员 (N)」）：跟随当前列表，移除成员后立即变化
                    if(r.page=="members")Text("群成员 (${visibleMembers.size})",Modifier.padding(start=(40*pageScale).dp,top=(16*pageScale).dp,bottom=(8*pageScale).dp),fontSize=(28*pageScale).sp,fontWeight=FontWeight.Bold,color=Body)
                    visibleMembers.forEach{p->
                        val memberActions:(@Composable ()->Unit)?=if(r.page=="members"&&canActOn(p)){{
                            Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                                Text(if(p.flag("isMuted"))"解禁" else "禁言",Modifier.clip(RoundedCornerShape(8.dp)).background(C.dangerBg).clickable{if(p.flag("isMuted"))controller.mutate("POST","/group-members/unmute",obj("groupId" to r.id,"memberUserId" to p.identifier())) else muteTarget=r.id to p}.padding(horizontal=12.dp,vertical=6.dp),color=Red,fontSize=13.sp)
                                Text("移除",Modifier.clip(RoundedCornerShape(8.dp)).background(C.field).clickable{removeTarget=r.id to p}.padding(horizontal=12.dp,vertical=6.dp),color=Muted,fontSize=13.sp)
                            }
                        }} else null
                        PersonRow(p,when(p.text("role")){"owner"->"群主";"admin"->"管理员";else->if(p.flag("isMuted"))"已禁言" else ""},trailing=memberActions){controller.open("member",p.identifier(),r.id,p)}
                    }
                    ListFooter(state,controller,"暂无成员")
                }
                "member" -> {
                    PersonRow(d,d.text("role")){}
                    RowItem("查看个人资料"){controller.open("user",r.id,r.context)}
                    var remark by remember(r){mutableStateOf(d.text("memberRemark"))};Input("成员备注",remark,{remark=it});Action("保存备注",!state.loading){controller.mutate("PUT","/groups/${encoded(r.context)}/members/${encoded(r.id)}/remark",obj("remark" to remark),true)}
                    Section("管理操作由服务器校验权限")
                    RowItem(if(d.text("role")=="admin")"取消管理员" else "设为管理员"){confirm="确认更改成员权限？" to {controller.mutate("PUT","/groups/${encoded(r.context)}/members/${encoded(r.id)}/role",obj("role" to if(d.text("role")=="admin")"member" else "admin"),true)}}
                    RowItem(if(d.flag("isMuted"))"解除禁言" else "禁言 1 小时"){controller.mutate("POST",if(d.flag("isMuted"))"/group-members/unmute" else "/group-members/mute",obj("groupId" to r.context,"memberUserId" to r.id).apply {if(!d.flag("isMuted"))addProperty("mutedSeconds",3600)},true)}
                    RowItem("移出群聊",red=true){confirm="确定移除该成员？" to {controller.mutate("DELETE","/groups/${encoded(r.context)}/members/${encoded(r.id)}",obj("deleteMessages" to false),true)}}
                    RowItem("移除并删除该成员历史消息",red=true){confirm="该成员历史消息将对所有成员隐藏，确定继续？" to {controller.mutate("DELETE","/groups/${encoded(r.context)}/members/${encoded(r.id)}",obj("deleteMessages" to true),true)}}
                }
                "join-requests" -> {
                    state.items.forEach{request->PersonRow(request.child("applicant"),request.text("remark"),trailing={Row {TextButton(onClick={controller.mutate("POST","/groups/${encoded(r.id)}/join-requests/${encoded(request.identifier())}/approve")}){Text("同意")};TextButton(onClick={controller.mutate("POST","/groups/${encoded(r.id)}/join-requests/${encoded(request.identifier())}/reject")}){Text("拒绝")}}}){}}
                    ListFooter(state,controller,"暂无入群申请")
                }
                "group-name","group-id","group-remark","group-nickname" -> {
                    val key=when(r.page){"group-name"->"name";"group-id"->"id";"group-remark"->"remark";else->"myNickname"}
                    var value by remember(r,d){mutableStateOf(d.text(key))};Input(routeTitles[r.page].orEmpty(),value,{value=it})
                    if(r.page=="group-id")Section("群号仅可修改一次，格式和唯一性由服务器校验。")
                    Action("保存",!state.loading&&value.isNotBlank()){
                        when(r.page){"group-name"->controller.mutate("POST","/groups/settings/update",obj("groupId" to r.id,"name" to value),true){ res -> val imId=(res as? JsonObject)?.text("imGroupId").orEmpty().ifBlank { d.text("imGroupId") };if(imId.isNotBlank())model.noteGroupRenamed(imId,value) };"group-id"->controller.mutate("POST","/groups/public-id/update",obj("groupId" to r.id,"publicId" to value),true);"group-remark"->controller.mutate("PUT","/groups/${encoded(r.id)}/remark",obj("remark" to value),true);else->controller.mutate("PUT","/groups/${encoded(r.id)}/me/nickname",obj("nickname" to value),true)}
                    }
                }
                "profile" -> {
                    Row(Modifier.fillMaxWidth().background(C.field).clickable(enabled=!uploading){uploadPurpose="avatar";imagePicker.launch("image/*")}.padding(horizontal=(40*pageScale).dp,vertical=(24*pageScale).dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.SpaceBetween){SharedAvatar(d.text("avatar"),Modifier.size((120*pageScale).dp).clip(CircleShape));OriginalIcon("uni_mine_icon_chevron",Modifier.size((32*pageScale).dp))}
                    ProfileRow("昵称",d.text("nickname")){controller.open("edit-nickname")}
                    ProfileRow("个性签名",d.text("bio")){controller.open("edit-bio")}
                    Spacer(Modifier.height((16*pageScale).dp))
                    ProfileRow("电话号码",d.text("countryCode")+" "+d.text("phoneMasked"),chevron=false){}
                    Row(Modifier.fillMaxWidth().heightIn(min=(96*pageScale).dp).background(C.card).clickable{controller.open("edit-chat-id")}.padding(horizontal=(40*pageScale).dp,vertical=(20*pageScale).dp),verticalAlignment=Alignment.CenterVertically){Text("聊天号",Modifier.weight(1f),fontSize=(34*pageScale).sp,color=Body);Text(d.text("publicId"),fontSize=(32*pageScale).sp,color=C.hint,fontFamily=androidx.compose.ui.text.font.FontFamily.Monospace);Text("复制",Modifier.padding(start=(8*pageScale).dp).clip(RoundedCornerShape((8*pageScale).dp)).background(C.primary).clickable{(context.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager).setPrimaryClip(android.content.ClipData.newPlainText("聊天号",d.text("publicId")));NativeNotices.show("已复制")}.padding(horizontal=(16*pageScale).dp,vertical=(4*pageScale).dp),fontSize=(32*pageScale).sp,fontWeight=FontWeight.Bold,color=Color.White);OriginalIcon("uni_mine_icon_chevron",Modifier.padding(start=(16*pageScale).dp).size((32*pageScale).dp))}
                    ProfileRow("二维码"){controller.open("qrcode")}
                    Spacer(Modifier.height((16*pageScale).dp))
                    ProfileRow("注销帐号",red=true,chevron=false){controller.open("deletion")}
                }
                "onboarding" -> {
                    Text("还差一步！",Modifier.padding(24.dp),fontSize=28.sp,fontWeight=FontWeight.Bold,color=Body)
                    Section("请输入你的个人资料，以完成注册流程")
                    Box(Modifier.fillMaxWidth().clickable{uploadPurpose="avatar";imagePicker.launch("image/*")}.padding(24.dp),contentAlignment=Alignment.Center){SharedAvatar(newAvatarUrl.ifBlank{d.text("avatar")},Modifier.size(90.dp).clip(CircleShape))}
                    var name by remember(d){mutableStateOf(d.text("nickname"))};Input("请输入昵称",name,{name=it.take(15)})
                    Action("完成",name.isNotBlank()&&!uploading&&!state.loading){controller.saveProfile(name.trim(),d.text("bio"),newAvatarId)}
                    TextButton(onClick={controller.back()}){Text("稍后再说")}
                }
                "edit-nickname","edit-bio","edit-chat-id" -> {
                    val key=when(r.page){"edit-bio"->"bio";"edit-chat-id"->"publicId";else->"nickname"}
                    var value by remember(r,d){mutableStateOf(d.text(key))};Input(routeTitles[r.page].orEmpty(),value,{value=if(key=="nickname")it.take(15) else if(key=="bio")it.take(50) else it},multiline=r.page=="edit-bio")
                    if(r.page=="edit-chat-id")Section("聊天号仅可修改一次，格式和唯一性由服务器校验。")
                    Action("保存",!state.loading){if(r.page=="edit-chat-id")controller.mutate("PUT","/me/public-id",obj("publicId" to value),true) else controller.saveProfile(if(key=="nickname")value else d.text("nickname"),if(key=="bio")value else d.text("bio"))}
                }
                "blacklist" -> {SearchBox(state.keyword){controller.query(it)};state.items.forEach{p->PersonRow(p,p.text("publicId"),trailing={TextButton(onClick={confirm="将该用户移出黑名单？" to {controller.mutate("DELETE","/contacts/${encoded(p.identifier())}/block")}}){Text("移出",color=Blue)}}){controller.open("user",p.identifier())}};ListFooter(state,controller,"暂无黑名单用户")}
                "privacy" -> {PrivacyToggleRow("加我为好友需验证",d.flag("requireFriendApproval",true),state.privacyEditable){controller.savePrivacy("requireFriendApproval",it)};PrivacyToggleRow("邀请我加入群聊需验证",d.flag("requireGroupApproval",true),state.privacyEditable){controller.savePrivacy("requireGroupApproval",it)};RowItem("黑名单"){controller.open("blacklist")}}
                "favorites" -> Favorites(state,controller,model){text,action->confirm=text to action}
                "security" -> Security(state,controller)
                "reset-password" -> {
                    var password by remember(r){mutableStateOf("")};var again by remember(r){mutableStateOf("")}
                    Input("新密码",password,{password=it},true);Input("确认新密码",again,{again=it},true)
                    Action("确认",password.length>=6&&password==again&&!state.loading){controller.changePassword(password)}
                }
                "notifications" -> {
                    ToggleRow("消息免打扰",preferences.noDisturb){model.settings.set("noDisturb",it)}
                    if(!preferences.noDisturb) {
                        NotificationSection("应用未打开时")
                        ToggleRow("新消息通知",preferences.message){value->model.settings.set("message",value);if(value&&android.os.Build.VERSION.SDK_INT>=33)notificationPermission.launch(android.Manifest.permission.POST_NOTIFICATIONS)}
                        ToggleRow("语音邀请",preferences.voice){model.settings.set("voice",it)}
                        NotificationSection("应用打开时")
                        ToggleRow("声音",preferences.sound){model.settings.set("sound",it)}
                        ToggleRow("震动",preferences.vibration){model.settings.set("vibration",it)}
                    }
                    Text("系统通知权限",Modifier.fillMaxWidth().padding(top=(64*pageScale).dp,bottom=(24*pageScale).dp).clickable{context.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE,context.packageName))}.wrapContentWidth(),fontSize=(26*pageScale).sp,color=C.hint)
                }
                "chat-settings" -> {
                    ToggleRow("回车键送出消息",preferences.enterToSend,compact=true){model.settings.set("enterToSend",it)}
                    ToggleRow("自动缓存最近聊天媒体",preferences.autoCacheMedia,compact=true){model.settings.set("autoCacheMedia",it)}
                    ToggleRow("仅 Wi-Fi 自动缓存",preferences.wifiOnly,compact=true){model.settings.set("wifiOnly",it)}
                    ChatSettingCell("群发助手"){controller.open("mass-assistant")}
                    ChatSettingCell("我的表情"){controller.open("emotions")}
                    var clearNote by remember{mutableStateOf("")};var clearing by remember{mutableStateOf(false)}
                    ChatSettingCell(if(clearing)"正在清除…" else "清除聊天记录",chevron=false,enabled=!clearing){confirm="将清除本账号所有会话在各设备中的聊天记录，不会影响其他人的记录。未确认发送结果将保留。" to {clearing=true;model.clearAllHistories{result->clearing=false;clearNote=result.fold({it},{it.message?:"清除失败"})}}}
                    if(clearNote.isNotBlank())Section(clearNote)
                }
                "emotions" -> StickerManager(state,controller,uploading){uploadPurpose="sticker";imagePicker.launch("image/*")}
                "general" -> {
                    GeneralRow("切换语言","简体中文"){NativeNotices.show("暂仅支持简体中文")}
                    GeneralRow("显示模式","行动版"){NativeNotices.show("暂仅支持行动版")}
                    GeneralRow("意见反馈"){controller.open("feedback")};GeneralRow("关于我们"){controller.open("about")}
                    var note by remember{mutableStateOf("")};var busy by remember{mutableStateOf(false)}
                    GeneralRow("清除缓存数据",enabled=!busy){confirm="仅清理可重新下载的媒体缓存，保留聊天记录和待发内容。" to {busy=true;model.clearDownloads{result->busy=false;note=result.fold({"已清除下载缓存"},{it.message?:"清除失败"})}}}
                    GeneralRow("重新选线",enabled=!busy){confirm="将重新检查聊天连接。" to {busy=true;model.reconnectChat{result->busy=false;note=result.fold({"已请求重新连接"},{it.message?:"连接检查失败"})}}}
                    GeneralRow("调试资讯"){controller.open("debug")}
                    if(note.isNotBlank())Section(note)
                }
                "feedback" -> {var content by remember(r){mutableStateOf("")};var contact by remember(r){mutableStateOf("")};Input("请输入您遇到的问题或建议",content,{content=it},multiline=true);Input("联系方式（选填）",contact,{contact=it});ImageAttachments(model,r){list,busy->attachments=list;attaching=busy};Action("提交反馈",content.isNotBlank()&&!state.loading&&!attaching){controller.mutate("POST","/feedbacks",obj("content" to content,"contact" to contact,"imageFileIds" to attachments.map{it.id}),true)}}
                "about" -> NativeAboutPage(model,onLegal)
                "debug" -> NativeDebugPage(model)
                "deletion" -> Deletion(state,controller,model){text,action->confirm=text to action}
                "report-user" -> {var reason by remember(r){mutableStateOf("")};var description by remember(r){mutableStateOf("")};state.items.forEach{item->CheckRow(item.text("reason"),reason==item.identifier()){reason=item.identifier()}};Input("补充说明",description,{description=it},multiline=true);ImageAttachments(model,r){list,busy->attachments=list;attaching=busy};Action("提交举报",reason.isNotBlank()&&!state.loading&&!attaching){controller.mutate("POST","/reports",obj("targetType" to "user","targetId" to r.id,"reasonId" to reason,"description" to description,"evidenceFileIds" to attachments.map{it.id}),true)}}
                "report-group" -> {
                    Section("请选择举报原因")
                    listOf("spam" to "垃圾广告","fraud" to "欺诈","pornography" to "色情","violence" to "暴力","harassment" to "骚扰","other" to "其他").forEach{(reason,label)->RowItem(label){controller.open("report-group-submit",r.id,reason)}}
                }
                "report-group-submit" -> {
                    var description by remember(r){mutableStateOf("")}
                    Input("补充说明",description,{description=it.take(500)},multiline=true)
                    ImageAttachments(model,r){list,busy->attachments=list;attaching=busy}
                    Action("提交举报",!state.loading&&!attaching){controller.mutate("POST","/groups/reports",obj("groupId" to r.id,"reason" to r.context,"description" to description,"imageFileIds" to attachments.map{it.id}),true)}
                }
            }
        }}
        // 底部固定主按钮，对标 H5 footer primary-btn（add-group 的按钮在内容区内，不在此处）
        if(r.page=="add-friend")PrimaryButton(if(state.loading)"搜索中..." else "搜索",!state.loading){if(addFriendKeyword.isBlank())controller.reportError("请输入聊天号")else{addFriendSearched=true;controller.searchUser(addFriendKeyword)}}
        if(r.page=="create-group"&&createGroupStep)PrimaryButton(if(state.loading)"创建中..." else "创建",createGroupName.isNotBlank()&&!state.loading,horizontal=32){controller.createGroup(createGroupName,createGroupSelected)}
    }
    confirm?.let{(text,action)->AlertDialog(onDismissRequest={confirm=null},title={Text("提示")},text={Text(text)},confirmButton={TextButton(onClick={confirm=null;action()}){Text("确认")}},dismissButton={TextButton(onClick={confirm=null}){Text("取消")}})}
    // 禁言时长档位与 H5 constants/mute.ts 保持一致（上限 30 天）
    muteTarget?.let{(groupId,member)->AlertDialog(onDismissRequest={muteTarget=null},title={Text("禁言 ${member.displayName().ifBlank{"该成员"}}")},text={Column{listOf("10分钟" to 600,"1小时" to 3600,"12小时" to 43200,"1天" to 86400,"7天" to 604800,"30天" to 2592000).forEach{(label,seconds)->Text(label,Modifier.fillMaxWidth().clickable{muteTarget=null;controller.mutate("POST","/group-members/mute",obj("groupId" to groupId,"memberUserId" to member.identifier()).apply{addProperty("mutedSeconds",seconds)})}.padding(vertical=12.dp),fontSize=16.sp)}}},confirmButton={TextButton(onClick={muteTarget=null}){Text("取消")}})}
    removeTarget?.let{(groupId,member)->AlertDialog(onDismissRequest={removeTarget=null},title={Text("移除 ${member.displayName().ifBlank{"该成员"}}")},text={Column{Text("移除并删除其消息",Modifier.fillMaxWidth().clickable{removeTarget=null;controller.removeGroupMember(groupId,member.identifier(),true)}.padding(vertical=12.dp),color=Red,fontSize=16.sp);Text("仅移除成员",Modifier.fillMaxWidth().clickable{removeTarget=null;controller.removeGroupMember(groupId,member.identifier(),false)}.padding(vertical=12.dp),fontSize=16.sp)}},confirmButton={TextButton(onClick={removeTarget=null}){Text("取消")}})}
    modal?.let{(title,save)->AlertDialog(onDismissRequest={modal=null},title={Text(title)},text={Input("",modalText,{modalText=it})},confirmButton={TextButton(enabled=modalText.isNotBlank(),onClick={modal=null;save(modalText)}){Text("保存")}},dismissButton={TextButton(onClick={modal=null}){Text("取消")}})}
}

@Composable internal fun AdminMemberPicker(state:BusinessState,controller:BusinessController,modifier:Modifier=Modifier) {
    val s=scale()
    var keyword by remember(state.route){mutableStateOf("")}
    var selected by remember(state.route){mutableStateOf(emptySet<String>())}
    val eligible=remember(state.items){adminCandidates(state.items)}
    val filtered=remember(eligible,keyword){adminCandidates(eligible,keyword)}
    val allowedIds=remember(eligible){eligible.map{it.identifier()}.toSet()}
    LaunchedEffect(allowedIds){selected=selected.intersect(allowedIds)}
    val canChoose=!state.loading
    Column(modifier.fillMaxWidth().background(C.card)) {
        SearchBox(keyword,original=true,auto=true){keyword=it}
        Text("可选成员 (${if(state.loading&&state.items.isEmpty())"…" else filtered.size})",Modifier.fillMaxWidth().padding(start=(32*s).dp,end=(32*s).dp,bottom=(12*s).dp),fontSize=(32*s).sp,fontWeight=FontWeight.Bold,color=Body)
        LazyColumn(Modifier.weight(1f).fillMaxWidth(),contentPadding=PaddingValues(bottom=(16*s).dp)) {
            items(filtered,key={"admin-candidate:"+it.identifier()}) {member->
                val id=member.identifier();val checked=id in selected
                Row(Modifier.fillMaxWidth().toggleable(checked,enabled=canChoose,role=androidx.compose.ui.semantics.Role.Checkbox,onValueChange={value->selected=if(value)selected+id else selected-id}).padding(horizontal=(32*s).dp,vertical=(20*s).dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy((20*s).dp)) {
                    SharedAvatar(member.text("avatar").ifBlank{member.text("Avatar")},Modifier.size((88*s).dp).clip(CircleShape).semantics {contentDescription=adminMemberName(member)+"的头像"})
                    Text(adminMemberName(member),Modifier.weight(1f),fontSize=(30*s).sp,color=C.text,maxLines=1,overflow=TextOverflow.Ellipsis)
                    Box(Modifier.size((40*s).dp).clip(CircleShape).border((2*s).dp,if(checked)C.primary else C.placeholder,CircleShape).background(if(checked)C.primary else Color.Transparent).semantics {contentDescription="选择"+adminMemberName(member)})
                }
            }
            if(filtered.isEmpty())item(key="admin-picker-empty") {Text(if(state.loading)"加载中…" else if(eligible.isEmpty())"暂无可设为管理员的普通成员" else "无匹配成员",Modifier.fillMaxWidth().padding(horizontal=(40*s).dp,vertical=(120*s).dp).wrapContentWidth(),fontSize=(28*s).sp,color=Muted)}
        }
        // 确认入口独立于长名单，滚动和搜索时始终留在底部。
        val canSubmit=selected.isNotEmpty()&&!state.loading
        Box(Modifier.fillMaxWidth().padding(horizontal=(32*s).dp,vertical=(24*s).dp)) {
            Box(Modifier.fillMaxWidth().height((96*s).dp).clip(RoundedCornerShape((16*s).dp)).background(C.primary).alpha(if(canSubmit)1f else .45f).clickable(enabled=canSubmit){controller.addAdmins(state.route.id,selected.intersect(allowedIds))}.semantics {contentDescription="确认添加管理员"},contentAlignment=Alignment.Center) {
                Text(if(state.loading&&selected.isNotEmpty())"保存中…" else if(selected.isEmpty())"确认" else "确认（${selected.size}）",fontSize=(32*s).sp,fontWeight=FontWeight.SemiBold,color=Color.White)
            }
        }
    }
}

@Composable private fun CheckRow(title:String,checked:Boolean,change:(Boolean)->Unit) {Row(Modifier.fillMaxWidth().background(C.card).clickable{change(!checked)}.padding(horizontal=18.dp,vertical=6.dp),verticalAlignment=Alignment.CenterVertically){Text(title,Modifier.weight(1f),fontSize=16.sp,color=Body);Checkbox(checked,change,colors=CheckboxDefaults.colors(checkedColor=Blue))}}
@Composable private fun NotificationSection(title:String) {
    val s=scale()
    Column(Modifier.fillMaxWidth().padding(start=(40*s).dp,end=(40*s).dp,top=(30*s).dp)) {
        HorizontalDivider(color=C.line,thickness=s.dp)
        Text(title,Modifier.padding(top=(30*s).dp,bottom=(16*s).dp),fontSize=(26*s).sp,lineHeight=(44*s).sp,fontWeight=FontWeight.Bold,color=C.textStrong)
    }
}
@Composable private fun ChatSettingCell(title:String,chevron:Boolean=true,enabled:Boolean=true,onClick:()->Unit) {
    val s=scale()
    Row(Modifier.fillMaxWidth().clickable(enabled=enabled,onClick=onClick).padding(horizontal=(32*s).dp,vertical=(20*s).dp),verticalAlignment=Alignment.CenterVertically) {
        Text(title,Modifier.weight(1f),fontSize=(30*s).sp,lineHeight=(40*s).sp,color=Body)
        if(chevron)Text("›",fontSize=(32*s).sp,color=C.placeholder)
    }
}
@Composable internal fun PrivacyToggleRow(title:String,checked:Boolean,enabled:Boolean=true,change:(Boolean)->Unit) {
    val s=scale()
    Row(Modifier.fillMaxWidth().heightIn(min=(96*s).dp).background(C.card).padding(horizontal=(40*s).dp,vertical=(16*s).dp),verticalAlignment=Alignment.CenterVertically) {
        Text(title,Modifier.weight(1f).padding(end=(24*s).dp),fontSize=(30*s).sp,lineHeight=(44*s).sp,color=C.textStrong)
        // 开关独立占位，长标题及系统字体放大只换行，不挤掉关闭态轨道。
        Box(Modifier.size((56*s).dp,(36*s).dp),contentAlignment=Alignment.Center) {
            Switch(checked=checked,onCheckedChange=change,enabled=enabled,
                modifier=Modifier.requiredSize(52.dp,32.dp).scale(56*s/52f).semantics {contentDescription=title},
                colors=SwitchDefaults.colors(checkedThumbColor=Color.White,checkedTrackColor=C.primary,uncheckedThumbColor=Color.White,uncheckedTrackColor=C.line,uncheckedBorderColor=C.line))
        }
    }
}

@Composable internal fun ToggleRow(title:String,checked:Boolean,enabled:Boolean=true,compact:Boolean=false,change:(Boolean)->Unit) {
    val s=scale()
    val offset by androidx.compose.animation.core.animateFloatAsState(if(checked)20f else 0f,label="switch")
    Row(Modifier.fillMaxWidth().heightIn(min=((if(compact)0 else 96)*s).dp).background(C.card).padding(horizontal=((if(compact)32 else 40)*s).dp,vertical=((if(compact)20 else 16)*s).dp),verticalAlignment=Alignment.CenterVertically) {
        Text(title,Modifier.weight(1f),fontSize=(30*s).sp,lineHeight=((if(compact)40 else 44)*s).sp,color=C.textStrong)
        Box(Modifier.size((56*s).dp,(36*s).dp).clip(CircleShape).background(if(checked)C.primary else C.field).then(if(enabled)Modifier else Modifier.alpha(.45f)).toggleable(checked,enabled=enabled,role=androidx.compose.ui.semantics.Role.Switch,onValueChange=change)) {
            Box(Modifier.offset(x=((4+offset)*s).dp,y=(4*s).dp).size((28*s).dp).clip(CircleShape).background(C.card))
        }
    }
}

@Composable private fun CircleCheck(on:Boolean) {
    // 对标 H5 选人列表的圆形勾选框：选中蓝底白勾，未选中灰底灰边
    val s=scale()
    Box(Modifier.size((48*s).dp).clip(CircleShape).border((2*s).dp,if(on)C.primary else C.line,CircleShape).background(if(on)C.primary else C.field)) {
        if(on)Canvas(Modifier.fillMaxSize()){
            val w=size.width
            drawLine(Color.White,androidx.compose.ui.geometry.Offset(w*.30f,w*.52f),androidx.compose.ui.geometry.Offset(w*.45f,w*.68f),strokeWidth=w*.08f,cap=androidx.compose.ui.graphics.StrokeCap.Round)
            drawLine(Color.White,androidx.compose.ui.geometry.Offset(w*.45f,w*.68f),androidx.compose.ui.geometry.Offset(w*.72f,w*.32f),strokeWidth=w*.08f,cap=androidx.compose.ui.graphics.StrokeCap.Round)
        }
    }
}
@Composable private fun GroupAdmin(state:BusinessState,c:BusinessController) {
    val r=state.route;val d=state.detail
    RowItem("入群申请"){c.open("join-requests",r.id)}
    RowItem("群管理员"){c.open("admins",r.id)}
    ToggleRow("全员禁言",d.flag("allMuted"),!state.loading){c.mutate("POST","/groups/settings/update",obj("groupId" to r.id,"allMuted" to it))}
    ToggleRow("允许群成员互加好友",d.flag("allowMemberAddFriend",true),!state.loading){c.mutate("POST","/groups/settings/update",obj("groupId" to r.id,"allowMemberAddFriend" to it))}
    ToggleRow("入群需审核",d.text("joinMode")=="approval",!state.loading){c.mutate("POST","/groups/settings/update",obj("groupId" to r.id,"joinMode" to if(it)"approval" else "open"))}
}

@Composable private fun Favorites(state:BusinessState,c:BusinessController,model:BootstrapViewModel,confirm:(String,()->Unit)->Unit) {
    val context=LocalContext.current
    var filter by remember{mutableStateOf(0)}
    var managing by remember{mutableStateOf(false)};var selected by remember{mutableStateOf(emptySet<String>())}
    var forwarding by remember{mutableStateOf<com.im.nativebootstrap.chat.ChatMessage?>(null)};var source by remember{mutableStateOf("")};var preparing by remember{mutableStateOf(false)};var note by remember{mutableStateOf("")}
    forwarding?.let{message->androidx.compose.ui.window.Dialog(onDismissRequest={forwarding=null},properties=androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth=false)){
        com.im.nativebootstrap.NativeForwardPicker(1,{forwarding=null},model::loadForwardTargets,{selection,done->model.submitFavoriteForward(listOf(message),source,selection,done)},{result->forwarding=null;note=if(result.queued)"转发任务已入队" else "消息已提交"})
    }}
    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.End){TextButton(onClick={managing=!managing;selected=emptySet()}){Text(if(managing)"完成" else "管理")}}
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).background(C.card)){listOf("全部","文字","图片与视频","文件","语音").forEachIndexed{index,label->TextButton(onClick={filter=index;c.query(index.toString());selected=emptySet()}){Text(label,color=if(filter==index)Blue else Muted)}}}
    if(managing)Row {
        TextButton(onClick={selected=if(state.items.all{it.identifier() in selected})emptySet() else state.items.map{it.identifier()}.toSet()}){Text("全选 / 取消当前页")}
        TextButton(enabled=selected.isNotEmpty()&&!state.loading,onClick={confirm("删除选中的 ${selected.size} 条收藏？"){c.deleteFavorites(selected);selected=emptySet()}}){Text("删除（${selected.size}）",color=Red)}
    }
    if(preparing)LinearProgressIndicator(Modifier.fillMaxWidth())
    if(note.isNotBlank())Section(note)
    state.items.forEach{favorite->Column(Modifier.fillMaxWidth().padding(horizontal=14.dp,vertical=6.dp).clip(RoundedCornerShape(8.dp)).background(C.card).padding(16.dp)) {
        if(managing)CheckRow("选择",favorite.identifier() in selected){value->selected=if(value)selected+favorite.identifier() else selected-favorite.identifier()}
        NativeFavoriteContent(favorite.text("type"),favorite.text("content"))
        Text(favorite.text("createdAt"),Modifier.padding(top=10.dp),fontSize=12.sp,color=Muted)
        Row {
            if(favorite.text("type") in listOf("text","emoji"))TextButton(onClick={(context.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager).setPrimaryClip(android.content.ClipData.newPlainText("收藏",favorite.text("content")));note="已复制"}){Text("复制")}
            TextButton(enabled=!preparing,onClick={preparing=true;model.loadFavoriteSource(favorite.text("messageId"),favorite.text("conversationId")){result->preparing=false;result.fold({message->source=favorite.text("conversationId");forwarding=message},{error->note=error.message?:"请回到聊天同步原消息后转发"})}}){Text("转发")}
            TextButton(onClick={confirm("取消收藏这条内容？"){c.mutate("DELETE","/favorites/${encoded(favorite.identifier())}")}}){Text("取消收藏",color=Red)}
        }
    }};ListFooter(state,c,"暂无收藏")
}

@Composable private fun Security(state:BusinessState,c:BusinessController,modifier:Modifier=Modifier) {
    val s=scale()
    var old by remember{mutableStateOf("")}
    var show by remember{mutableStateOf(false)}
    Column(modifier.fillMaxWidth().background(C.card).padding(horizontal=(40*s).dp,vertical=(32*s).dp)) {
        Text("手机号码",fontSize=(28*s).sp,color=Body)
        Text(state.detail.text("countryCode").removePrefix("+")+" "+state.detail.text("phoneMasked"),Modifier.padding(top=(24*s).dp,bottom=(40*s).dp),fontSize=(32*s).sp,color=C.hint)
        HorizontalDivider(color=C.line);Spacer(Modifier.height((32*s).dp))
        Text(if(state.detail.flag("hasPassword"))"修改密码" else "设置密码",fontSize=(32*s).sp,fontWeight=FontWeight.Bold,color=Body)
        if(state.detail.flag("hasPassword")) {
            Text("旧密码",Modifier.padding(top=(24*s).dp,bottom=(20*s).dp),fontSize=(28*s).sp,color=Body)
            Row(Modifier.fillMaxWidth().height((96*s).dp).clip(RoundedCornerShape((8*s).dp)).border(1.dp,C.line,RoundedCornerShape((8*s).dp)).padding(horizontal=(32*s).dp),verticalAlignment=Alignment.CenterVertically){BasicTextField(old,{old=it},Modifier.weight(1f),singleLine=true,textStyle=TextStyle(fontSize=(32*s).sp,color=Body),visualTransformation=if(show)VisualTransformation.None else PasswordVisualTransformation(),decorationBox={inner->if(old.isBlank())Text("请输入旧密码",fontSize=(32*s).sp,color=C.hint);inner()});Text(if(show)"◉" else "⊘",Modifier.size((72*s).dp).clickable{show=!show}.wrapContentSize(),fontSize=(36*s).sp,color=C.hint)}
        }
        Spacer(Modifier.weight(1f))
        val enabled=!state.loading&&(!state.detail.flag("hasPassword")||old.isNotBlank())
        Box(Modifier.fillMaxWidth().height((96*s).dp).clip(RoundedCornerShape((8*s).dp)).background(if(enabled)C.primary else C.field).clickable(enabled=enabled){if(state.detail.flag("hasPassword")){c.verifyOldPassword(old);old=""}else c.open("reset-password",context="init")},contentAlignment=Alignment.Center){Text("下一步",fontSize=(28*s).sp,fontWeight=FontWeight.SemiBold,color=if(enabled)Color.White else C.placeholder)}
    }
}

@Composable private fun Deletion(state:BusinessState,c:BusinessController,model:BootstrapViewModel,confirm:(String,()->Unit)->Unit) {
    val d=state.detail;val blockers=elements(d.get("blockers"));val summary=d.child("summary")
    Section("注销账号后，账号及关联资料将按服务端规则处理。请仔细阅读并确认。")
    listOf("friendCount" to "好友","groupCount" to "群聊","favoriteCount" to "收藏","fileCount" to "文件").forEach{(key,label)->RowItem(label,summary.text(key),enabled=false){}}
    blockers.forEach{b->Text(b.text("message"),Modifier.padding(18.dp),color=Red);if(b.text("groupId").isNotBlank())RowItem(b.text("groupName")){c.open("group",b.text("groupId"))}}
    if(d.flag("canDelete")) {
        var phone by remember{mutableStateOf("")};var code by remember{mutableStateOf("")};var country by remember{mutableStateOf("+86")};var acknowledge by remember{mutableStateOf("")};var smsNote by remember{mutableStateOf("")}
        Input("国家/地区",country,{country=it});Input("完整手机号",phone,{phone=it});Input("短信验证码",code,{code=it})
        TextButton(onClick={model.authRequest(com.im.nativebootstrap.data.RuntimeEndpoints.DEFAULT_API_BASE_URL,"/auth/sms/send",obj("countryCode" to country,"phone" to phone,"scene" to "delete_account")){smsNote=it.fold({"验证码已发送"},{"发送失败，请重试"})}}){Text("发送验证码")}
        Text(smsNote,Modifier.padding(horizontal=20.dp),color=Muted,fontSize=12.sp)
        Input("请输入：${d.text("confirmPhrase")}",acknowledge,{acknowledge=it})
        Action("确认注销账号",phone.isNotBlank()&&code.isNotBlank()&&acknowledge==d.text("confirmPhrase")&&!state.loading,true){confirm("此操作将注销账号，确定继续？"){c.deleteAccount(phone,country,code,acknowledge)}}
    }
}

