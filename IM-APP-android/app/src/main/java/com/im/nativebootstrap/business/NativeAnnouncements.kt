package com.im.nativebootstrap.business

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.gson.JsonObject
import com.im.nativebootstrap.BootstrapViewModel
import com.im.nativebootstrap.media.RemoteMediaImage
import kotlinx.coroutines.launch

fun canEditAnnouncement(group:JsonObject):Boolean {
    val permissions=group.child("permissions")
    return if(permissions.has("canEditAnnouncement"))permissions.flag("canEditAnnouncement") else group.text("myRole").ifBlank{group.text("role")} in setOf("owner","admin")
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun NativeAnnouncements(state:BusinessState,controller:BusinessController,model:BootstrapViewModel,modifier:Modifier=Modifier) {
    val s=LocalConfiguration.current.screenWidthDp/750f;val scope=rememberCoroutineScope();val scroll=rememberScrollState()
    val blue=Color(0xFF0A2FC2);val muted=Color(0xFF636E86);val page=Color(0xFFF3F4F7)
    val editable=canEditAnnouncement(state.detail.child("_group"))
    var editing by remember(state.route.id){mutableStateOf("")}
    var content by remember(state.route.id){mutableStateOf("")}
    var original by remember(state.route.id){mutableStateOf("")}
    var originalImages by remember(state.route.id){mutableStateOf(emptyList<String>())}
    var images by remember(state.route.id){mutableStateOf(emptyList<ImageAttachment>())}
    var imageBusy by remember{mutableStateOf(false)}
    var editorKey by remember{mutableIntStateOf(0)}
    var deleting by remember{mutableStateOf<JsonObject?>(null)}
    var preview by remember{mutableStateOf<String?>(null)}
    fun reset(){editing="";content="";original="";originalImages=emptyList();images=emptyList();editorKey++}
    val atLimit=editing.isBlank()&&state.items.size>=10
    val changed=editing.isBlank()||content!=original||images.map{it.url}!=originalImages
    val canSubmit=editable&&!state.loading&&!imageBusy&&!atLimit&&(content.isNotBlank()||images.isNotEmpty())&&changed
    Column(modifier.fillMaxWidth().background(page)) {
        NativePullRefresh(state.loading,{controller.refresh()},Modifier.weight(1f)) {Column(Modifier.fillMaxSize().verticalScroll(scroll)) {
            if(editable)Column(Modifier.fillMaxWidth().padding(top=(16*s).dp).background(Color.White).padding(horizontal=(28*s).dp,vertical=(32*s).dp)) {
                Text(if(editing.isBlank())"发布新公告" else "编辑这一条",fontSize=(26*s).sp,color=muted)
                Text("最多 10 条，互不影响。改某一条请点下面的编辑，不会再复制出一条。",Modifier.padding(top=(8*s).dp,bottom=(16*s).dp),fontSize=(22*s).sp,lineHeight=(33*s).sp,color=Color(0xFF8A8F9C))
                BasicTextField(content,{content=it.take(500)},Modifier.fillMaxWidth().heightIn(min=(280*s).dp),textStyle=TextStyle(fontSize=(30*s).sp,lineHeight=(51*s).sp,color=Color(0xFF2A2A2A)),cursorBrush=SolidColor(blue),decorationBox={inner->Box{if(content.isEmpty())Text(if(editing.isBlank())"请输入新的公告内容" else "修改这条公告",fontSize=(30*s).sp,color=Color(0xFF8A8F9C));inner()}})
                Text("${content.length}/ 500",Modifier.align(Alignment.End),fontSize=(24*s).sp,color=muted)
                ImageAttachments(model,editorKey,images){list,busy->images=list;imageBusy=busy}
                if(atLimit)Text("最多 10 条，请先删除或编辑已有公告",fontSize=(24*s).sp,color=Color(0xFFDC2828))
            }
            Text("已发布（${state.items.size}/10）",Modifier.padding(start=(28*s).dp,end=(28*s).dp,top=(28*s).dp,bottom=(12*s).dp),fontSize=(28*s).sp,fontWeight=FontWeight.SemiBold,color=Color(0xFF212121))
            if(state.items.isEmpty()&&!state.loading)Text("暂无群公告",Modifier.fillMaxWidth().padding((40*s).dp).wrapContentWidth(),fontSize=(26*s).sp,color=Color(0xFF8A8F9C))
            state.items.forEachIndexed{index,announcement->
                Column(Modifier.fillMaxWidth().padding(start=(16*s).dp,end=(16*s).dp,bottom=(16*s).dp).clip(RoundedCornerShape((12*s).dp)).background(Color.White).then(if(editing==announcement.identifier())Modifier.border((2*s).dp,blue,RoundedCornerShape((12*s).dp)) else Modifier).padding(horizontal=(28*s).dp,vertical=(24*s).dp)) {
                    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){Text(announcement.text("publisherName").ifBlank{"管理员"}+if(index==0)" · 最新" else "",fontSize=(24*s).sp,color=muted);Text(announcement.text("createdAt").replace('T',' ').take(16),fontSize=(22*s).sp,color=Color(0xFF999999))}
                    Text(announcement.text("content").ifBlank{"（仅图片）"},Modifier.padding(top=(12*s).dp),fontSize=(28*s).sp,lineHeight=(48*s).sp,color=Color(0xFF2A2A2A))
                    FlowRow(Modifier.padding(top=(20*s).dp),horizontalArrangement=Arrangement.spacedBy((16*s).dp),verticalArrangement=Arrangement.spacedBy((16*s).dp)) {stringValues(announcement.get("images")).forEach{url->RemoteMediaImage(url,Modifier.size((160*s).dp).clip(RoundedCornerShape((12*s).dp)).clickable{preview=url})}}
                    if(editable)Row(Modifier.fillMaxWidth().padding(top=(16*s).dp),horizontalArrangement=Arrangement.End) {
                        Text("编辑",Modifier.clickable(enabled=!state.loading&&!imageBusy){editing=announcement.identifier();content=announcement.text("content");original=content;originalImages=stringValues(announcement.get("images"));images=originalImages.map{ImageAttachment("",it)};editorKey++;scope.launch{scroll.animateScrollTo(0)}},fontSize=(26*s).sp,color=blue)
                        Text("删除",Modifier.padding(start=(32*s).dp).clickable(enabled=!state.loading&&!imageBusy){deleting=announcement},fontSize=(26*s).sp,color=Color(0xFFE54D42))
                    }
                }
            }
        }}
        if(editable)Row(Modifier.fillMaxWidth().padding(horizontal=(32*s).dp,vertical=(24*s).dp),horizontalArrangement=Arrangement.spacedBy((16*s).dp)) {
            if(editing.isNotBlank())Box(Modifier.weight(1f).height((96*s).dp).clip(RoundedCornerShape((16*s).dp)).background(Color.White).clickable(enabled=!state.loading&&!imageBusy){reset()},contentAlignment=Alignment.Center){Text("取消",fontSize=(32*s).sp,color=Color(0xFF212121))}
            Box(Modifier.weight(1f).height((96*s).dp).clip(RoundedCornerShape((16*s).dp)).background(if(canSubmit)blue else Color(0xFF98A9E3)).clickable(enabled=canSubmit){
                val body=obj("groupId" to state.route.id,"content" to content,"announcementImageFileIds" to images.map{it.id}.filter{it.isNotBlank()})
                if(editing.isNotBlank()){body.addProperty("announcementId",editing);body.add("keepAnnouncementImages",com.google.gson.JsonArray().apply{images.filter{it.id.isBlank()}.forEach{add(it.url)}})}
                controller.mutate("POST",if(editing.isBlank())"/group-announcements/create" else "/group-announcements/update",body){reset()}
            },contentAlignment=Alignment.Center){Text(if(editing.isBlank())"发布" else "保存",fontSize=(32*s).sp,fontWeight=FontWeight.SemiBold,color=Color.White)}
        }
    }
    preview?.let{BusinessImagePreview(it){preview=null}}
    deleting?.let{item->AlertDialog(onDismissRequest={deleting=null},title={Text("删除公告")},text={Text("删除后成员将看不到这一条")},confirmButton={TextButton(onClick={deleting=null;controller.mutate("POST","/group-announcements/delete",obj("groupId" to state.route.id,"announcementId" to item.identifier())){if(editing==item.identifier())reset()}}){Text("删除")}},dismissButton={TextButton(onClick={deleting=null}){Text("取消")}})}
}
