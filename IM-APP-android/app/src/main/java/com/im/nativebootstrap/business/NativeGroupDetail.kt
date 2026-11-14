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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.im.nativebootstrap.BootstrapViewModel
import com.im.nativebootstrap.R
import com.im.nativebootstrap.chat.ChatConversation
import com.im.nativebootstrap.media.SharedAvatar

private val GroupInk=Color(0xFF1D1D1D)
private val GroupMuted=Color(0xFF666666)
private val GroupBlue=Color(0xFF1E88FF)

@Composable private fun GroupCard(content:@Composable ColumnScope.()->Unit) {
    val s=LocalConfiguration.current.screenWidthDp/750f
    Column(Modifier.fillMaxWidth().padding(top=(16*s).dp).background(Color.White),content=content)
}
@Composable private fun GroupInfoRow(title:String,value:String="",enabled:Boolean=true,arrow:Boolean=true,last:Boolean=false,weightedTrailing:Boolean=false,trailing:(@Composable RowScope.()->Unit)?=null,onClick:()->Unit={}) {
    val s=LocalConfiguration.current.screenWidthDp/750f
    Column {
        Row(Modifier.fillMaxWidth().heightIn(min=(96*s).dp).clickable(enabled=enabled,onClick=onClick).padding(horizontal=(30*s).dp,vertical=(14*s).dp),verticalAlignment=Alignment.CenterVertically) {
            Text(title,color=GroupInk,fontSize=(30*s).sp)
            if(!weightedTrailing)Spacer(Modifier.weight(1f))
            if(value.isNotBlank())Text(value,Modifier.widthIn(max=(360*s).dp).padding(start=(20*s).dp),fontSize=(28*s).sp,color=GroupMuted,maxLines=1,overflow=TextOverflow.Ellipsis)
            trailing?.invoke(this)
            if(arrow)Text("›",Modifier.padding(start=(12*s).dp),color=Color(0xFF999999),fontSize=(40*s).sp)
        }
        if(!last)HorizontalDivider(color=Color(0xFFF0F0F0),thickness=s.dp)
    }
}

@OptIn(ExperimentalFoundationApi::class,ExperimentalMaterial3Api::class)
@Composable fun NativeGroupDetail(state:BusinessState,c:BusinessController,model:BootstrapViewModel,onAvatar:()->Unit,avatarEnabled:Boolean,confirm:(String,()->Unit)->Unit) {
    val r=state.route;val d=state.detail;val role=d.text("myRole");val owner=role=="owner";val manager=owner||role=="admin";val permissions=d.child("permissions")
    val s=LocalConfiguration.current.screenWidthDp/750f
    val context=LocalContext.current
    val routeVersion=remember(r){c.routeVersion}
    val my=model.state.value.profile
    val dissolved=d.flag("_dissolved")||d.text("status")=="dismissed"
    val lookup=r.context=="lookup"
    var conversation by remember(r){mutableStateOf<ChatConversation?>(null)}
    var settingsLoading by remember(r){mutableStateOf(false)}
    var settingsError by remember(r){mutableStateOf("")}
    var busy by remember(r){mutableStateOf(false)}
    var note by remember(r){mutableStateOf("")}
    var joinSheet by remember(r){mutableStateOf(false)}
    fun toast(text:String){NativeNotices.show(text)}
    fun copy(text:String){(context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("",text));toast("已复制")}
    fun loadSettings(){
        settingsLoading=true;settingsError=""
        model.loadBusinessGroupConversation(r.id){result->settingsLoading=false;result.fold({conversation=it},{settingsError=it.message?:"会话设置未加载"})}
    }
    LaunchedEffect(r,dissolved,lookup){
        if(!lookup&&!dissolved)loadSettings()
        else if(dissolved)conversation=model.state.value.chat.conversations.firstOrNull{it.target.conversationId==d.text("conversationId")}
    }
    fun finish(result:Result<String>){busy=false;if(c.routeVersion!=routeVersion)return;result.fold({toast(it);c.back()},{note=it.message?:"操作未完成，请重试"})}
    fun updateSetting(pinned:Boolean?=null,muted:Boolean?=null){
        val current=conversation?:return
        busy=true;note=""
        model.updateConversation(current,pinned,muted){result->busy=false;result.fold({conversation=current.copy(pinned=pinned?:current.pinned,muted=muted?:current.muted)},{note=it.message?:"设置未完成"})}
    }
    if(d.identifier().isBlank())return
    if(dissolved){
        Column(Modifier.fillMaxWidth().padding(top=(80*s).dp,bottom=(64*s).dp),horizontalAlignment=Alignment.CenterHorizontally){
            SharedAvatar(d.text("avatar"),Modifier.size((128*s).dp).clip(CircleShape),true)
            Text(d.text("name").ifBlank{"群聊"},Modifier.padding(top=(24*s).dp),fontSize=(34*s).sp,fontWeight=FontWeight.Medium,color=GroupInk)
            Text("该群已解散，无法继续聊天",Modifier.padding(top=(16*s).dp),fontSize=(28*s).sp,color=GroupMuted)
        }
        GroupCard{GroupInfoRow("删除",enabled=!busy,arrow=false,last=true){confirm("删除该已解散群的记录及本机对话？"){busy=true;model.removeDissolvedGroup(r.id,conversation,::finish)}}}
        if(note.isNotBlank())Text(note,Modifier.padding(16.dp),color=Color(0xFFDC2828),fontSize=13.sp)
        return
    }
    if(!lookup)GroupCard {
        Row(Modifier.fillMaxWidth().padding(start=(24*s).dp,end=(24*s).dp,top=(24*s).dp,bottom=(8*s).dp),horizontalArrangement=Arrangement.spacedBy((12*s).dp),verticalAlignment=Alignment.Top){
            elements(d.get("_previewMembers")).take(4).forEach{member->
                val name=member.displayName().ifBlank{"成员"}
                Column(Modifier.width((128*s).dp),horizontalAlignment=Alignment.CenterHorizontally){
                    SharedAvatar(member.text("avatar").ifBlank{member.text("Avatar")},Modifier.size((96*s).dp).clip(CircleShape).clickable(enabled=!state.loading){c.openGroupPreviewMember(member,setOfNotNull(my?.businessUserId,my?.publicId))})
                    Text(name,Modifier.fillMaxWidth().padding(top=(8*s).dp).combinedClickable(onClick={c.openGroupPreviewMember(member,setOfNotNull(my?.businessUserId,my?.publicId))},onLongClick={copy(name)}),fontSize=(22*s).sp,color=Color(0xFF555555),textAlign=TextAlign.Center,maxLines=1,overflow=TextOverflow.Ellipsis)
                }
            }
            Box(Modifier.width((128*s).dp).height((96*s).dp).clickable{c.open("members",r.id)},contentAlignment=Alignment.Center){Image(painterResource(R.drawable.uni_icon_add_member),"查看群成员",Modifier.size((96*s).dp))}
        }
        if(d.flag("_previewError"))Text("成员预览未加载，点击重试",Modifier.fillMaxWidth().clickable{c.refresh()}.padding(horizontal=16.dp,vertical=8.dp),fontSize=12.sp,color=GroupMuted)
        HorizontalDivider(color=Color(0xFFF0F0F0),thickness=s.dp)
        GroupInfoRow("群组成员","共${d.text("memberCount").ifBlank{"0"}}人",last=true){c.open("members",r.id)}
    }
    if(manager&&!lookup)GroupCard {
        GroupInfoRow("群组管理"){c.open("group-admin",r.id)}
        GroupInfoRow("入群申请",if(d.flag("_pendingError"))"数量未加载" else d.text("_pendingJoinCount").takeIf{it!="0"}.orEmpty()){c.open("join-requests",r.id)}
        GroupInfoRow("入群方式",if(d.text("joinMode")=="approval")"私密群（申请入群）" else "公开群（扫码入群）",last=true){joinSheet=true}
    }
    GroupCard {
        val canEdit=permissions.flag("canEditProfile",manager)
        GroupInfoRow("群组名称",d.text("name"),enabled=canEdit&&!state.loading,arrow=canEdit){c.open("group-name",r.id)}
        GroupInfoRow("群头像",enabled=canEdit&&avatarEnabled&&!state.loading,arrow=canEdit,trailing={Box(Modifier.size((64*s).dp).clip(CircleShape).background(Color(0xFFE9F2FF)),contentAlignment=Alignment.Center){SharedAvatar(d.text("avatar"),Modifier.size((52*s).dp).clip(CircleShape),true)}},onClick=onAvatar)
        GroupInfoRow("群号",arrow=false,weightedTrailing=true,trailing={
            Text(d.identifier(),Modifier.weight(1f).padding(start=(20*s).dp),fontSize=(28*s).sp,color=Color(0xFF444444),maxLines=1,overflow=TextOverflow.Ellipsis,textAlign=TextAlign.End)
            Text("复制",Modifier.padding(start=(18*s).dp).height((52*s).dp).clip(RoundedCornerShape((12*s).dp)).background(GroupBlue).clickable{copy(d.identifier())}.padding(horizontal=(22*s).dp).wrapContentSize(),fontSize=(26*s).sp,color=Color.White)
            if(owner&&!d.flag("publicIdChangeUsed"))Text("设置 ›",Modifier.padding(start=(18*s).dp).clickable{c.open("group-id",r.id)},fontSize=(26*s).sp,color=GroupBlue)
        })
        GroupInfoRow("群公告"){c.open("announcements",r.id)}
        if(permissions.flag("canViewQRCode",true))GroupInfoRow("群二维码"){c.open("group-qrcode",r.id)}
        if(!lookup)GroupInfoRow("我在本群的昵称",last=true,enabled=permissions.flag("canEditMyNickname",true)){c.open("group-nickname",r.id)}
    }
    if(!lookup){
        GroupCard {
            GroupInfoRow("图片与视频"){model.openGroupArchive(r.id,true)}
            GroupInfoRow("搜索聊天记录"){model.openGroupArchive(r.id,false)}
            GroupInfoRow("清除聊天记录",enabled=conversation!=null&&!busy,last=true){confirm("将清除本账号在此群的服务端漫游记录及本机记录，并同步到你的其他设备；不影响其他群成员。此操作不可恢复。"){
                conversation?.let{item->busy=true;note="";model.clearOwnConversation(item){result->busy=false;note=result.fold({"已清除本账号在此群的聊天记录"},{it.message?:"清除未完成"})}}
            }}
        }
        GroupCard {
            ToggleRow("消息免打扰",conversation?.muted?:false,enabled=conversation!=null&&!busy){updateSetting(muted=it)}
            HorizontalDivider(color=Color(0xFFF0F0F0),thickness=s.dp)
            ToggleRow("置顶聊天",conversation?.pinned?:false,enabled=conversation!=null&&!busy){updateSetting(pinned=it)}
            if(settingsLoading)Text("正在加载会话设置…",Modifier.padding(12.dp),color=GroupMuted,fontSize=12.sp)
            if(settingsError.isNotBlank())Text("$settingsError · 点击重试",Modifier.fillMaxWidth().clickable(enabled=!settingsLoading){loadSettings()}.padding(12.dp),color=Color(0xFFDC2828),fontSize=12.sp)
        }
    }
    if(permissions.flag("canReport",true))GroupCard{GroupInfoRow("检举",last=true){c.open("report-group",r.id)}}
    if(lookup)GroupCard{
        GroupInfoRow(if(d.text("joinMode")=="approval")"申请入群" else "加入群聊",enabled=!state.loading,last=true){
            if(d.text("joinMode")=="approval")c.mutate("POST","/groups/${encoded(r.id)}/join-requests",obj("remark" to "")) else c.mutate("POST","/groups/${encoded(r.id)}/join")
        }
    } else GroupCard{
        Box(Modifier.fillMaxWidth().height((100*s).dp).clickable(enabled=!busy&&!state.loading){confirm(if(owner)"解散后群聊将不可恢复，确定解散？" else "退出后将不再接收此群消息，并移除本机对话。确定退出？"){
            busy=true;note="";model.leaveBusinessGroup(r.id,owner,conversation,::finish)
        }},contentAlignment=Alignment.Center){Text(if(owner)"解散群" else "退出群并删除对话",fontSize=(30*s).sp,color=Color(0xFFFF4D4F),fontWeight=FontWeight.Medium)}
    }
    if(note.isNotBlank())Text(note,Modifier.fillMaxWidth().padding(16.dp),color=GroupMuted,fontSize=13.sp)
    Spacer(Modifier.height((48*s).dp))
    if(joinSheet)ModalBottomSheet(onDismissRequest={joinSheet=false},containerColor=Color.White){
        listOf("open" to "公开群（扫码入群）","approval" to "私密群（申请入群）").forEach{(mode,label)->Text(label,Modifier.fillMaxWidth().height((108*s).dp).clickable(enabled=!state.loading){joinSheet=false;if(d.text("joinMode")!=mode)c.mutate("POST","/groups/settings/update",obj("groupId" to r.id,"joinMode" to mode))}.wrapContentSize(),fontSize=(32*s).sp,color=GroupInk);HorizontalDivider(color=Color(0xFFF0F0F0),thickness=s.dp)}
        Text("取消",Modifier.fillMaxWidth().height((108*s).dp).clickable{joinSheet=false}.wrapContentSize(),fontSize=(32*s).sp,color=GroupMuted)
    }
}
