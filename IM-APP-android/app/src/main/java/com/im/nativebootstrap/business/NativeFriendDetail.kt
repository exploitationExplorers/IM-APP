package com.im.nativebootstrap.business

import com.im.nativebootstrap.NativeNotices

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.im.nativebootstrap.BootstrapViewModel
import com.im.nativebootstrap.R
import com.im.nativebootstrap.chat.ChatConversation
import com.im.nativebootstrap.media.SharedAvatar

private val FriendInk=Color(0xFF212121)
private val FriendPage=Color(0xFFF3F4F7)
private val FriendBlue=Color(0xFF0A2FC2)

@OptIn(ExperimentalFoundationApi::class)
@Composable private fun FriendInfoRow(label:String,value:String="",arrow:Boolean=false,copyValue:(()->Unit)?=null,trailing:(@Composable RowScope.()->Unit)?=null,onClick:(()->Unit)?=null) {
    val s=LocalConfiguration.current.screenWidthDp/750f
    Row(Modifier.fillMaxWidth().heightIn(min=(96*s).dp).then(if(onClick!=null)Modifier.clickable(onClick=onClick) else Modifier).padding(horizontal=(40*s).dp,vertical=(20*s).dp),verticalAlignment=Alignment.CenterVertically){
        Text(label,fontSize=(34*s).sp,lineHeight=(48*s).sp,color=FriendInk)
        Spacer(Modifier.width((24*s).dp))
        if(trailing==null||value.isNotBlank())Text(value,Modifier.weight(1f).then(if(copyValue!=null)Modifier.combinedClickable(onClick={onClick?.invoke()},onDoubleClick=copyValue,onLongClick=copyValue) else Modifier),textAlign=TextAlign.End,fontSize=(32*s).sp,color=FriendInk,maxLines=1,overflow=TextOverflow.Ellipsis)
        trailing?.invoke(this)
        if(arrow)Image(painterResource(R.drawable.uni_icon_chevron),null,Modifier.padding(start=(16*s).dp).size((40*s).dp).alpha(.45f))
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable fun NativeFriendDetail(state:BusinessState,c:BusinessController,model:BootstrapViewModel) {
    val s=LocalConfiguration.current.screenWidthDp/750f
    val context=LocalContext.current
    val r=state.route;val d=state.detail
    val routeVersion=remember(r){c.routeVersion}
    var menu by remember(r){mutableStateOf(false)}
    var confirmation by remember(r){mutableStateOf<String?>(null)}
    var conversation by remember(r){mutableStateOf<ChatConversation?>(null)}
    var settingsLoading by remember(r){mutableStateOf(false)}
    var settingsError by remember(r){mutableStateOf("")}
    var busy by remember(r){mutableStateOf(false)}
    var note by remember(r){mutableStateOf("")}
    val name=d.text("remark").ifBlank{d.text("nickname")}
    val groups=elements(d.get("commonGroups"))
    fun toast(text:String){NativeNotices.show(text)}
    fun copy(text:String){if(text.isNotBlank()){(context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("",text));toast("已复制")}}
    fun loadSettings(){settingsLoading=true;settingsError="";model.loadBusinessConversation(r.id,false){result->settingsLoading=false;result.fold({conversation=it},{settingsError=it.message?:"会话设置未加载"})}}
    fun updateSettings(pinned:Boolean?=null,muted:Boolean?=null){
        val current=conversation?:return
        busy=true;note=""
        model.updateConversation(current,pinned,muted){result->busy=false;result.fold({conversation=current.copy(pinned=pinned?:current.pinned,muted=muted?:current.muted)},{note=it.message?:"设置未完成"})}
    }
    LaunchedEffect(r){loadSettings()}
    Box(Modifier.fillMaxSize().background(FriendPage)) {
        Image(painterResource(R.drawable.uni_friend_info_bg),null,Modifier.fillMaxWidth().height((460*s).dp),contentScale=ContentScale.Crop)
        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
            Row(Modifier.fillMaxWidth().height((96*s).dp).background(Color.White).padding(horizontal=(32*s).dp),verticalAlignment=Alignment.CenterVertically){
                Box(Modifier.width((72*s).dp).fillMaxHeight().clickable{c.back()},contentAlignment=Alignment.CenterStart){Image(painterResource(R.drawable.uni_icon_back),"返回",Modifier.size((44*s).dp))}
                Text("好友详情",Modifier.weight(1f),fontSize=(40*s).sp,fontWeight=FontWeight.Bold,textAlign=TextAlign.Center,color=FriendInk)
                Box(Modifier.size((72*s).dp),contentAlignment=Alignment.Center){
                    Image(painterResource(R.drawable.uni_icon_more),"更多",Modifier.size((36*s).dp).rotate(90f).clickable{menu=!menu})
                    DropdownMenu(expanded=menu,onDismissRequest={menu=false}){
                        DropdownMenuItem(text={Text(if(d.flag("isBlocked"))"移出黑名单" else "加入黑名单",fontSize=(28*s).sp)},leadingIcon={Image(painterResource(R.drawable.uni_icon_block),null,Modifier.size((40*s).dp))},enabled=!busy&&!state.loading&&d.identifier().isNotBlank(),onClick={menu=false;confirmation="block"})
                        DropdownMenuItem(text={Text("删除联络人",fontSize=(28*s).sp,color=Color(0xFFEF4343))},leadingIcon={Image(painterResource(R.drawable.uni_icon_profile_remove),null,Modifier.size((40*s).dp))},enabled=!busy&&!state.loading&&d.identifier().isNotBlank(),onClick={menu=false;confirmation="delete"})
                    }
                }
            }
            if(state.loading)LinearProgressIndicator(Modifier.fillMaxWidth(),color=FriendBlue)
            state.error?.let{Text("$it · 重试",Modifier.fillMaxWidth().background(Color.White).clickable{c.refresh()}.padding(12.dp),fontSize=13.sp,color=Color(0xFFDC2828))}
            Spacer(Modifier.height((60*s).dp))
            if(d.identifier().isNotBlank()){
                NativePullRefresh(state.loading,{c.refresh()},Modifier.weight(1f)) {
                    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                        // 把头像上探区域留在滚动视口内，避免 scroll 裁掉上方 40 rpx。
                        Spacer(Modifier.height((40*s).dp))
                        Column(Modifier.fillMaxWidth().background(Color.White,RoundedCornerShape(topStart=(32*s).dp,topEnd=(32*s).dp))) {
                            Box(Modifier.fillMaxWidth().heightIn(min=(132*s).dp)){
                                Row(Modifier.fillMaxWidth().offset(y=(-40*s).dp).padding(horizontal=(48*s).dp),horizontalArrangement=Arrangement.spacedBy((32*s).dp),verticalAlignment=Alignment.Top){
                                    SharedAvatar(d.text("avatar"),Modifier.size((144*s).dp).clip(CircleShape).border((4*s).dp,Color.White,CircleShape))
                                    Column(Modifier.weight(1f).padding(top=(36*s).dp).heightIn(min=(104*s).dp)){
                                        Text(name,Modifier.fillMaxWidth().combinedClickable(onClick={},onDoubleClick={copy(name)},onLongClick={copy(name)}),fontSize=(34*s).sp,lineHeight=(48*s).sp,fontWeight=FontWeight.Bold,color=FriendInk,maxLines=1,overflow=TextOverflow.Ellipsis)
                                        if(d.text("remark").isNotBlank()&&d.text("nickname").isNotBlank()&&d.text("remark").trim()!=d.text("nickname").trim())Text("昵称："+d.text("nickname"),Modifier.padding(top=(6*s).dp).combinedClickable(onClick={},onDoubleClick={copy(d.text("nickname"))},onLongClick={copy(d.text("nickname"))}),fontSize=(24*s).sp,lineHeight=(34*s).sp,color=Color(0xFF9AA3B5),maxLines=1,overflow=TextOverflow.Ellipsis)
                                        if(d.flag("isBlocked"))Text("已拉黑",Modifier.padding(top=(8*s).dp).clip(RoundedCornerShape((8*s).dp)).background(Color(0xFFFFE5E5)).padding(horizontal=(16*s).dp,vertical=(4*s).dp),fontSize=(22*s).sp,color=Color(0xFFE54D42))
                                    }
                                }
                            }
                            HorizontalDivider(Modifier.padding(start=(40*s).dp,end=(40*s).dp,top=(8*s).dp),color=Color(0xFFE1E3EA),thickness=s.dp)
                            FriendInfoRow("备注",d.text("remark"),arrow=true,copyValue={copy(d.text("remark"))}){c.open("friend-remark",r.id)}
                            val since=contactEventTime(d.text("friendSince"));if(since.isNotBlank())FriendInfoRow("添加时间",since)
                            val last=contactLastSeen(d.text("lastSeenAt"));if(last.isNotBlank())FriendInfoRow("最近上线",last)
                            FriendInfoRow("聊天号",trailing={
                                Text(d.text("publicId").ifBlank{"—"},Modifier.weight(1f).padding(start=(8*s).dp),textAlign=TextAlign.End,fontSize=(32*s).sp,color=Color(0xFF626E8D),fontFamily=FontFamily.Monospace,maxLines=1,overflow=TextOverflow.Ellipsis)
                                if(d.text("publicId").isNotBlank())Text("复制",Modifier.padding(start=(16*s).dp).height((64*s).dp).clip(RoundedCornerShape((8*s).dp)).background(Color(0xFF3C83F6)).clickable{copy(d.text("publicId"))}.padding(horizontal=(16*s).dp).wrapContentSize(),fontSize=(28*s).sp,fontWeight=FontWeight.SemiBold,color=Color.White)
                            })
                            FriendInfoRow("标签",elements(d.get("tags")).joinToString("、"){it.text("name")},arrow=true){c.open("friend-tags",r.id,seed=d)}
                        }
                        if(groups.isNotEmpty()){
                            Row(Modifier.fillMaxWidth().heightIn(min=(64*s).dp).padding(horizontal=(40*s).dp,vertical=(16*s).dp),verticalAlignment=Alignment.CenterVertically){
                                Text("共同群组 (${groups.size})",Modifier.weight(1f),fontSize=(28*s).sp,lineHeight=(40*s).sp,fontWeight=FontWeight.Bold,color=FriendInk)
                                if(groups.size>3)Text("查看全部",Modifier.clickable{c.open("common-groups",r.id)},fontSize=(24*s).sp,color=FriendInk)
                            }
                            groups.take(3).forEach{group->Row(Modifier.fillMaxWidth().background(Color.White).clickable{c.openChat(group,true)}.padding(horizontal=(40*s).dp,vertical=(16*s).dp),verticalAlignment=Alignment.CenterVertically){
                                SharedAvatar(group.text("avatar"),Modifier.size((96*s).dp).clip(CircleShape),true)
                                Text(group.text("name"),Modifier.weight(1f).padding(start=(32*s).dp),fontSize=(32*s).sp,color=FriendInk,maxLines=1,overflow=TextOverflow.Ellipsis)
                                Image(painterResource(R.drawable.uni_icon_chevron),null,Modifier.size((40*s).dp).alpha(.45f))
                            }}
                        }
                        Column(Modifier.fillMaxWidth().padding(top=(24*s).dp).clip(RoundedCornerShape((24*s).dp)).background(Color.White)){
                            ToggleRow("消息免打扰",conversation?.muted?:false,enabled=conversation!=null&&!busy){updateSettings(muted=it)}
                            HorizontalDivider(color=Color(0xFFF0F0F0),thickness=s.dp)
                            ToggleRow("置顶聊天",conversation?.pinned?:false,enabled=conversation!=null&&!busy){updateSettings(pinned=it)}
                            if(settingsLoading)Text("正在加载会话设置…",Modifier.padding(12.dp),color=Color.Gray,fontSize=12.sp)
                            if(settingsError.isNotBlank())Text("$settingsError · 点击重试",Modifier.fillMaxWidth().clickable(enabled=!settingsLoading){loadSettings()}.padding(12.dp),color=Color(0xFFDC2828),fontSize=12.sp)
                        }
                        if(note.isNotBlank())Text(note,Modifier.padding(16.dp),color=Color(0xFF626E8D),fontSize=13.sp)
                        Spacer(Modifier.height((16*s).dp))
                    }
                }
                Row(Modifier.fillMaxWidth().padding(horizontal=(40*s).dp,vertical=(16*s).dp).height((80*s).dp).clip(RoundedCornerShape((8*s).dp)).background(FriendBlue).clickable(enabled=!busy&&!state.loading){c.openChat(d)},horizontalArrangement=Arrangement.Center,verticalAlignment=Alignment.CenterVertically){Image(painterResource(R.drawable.uni_icon_chat_white),null,Modifier.size((40*s).dp));Text("消息",Modifier.padding(start=(8*s).dp),fontSize=(28*s).sp,fontWeight=FontWeight.SemiBold,color=Color.White)}
            }else Spacer(Modifier.weight(1f))
        }
    }
    confirmation?.let{action->val delete=action=="delete";val blocked=!d.flag("isBlocked");AlertDialog(onDismissRequest={confirmation=null},title={Text(if(delete)"删除联络人" else if(blocked)"加入黑名单" else "移出黑名单")},text={Text(if(delete)"确定删除「$name」？" else if(blocked)"拉黑后对方将无法再向你发送消息，解除后可恢复。" else "解除后对方可正常向你发送消息。")},confirmButton={TextButton(onClick={
        confirmation=null;busy=true;note=""
        model.updateContactRelation(r.id,delete,blocked,conversation){result->
            busy=false
            if(c.routeVersion==routeVersion)result.fold({toast(it);if(delete)c.back() else c.refresh()},{note=it.message?:"操作未完成，请重试"})
        }
    }){Text(if(delete)"删除" else if(blocked)"拉黑" else "解除",color=Color(0xFFEF4343))}},dismissButton={TextButton(onClick={confirmation=null}){Text("取消")}})}
}
