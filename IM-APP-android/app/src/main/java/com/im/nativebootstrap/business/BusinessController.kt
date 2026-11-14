package com.im.nativebootstrap.business

import com.google.gson.*
import com.im.nativebootstrap.data.APIException
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

data class BusinessRoute(val page: String, val id: String = "", val context: String = "")
data class BusinessState(
    val stack: List<BusinessRoute> = listOf(BusinessRoute("contacts")),
    val items: List<JsonObject> = emptyList(), val detail: JsonObject = JsonObject(),
    val loading: Boolean = false, val error: String? = null, val notice: String? = null,
    val cursor: String = "", val hasMore: Boolean = false,
    val keyword: String = "", val sort: String = "recent",
    val groups:List<JsonObject> = emptyList(),val friendRequests:Int=0,val total:Int=0,
) { val route get() = stack.last(); val subpage get() = stack.size > 1 }

fun obj(vararg fields: Pair<String, Any?>): JsonObject = JsonObject().apply {
    fields.forEach { (key, value) -> when(value) {
        null -> add(key, JsonNull.INSTANCE)
        is JsonElement -> add(key,value)
        is Boolean -> addProperty(key,value)
        is Number -> addProperty(key,value)
        is Iterable<*> -> add(key, JsonArray().apply { value.forEach { add(it?.toString()) } })
        else -> addProperty(key,value.toString())
    } }
}
fun JsonObject.text(key:String):String = get(key)?.takeIf { it.isJsonPrimitive }?.asString.orEmpty()
fun JsonObject.flag(key:String, default:Boolean=false):Boolean = get(key)?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isBoolean }?.asBoolean ?: default
fun JsonObject.child(key:String):JsonObject = get(key)?.takeIf { it.isJsonObject }?.asJsonObject ?: JsonObject()
fun JsonObject.identifier():String = text("id").ifBlank { text("ID") }
fun JsonObject.displayName():String = text("remark").ifBlank { text("displayName") }.ifBlank { text("groupNickname") }.ifBlank { text("nickname") }.ifBlank { text("name") }.ifBlank { text("Nickname") }.ifBlank { text("Name") }
fun encoded(value:String):String = java.net.URLEncoder.encode(value,"UTF-8").replace("+","%20")
fun canOpenBusinessChat(target:JsonObject,group:Boolean):Boolean = target.flag("canChat")||(group&&target.text("denyReason") in setOf("member_muted","group_muted")&&target.text("imGroupId").isNotBlank())

/** UI 按业务页面组织，JSON 仅为接口边界；不会把响应原文呈现为调试界面。 */
class BusinessController(
    private val scope:CoroutineScope,
    private val transport:(String,String,JsonObject?,Map<String,String>)->JsonElement,
    private val onChat:(String,Boolean,String,String)->Unit,
    private val onLogout:()->Unit,
) {
    private val mutable=MutableStateFlow(BusinessState())
    val state=mutable.asStateFlow()
    private var generation=0L
    val routeVersion get()=generation
    private var job:Job?=null
    private var requestVersion=0L
    private var verifiedOldPassword:String?=null
    fun reset() { generation++;job?.cancel();verifiedOldPassword=null;mutable.value=BusinessState() }
    fun root(page:String) {
        if(mutable.value.stack.first().page==page) return
        generation++;job?.cancel();mutable.value=BusinessState(stack=listOf(BusinessRoute(page)));refresh()
    }
    fun open(page:String,id:String="",context:String="",seed:JsonObject=JsonObject()) {
        generation++;job?.cancel();mutable.value=BusinessState(stack=mutable.value.stack+BusinessRoute(page,id,context),detail=seed.deepCopy(),keyword=if(page=="groups")"owner" else "");refresh()
    }
    fun back():Boolean {
        if(!mutable.value.subpage) return false
        if(mutable.value.route.page=="reset-password")verifiedOldPassword=null
        val stack=mutable.value.stack.dropLast(1)
        generation++;job?.cancel();mutable.value=BusinessState(stack=stack,keyword=if(stack.last().page=="groups")"owner" else "");refresh();return true
    }
    fun returnTo(page:String) {
        val index=mutable.value.stack.indexOfLast{it.page==page}
        if(index<0){open(page);return}
        generation++;job?.cancel();mutable.value=BusinessState(stack=mutable.value.stack.take(index+1),keyword=if(page=="groups")"owner" else "");refresh()
    }
    fun clearNotice() { mutable.value=mutable.value.copy(notice=null) }
    fun reportError(message:String) {mutable.value=mutable.value.copy(error=message)}
    fun query(keyword:String,sort:String=mutable.value.sort) {
        generation++;job?.cancel();mutable.value=mutable.value.copy(keyword=keyword,sort=sort,loading=false);refresh()
    }
    fun refresh(more:Boolean=false) {
        if(mutable.value.loading) return
        val s=mutable.value;val route=s.route;val cursor=if(more)s.cursor else ""
        launch {
            val result=when(route.page) {
                "contacts","create-group","invite","tag-add-members" -> call("GET","/contacts",query=mapOf("limit" to "50","keyword" to s.keyword,"sort" to if(s.sort=="name")"name" else "recent","cursor" to cursor))
                "groups" -> call("GET","/groups",query=mapOf("limit" to "100","cursor" to cursor,"role" to s.keyword))
                "friend","friend-remark" -> call("GET","/contacts/${encoded(route.id)}")
                "user" -> call("GET","/users/${encoded(route.id)}",query=if(route.context.isBlank())emptyMap() else mapOf("groupId" to route.context))
                "requests" -> call("POST","/friend-requests/sync",obj("direction" to "received"))
                "tags","friend-tags" -> call("GET","/contact-tags")
                "tag-members" -> call("GET","/contact-tags/${encoded(route.id)}/members")
                "blacklist" -> call("GET","/contacts/blocked",query=mapOf("keyword" to s.keyword,"limit" to "100"))
                "group" -> {
                    if(route.context=="dissolved")call("GET","/groups/${encoded(route.id)}/dissolved").asJsonObject.deepCopy().apply{addProperty("_dissolved",true)}
                    else try {call("GET","/groups/detail",query=mapOf("groupId" to route.id))}catch(error:APIException){
                        if(error.httpStatus !in listOf(403,404))throw error
                        try{call("GET","/groups/${encoded(route.id)}/dissolved").asJsonObject.deepCopy().apply{addProperty("_dissolved",true)}}catch(_:APIException){throw error}
                    }
                }
                "group-admin","group-name","group-id","group-remark","group-nickname" -> call("GET","/groups/detail",query=mapOf("groupId" to route.id))
                "members","admins","admin-add" -> {
                    val all=mutableListOf<JsonObject>();var next="";val seen=mutableSetOf<String>()
                    do {
                        val page=call("GET","/group-members",query=mapOf("groupId" to route.id,"limit" to "100","cursor" to next))
                        all+=elements(page)
                        val value=if(page.isJsonObject)page.asJsonObject.text("nextCursor") else ""
                        val more=page.isJsonObject&&page.asJsonObject.flag("hasMore")
                        if(more&&(value.isBlank()||!seen.add(value)))throw APIException("群成员分页未推进，请重试")
                        next=if(more)value else ""
                    }while(next.isNotBlank())
                    JsonArray().apply{all.distinctBy{it.identifier()}.forEach{add(it)}}
                }
                "join-requests" -> call("GET","/groups/${encoded(route.id)}/join-requests")
                "announcements" -> call("GET","/group-announcements",query=mapOf("groupId" to route.id)).asJsonObject.deepCopy().apply {add("_group",call("GET","/groups/detail",query=mapOf("groupId" to route.id)))}
                "profile","onboarding","edit-nickname","edit-bio","edit-chat-id","security" -> call("GET","/me")
                "qrcode" -> call("GET","/me/qrcode")
                "group-qrcode" -> {
                    val qr=call("GET","/groups/${encoded(route.id)}/qrcode").asJsonObject.deepCopy()
                    qr.add("group",call("GET","/groups/detail",query=mapOf("groupId" to route.id)))
                    qr
                }
                "privacy" -> call("GET","/me/privacy-settings")
                "deletion" -> call("GET","/me/deletion-preview")
                "favorites" -> call("POST","/favorites/list",obj("type" to (s.keyword.toIntOrNull()?:0),"page" to (cursor.toIntOrNull()?:1),"size" to 30))
                "report-user" -> call("GET","/report-reasons",query=mapOf("targetType" to "user","language" to "zh"))
                "emotions" -> call("GET","/stickers",query=mapOf("page" to (cursor.toIntOrNull()?:1).toString(),"size" to "100"))
                "mine" -> call("GET","/me")
                else -> s.detail
            }
            var detail=if(result.isJsonObject)result.asJsonObject else JsonObject()
            if(route.page=="user") {
                val contact=try{call("GET","/contacts/${encoded(route.id)}").takeIf{it.isJsonObject}?.asJsonObject}catch(error:APIException){if(error.httpStatus==404)null else throw error}
                if(contact!=null)detail=detail.deepCopy().apply{contact.entrySet().forEach{add(it.key,it.value)};addProperty("_isFriend",true)}
            }
            if(route.page=="friend-tags")detail=s.detail
            if(route.page=="tag-add-members") {
                val existing=call("GET","/contact-tags/${encoded(route.id)}/members")
                detail=detail.deepCopy().apply {add("existingMembers",JsonArray().apply{elements(existing).forEach{add(it.identifier())}})}
            }
            if(route.page=="invite") {
                val existing=mutableListOf<String>();var next="";val seen=mutableSetOf<String>()
                do {
                    val page=call("GET","/group-members",query=mapOf("groupId" to route.id,"limit" to "100","cursor" to next))
                    existing+=elements(page).map{it.identifier()}
                    val cursorValue=if(page.isJsonObject)page.asJsonObject.text("nextCursor") else ""
                    val more=page.isJsonObject&&page.asJsonObject.flag("hasMore")
                    if(more&&(!seen.add(cursorValue)||cursorValue.isBlank()))throw APIException("群成员分页未推进，请刷新重试")
                    next=if(more)cursorValue else ""
                }while(next.isNotBlank())
                detail=detail.deepCopy().apply{add("existingMembers",JsonArray().apply{existing.forEach{add(it)}})}
            }
            val items=when(route.page) {
                "requests" -> elements(detail.get("pending"))+elements(detail.get("recent"))
                "common-groups" -> elements(call("GET","/contacts/${encoded(route.id)}").asJsonObject.get("commonGroups"))
                else -> elements(result)
            }
            val endCursor=if(route.page in listOf("favorites","emotions")) ((cursor.toIntOrNull()?:1)+1).toString() else detail.text("nextCursor")
            val hasMore=if(route.page=="favorites")items.size>=30 else if(route.page=="emotions")items.size>=100 else detail.flag("hasMore") && endCursor.isNotBlank() && endCursor!=cursor
            var groups=s.groups;var pending=s.friendRequests
            if(route.page=="contacts"&&!more)coroutineScope {
                val groupsRequest=async {runCatching{elements(call("GET","/groups",query=mapOf("limit" to "100")))}}
                val requestsRequest=async {runCatching{call("POST","/friend-requests/sync",obj("direction" to "received"))}}
                groups=groupsRequest.await().getOrElse{emptyList()}.filter{it.text("status")!="dismissed"}
                pending=requestsRequest.await().getOrNull()?.let{if(it.isJsonObject)elements(it.asJsonObject.get("pending")).size else elements(it).count{item->item.text("status")=="pending"}}?:0
            }
            mutable.value=mutable.value.copy(detail=detail,items=if(more)(s.items+items).distinctBy { it.identifier().ifBlank{it.toString()} } else items,cursor=endCursor,hasMore=hasMore,loading=false,error=null,groups=groups,friendRequests=pending,total=detail.text("total").toIntOrNull()?:items.size)
            if(route.page=="group"&&route.context!="lookup"&&!detail.flag("_dissolved"))enrichGroup(route,generation,requestVersion)
        }
    }
    private fun enrichGroup(route:BusinessRoute,tag:Long,request:Long) {
        scope.launch {
            coroutineScope {
                launch {
                    val result=runCatching{call("GET","/group-members",query=mapOf("groupId" to route.id,"limit" to "4"))}
                    if(tag!=generation||request!=requestVersion||mutable.value.route!=route)return@launch
                    val detail=mutable.value.detail.deepCopy()
                    result.fold({page->detail.add("_previewMembers",JsonArray().apply{elements(page).take(4).forEach{add(it)}});detail.remove("_previewError")},{error->if(error is CancellationException)throw error;detail.addProperty("_previewError",true)})
                    mutable.value=mutable.value.copy(detail=detail)
                }
                if(mutable.value.detail.text("myRole") in listOf("owner","admin"))launch {
                    val result=runCatching{call("GET","/groups/${encoded(route.id)}/join-requests")}
                    if(tag!=generation||request!=requestVersion||mutable.value.route!=route)return@launch
                    val detail=mutable.value.detail.deepCopy()
                    result.fold({rows->detail.addProperty("_pendingJoinCount",elements(rows).count{it.text("status").ifBlank{"pending"}=="pending"});detail.remove("_pendingError")},{error->if(error is CancellationException)throw error;detail.addProperty("_pendingError",true)})
                    mutable.value=mutable.value.copy(detail=detail)
                }
            }
        }
    }
    fun openGroupPreviewMember(member:JsonObject,myIds:Set<String>) {
        val route=mutable.value.route;val id=member.identifier()
        if(id.isBlank()||route.page!="group")return
        if(id in myIds){open("members",route.id);return}
        launch {
            val contact=try{call("GET","/contacts/${encoded(id)}").takeIf{it.isJsonObject}?.asJsonObject}catch(error:APIException){if(error.httpStatus==404)null else throw error}
            mutable.value=mutable.value.copy(loading=false)
            if(contact!=null)openChat(member.deepCopy().apply{contact.entrySet().forEach{add(it.key,it.value)}})
            else open("user",id,route.id,member)
        }
    }
    private suspend fun call(method:String,path:String,data:JsonObject?=null,query:Map<String,String> = emptyMap()):JsonElement = withContext(Dispatchers.IO) { transport(method,path,data,query.filterValues { it.isNotBlank() }) }
    private fun launch(block:suspend ()->Unit) {
        val tag=generation
        val request=++requestVersion
        mutable.value=mutable.value.copy(loading=true,error=null,notice=null)
        job=scope.launch {
            try { block() } catch(_:CancellationException) {} catch(e:Exception) {
                if(tag==generation&&request==requestVersion) mutable.value=mutable.value.copy(error=if(e is APIException || e is IllegalArgumentException)e.message else "请求未完成，请检查网络后重试。",loading=false)
            } finally { if(tag==generation&&request==requestVersion)mutable.value=mutable.value.copy(loading=false) }
        }
    }
    fun mutate(method:String,path:String,data:JsonObject?=null,backAfter:Boolean=false,done:(JsonElement)->Unit={}) {
        if(mutable.value.loading)return
        launch {
            val response=call(method,path,data)
            mutable.value=mutable.value.copy(loading=false,notice="已保存")
            done(response)
            if(backAfter)back() else refresh()
        }
    }
    fun searchUser(publicId:String) {
        if(publicId.isBlank())return
        launch {
            val result=call("GET","/users/search",query=mapOf("publicId" to publicId.trim()))
            mutable.value=mutable.value.copy(detail=if(result.isJsonObject)result.asJsonObject else JsonObject(),items=emptyList(),loading=false,notice=if(result.isJsonNull)"没有找到该用户" else null)
        }
    }
    fun lookupGroup(publicId:String) {
        if(publicId.isBlank())return
        open("group",publicId.trim(),"lookup")
    }
    fun resolveQr(raw:String) {
        if(raw.isBlank())return
        launch {
            var token=raw;var type="user"
            try {
                val uri=runCatching{java.net.URI(raw)}.getOrNull()
                if(uri!=null&&uri.scheme in listOf("http","https")) {
                    val query=uri.rawQuery.orEmpty().split("&").mapNotNull { part->part.split("=",limit=2).takeIf{it.size==2}?.let{java.net.URLDecoder.decode(it[0],"UTF-8") to java.net.URLDecoder.decode(it[1],"UTF-8")} }.toMap()
                    token=query["qrcode"]?:raw;type=if(query["qrcodetype"]=="g")"group" else "user"
                } else if(raw.trim().startsWith("{")) {
                    val parsed=JsonParser.parseString(raw).asJsonObject;token=parsed.text("token");type=parsed.text("type")
                    if(token.isBlank()&&parsed.text("publicId").isNotBlank()) {
                        val result=call("GET","/users/search",query=mapOf("publicId" to parsed.text("publicId")))
                        mutable.value=mutable.value.copy(loading=false)
                        if(result.isJsonObject)open("user",result.asJsonObject.identifier(),seed=result.asJsonObject)
                        else mutable.value=mutable.value.copy(notice="没有找到该用户")
                        return@launch
                    }
                }
            } catch(_:Exception) {}
            val group=type in listOf("g","group")
            val response=call("POST",if(group)"/groups/qrcode/resolve" else "/users/qrcode/resolve",obj("token" to token,"payload" to raw).apply{if(raw.startsWith("http"))addProperty("qrcode",raw)}).asJsonObject
            mutable.value=mutable.value.copy(loading=false)
            if(group)open("scan-group-result",response.child("group").identifier(),token,response) else open("scan-result",response.child("user").identifier(),token,response)
        }
    }
    fun openChat(user:JsonObject,group:Boolean=false) {
        val id=user.identifier();if(id.isBlank())return
        onChat(id,group,user.displayName(),user.text("avatar"))
    }
    fun saveProfile(name:String,bio:String,avatarFileId:String="") = mutate("PATCH","/me",obj("nickname" to name,"bio" to bio,"avatarFileId" to avatarFileId),true)
    fun verifyOldPassword(value:String) {
        if(value.isBlank()||state.value.loading)return
        launch {
            call("POST","/me/password/verify",obj("oldPassword" to value))
            verifiedOldPassword=value
            mutable.value=mutable.value.copy(loading=false)
            open("reset-password",context="change")
        }
    }
    fun changePassword(value:String) {
        if(value.length<6||state.value.loading)return
        val old=verifiedOldPassword
        if(state.value.route.context=="change"&&old.isNullOrBlank())return reportError("请返回重新验证旧密码")
        mutate("PUT","/me/password",obj("password" to value).apply{if(!old.isNullOrBlank())addProperty("oldPassword",old)},true)
    }
    fun addTagMembers(tagId:String,userIds:Set<String>) {
        launch {
            val existing=elements(call("GET","/contact-tags/${encoded(tagId)}/members")).map{it.identifier()}.toSet()
            call("PUT","/contact-tags/${encoded(tagId)}/members",obj("userIds" to (existing+userIds)))
            mutable.value=mutable.value.copy(loading=false);back()
        }
    }
    fun removeTagMembers(tagId:String,userIds:Set<String>) {
        launch {
            val latest=elements(call("GET","/contact-tags/${encoded(tagId)}/members")).map{it.identifier()}.toSet()
            call("PUT","/contact-tags/${encoded(tagId)}/members",obj("userIds" to latest-userIds))
            mutable.value=mutable.value.copy(loading=false);refresh()
        }
    }
    fun deleteFavorites(ids:Set<String>) {
        launch {
            var saved=0;var failed=0
            for(id in ids)try{call("DELETE","/favorites/${encoded(id)}");saved++}catch(error:CancellationException){throw error}catch(_:Exception){failed++}
            mutable.value=mutable.value.copy(loading=false);refresh()
            mutable.value=mutable.value.copy(notice="已删除 $saved 条收藏"+if(failed>0)"，$failed 条未完成，请刷新核对。" else "")
        }
    }
    fun addAdmins(groupId:String,userIds:Set<String>) {
        launch {
            var saved=0;val failed=mutableListOf<String>()
            for(id in userIds) {
                try{call("PUT","/groups/${encoded(groupId)}/members/${encoded(id)}/role",obj("role" to "admin"));saved++}
                catch(error:CancellationException){throw error}catch(_:Exception){failed+=id}
            }
            mutable.value=mutable.value.copy(loading=false)
            if(failed.isEmpty())back() else {
                refresh()
                mutable.value=mutable.value.copy(notice="已添加 $saved 位管理员，${failed.size} 位未完成。请核对当前列表后重试。")
            }
        }
    }
    fun savePrivacy(key:String,value:Boolean) {
        val current=mutable.value.detail
        mutate("POST","/me/privacy-settings",obj("requireFriendApproval" to if(key=="requireFriendApproval")value else current.flag("requireFriendApproval"),"requireGroupApproval" to if(key=="requireGroupApproval")value else current.flag("requireGroupApproval",true)))
    }
    fun createGroup(name:String,members:Set<String>) {
        if(name.isBlank()||members.isEmpty())return
        mutate("POST","/groups",obj("name" to name.trim(),"memberIds" to members)) { response ->
            if(response.isJsonObject) { val group=response.asJsonObject;open("group",group.identifier()) }
        }
    }
    fun deleteAccount(phone:String,country:String,code:String,acknowledge:String) {
        val d=mutable.value.detail
        if(!d.flag("canDelete") || acknowledge!=d.text("confirmPhrase"))return
        mutate("POST","/me/account/delete",obj("phone" to phone,"countryCode" to country,"code" to code,"acknowledge" to acknowledge)) { result ->
            if(!result.isJsonObject||!result.asJsonObject.flag("ok"))throw APIException("服务未确认账号注销")
            onLogout()
        }
    }
}

/** 明确兼容旧数组、分页 items、双层 data 和字符串 JSON，null 表示空结果。 */
fun elements(value:JsonElement?):List<JsonObject> {
    if(value==null||value.isJsonNull)return emptyList()
    if(value.isJsonPrimitive&&value.asJsonPrimitive.isString) return try { elements(JsonParser.parseString(value.asString)) } catch(_:Exception){emptyList()}
    if(value.isJsonArray)return value.asJsonArray.filter{it.isJsonObject}.map{it.asJsonObject}
    if(value.isJsonObject) { val o=value.asJsonObject;return elements(o.get("items")?:o.get("data")) }
    return emptyList()
}

fun stringValues(value:JsonElement?):List<String> = value?.takeIf{it.isJsonArray}?.asJsonArray?.filter{it.isJsonPrimitive&&it.asJsonPrimitive.isString}?.map{it.asString}.orEmpty()
