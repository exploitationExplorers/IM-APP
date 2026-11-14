package com.im.nativebootstrap

import android.app.Application
import android.os.Handler
import android.os.Looper
import com.im.nativebootstrap.chat.*
import com.im.nativebootstrap.core.AccountIdentity
import java.io.File
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.RejectedExecutionException
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.im.nativebootstrap.core.BusinessLoginFlow
import com.im.nativebootstrap.core.BusinessSession
import com.im.nativebootstrap.data.APIException
import com.im.nativebootstrap.data.BusinessProfile
import com.im.nativebootstrap.data.NativeAPI
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.UUID
import com.im.nativebootstrap.business.*
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.im.nativebootstrap.core.SecureSessionStore
import com.im.nativebootstrap.core.SessionPersistenceCodec
import com.im.nativebootstrap.data.TokenPair

data class SampleMessage(val id: String, val text: String, val mine: Boolean)
data class BootstrapState(
    val busy: Boolean = false,
    val notice: String = "",
    val authenticated: Boolean = false,
    val profile: BusinessProfile? = null,
    val profileWarning: String? = null,
    val sample: Boolean = false,
    val chatOpen: Boolean = false,
    val messages: List<SampleMessage> = emptyList(),
    val chat: ChatState = ChatState(),
)

class BootstrapViewModel(application: Application) : AndroidViewModel(application) {
    private val mutableState = MutableStateFlow(BootstrapState())
    val state = mutableState.asStateFlow()
    private val businessSession = BusinessSession()
    private val loginFlow = BusinessLoginFlow(businessSession)
    @Volatile private var operation = 0L
    @Volatile private var foregroundActive=false
    private val main=Handler(Looper.getMainLooper())
    private val chatExecutor=ScheduledThreadPoolExecutor(1) { task -> Thread(task,"native-chat-io").apply { isDaemon=true } }
    private val chatController=ChatController(OpenIMGateway(application),
        { action -> if(!chatExecutor.isShutdown) try { chatExecutor.execute(action) } catch (_:RejectedExecutionException) {} },
        { delay, action -> if(!chatExecutor.isShutdown) try { chatExecutor.schedule(action,delay,TimeUnit.MILLISECONDS) } catch (_:RejectedExecutionException) {} },
        { chat -> main.post { if(chat.sessionTag==operation && mutableState.value.authenticated) mutableState.value=mutableState.value.copy(chat=chat,chatOpen=chat.active!=null) } },
    )
    private fun chatAction(action:()->Unit) {
        if(chatExecutor.isShutdown) return
        try { chatExecutor.execute {
            try { action() } catch (_:Exception) { val tag=operation;main.post { if(tag==operation&&mutableState.value.authenticated) mutableState.value=mutableState.value.copy(chat=mutableState.value.chat.copy(error="聊天资源暂不可用，数据已保留。")) } }
        } } catch (_:RejectedExecutionException) {}
    }

    private var loginJob: Job? = null
    private val deviceId by lazy { DeviceIdentity.get(application) }
    val settings=NativeSettings(application)
    private var businessBaseURL = com.im.nativebootstrap.data.RuntimeEndpoints.DEFAULT_API_BASE_URL
    private var imDiagnosticAPI=""
    private var imDiagnosticWS=""
    fun diagnosticEndpoints()=DiagnosticEndpoints(businessBaseURL,imDiagnosticAPI,imDiagnosticWS,com.im.nativebootstrap.media.MediaURLs.remote(mutableState.value.profile?.avatar.orEmpty()))
    private val secureStore=SecureSessionStore(application)
    private val credentialIO=java.util.concurrent.Executors.newSingleThreadExecutor { task->Thread(task,"native-credentials").apply{isDaemon=true} }
    private val refreshLock=Any()
    val business = BusinessController(viewModelScope, { method, path, data, query -> businessRequest(method,path,data,query) },
        { id, group, title, avatar -> openBusinessChat(id,group,title,avatar) }, { logout() })
    val mass=MassAssistant(application,viewModelScope,{businessBaseURL+"|"+businessSession.currentProfile()?.businessUserId.orEmpty()},
        {method,path,data,query->businessRequest(method,path,data,query)},::sendMassTarget)
    init { restoreSession() }

    private fun persistSession() {
        val tag=operation
        val tokens=businessSession.currentTokens()?:return
        val profile=businessSession.currentProfile()?:return
        val value=SessionPersistenceCodec.encode(businessBaseURL,tokens,profile)
        credentialIO.execute { if(tag==operation)try {secureStore.save(value)} catch(_:Exception){main.post{if(tag==operation)mutableState.value=mutableState.value.copy(notice="登录状态未能安全保存，下次启动需要重新登录。")}} }
    }
    private fun restoreSession() {
        val tag=operation
        mutableState.value=BootstrapState(busy=true,notice="正在恢复登录")
        loginJob=viewModelScope.launch {
            try {
                val cached=withContext(Dispatchers.IO){secureStore.load()} ?: run {if(tag==operation)mutableState.value=BootstrapState();return@launch}
                val stored=SessionPersistenceCodec.decode(cached)
                val base=stored.baseURL;val api=NativeAPI(base)
                var credentials=stored.tokens
                var refreshed=false
                var warning:String?=null
                var user:BusinessProfile?=null
                withContext(Dispatchers.IO) {
                    fun refreshOnce() {
                        if(refreshed)throw APIException("登录已失效，请重新登录",401)
                        credentials=api.refreshToken(credentials.refreshToken,deviceId);refreshed=true
                        if(tag!=operation)throw java.util.concurrent.CancellationException()
                        val rotated=SessionPersistenceCodec.encode(base,credentials,stored.profile)
                        credentialIO.submit { secureStore.save(rotated) }.get()
                    }
                    if(credentials.expiresIn<=30)refreshOnce()
                    user=try {api.profile(credentials.accessToken)} catch(e:Exception) {
                        if(e is APIException && e.httpStatus==401) {refreshOnce();api.profile(credentials.accessToken)}
                        else if(e is APIException && e.httpStatus==403)throw e
                        else {warning="当前显示上次登录资料，联网后可刷新。";stored.profile}
                    }
                }
                val loaded=user?:throw APIException("账号资料未加载")
                if(loaded.businessUserId!=stored.profile.businessUserId)throw APIException("登录身份校验失败，请重新登录",401)
                if(tag!=operation)return@launch
                businessBaseURL=base
                businessSession.restore(credentials,loaded)
                com.im.nativebootstrap.media.MediaLoader.setScope(base,loaded.businessUserId)
                mutableState.value=BootstrapState(authenticated=true,profile=loaded,profileWarning=warning,chat=ChatState(sessionTag=tag,connection=ConnectionState.CONNECTING))
                persistSession();startChatSession(base,loaded,tag)
            } catch(_:kotlinx.coroutines.CancellationException) {} catch(e:Exception) {
                if(tag==operation) {
                    businessSession.logout()
                    mutableState.value=BootstrapState(notice=if(e is APIException)e.message.orEmpty() else "登录恢复未完成，请联网后重试登录。")
                    // 网络失败保留加密凭据，明确认证拒绝才撤销本机认证；绝不操作消息库。
                    if(e is APIException&&e.httpStatus in listOf(401,403))credentialIO.execute{secureStore.clear()}
                }
            } finally {if(tag==operation)loginJob=null}
        }
    }
    private suspend fun startChatSession(baseURL:String,profile:BusinessProfile,tag:Long) {
        try {
            val credentials=withContext(Dispatchers.IO) { businessSession.withAccessToken(profile.businessUserId){NativeAPI(baseURL).imToken(it)} }
            if(tag!=operation||credentials==null)return
            imDiagnosticAPI=credentials.apiAddr;imDiagnosticWS=credentials.wsAddr
            chatAction {
                if(tag==operation) {
                    chatController.attachBusiness(object:ChatBusiness {
                        override val baseUrl=baseURL
                        override fun prepareMedia(media:com.im.nativebootstrap.media.LocalMedia):com.im.nativebootstrap.media.LocalMedia {
                            if(tag!=operation)throw java.util.concurrent.CancellationException()
                            return if(media.kind==com.im.nativebootstrap.media.MediaKind.VIDEO)com.im.nativebootstrap.media.MediaIO.prepareVideo(media) else media
                        }
                        override fun rememberForwardMedia(source:ChatMessage,preserved:JsonObject) {
                            if(tag==operation)runCatching { com.im.nativebootstrap.media.MediaLoader.rememberForwarded(getApplication(),source,preserved,baseURL,profile.businessUserId) }
                        }
                        override fun uploadMedia(media:com.im.nativebootstrap.media.LocalMedia):com.im.nativebootstrap.media.UploadedMedia {
                            val uploaded=com.im.nativebootstrap.media.ChatMediaUploader.upload(this,media)
                            if(tag==operation)runCatching { com.im.nativebootstrap.media.MediaLoader.rememberUploaded(getApplication(),uploaded,baseURL,profile.businessUserId) }
                            return uploaded
                        }
                        override fun request(method:String,path:String,body:JsonObject?,query:Map<String,String>):JsonElement {
                            if(tag!=operation)throw java.util.concurrent.CancellationException()
                            return businessRequest(method,path,body,query)
                        }
                    })
                    chatController.attachIncoming { message -> main.post { if(tag==operation&&mutableState.value.authenticated)settings.incoming(message,foregroundActive) } }
                    chatController.start(AccountIdentity(profile.businessUserId,credentials.imUserId),baseURL,credentials.token,credentials.apiAddr,credentials.wsAddr,File(getApplication<Application>().filesDir,"native-chat"),tag)
                    chatController.foreground(foregroundActive)
                }
            }
        } catch(_:kotlinx.coroutines.CancellationException) {} catch(_:Exception) {
            if(tag==operation)mutableState.value=mutableState.value.copy(chat=ChatState(sessionTag=tag,error="聊天认证未完成，账号资料仍可使用。请稍后重新登录。"))
        }
    }

    fun businessRequest(method:String,path:String,data:JsonObject?=null,query:Map<String,String> = emptyMap()):JsonElement {
        val tag=operation
        val user=businessSession.currentProfile() ?: throw APIException("请先登录")
        val base=businessBaseURL;val api=NativeAPI(base)
        val captured=businessSession.currentTokens()?:throw APIException("登录已失效")
        val result=try{api.businessRequest(method,path,captured.accessToken,data,query)}catch(error:APIException) {
            if(error.httpStatus!=401||path=="/im/token")throw error
            val token=synchronized(refreshLock) {
                if(tag!=operation)throw java.util.concurrent.CancellationException()
                val current=businessSession.currentTokens()?:throw APIException("登录已失效")
                if(current.accessToken!=captured.accessToken)current else {
                    val next=api.refreshToken(current.refreshToken,deviceId)
                    if(tag!=operation || !businessSession.replaceTokens(user.businessUserId,current.accessToken,next))throw java.util.concurrent.CancellationException()
                    val rotated=SessionPersistenceCodec.encode(base,next,user)
                    credentialIO.submit { secureStore.save(rotated) }.get()
                    next
                }
            }
            api.businessRequest(method,path,token.accessToken,data,query)
        }
        if(tag!=operation)throw java.util.concurrent.CancellationException()
        if(path=="/me"&&result.isJsonObject) {
            val p=result.asJsonObject
            if(p.identifier()==user.businessUserId)main.post {if(tag==operation) {
                val profile=BusinessProfile(p.identifier(),p.text("nickname"),p.text("publicId"),p.text("phoneMasked"),p.text("avatar"),p.text("bio"),p.text("countryCode").ifBlank{"+86"},p.flag("hasPassword"))
                businessSession.replaceProfile(profile)
                mutableState.value=mutableState.value.copy(profile=profile)
                credentialIO.execute {if(tag==operation)runCatching{val cached=secureStore.load();if(cached!=null&&tag==operation)secureStore.save(SessionPersistenceCodec.withProfile(cached,profile))}}
            }}
        }
        return result
    }
    private fun openBusinessChat(id:String,group:Boolean,title:String,avatar:String) {
        val tag=operation
        viewModelScope.launch {
            try {
                val target=withContext(Dispatchers.IO) { businessRequest("GET",if(group) "/im/groups/${encoded(id)}" else "/im/peers/${encoded(id)}").asJsonObject }
                if(tag!=operation)return@launch
                if(!canOpenBusinessChat(target,group))throw APIException(target.text("denyReason").ifBlank { "暂时不能发送消息" })
                val im=target.text(if(group)"imGroupId" else "imUserId")
                if(im.isBlank())throw APIException("聊天身份缺失")
                chatAction{chatController.openPeer(im,group,title.ifBlank{target.text(if(group)"name" else "nickname")},avatar.ifBlank{target.text("avatar")})}
            } catch(_:kotlinx.coroutines.CancellationException) {} catch(e:Exception) { if(tag==operation){val message=if(e is APIException)e.message.orEmpty() else "聊天未打开，请稍后重试。";business.reportError(message);mutableState.value=mutableState.value.copy(notice=message)} }
        }
    }

    fun login(baseURL: String, country: String, phone: String, secret: String, password: Boolean, registerCode: String? = null) {
        if (mutableState.value.busy) return
        operation += 1
        val activeOperation = operation
        businessBaseURL=baseURL
        business.reset()
        mass.reset()
        val attempt = businessSession.beginLogin()
        mutableState.value = BootstrapState(busy = true, notice = "正在登录")
        loginJob = viewModelScope.launch {
            try {
                val result = withContext(Dispatchers.IO) {
                    loginFlow.login(attempt, NativeAPI(baseURL), country, phone, secret, deviceId, password, registerCode)
                }
                if (activeOperation != operation || result == null) return@launch
                com.im.nativebootstrap.media.MediaLoader.setScope(baseURL,result.profile.businessUserId)
                mutableState.value = BootstrapState(authenticated = true, profile = result.profile, profileWarning = result.profileWarning,chat=ChatState(sessionTag=activeOperation,connection=ConnectionState.CONNECTING))
                persistSession()
                if(registerCode!=null)business.open("onboarding")
                startChatSession(baseURL,result.profile,activeOperation)
            } catch (_: kotlinx.coroutines.CancellationException) {
                // 退出/换号先使业务代次失效；迟到网络结果不会进入新账号。
            } catch (error: Exception) {
                if (activeOperation != operation) return@launch
                val message = if (error is APIException || error is IllegalArgumentException) error.message else "请求未完成，请检查网络后重试。"
                businessSession.logout()
                mutableState.value = BootstrapState(notice = message ?: "请求未完成")
            } finally {
                if (activeOperation == operation) loginJob = null
            }
        }
    }

    fun sendSms(baseURL: String, country: String, phone: String) {
        if (mutableState.value.busy) return
        operation += 1
        val activeOperation = operation
        mutableState.value = BootstrapState(busy = true, notice = "正在申请验证码")
        loginJob = viewModelScope.launch {
            try {
                val receipt = withContext(Dispatchers.IO) { NativeAPI(baseURL).sendSms(country, phone, deviceId) }
                if (activeOperation == operation) mutableState.value = BootstrapState(notice = "申请已受理，请 ${receipt.retryAfterSec} 秒后再试；验证码有效期 ${receipt.expiresIn} 秒。")
            } catch (_: kotlinx.coroutines.CancellationException) {
            } catch (_: Exception) {
                if (activeOperation == operation) mutableState.value = BootstrapState(notice = "验证码申请失败，请检查网络和手机号。")
            } finally {
                if (activeOperation == operation) loginJob = null
            }
        }
    }

    fun startSample() {
        logout()
        mutableState.value = BootstrapState(sample = true, notice = "本地样例 · 不会向任何用户发送消息")
    }
    fun openChat() {
        if (!mutableState.value.sample) return
        mutableState.value = mutableState.value.copy(chatOpen = true, messages = listOf(SampleMessage("welcome", "这里可以验证文本列表与输入交互。内容仅存于当前内存，退出样例即清除。", false)))
    }
    fun openRealChat(conversation:ChatConversation) { if(mutableState.value.authenticated) chatAction { chatController.open(conversation) } }
    fun loadConversations(refresh:Boolean=false) { if(mutableState.value.authenticated) chatAction { chatController.loadConversations(refresh) } }
    fun loadHistory() { if(mutableState.value.authenticated) chatAction { chatController.loadHistory() } }
    fun reconcileMessage(id:String) { if(mutableState.value.authenticated) chatAction { chatController.reconcile(id) } }
    fun retryFailedMessage(id:String) { if(mutableState.value.authenticated) chatAction { chatController.retryFailed(id) } }
    fun retryImageUpload(id:String) { if(mutableState.value.authenticated)chatAction { chatController.retryImageUpload(id) } }
    fun discardImageUpload(id:String) { if(mutableState.value.authenticated)chatAction { chatController.discardImageUpload(id) } }
    fun foreground(active:Boolean) { foregroundActive=active;chatAction { chatController.foreground(active) } }
    fun closeChat() { if(mutableState.value.authenticated) { chatAction { chatController.closeRoom() };return };mutableState.value = mutableState.value.copy(chatOpen = false, messages = emptyList()) }
    fun sendText(text:String,queued:(Boolean)->Unit) {
        if(mutableState.value.sample) { sendSample(text);queued(true);return }
        val tag=operation
        chatAction { val saved=chatController.send(text);main.post { if(tag==operation) queued(saved) } }
    }
    fun sendQuotedText(text:String,quote:ChatMessage?,queued:(Boolean)->Unit) {
        val tag=operation
        chatAction{val saved=chatController.send(text,quote);main.post{if(tag==operation)queued(saved)}}
    }
    fun sendMedia(media:com.im.nativebootstrap.media.LocalMedia,queued:(Boolean)->Unit) {
        val tag=operation
        chatAction{chatController.sendMedia(media){saved->main.post{if(tag==operation)queued(saved)}}}
    }
    fun messageAction(message:ChatMessage,action:ChatAction,done:(Result<Unit>)->Unit) {
        val tag=operation
        chatAction{chatController.performAction(message,action){result->main.post{if(tag==operation)done(result)}}}
    }
    fun refreshChatPermission() {if(mutableState.value.authenticated)chatAction{chatController.refreshSendPermission()}}
    fun recallChatMessage(message:ChatMessage,reason:String,done:(Result<Unit>)->Unit) {
        val tag=operation
        chatAction{chatController.recallMessage(message,reason){result->main.post{if(tag==operation)done(result)}}}
    }
    fun acceptChatGroupInvite(token:String,done:(Result<ChatInviteResult>)->Unit) {
        val tag=operation
        chatAction{chatController.acceptGroupInvite(token){result->main.post{if(tag==operation)done(result)}}}
    }
    fun openBusinessGroupFromChat(groupId:String) {
        if(groupId.isBlank())return
        closeChat();openBusinessChat(groupId,true,"","")
    }
    fun openJoinRequestsFromChat(groupId:String) {
        if(groupId.isBlank())return
        closeChat();business.open("join-requests",groupId)
    }
    fun openAnnouncementsFromChat(groupId:String) {
        if(groupId.isBlank())return
        closeChat();business.open("announcements",groupId)
    }
    fun dismissChatAnnouncement(){if(mutableState.value.authenticated)chatAction{chatController.dismissAnnouncementBanner()}}
    fun dismissChatPin(){if(mutableState.value.authenticated)chatAction{chatController.dismissPinnedBanner()}}
    fun loadVisibleChatMembers(ids:List<String>){if(mutableState.value.authenticated)chatAction{chatController.loadVisibleGroupMembers(ids)}}
    fun loadMessageMenu(message:ChatMessage,done:(Result<ChatMessageMenu>)->Unit) {
        val tag=operation
        chatAction{chatController.loadMessageMenu(message){result->main.post{if(tag==operation)done(result)}}}
    }
    fun addChatSticker(media:com.im.nativebootstrap.media.LocalMedia,done:(Result<Unit>)->Unit) {
        val tag=operation
        chatAction{chatController.addSticker(media){result->main.post{if(tag==operation)done(result)}}}
    }
    fun loadChatStickers(page:Int,done:(Result<ChatPickerPage>)->Unit) {
        val tag=operation
        chatAction{chatController.loadStickers(page){result->main.post{if(tag==operation)done(result)}}}
    }
    fun sendChatSticker(url:String,done:(Result<ChatMessage>)->Unit) {
        val tag=operation
        chatAction{chatController.sendFavorite("image",url){result->main.post{if(tag==operation)done(result)}}}
    }
    fun deleteChatSticker(id:String,done:(Result<Unit>)->Unit) {
        val tag=operation
        chatAction{chatController.deleteSticker(id){result->main.post{if(tag==operation)done(result)}}}
    }
    fun manageChatStickers() {closeChat();business.open("emotions")}
    fun forwardMessage(message:ChatMessage,target:ChatConversation,done:(Result<Unit>)->Unit) {
        val tag=operation
        chatAction{chatController.forward(message,target){result->main.post{if(tag==operation)done(result)}}}
    }
    fun openPeerProfile(imId:String) {
        val id=businessUserId(imId)
        if(id.isNotBlank())business.open("user",id)
    }
    fun reportChatUser(imId:String) {
        val id=businessUserId(imId)
        if(id.isNotBlank()) { closeChat();business.open("report-user",id) }
    }
    fun openChatDetails() {
        val active=mutableState.value.chat.active?:return
        if(active.target.sessionType==3) {
            val tag=operation
            viewModelScope.launch{try{val group=withContext(Dispatchers.IO){businessRequest("GET","/im/groups/by-im/${encoded(active.target.groupId)}").asJsonObject};if(tag==operation){closeChat();business.open("group",group.text("businessGroupId"))}}catch(_:Exception){}}
        } else {val id=businessUserId(active.target.userId);if(id.isNotBlank()){closeChat();business.open("friend",id)}}
    }
    fun reconnectChat(done:(Result<Unit>)->Unit) {
        val tag=operation
        chatAction{chatController.reconnect{result->main.post{if(tag==operation)done(result)}}}
    }
    fun clearDownloads(done:(Result<Unit>)->Unit) {
        viewModelScope.launch{done(runCatching{withContext(Dispatchers.IO){com.im.nativebootstrap.media.MediaLoader.clearDownloads(getApplication());Unit}})}
    }
    fun checkAppRelease(version:Long,done:(Result<NativeRelease?>)->Unit) {
        val tag=operation;val base=businessBaseURL
        viewModelScope.launch {
            val result=runCatching{withContext(Dispatchers.IO){
                val value=NativeAPI(base).businessRequest("GET","/public/app-release",query=mapOf("platform" to "android","channel" to NativeRelease.CHANNEL,"nativeVersion" to version.toString(),"wgtVersion" to "0"))
                NativeRelease.parse(value.asJsonObject,version)
            }}
            if(tag==operation)done(result)
        }
    }
    fun clearAllHistories(done:(Result<String>)->Unit) {
        val tag=operation
        chatAction{chatController.clearAllConversations{result->main.post{if(tag==operation)done(result)}}}
    }
    fun uploadBusinessImage(uri:android.net.Uri,purpose:String,done:(Result<com.im.nativebootstrap.media.UploadedMedia>)->Unit) {
        val tag=operation;val base=businessBaseURL
        viewModelScope.launch {
            val result=runCatching{withContext(Dispatchers.IO){
                val media=com.im.nativebootstrap.media.MediaIO.stage(getApplication(),uri,com.im.nativebootstrap.media.MediaKind.IMAGE)
                try {
                    val bridge=object:ChatBusiness{
                        override val baseUrl=base
                        override fun request(method:String,path:String,body:JsonObject?,query:Map<String,String>):JsonElement{if(tag!=operation)throw java.util.concurrent.CancellationException();return businessRequest(method,path,body,query)}
                    }
                    com.im.nativebootstrap.media.ChatMediaUploader.upload(bridge,media,purpose)
                } finally {media.file.delete();media.snapshot?.delete();if(uri.scheme=="file"){val input=File(uri.path.orEmpty());val folder=File(getApplication<Application>().cacheDir,"media").canonicalFile;if(input.parentFile?.canonicalFile==folder&&input.name.startsWith("avatar-crop-"))input.delete()}}
            }}
            if(tag==operation)done(result)
        }
    }
    fun uploadMassMedia(uri:android.net.Uri,kind:com.im.nativebootstrap.media.MediaKind,done:(Result<com.im.nativebootstrap.media.UploadedMedia>)->Unit) {
        val tag=operation;val base=businessBaseURL
        viewModelScope.launch {
            val result=runCatching{withContext(Dispatchers.IO){
                val local=com.im.nativebootstrap.media.MediaIO.stage(getApplication(),uri,kind)
                val bridge=object:ChatBusiness {
                    override val baseUrl=base
                    override fun request(method:String,path:String,body:JsonObject?,query:Map<String,String>):JsonElement {if(tag!=operation)throw java.util.concurrent.CancellationException();return businessRequest(method,path,body,query)}
                }
                try{com.im.nativebootstrap.media.ChatMediaUploader.upload(bridge,local)}catch(error:Exception){local.file.delete();local.snapshot?.delete();throw error}
            }}
            if(tag==operation)done(result)
        }
    }
    fun uploadMassRecording(local:com.im.nativebootstrap.media.LocalMedia,done:(Result<com.im.nativebootstrap.media.UploadedMedia>)->Unit) {
        val tag=operation;val base=businessBaseURL
        viewModelScope.launch {
            val result=runCatching{withContext(Dispatchers.IO){com.im.nativebootstrap.media.ChatMediaUploader.upload(object:ChatBusiness {
                override val baseUrl=base
                override fun request(method:String,path:String,body:JsonObject?,query:Map<String,String>):JsonElement{if(tag!=operation)throw java.util.concurrent.CancellationException();return businessRequest(method,path,body,query)}
            },local)}}
            if(tag==operation)done(result)
        }
    }
    private fun sendMassTarget(target:MassTarget,text:String,media:com.im.nativebootstrap.media.UploadedMedia?,done:(Result<ChatMessage>)->Unit) {
        val tag=operation
        viewModelScope.launch {
            try {
                val group=target.type in listOf("group","im-group")
                val peer=withContext(Dispatchers.IO){
                    val id=if(target.type=="im-group")businessRequest("GET","/im/groups/by-im/${encoded(target.id)}").asJsonObject.text("businessGroupId") else target.id
                    if(id.isBlank())throw APIException("群身份未解析")
                    businessRequest("GET",if(group)"/im/groups/${encoded(id)}" else "/im/peers/${encoded(id)}").asJsonObject
                }
                if(tag!=operation)return@launch
                if(!peer.flag("canChat"))throw APIException(peer.text("denyReason").ifBlank{"暂时不能发送消息"})
                val imId=peer.text(if(group)"imGroupId" else "imUserId")
                if(imId.isBlank())throw APIException("聊天身份缺失")
                val callback:(Result<ChatMessage>)->Unit={result->main.post{if(tag==operation)done(result)}}
                chatAction {if(tag==operation){if(media==null)chatController.sendToPeer(imId,group,text,callback) else chatController.sendToPeer(imId,group,media,callback)}}
            }catch(_:kotlinx.coroutines.CancellationException){}catch(error:Exception){if(tag==operation)done(Result.failure(error))}
        }
    }
    fun searchPeerMessages(imId:String,group:Boolean,keyword:String,types:List<Int>,page:Int,count:Int,done:(Result<ChatSearchPage>)->Unit) {
        val tag=operation
        chatAction {chatController.searchPeerMessages(imId,group,keyword,types,page,count){result->main.post{if(tag==operation)done(result)}}}
    }
    fun loadChatPicker(mode:String,keyword:String,tab:Int,page:Int,cursor:String,done:(Result<ChatPickerPage>)->Unit) {
        val tag=operation
        chatAction{chatController.loadPicker(mode,keyword,tab,page,cursor){result->main.post{if(tag==operation)done(result)}}}
    }
    fun loadMentions(cursor:String,done:(Result<ChatMentionPage>)->Unit) {
        val tag=operation
        chatAction{chatController.loadMentions(cursor){result->main.post{if(tag==operation)done(result)}}}
    }
    fun selectMention(choice:ChatMentionChoice,done:(Result<Unit>)->Unit) {
        val tag=operation
        chatAction{chatController.selectMention(choice){result->main.post{if(tag==operation)done(result)}}}
    }
    fun searchAllMessages(keyword:String,page:Int,count:Int,done:(Result<ChatGlobalSearchPage>)->Unit) {
        val tag=operation
        chatAction{chatController.searchAllMessages(keyword,page,count){result->main.post{if(tag==operation)done(result)}}}
    }
    fun openSearchHit(hit:ChatGlobalHit) {if(state.value.authenticated)chatAction{chatController.openSearchHit(hit)}}
    fun openPeerMessage(imId:String,group:Boolean,title:String,avatar:String,message:ChatMessage) {if(state.value.authenticated)chatAction{chatController.openPeerMessage(imId,group,title,avatar,message)}}
    fun loadForwardTargets(tab:String,keyword:String,cursor:String,offset:Int,done:(Result<ChatForwardPage>)->Unit) {
        val tag=operation
        chatAction{chatController.loadForwardTargets(tab,keyword,cursor,offset){result->main.post{if(tag==operation)done(result)}}}
    }
    fun forwardProgress(ids:List<String>,done:(Result<List<ChatForwardProgress>>)->Unit) {
        val tag=operation
        chatAction{chatController.forwardProgress(ids){result->main.post{if(tag==operation)done(result)}}}
    }
    fun forwardTaskAction(id:String,action:String,done:(Result<Unit>)->Unit) {
        val tag=operation
        chatAction{chatController.forwardTaskAction(id,action){result->main.post{if(tag==operation)done(result)}}}
    }
    fun consumeForwardNotice(successId:String,failureId:String) {
        if(state.value.authenticated)chatAction{chatController.consumeForwardNotice(successId,failureId)}
    }
    fun submitForward(messages:List<ChatMessage>,selection:ChatForwardSelection,done:(Result<ChatForwardResult>)->Unit) {
        val tag=operation
        chatAction{chatController.submitForward(messages,selection,{result->main.post{if(tag==operation)done(result)}})}
    }
    fun loadFavoriteSource(messageId:String,conversationId:String,done:(Result<ChatMessage>)->Unit) {
        val tag=operation
        chatAction{chatController.loadFavoriteSource(messageId,conversationId){result->main.post{if(tag==operation)done(result)}}}
    }
    fun submitFavoriteForward(messages:List<ChatMessage>,conversationId:String,selection:ChatForwardSelection,done:(Result<ChatForwardResult>)->Unit) {
        val tag=operation
        chatAction{chatController.submitForward(messages,selection,{result->main.post{if(tag==operation)done(result)}},conversationId)}
    }
    fun sendChatPicker(mode:String,item:ChatPickerItem,done:(Result<ChatMessage>)->Unit) {
        val tag=operation
        val callback:(Result<ChatMessage>)->Unit={result->main.post{if(tag==operation)done(result)}}
        chatAction{if(mode=="card")chatController.sendCard(item.id,item.nickname,item.avatar,callback) else chatController.sendFavorite(item.type,item.content,callback)}
    }
    fun deleteChatFavorite(item:ChatPickerItem,done:(Result<Unit>)->Unit) {
        val tag=operation
        chatAction{chatController.deleteFavorite(item.id){result->main.post{if(tag==operation)done(result)}}}
    }
    fun updateConversation(item:ChatConversation,pinned:Boolean?=null,muted:Boolean?=null,done:(Result<Unit>)->Unit) {
        val tag=operation
        chatAction{chatController.updateConversation(item,pinned,muted){result->main.post{if(tag==operation)done(result)}}}
    }
    fun loadBusinessGroupConversation(groupId:String,done:(Result<ChatConversation>)->Unit)=loadBusinessConversation(groupId,true,done)
    fun loadBusinessConversation(id:String,group:Boolean,done:(Result<ChatConversation>)->Unit) {
        val tag=operation
        viewModelScope.launch {
            try {
                val target=withContext(Dispatchers.IO){businessRequest("GET",if(group)"/im/groups/${encoded(id)}" else "/im/peers/${encoded(id)}").asJsonObject}
                if(tag!=operation)return@launch
                val imId=target.text(if(group)"imGroupId" else "imUserId")
                if(imId.isBlank())throw APIException("聊天身份缺失")
                chatAction{chatController.getPeerConversation(imId,group){result->main.post{if(tag==operation)done(result)}}}
            }catch(_:kotlinx.coroutines.CancellationException){}catch(error:Exception){if(tag==operation)done(Result.failure(if(error is APIException)error else IllegalStateException("会话设置未加载，请重试。")))}
        }
    }
    fun updateContactRelation(id:String,delete:Boolean,blocked:Boolean,conversation:ChatConversation?,done:(Result<String>)->Unit) {
        val tag=operation
        viewModelScope.launch {
            val result=runCatching{withContext(Dispatchers.IO){
                businessRequest(if(delete||!blocked)"DELETE" else "POST","/contacts/${encoded(id)}"+if(delete)"" else "/block");Unit
            }}
            if(tag!=operation)return@launch
            result.fold({
                val success=if(delete)"已删除联络人" else if(blocked)"已加入黑名单" else "已移出黑名单"
                if(!delete&&!blocked){chatAction{chatController.loadConversations(true)};done(Result.success(success))}
                else if(conversation==null)done(Result.success("$success；若本机对话仍在，可在消息列表移除。"))
                else hideConversation(conversation){hidden->done(Result.success(success+if(hidden.isFailure)"；本机对话暂未移除，请核对待发消息后操作。" else ""))}
            },{done(Result.failure(it))})
        }
    }
    fun clearOwnConversation(conversation:ChatConversation,done:(Result<Unit>)->Unit) {
        val tag=operation
        chatAction{chatController.clearOwnConversation(conversation){result->main.post{if(tag==operation)done(result)}}}
    }
    fun leaveBusinessGroup(groupId:String,owner:Boolean,conversation:ChatConversation?,done:(Result<String>)->Unit) {
        val tag=operation
        viewModelScope.launch {
            val result=runCatching{withContext(Dispatchers.IO){businessRequest("POST","/groups/${encoded(groupId)}/${if(owner)"dismiss" else "leave"}");Unit}}
            if(tag!=operation)return@launch
            result.fold({
                if(conversation==null)done(Result.success(if(owner)"群已解散；本机对话尚未移除，可在消息列表删除。" else "已退出群聊；本机对话尚未移除，可在消息列表删除。"))
                else hideConversation(conversation){hidden->done(Result.success(if(hidden.isSuccess)if(owner)"群已解散" else "已退出群聊并移除本机对话" else "群成员关系已更新；本机对话移除失败，请在消息列表重试。"))}
            },{done(Result.failure(it))})
        }
    }
    fun removeDissolvedGroup(groupId:String,conversation:ChatConversation?,done:(Result<String>)->Unit) {
        val tag=operation
        viewModelScope.launch {
            val result=runCatching{withContext(Dispatchers.IO){businessRequest("POST","/groups/${encoded(groupId)}/dissolved/remove");Unit}}
            if(tag!=operation)return@launch
            result.fold({
                if(conversation==null)done(Result.success("已移除已解散群记录；若本机对话仍在，请在消息列表删除。"))
                else hideConversation(conversation){hidden->done(Result.success(if(hidden.isSuccess)"已删除" else "已移除群记录；本机对话移除失败，请在消息列表重试。"))}
            },{done(Result.failure(it))})
        }
    }
    fun markConversationRead(item:ChatConversation,done:(Result<Unit>)->Unit) {
        val tag=operation
        chatAction{chatController.markConversationRead(item){result->main.post{if(tag==operation)done(result)}}}
    }
    fun hideConversation(item:ChatConversation,done:(Result<Unit>)->Unit) {
        val tag=operation
        chatAction{chatController.hideConversation(item){result->main.post{if(tag==operation)done(result)}}}
    }
    fun markLoadedConversationsRead(done:(String)->Unit) {
        val tag=operation
        chatAction{chatController.markAllConversationsRead{result->main.post{if(tag==operation)done(result.fold({it},{it.message?:"标记未完成，请重试"}))}}}
    }
    fun openGroupArchive(groupId:String,media:Boolean) {
        val tag=operation
        viewModelScope.launch {
            try {
                val result=withContext(Dispatchers.IO){businessRequest("GET","/im/groups/${encoded(groupId)}").asJsonObject}
                if(tag!=operation)return@launch
                val imId=result.text("imGroupId")
                if(imId.isBlank())throw APIException("群聊身份缺失")
                business.open(if(media)"group-media" else "group-search-history",groupId,imId)
            }catch(_:kotlinx.coroutines.CancellationException){}catch(error:Exception){if(tag==operation)business.reportError(if(error is APIException)error.message.orEmpty() else "聊天记录未打开，请重试。")}
        }
    }
    fun sendSample(text: String) {
        if(mutableState.value.authenticated) { if(text.isNotBlank()) chatAction { chatController.send(text) };return }
        if (!mutableState.value.sample || !mutableState.value.chatOpen || text.isBlank()) return
        mutableState.value = mutableState.value.copy(messages = mutableState.value.messages + SampleMessage(UUID.randomUUID().toString(), text.trim(), true))
    }
    fun logout() {
        com.im.nativebootstrap.media.MediaLoader.setScope(businessBaseURL,"anonymous")
        val oldTokens=businessSession.currentTokens()
        val oldBase=businessBaseURL
        operation += 1
        loginJob?.cancel()
        loginJob = null
        businessSession.logout()
        imDiagnosticAPI="";imDiagnosticWS=""
        business.reset()
        mass.reset()
        chatAction { chatController.attachIncoming(null);chatController.logout();chatController.attachBusiness(null) }
        mutableState.value = BootstrapState()
        credentialIO.execute {
            try{secureStore.clear()}catch(_:Exception){}
            if(oldTokens!=null)try{NativeAPI(oldBase).businessRequest("POST","/auth/logout",data=obj("refreshToken" to oldTokens.refreshToken))}catch(_:Exception){}
        }
    }

    fun authRequest(baseURL:String,path:String,data:JsonObject,done:(Result<JsonElement>)->Unit) {
        val tag=operation
        viewModelScope.launch {
            val result=runCatching { withContext(Dispatchers.IO) { NativeAPI(baseURL).businessRequest("POST",path,data=data.apply { if(path=="/auth/sms/send")addProperty("deviceId",deviceId) }) } }
            if(tag==operation)done(result)
        }
    }
    override fun onCleared() {
        operation+=1;loginJob?.cancel();businessSession.logout();business.reset();mass.reset()
        chatExecutor.execute { chatController.logout();chatExecutor.shutdownNow() }
        credentialIO.shutdown()
        super.onCleared()
    }
}
