package com.im.nativebootstrap.business

import android.content.Context
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.google.gson.*
import com.im.nativebootstrap.BootstrapViewModel
import com.im.nativebootstrap.chat.ChatMessage
import com.im.nativebootstrap.media.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.security.MessageDigest

data class MassTarget(val id:String,val type:String,val name:String,val avatar:String="")
data class MassState(val choices:List<MassTarget> = emptyList(),val selected:List<MassTarget> = emptyList(),val history:List<JsonObject> = emptyList(),val loading:Boolean=false,val sending:Boolean=false,val note:String="",val category:String="contact",val draftText:String="",val draftMedia:List<UploadedMedia> = emptyList(),val uploading:Boolean=false,val uploadNote:String="")
class MassAssistant(
    private val context:Context,private val scope:CoroutineScope,
    private val owner:()->String,
    private val api:(String,String,JsonObject?,Map<String,String>)->JsonElement,
    private val send:(MassTarget,String,UploadedMedia?,(Result<ChatMessage>)->Unit)->Unit,
) {
    private val mutable=MutableStateFlow(MassState());val state=mutable.asStateFlow();private var generation=0L;private var job:Job?=null
    private var draftVersion=0L
    private fun prefs()=context.getSharedPreferences("mass_"+MessageDigest.getInstance("SHA-256").digest(owner().toByteArray()).joinToString(""){"%02x".format(it)},Context.MODE_PRIVATE)
    fun reset(){generation++;draftVersion++;job?.cancel();mutable.value=MassState()}
    fun clearSelection(){if(state.value.sending||state.value.uploading)return;draftVersion++;mutable.value=state.value.copy(selected=emptyList(),note="",draftText="",draftMedia=emptyList(),uploading=false,uploadNote="")}
    fun editText(value:String){if(!state.value.sending&&!state.value.uploading)mutable.value=state.value.copy(draftText=value,draftMedia=if(value.isNotBlank())emptyList() else state.value.draftMedia,uploadNote=if(value.isNotBlank())"" else state.value.uploadNote)}
    fun beginUpload():Long? {if(state.value.uploading||state.value.sending)return null;mutable.value=state.value.copy(uploading=true,uploadNote="");return draftVersion}
    fun finishUpload(ticket:Long,result:Result<UploadedMedia>,appendImages:Boolean=false) {
        if(ticket!=draftVersion)return
        result.fold({media->mutable.value=state.value.copy(uploading=false,draftText="",draftMedia=if(appendImages&&state.value.draftMedia.all{it.local.kind==MediaKind.IMAGE})state.value.draftMedia+media else listOf(media),uploadNote=media.local.name)}, {mutable.value=state.value.copy(uploading=false,uploadNote=it.message?:"上传失败")})
    }
    fun removeDraftMedia(media:UploadedMedia){if(!state.value.sending&&!state.value.uploading)mutable.value=state.value.copy(draftMedia=state.value.draftMedia-media,uploadNote="")}
    fun selectAll(targets:List<MassTarget>){if(state.value.sending)return;val selected=state.value.selected;val keys=targets.map{it.type+":"+it.id}.toSet();mutable.value=state.value.copy(selected=if(targets.all{t->selected.any{it.type==t.type&&it.id==t.id}})selected.filterNot{it.type+":"+it.id in keys} else (selected+targets).distinctBy{it.type+":"+it.id})}
    fun recent(targets:List<MassTarget>){if(state.value.sending)return;job?.cancel();mutable.value=state.value.copy(choices=targets,category="recent",loading=false,note="")}
    fun history(){val rows=runCatching{elements(JsonParser.parseString(prefs().getString("history","[]")))}.getOrDefault(emptyList());mutable.value=mutable.value.copy(history=rows)}
    fun remove(id:String){val rows=state.value.history.filter{it.identifier()!=id};prefs().edit().putString("history",JsonArray().apply{rows.forEach{add(it)}}.toString()).apply();mutable.value=state.value.copy(history=rows)}
    fun choose(category:String) {
        if(state.value.sending)return
        val tag=generation
        job?.cancel();mutable.value=state.value.copy(loading=true,category=category,note="")
        job=scope.launch {
            try {
                val result=withContext(Dispatchers.IO){
                    val path=when(category){"group"->"/groups";"tag"->"/contact-tags";else->"/contacts"}
                    val rows=mutableListOf<JsonObject>();var cursor="";val seen=mutableSetOf<String>()
                    do {
                        val page=api("GET",path,null,mapOf("limit" to "100","cursor" to cursor).filterValues{it.isNotBlank()});rows+=elements(page)
                        val next=if(page.isJsonObject)page.asJsonObject.text("nextCursor") else ""
                        val more=page.isJsonObject&&page.asJsonObject.flag("hasMore")&&next.isNotBlank()&&seen.add(next)
                        cursor=if(more)next else ""
                    }while(cursor.isNotBlank())
                    rows.distinctBy{it.identifier()}.map{MassTarget(it.identifier(),category,it.displayName(),it.text("avatar"))}
                }
                if(tag==generation)mutable.value=state.value.copy(choices=result,loading=false)
            }catch(_:CancellationException){}catch(_:Exception){if(tag==generation)mutable.value=state.value.copy(loading=false,note="联系人加载失败，请重试。")}
        }
    }
    fun toggle(target:MassTarget){if(state.value.sending)return;val selected=state.value.selected;mutable.value=state.value.copy(selected=if(selected.any{it.id==target.id&&it.type==target.type})selected.filterNot{it.id==target.id&&it.type==target.type} else selected+target)}
    fun restore(record:JsonObject){if(state.value.sending||state.value.uploading)return;draftVersion++;val targets=elements(record.get("targets")).map{MassTarget(it.identifier(),it.text("type"),it.text("name"),it.text("avatar"))};mutable.value=state.value.copy(selected=targets,note="",draftText="",draftMedia=emptyList(),uploading=false,uploadNote="")}
    fun dispatch(text:String,media:List<UploadedMedia> = emptyList(),finished:()->Unit={}) {
        if(state.value.sending||state.value.uploading||state.value.selected.isEmpty()||(text.isBlank()&&media.isEmpty()))return
        val tag=generation;val targets=state.value.selected.toList();val account=owner()
        mutable.value=state.value.copy(sending=true,note="正在发送…")
        job=scope.launch {
            var submitted=0;val failed=mutableListOf<String>()
            try {
                val expanded=withContext(Dispatchers.IO){targets.flatMap{target->
                    if(target.type=="im-group")try {
                        val resolved=api("GET","/im/groups/by-im/${encoded(target.id)}",null,emptyMap()).asJsonObject.text("businessGroupId")
                        if(resolved.isBlank())error("群聊身份未解析")
                        listOf(target.copy(id=resolved,type="group"))
                    }catch(error:CancellationException){throw error}catch(_:Exception){failed+=target.name+"（群聊身份未解析）";emptyList()}
                    else if(target.type!="tag")listOf(target) else try {
                        val members=elements(api("GET","/contact-tags/${encoded(target.id)}/members",null,emptyMap())).map{MassTarget(it.identifier(),"contact",it.displayName(),it.text("avatar"))}
                        if(members.isEmpty())failed+=target.name+"（该标签下暂无联系人）"
                        members
                    }catch(error:CancellationException){throw error}catch(_:Exception){failed+=target.name+"（标签成员未加载）";emptyList()}
                }.distinctBy{it.type+":"+it.id}}
                for(target in expanded) {
                    if(tag!=generation||account!=owner())return@launch
                    var result:Result<ChatMessage>?=null
                    val payloads:List<UploadedMedia?> = if(media.isEmpty())listOf(null) else media
                    for((index,item) in payloads.withIndex()) {
                        result=suspendCancellableCoroutine<Result<ChatMessage>>{continuation->send(target,text,item){response->if(continuation.isActive)continuation.resumeWith(Result.success(response))}}
                        if(result.isFailure){failed+=target.name+"（附件 ${index+1}/${payloads.size}："+(result.exceptionOrNull()?.message?:"发送未确认")+"）";break}
                    }
                    if(result?.isSuccess==true)submitted++
                    mutable.value=state.value.copy(note="已提交 $submitted / ${expanded.size}")
                }
                val record=obj("id" to java.util.UUID.randomUUID().toString(),"createdAt" to System.currentTimeMillis(),"text" to text,"mediaName" to media.joinToString("、"){it.local.name},"submitted" to submitted,"failed" to failed.size,"targets" to JsonArray().apply{targets.forEach{add(obj("id" to it.id,"type" to it.type,"name" to it.name,"avatar" to it.avatar))}})
                if(tag!=generation||account!=owner())return@launch
                history();val rows=(listOf(record)+state.value.history).take(200)
                prefs().edit().putString("history",JsonArray().apply{rows.forEach{add(it)}}.toString()).apply()
                mutable.value=state.value.copy(history=rows,sending=false,draftText="",draftMedia=emptyList(),uploadNote="",note="已提交 $submitted 个目标"+if(failed.isNotEmpty())"，${failed.size} 个未完成：\n"+failed.joinToString("\n") else "")
                finished()
            }catch(_:CancellationException){}catch(_:Exception){if(tag==generation)mutable.value=state.value.copy(sending=false,note="群发未完成，已提交的目标不会自动重发，请核对后操作。")}
        }
    }
}

@Composable fun MassPage(page:String,model:BootstrapViewModel,controller:BusinessController) {
    val state by model.mass.state.collectAsStateWithLifecycle()
    val context=androidx.compose.ui.platform.LocalContext.current
    val routeVersion=remember(page){controller.routeVersion}
    val text=state.draftText;val media=state.draftMedia;val uploading=state.uploading
    var uploadNote by remember{mutableStateOf("")};var kind by remember{mutableStateOf(MediaKind.IMAGE)}
    val picker=rememberLauncherForActivityResult(ActivityResultContracts.GetContent()){uri->if(uri!=null){val ticket=model.mass.beginUpload();if(ticket!=null){val append=kind==MediaKind.IMAGE;model.uploadMassMedia(uri,kind){result->model.mass.finishUpload(ticket,result,append)}}}}
    val recorder=remember{VoiceRecorder(context)}
    var recording by remember{mutableStateOf(false)}
    fun beginRecording(){runCatching{recorder.start();recording=true}.onFailure{uploadNote=it.message?:"录音未开始"}}
    val microphone=rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()){allowed->if(allowed)beginRecording() else uploadNote="需要麦克风权限才能录音"}
    DisposableEffect(Unit){onDispose{recorder.cancel()}}
    val bootstrap by model.state.collectAsStateWithLifecycle()
    var keyword by remember{mutableStateOf("")}
    var editing by remember{mutableStateOf(false)};var selectedHistory by remember{mutableStateOf(emptySet<String>())};var confirmHistory by remember{mutableStateOf(false)}
    val recent=bootstrap.chat.conversations.mapNotNull{c->val group=c.target.sessionType==3;val id=if(group)c.target.groupId else com.im.nativebootstrap.chat.businessUserId(c.target.userId);if(id.isBlank())null else MassTarget(id,if(group)"im-group" else "contact",c.title,c.avatar)}
    LaunchedEffect(page){if(page=="mass-assistant")model.mass.history() else if(page=="mass-select")model.mass.choose("contact")}
    if(state.loading||uploading)LinearProgressIndicator(Modifier.fillMaxWidth())
    when(page) {
        "mass-assistant" -> {
            TextButton(enabled=!state.sending&&!uploading,onClick={model.mass.clearSelection();controller.open("mass-select")}){Text("新建群发")}
            TextButton(onClick={editing=!editing;selectedHistory=emptySet()}){Text(if(editing)"完成" else "编辑")}
            if(editing){TextButton(onClick={selectedHistory=if(selectedHistory.size==state.history.size)emptySet() else state.history.map{it.identifier()}.toSet()}){Text("全选 / 取消全选")};TextButton(enabled=selectedHistory.isNotEmpty(),onClick={confirmHistory=true}){Text("删除选中记录（${selectedHistory.size}）")}}
            if(state.history.isEmpty())Text("暂无群发记录",Modifier.padding(24.dp),color=Color.Gray)
            state.history.forEach{record->Column(Modifier.fillMaxWidth().background(Color.White).padding(18.dp)){
                if(editing)Checkbox(record.identifier() in selectedHistory,{checked->selectedHistory=if(checked)selectedHistory+record.identifier() else selectedHistory-record.identifier()})
                Text(record.text("text").ifBlank{record.text("mediaName")},fontSize=16.sp)
                Text("目标 ${elements(record.get("targets")).size} 个 · 已提交 ${record.text("submitted")} · 未完成 ${record.text("failed")}",Modifier.padding(top=8.dp),fontSize=12.sp,color=Color.Gray)
                Row {TextButton(enabled=!state.sending&&!uploading,onClick={model.mass.restore(record);controller.open("mass-compose")}){Text("再发一条")};TextButton(onClick={model.mass.remove(record.identifier())}){Text("删除记录")}}
            }}
        }
        "mass-select","mass-targets" -> {
            if(page=="mass-select")Row {listOf("contact" to "联系人","group" to "群聊","recent" to "最近聊天","tag" to "标签").forEach{(kind,label)->TextButton(onClick={if(kind=="recent")model.mass.recent(recent) else model.mass.choose(kind)}){Text(label)}}}
            androidx.compose.foundation.text.BasicTextField(keyword,{keyword=it},Modifier.fillMaxWidth().background(Color.White).padding(18.dp),decorationBox={inner->if(keyword.isBlank())Text("搜索联系人、群聊或标签",color=Color.Gray);inner()})
            val visible=(if(page=="mass-targets")state.selected else state.choices).filter{keyword.isBlank()||it.name.contains(keyword,true)}
            TextButton(onClick={model.mass.selectAll(visible)}){Text(if(visible.isNotEmpty()&&visible.all{t->state.selected.any{it.id==t.id&&it.type==t.type}})"取消全选" else "全选")}
            visible.forEach{target->
                val selected=state.selected.any{it.id==target.id&&it.type==target.type}
                Row(Modifier.fillMaxWidth().background(Color.White).clickable{model.mass.toggle(target)}.padding(18.dp),verticalAlignment=androidx.compose.ui.Alignment.CenterVertically){SharedAvatar(target.avatar,Modifier.size(42.dp));Text(target.name,Modifier.weight(1f).padding(start=12.dp));Checkbox(selected,{model.mass.toggle(target)})}
            }
            TextButton(enabled=state.selected.isNotEmpty(),onClick={if(page=="mass-targets")controller.returnTo("mass-compose") else controller.open("mass-compose")}){Text(if(page=="mass-targets")"完成（${state.selected.size}）" else "下一步（${state.selected.size}）")}
        }
        "mass-compose" -> {
            Text("你将发送消息给",Modifier.padding(horizontal=18.dp,vertical=12.dp),fontSize=13.sp,color=Color.Gray)
            Text(state.selected.joinToString("、"){it.name},Modifier.fillMaxWidth().clickable(enabled=!state.sending&&!recording){controller.open("mass-targets")}.padding(18.dp),fontSize=16.sp)
            androidx.compose.foundation.text.BasicTextField(text,model.mass::editText,Modifier.fillMaxWidth().heightIn(min=140.dp).background(Color.White).padding(18.dp),enabled=!state.sending&&!uploading,textStyle=androidx.compose.ui.text.TextStyle(fontSize=16.sp),decorationBox={inner->Box {if(text.isEmpty())Text("输入消息",color=Color.Gray);inner()}})
            Row {TextButton(enabled=!uploading&&!state.sending,onClick={kind=MediaKind.IMAGE;picker.launch("image/*")}){Text("图片")};TextButton(enabled=!uploading&&!state.sending,onClick={kind=MediaKind.VOICE;picker.launch("audio/*")}){Text("语音文件")};TextButton(enabled=!uploading&&!state.sending,onClick={kind=MediaKind.FILE;picker.launch("*/*")}){Text("文件")}}
            TextButton(enabled=!uploading&&!state.sending,onClick={
                if(recording){recording=false;runCatching{recorder.finish()}.fold({local->val ticket=model.mass.beginUpload();if(ticket!=null)model.uploadMassRecording(local){result->model.mass.finishUpload(ticket,result)}},{uploadNote=it.message?:"录音失败"})}
                else if(androidx.core.content.ContextCompat.checkSelfPermission(context,android.Manifest.permission.RECORD_AUDIO)==android.content.pm.PackageManager.PERMISSION_GRANTED)beginRecording() else microphone.launch(android.Manifest.permission.RECORD_AUDIO)
            }){Text(if(recording)"完成录音" else "录制语音")}
            if(recording)TextButton(onClick={recorder.cancel();recording=false}){Text("取消录音")}
            if(state.uploadNote.isNotBlank()||uploadNote.isNotBlank())Text(state.uploadNote.ifBlank{uploadNote},Modifier.padding(18.dp),fontSize=13.sp,color=Color.Gray)
            media.forEach{item->Row {Text(item.local.name,Modifier.weight(1f).padding(12.dp));TextButton(enabled=!state.sending&&!uploading,onClick={model.mass.removeDraftMedia(item)}){Text("移除")}}}
            TextButton(enabled=!recording&&!state.sending&&!uploading&&state.selected.isNotEmpty()&&(text.isNotBlank()||media.isNotEmpty()),onClick={model.mass.dispatch(text,media){if(controller.routeVersion==routeVersion)controller.returnTo("mass-assistant")}}){Text(if(state.sending)"发送中…" else "传送")}
        }
    }
    if(confirmHistory)AlertDialog(onDismissRequest={confirmHistory=false},title={Text("删除群发记录")},text={Text("确定删除选中的 ${selectedHistory.size} 条本机群发记录？已发送的消息不会撤回。")},confirmButton={TextButton(onClick={confirmHistory=false;selectedHistory.forEach(model.mass::remove);selectedHistory=emptySet()}){Text("删除")}},dismissButton={TextButton(onClick={confirmHistory=false}){Text("取消")}})
    if(state.note.isNotBlank())Text(state.note,Modifier.padding(18.dp),color=Color(0xFF636E86),fontSize=13.sp)
}
