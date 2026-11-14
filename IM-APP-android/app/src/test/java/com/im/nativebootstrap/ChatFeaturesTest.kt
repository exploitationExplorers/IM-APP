package com.im.nativebootstrap

import com.im.nativebootstrap.chat.*
import com.im.nativebootstrap.core.AccountIdentity
import com.im.nativebootstrap.media.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.CountDownLatch
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser

class ChatFeaturesTest {
    @get:Rule val temporary=TemporaryFolder()
    private val target=ChatTarget("si_test",1,"peer")
    private val conversation=ChatConversation(target,"好友","",1)
    private val image=ChatMessage("stable-media-id","[图片]",true,10,1,0,"""{"clientMsgID":"stable-media-id","contentType":102,"pictureElem":{"sourcePicture":{"url":"https://cdn.invalid/original.jpg"}}}""")
    private class Gateway(var peerResult:ChatConversation):ChatGateway {
        lateinit var events:ChatEvents
        var loginCount=0
        var sendCount=0
        var clearCount=0
        var clearResult:Result<Unit> = Result.success(Unit)
        var memberBatchCount=0
        var memberBatch:List<String> = emptyList()
        lateinit var memberBatchDone:(Result<List<ChatGroupMember>>)->Unit
        var listed:List<ChatConversation>?=null
        val offsets=mutableListOf<Int>()
        var readCount=0
        lateinit var sendDone:(Result<ChatMessage>)->Unit
        lateinit var historyDone:(Result<HistoryPage>)->Unit
        lateinit var searchDone:(Result<ChatSearchPage>)->Unit
        lateinit var reconnectDone:(Result<Unit>)->Unit
        lateinit var globalDone:(Result<ChatGlobalSearchPage>)->Unit
        var cursor:String?=null
        var mentionUsers:List<Pair<String,String>> = emptyList()
        var pinned:PinnedChatMessage?=null
        var member:ChatGroupMember?=null
        var remoteImageUrl=""
        var forwardCreates=0
        var mediaCreates=0
        var resolveEachPeer=false
        val sendCallbacks=java.util.concurrent.CopyOnWriteArrayList<(Result<ChatMessage>)->Unit>()
        var sentNotice:()->Unit={}
        val sendStarted=CountDownLatch(1)
        val foundMessages=mutableMapOf<String,ChatMessage>()
        var created=ChatMessage("sdk-id","text",true,1,1,0,"""{"clientMsgID":"sdk-id","contentType":101}""")
        override fun start(userId:String,token:String,api:String,ws:String,directory:File,events:ChatEvents,done:(Result<Unit>)->Unit) { loginCount++;this.events=events;done(Result.success(Unit)) }
        override fun conversations(offset:Int,count:Int,done:(Result<List<ChatConversation>>)->Unit) { offsets+=offset;done(Result.success(listed?.drop(offset)?.take(count) ?: listOf(peerResult))) }
        override fun history(target:ChatTarget,cursor:String?,count:Int,done:(Result<HistoryPage>)->Unit) { this.cursor=cursor;historyDone=done }
        override fun createText(text:String,target:ChatTarget)=created
        override fun createMedia(media:UploadedMedia,target:ChatTarget):ChatMessage { mediaCreates++;return created }
        override fun createMention(text:String,mentions:List<Pair<String,String>>,quote:ChatMessage?,target:ChatTarget):ChatMessage { mentionUsers=mentions;return created }
        override fun pinMessage(target:ChatTarget,pinned:PinnedChatMessage?,done:(Result<Unit>)->Unit) { this.pinned=pinned;done(Result.success(Unit)) }
        override fun send(target:ChatTarget,serialized:String,done:(Result<ChatMessage>)->Unit) { sendCount++;sendDone=done;sendCallbacks+=done;sentNotice();sendStarted.countDown() }
        override fun createForward(source:ChatMessage,snapshot:JsonObject,target:ChatTarget):ChatMessage {
            val id="forward-${++forwardCreates}"
            return created.copy(id=id,serialized="""{"clientMsgID":"$id","contentType":101,"textElem":{"content":"forwarded"}}""")
        }
        override fun find(target:ChatTarget,id:String,done:(Result<ChatMessage?>)->Unit)=done(Result.success(foundMessages[id]))
        override fun foreground(active:Boolean) {}
        override fun shutdown() {}
        override fun peer(imId:String,group:Boolean,done:(Result<ChatConversation>)->Unit)=done(Result.success(if(resolveEachPeer)peerResult.copy(target=ChatTarget("si_$imId",1,imId)) else peerResult))
        override fun reconnect(done:(Result<Unit>)->Unit) { reconnectDone=done }
        override fun clearHistory(target:ChatTarget,done:(Result<Unit>)->Unit) { clearCount++;done(clearResult) }
        override fun search(target:ChatTarget,keyword:String,types:List<Int>,page:Int,count:Int,done:(Result<ChatSearchPage>)->Unit) { searchDone=done }
        override fun searchAll(keyword:String,page:Int,count:Int,done:(Result<ChatGlobalSearchPage>)->Unit) { globalDone=done }
        override fun markRead(target:ChatTarget,done:(Result<Unit>)->Unit) { readCount++;done(Result.success(Unit)) }
        override fun groupMember(target:ChatTarget,userId:String,done:(Result<ChatGroupMember?>)->Unit)=done(Result.success(member))
        override fun groupMembers(target:ChatTarget,userIds:List<String>,done:(Result<List<ChatGroupMember>>)->Unit) { memberBatchCount++;memberBatch=userIds;memberBatchDone=done }
        override fun createRemoteImage(url:String,target:ChatTarget):ChatMessage { remoteImageUrl=url;return created }
    }
    private inner class Harness(group:Boolean=false) {
        val root=temporary.newFolder()
        val groupTarget=ChatTarget("sg_12345678123412341234123456789abc",3,groupId="group")
        val gateway=Gateway(if(group)ChatConversation(groupTarget,"群","",1) else conversation)
        val timers=mutableListOf<Pair<Long,()->Unit>>()
        var state=ChatState()
        val emitted=LinkedBlockingQueue<ChatState>()
        var deferCallbacks=false
        val deferred=LinkedBlockingQueue<()->Unit>()
        val controller=ChatController(gateway,{ if(deferCallbacks)deferred.offer(it) else it() },{ ms,work -> timers+=ms to work },{ state=it;emitted.offer(it) })
        val directory=AccountStorage.directory(root,"https://service.invalid/api/v1","business","im")
        init {
            if(group)GroupRetention(File(directory,"group-retention.json"),AccountStorage.key("https://service.invalid/api/v1","business","im")).merge(listOf(RetentionWatermark(groupTarget.conversationId,10,1,"2026-11-13T00:00:00Z")))
            controller.start(AccountIdentity("business","im"),"https://service.invalid/api/v1","token","https://im.invalid","wss://im.invalid",root)
        }
        fun awaitState(predicate:(ChatState)->Boolean):ChatState {
            val deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(5)
            while(System.nanoTime()<deadline) {
                val next=emitted.poll(250,TimeUnit.MILLISECONDS) ?: continue
                if(predicate(next))return next
            }
            error("expected chat state was not emitted")
        }
    }
    @Test fun resolvingConversationForSettingsDoesNotOpenOrReplaceCurrentRoom() {
        val h=Harness();h.controller.open(conversation)
        val other=ChatConversation(ChatTarget("sg_other",3,groupId="other"),"其他群","",0)
        h.gateway.peerResult=other
        var result:Result<ChatConversation>?=null
        h.controller.getPeerConversation("other",true) { result=it }
        assertEquals(other,result!!.getOrThrow());assertEquals(conversation,h.state.active)
        assertTrue(h.state.messages.isEmpty())
    }
    @Test fun permissionUpdatesBlockAndUnblockInputAndIgnoreAnOldRoomResponse() {
        val h=Harness(true);h.controller.open(h.gateway.peerResult)
        val entered=CountDownLatch(1);val release=CountDownLatch(1)
        var blocked=true;var delayOld=false
        h.controller.attachBusiness(object:ChatBusiness {
            override val baseUrl="https://service.invalid/api/v1"
            override fun request(method:String,path:String,body:JsonObject?,query:Map<String,String>):JsonElement {
                if(path.startsWith("/im/groups/by-im/")) {
                    if(delayOld) { entered.countDown();check(release.await(5,TimeUnit.SECONDS)) }
                    return JsonParser.parseString("""{"canChat":${!blocked},"denyReason":"member_muted","role":"admin"}""")
                }
                if(path.startsWith("/im/peers/"))return JsonParser.parseString("""{"canChat":true}""")
                return JsonParser.parseString("""{"items":[]}""")
            }
        })
        h.controller.refreshSendPermission()
        assertEquals("admin",h.awaitState { it.sendBlockedReason=="您已被禁言" }.groupRole)
        blocked=false;h.controller.refreshSendPermission()
        h.awaitState { !it.permissionLoading&&it.sendBlockedReason==null&&it.groupRole=="admin" }
        blocked=true;delayOld=true;h.controller.refreshSendPermission();assertTrue(entered.await(5,TimeUnit.SECONDS))
        h.controller.open(conversation)
        h.awaitState { it.active==conversation&&!it.permissionLoading }
        h.deferCallbacks=true
        release.countDown()
        val late=h.deferred.poll(5,TimeUnit.SECONDS)
        assertNotNull(late);late!!.invoke()
        assertEquals(conversation,h.state.active);assertNull(h.state.sendBlockedReason)
    }
    @Test fun visibleMemberLookupBatchesOnlyVisibleIdsAndDoesNotRefetchCachedSenders() {
        val h=Harness(true);h.controller.open(h.gateway.peerResult)
        h.controller.loadVisibleGroupMembers(listOf("one","one","two"))
        assertEquals(listOf("one","two"),h.gateway.memberBatch);assertEquals(1,h.gateway.memberBatchCount)
        h.controller.loadVisibleGroupMembers(listOf("three"))
        assertEquals(1,h.gateway.memberBatchCount)
        h.gateway.memberBatchDone(Result.success(listOf(ChatGroupMember("one","owner",false,"群主"))))
        assertEquals(listOf("three"),h.gateway.memberBatch);assertEquals(2,h.gateway.memberBatchCount)
        h.gateway.memberBatchDone(Result.success(listOf(ChatGroupMember("three","admin",false,"管理员"))))
        h.controller.loadVisibleGroupMembers(listOf("one","two","three"))
        assertEquals(2,h.gateway.memberBatchCount)
        assertEquals(setOf("one","three"),h.state.groupMembers.keys)
        h.controller.closeRoom();h.gateway.memberBatchDone(Result.success(listOf(ChatGroupMember("late","owner",false))))
        assertNull(h.state.active);assertFalse(h.state.groupMembers.containsKey("late"))
    }
    @Test fun ownConversationClearRejectsPendingBeforeAnyRemoteMutation() {
        val h=Harness(true);h.controller.open(h.gateway.peerResult);assertTrue(h.controller.send("pending"))
        var mutations=0
        h.controller.attachBusiness(object:ChatBusiness {
            override val baseUrl="https://service.invalid/api/v1"
            override fun request(method:String,path:String,body:JsonObject?,query:Map<String,String>):JsonElement { if(method=="POST")mutations++;return JsonParser.parseString("""{"items":[]}""") }
        })
        var result:Result<Unit>?=null
        h.controller.clearOwnConversation(h.gateway.peerResult) { result=it }
        assertTrue(result!!.isFailure);assertEquals(0,mutations);assertEquals(0,h.gateway.clearCount)
    }
    @Test fun ownClearKeepsItsLockAcrossRemoteRequestAndReportsLocalFailureHonestly() {
        val h=Harness(true);h.controller.open(h.gateway.peerResult)
        val entered=CountDownLatch(1);val release=CountDownLatch(1);val done=CountDownLatch(1)
        var requestBody:JsonObject?=null;var result:Result<Unit>?=null
        h.gateway.clearResult=Result.failure(IllegalStateException("local disk unavailable"))
        h.controller.attachBusiness(object:ChatBusiness {
            override val baseUrl="https://service.invalid/api/v1"
            override fun request(method:String,path:String,body:JsonObject?,query:Map<String,String>):JsonElement=when {
                path.startsWith("/im/groups/by-im/") -> JsonParser.parseString("""{"businessGroupId":"business-group"}""")
                path=="/im/conversation-messages/clear" -> { requestBody=body;entered.countDown();check(release.await(5,TimeUnit.SECONDS));JsonObject() }
                else -> JsonParser.parseString("""{"items":[]}""")
            }
        })
        h.controller.clearOwnConversation(h.gateway.peerResult) { result=it;done.countDown() }
        assertTrue(entered.await(5,TimeUnit.SECONDS))
        assertFalse(h.controller.send("must not race the clear"));assertEquals(0,h.gateway.sendCount)
        release.countDown();assertTrue(done.await(5,TimeUnit.SECONDS))
        assertEquals("business-group",requestBody!!.get("peerId").asString);assertEquals("group",requestBody!!.get("peerType").asString)
        assertTrue(result!!.isFailure);assertTrue(result!!.exceptionOrNull()!!.message!!.contains("远端记录已清理"));assertEquals(1,h.gateway.clearCount)
    }
    @Test fun adminRecallPreservesReasonAndResolvesTheBusinessGroupId() {
        val h=Harness(true);h.controller.open(h.gateway.peerResult)
        var bodySent:JsonObject?=null
        h.controller.attachBusiness(object:ChatBusiness {
            override val baseUrl="https://service.invalid/api/v1"
            override fun request(method:String,path:String,body:JsonObject?,query:Map<String,String>):JsonElement=when {
                path.startsWith("/im/groups/by-im/") -> JsonParser.parseString("""{"businessGroupId":"business-group","role":"admin"}""")
                path=="/im/messages/recall" -> { bodySent=body;JsonObject() }
                else -> JsonParser.parseString("""{"items":[]}""")
            }
        })
        val done=CountDownLatch(1)
        h.controller.recallMessage(ChatMessage("client-id","文字",false,1,seq=15),"  重复内容  ") { assertTrue(it.isSuccess);done.countDown() }
        assertTrue(done.await(5,TimeUnit.SECONDS));assertEquals("重复内容",bodySent!!.get("reason").asString);assertEquals("business-group",bodySent!!.get("peerId").asString);assertEquals("client-id",bodySent!!.get("clientMsgId").asString)
    }
    @Test fun ownMessageWithLateSeqOffersRecallAndResolvesSdkSeqBeforeRealRequest() {
        val h=Harness();h.controller.open(conversation.copy(target=ChatTarget("si_valid",1,"12345678123412341234123456789abc")))
        val pending=ChatMessage("late-seq","待撤回",true,1,2,0,"""{"contentType":101,"textElem":{"content":"待撤回"}}""")
        h.gateway.historyDone(Result.success(HistoryPage(listOf(pending),true)))
        h.gateway.foundMessages[pending.id]=pending.copy(seq=25)
        var sent:JsonObject?=null
        h.controller.attachBusiness(object:ChatBusiness {
            override val baseUrl="https://service.invalid/api/v1"
            override fun request(method:String,path:String,body:JsonObject?,query:Map<String,String>):JsonElement {
                if(path.startsWith("/im/groups/by-im/"))return JsonParser.parseString("""{"businessGroupId":"business-group","canChat":true}""")
                if(path=="/im/messages/recall") { assertEquals("POST",method);sent=body;return JsonObject() }
                return JsonParser.parseString("""{"items":[]}""")
            }
        })
        var menu:ChatMessageMenu?=null
        h.controller.loadMessageMenu(pending) { menu=it.getOrThrow() }
        assertTrue(menu!!.canRecall)
        val done=CountDownLatch(1);var result:Result<Unit>?=null
        h.controller.performAction(pending,ChatAction.RECALL) { result=it;done.countDown() }
        assertTrue(done.await(5,TimeUnit.SECONDS));assertTrue(result!!.isSuccess)
        assertEquals(25L,sent!!.get("seq").asLong)
        assertEquals(pending.id,sent!!.get("clientMsgId").asString)
        assertEquals("12345678-1234-1234-1234-123456789abc",sent!!.get("peerId").asString)
        assertEquals("[消息已撤回]",h.state.messages.first { it.id==pending.id }.text)
    }
    @Test fun recallFallsBackToSameIdRecentHistoryButNeverSubmitsMissingSeqOrTreatsRejectionAsSuccess() {
        listOf(0L,28L).forEach { syncedSeq ->
            val h=Harness();h.controller.open(conversation.copy(target=ChatTarget("si_valid",1,"12345678123412341234123456789abc")))
            val pending=ChatMessage("history-seq","保留原文",true,1,2,0,"""{"contentType":101,"textElem":{"content":"保留原文"}}""")
            h.gateway.historyDone(Result.success(HistoryPage(listOf(pending),true)))
            h.gateway.foundMessages[pending.id]=pending
            val requests=java.util.concurrent.CopyOnWriteArrayList<JsonObject>()
            h.controller.attachBusiness(object:ChatBusiness {
                override val baseUrl="https://service.invalid/api/v1"
                override fun request(method:String,path:String,body:JsonObject?,query:Map<String,String>):JsonElement {
                    if(path.startsWith("/im/groups/by-im/"))return JsonParser.parseString("""{"businessGroupId":"business-group","canChat":true}""")
                    if(path=="/im/messages/recall") { requests+=body!!.deepCopy();error("server rejected recall") }
                    return JsonParser.parseString("""{"items":[]}""")
                }
            })
            val done=CountDownLatch(1);var result:Result<Unit>?=null
            h.controller.performAction(pending,ChatAction.RECALL) { result=it;done.countDown() }
            assertNull(result)
            // 不得误用另一条消息的 seq；只接受 clientMsgID 完全一致的历史记录。
            h.gateway.historyDone(Result.success(HistoryPage(listOf(pending.copy(id="different",seq=99),pending.copy(seq=syncedSeq)),true)))
            assertTrue(done.await(5,TimeUnit.SECONDS));assertTrue(result!!.isFailure)
            assertEquals(if(syncedSeq>0)1 else 0,requests.size)
            if(syncedSeq>0)assertEquals(syncedSeq,requests.single().get("seq").asLong)
            assertEquals("保留原文",h.state.messages.first { it.id==pending.id }.text)
        }
    }
    @Test fun inviteAcceptanceEncodesTheOpaqueTokenAndRequiresAnExplicitNextAction() {
        val h=Harness();var acceptedPath=""
        h.controller.attachBusiness(object:ChatBusiness {
            override val baseUrl="https://service.invalid/api/v1"
            override fun request(method:String,path:String,body:JsonObject?,query:Map<String,String>):JsonElement {
                if(path.startsWith("/group-invitations/")) { acceptedPath=path;return JsonParser.parseString("""{"nextAction":"pending_approval"}""") }
                return JsonParser.parseString("""{"items":[]}""")
            }
        })
        val done=CountDownLatch(1);var result:Result<ChatInviteResult>?=null
        h.controller.acceptGroupInvite("opaque/token+value") { result=it;done.countDown() }
        assertTrue(done.await(5,TimeUnit.SECONDS));assertEquals("/group-invitations/opaque%2Ftoken%2Bvalue/accept",acceptedPath);assertEquals("pending_approval",result!!.getOrThrow().nextAction)
        assertEquals(0,h.gateway.sendCount)
    }
    @Test fun batchMediaUsesStableDurableOutboxAndDoesNotClaimAcceptanceEarly() {
        val h=Harness();h.gateway.created=image
        val local=LocalMedia(File(h.root,"selected.jpg"),"a.jpg","image/jpeg",MediaKind.IMAGE)
        val results=mutableListOf<Result<ChatMessage>>()
        h.controller.sendToPeer("peer",false,UploadedMedia(local,"https://cdn.invalid/original.jpg")) { results+=it }
        assertTrue(results.isEmpty());assertEquals(1,h.gateway.sendCount)
        assertTrue(File(h.directory,"app-outbox.json").readText().contains("original.jpg"))
        assertEquals(OutboxState.SENDING,h.state.outbox.single().state)
        h.gateway.sendDone(Result.success(image.copy(status=2,seq=15)))
        assertTrue(results.single().isSuccess);assertEquals("stable-media-id",results.single().getOrThrow().id)
    }
    @Test fun recordingQueuesLocalVideoBeforeMetadataOrUploadAndHandoffsOneSdkIdWithPlayableCopy() {
        val h=Harness();h.controller.open(conversation)
        val source=File(h.root,"recorded.mp4").apply { writeBytes(byteArrayOf(1,5,9,13)) }
        val metadataEntered=CountDownLatch(1);val metadataRelease=CountDownLatch(1)
        val uploadEntered=CountDownLatch(1);val uploadRelease=CountDownLatch(1)
        val uploadedKinds=java.util.concurrent.CopyOnWriteArrayList<MediaKind>()
        val video=ChatMessage("stable-sdk-video","[视频]",true,10,1,0,"""{"clientMsgID":"stable-sdk-video","contentType":104,"videoElem":{"videoUrl":"https://cdn.invalid/recorded.mp4","snapshotUrl":"https://cdn.invalid/cover.jpg","duration":12,"snapshotWidth":360,"snapshotHeight":640}}""")
        h.gateway.created=video
        h.controller.attachBusiness(object:ChatBusiness {
            override val baseUrl="https://service.invalid/api/v1"
            override fun request(method:String,path:String,body:JsonObject?,query:Map<String,String>)=JsonParser.parseString("""{"canChat":true}""")
            override fun prepareMedia(media:LocalMedia):LocalMedia {
                metadataEntered.countDown();check(metadataRelease.await(5,TimeUnit.SECONDS))
                val cover=File(media.file.parentFile,media.file.nameWithoutExtension+".cover.jpg").apply { writeBytes(byteArrayOf(2,4,6)) }
                return media.copy(duration=12,width=360,height=640,snapshot=cover)
            }
            override fun uploadMedia(media:LocalMedia):UploadedMedia {
                uploadedKinds+=media.kind
                if(media.kind==MediaKind.VIDEO) { uploadEntered.countDown();check(uploadRelease.await(5,TimeUnit.SECONDS)) }
                return UploadedMedia(media,if(media.kind==MediaKind.VIDEO)"https://cdn.invalid/recorded.mp4" else "https://cdn.invalid/cover.jpg")
            }
        })
        var queued:Boolean?=null
        assertTrue(h.controller.sendMedia(LocalMedia(source,"recorded.mp4","video/mp4",MediaKind.VIDEO)) { queued=it })
        assertEquals(true,queued)
        assertTrue(metadataEntered.await(5,TimeUnit.SECONDS))
        val local=h.state.mediaUploads.single()
        assertEquals(MediaKind.VIDEO,local.kind)
        assertEquals(local.id,h.state.messages.single().id)
        assertTrue(local.media().file.isFile)
        assertEquals(0,h.gateway.mediaCreates);assertEquals(0,h.gateway.sendCount)
        assertFalse(h.state.uploading)
        metadataRelease.countDown();assertTrue(uploadEntered.await(5,TimeUnit.SECONDS))
        assertEquals(104,MessageContents.parse(h.state.messages.single().serialized).type)
        assertEquals(0,h.gateway.sendCount)
        uploadRelease.countDown()
        assertTrue(h.gateway.sendStarted.await(5,TimeUnit.SECONDS))
        h.awaitState { it.outbox.singleOrNull()?.id==video.id }
        assertEquals(listOf(MediaKind.VIDEO,MediaKind.IMAGE),uploadedKinds.toList())
        assertEquals(1,h.gateway.mediaCreates);assertEquals(1,h.gateway.sendCount)
        assertTrue(h.state.mediaUploads.isEmpty())
        assertEquals(OutboxState.SENDING,h.state.outbox.single().state)
        assertEquals(1,h.state.messages.count { it.id==video.id })
        assertArrayEquals(byteArrayOf(1,5,9,13),h.state.localSentMedia.getValue(video.id).file.readBytes())
        assertTrue(h.state.localSentMedia.getValue(video.id).snapshot!!.isFile)
        h.controller.start(AccountIdentity("business","im"),"https://service.invalid/api/v1","token","https://im.invalid","wss://im.invalid",h.root)
        assertTrue(h.state.localSentMedia.getValue(video.id).file.isFile)
        assertEquals(1,h.gateway.mediaCreates)
        assertEquals(1,h.gateway.sendCount)
    }
    @Test fun videoCoverRetryReusesUploadedVideoAndNeverClaimsServerAcceptance() {
        val h=Harness();h.controller.open(conversation)
        val source=File(h.root,"clip.mp4").apply { writeBytes(byteArrayOf(4,3,2,1)) }
        val cover=File(h.root,"clip.jpg").apply { writeBytes(byteArrayOf(1,2)) }
        var videoUploads=0;var coverUploads=0
        h.controller.attachBusiness(object:ChatBusiness {
            override val baseUrl="https://service.invalid/api/v1"
            override fun request(method:String,path:String,body:JsonObject?,query:Map<String,String>)=JsonParser.parseString("""{"canChat":true}""")
            override fun uploadMedia(media:LocalMedia):UploadedMedia {
                if(media.kind==MediaKind.VIDEO) { videoUploads++;return UploadedMedia(media,"https://cdn.invalid/clip.mp4") }
                coverUploads++;if(coverUploads==1)error("cover network unavailable")
                return UploadedMedia(media,"https://cdn.invalid/clip.jpg")
            }
        })
        assertTrue(h.controller.sendMedia(LocalMedia(source,"clip.mp4","video/mp4",MediaKind.VIDEO,duration=4,width=360,height=640,snapshot=cover)))
        h.awaitState { it.mediaUploads.singleOrNull()?.state==MediaUploadState.FAILED }
        val failed=h.state.mediaUploads.single()
        assertEquals("https://cdn.invalid/clip.mp4",failed.remoteUrl)
        assertTrue(failed.media().file.isFile);assertTrue(failed.media().snapshot!!.isFile)
        assertEquals(0,h.gateway.sendCount)
        h.controller.retryImageUpload(failed.id)
        assertTrue(h.gateway.sendStarted.await(5,TimeUnit.SECONDS))
        assertEquals(1,videoUploads);assertEquals(2,coverUploads)
        assertEquals(1,h.gateway.mediaCreates)
        assertEquals(OutboxState.SENDING,h.state.outbox.single().state)
        assertEquals(1,h.state.outbox.single().message.status)
    }
    @Test fun batchTimeoutReportsUncertainOnceAndNeverBlindlyResends() {
        val h=Harness();val results=mutableListOf<Result<ChatMessage>>()
        h.controller.sendToPeer("peer",false,"hello") { results+=it }
        h.timers.last { it.first==30_000L }.second()
        assertTrue(results.single().isFailure)
        assertEquals(OutboxState.UNCERTAIN,h.state.outbox.single().state)
        h.gateway.sendDone(Result.success(h.gateway.created.copy(status=2,seq=12)))
        assertEquals(1,results.size);assertEquals(1,h.gateway.sendCount)
        assertEquals(OutboxState.ACCEPTED,h.state.outbox.single().state)
    }
    @Test fun onlyRealtimeNonMineMessagesNotifyAndDuplicatesAreCoalesced() {
        val h=Harness();val notifications=mutableListOf<String>()
        h.controller.attachIncoming { notifications+=it.id }
        val incoming=ChatMessage("incoming","你好",false,1)
        h.gateway.events.messages(listOf(target to incoming))
        assertTrue(notifications.isEmpty())
        h.gateway.events.liveMessages(listOf(target to incoming,target to incoming,target to incoming.copy(id="mine",mine=true)))
        assertEquals(listOf("incoming"),notifications)
        h.controller.logout();h.gateway.events.liveMessages(listOf(target to incoming.copy(id="late-account")))
        assertEquals(listOf("incoming"),notifications)
    }
    @Test fun groupFilteringPreservesOriginalSdkHistoryCursorAndSearchBoundary() {
        val h=Harness(true);h.controller.open(h.gateway.peerResult)
        val hidden=ChatMessage("hidden","old",false,9,seq=9)
        h.gateway.historyDone(Result.success(HistoryPage(listOf(hidden),false)))
        assertTrue(h.state.messages.isEmpty());assertFalse(h.state.historyEnd)
        h.controller.loadHistory();assertEquals("hidden",h.gateway.cursor)
        var found:ChatSearchPage?=null
        h.controller.searchPeerMessages("group",true,"test",emptyList(),1,40) { found=it.getOrThrow() }
        h.gateway.searchDone(Result.success(ChatSearchPage(listOf(hidden,hidden.copy(id="boundary",seq=10)),1,false)))
        assertEquals(listOf("boundary"),found!!.messages.map { it.id });assertFalse(found!!.end)
    }
    @Test fun reconnectNeverRequestsAnotherLoginAndDoesNotPretendConnected() {
        val h=Harness();var result:Result<Unit>?=null
        h.controller.reconnect { result=it }
        assertEquals(ConnectionState.CONNECTING,h.state.connection);assertNull(result)
        h.gateway.reconnectDone(Result.success(Unit))
        assertTrue(result!!.isSuccess);assertEquals(ConnectionState.CONNECTING,h.state.connection)
        assertEquals(1,h.gateway.loginCount)
        h.gateway.events.connection(ConnectionState.CONNECTED)
        assertEquals(ConnectionState.CONNECTED,h.state.connection)
    }
    @Test fun localClearCannotEraseUnconfirmedOutbox() {
        val h=Harness();h.controller.open(conversation);assertTrue(h.controller.send("text"))
        var result:Result<Unit>?=null
        h.controller.clearConversation(conversation) { result=it }
        assertTrue(result!!.isFailure);assertEquals(0,h.gateway.clearCount)
        assertEquals(OutboxState.SENDING,h.state.outbox.single().state)
    }
    @Test fun currentForegroundRoomAndMutedConversationsDoNotNotify() {
        val h=Harness();val ids=mutableListOf<String>();h.controller.attachIncoming { ids+=it.id }
        h.controller.open(conversation);h.controller.foreground(true)
        h.gateway.events.liveMessages(listOf(target to ChatMessage("viewed","hello",false,1)))
        assertTrue(ids.isEmpty())
        h.controller.foreground(false)
        h.gateway.events.liveMessages(listOf(target to ChatMessage("background","hello",false,1)))
        assertEquals(listOf("background"),ids)
        h.gateway.events.conversations(listOf(conversation.copy(muted=true,time=99)))
        h.gateway.events.liveMessages(listOf(target to ChatMessage("muted","hello",false,1)))
        assertEquals(listOf("background"),ids)
    }
    @Test fun mentionUsesSdkUserIdsAndDoesNotTreatPlainAtTextAsReceipt() {
        val h=Harness(true);h.controller.open(h.gateway.peerResult)
        val other=ChatMessage("other","你好",false,1,2,12,"""{"contentType":101,"sendID":"member-im","textElem":{"content":"你好"}}""","成员")
        h.controller.performAction(other,ChatAction.MENTION) { assertTrue(it.isSuccess) }
        assertEquals("member-im",h.state.mentions.single().userId)
        assertTrue(h.controller.send("@成员 收到"))
        assertEquals(listOf("member-im" to "成员"),h.gateway.mentionUsers)
        assertTrue(h.state.mentions.isEmpty())
    }
    @Test fun selfPinUpdatesConversationWithoutSendingSharedMessage() {
        val h=Harness();h.controller.open(conversation)
        val message=ChatMessage("pinned-id","置顶内容",false,1,2,3,"""{"contentType":101,"textElem":{"content":"置顶内容"}}""","好友")
        var done:Result<Unit>?=null
        h.controller.performAction(message,ChatAction.PIN_SELF) { done=it }
        assertTrue(done!!.isSuccess);assertEquals("self",h.gateway.pinned!!.scope)
        assertEquals("pinned-id",h.state.active!!.pinnedMessage!!.clientMsgID)
        assertEquals(0,h.gateway.sendCount)
        h.controller.performAction(message,ChatAction.UNPIN) { done=it }
        assertTrue(done!!.isSuccess);assertNull(h.state.active!!.pinnedMessage)
    }
    @Test fun blockedSharedPinPermissionDoesNotBlockFollowingSerialControllerAction() {
        val h=Harness()
        val peer="12345678123412341234123456789abc"
        h.controller.open(conversation.copy(target=ChatTarget("si_$peer",1,peer)))
        val entered=CountDownLatch(1);val release=CountDownLatch(1)
        h.controller.attachBusiness(object:ChatBusiness {
            override val baseUrl="https://service.invalid/api/v1"
            override fun request(method:String,path:String,body:JsonObject?,query:Map<String,String>):JsonElement {
                if(path.startsWith("/im/peers/")) { entered.countDown();check(release.await(5,TimeUnit.SECONDS));return JsonParser.parseString("""{"canChat":false}""") }
                return JsonParser.parseString("""{"items":[]}""")
            }
        })
        val message=ChatMessage("pin","置顶",true,1,2,20,"""{"contentType":101,"textElem":{"content":"置顶"}}""")
        val serial=java.util.concurrent.Executors.newSingleThreadExecutor()
        val selfDone=CountDownLatch(1);val sharedDone=CountDownLatch(1)
        var selfResult:Result<Unit>?=null;var sharedResult:Result<Unit>?=null
        try {
            serial.execute { h.controller.performAction(message,ChatAction.PIN_SHARED) { sharedResult=it;sharedDone.countDown() } }
            assertTrue(entered.await(5,TimeUnit.SECONDS))
            serial.execute { h.controller.performAction(message,ChatAction.PIN_SELF) { selfResult=it;selfDone.countDown() } }
            assertTrue(selfDone.await(1,TimeUnit.SECONDS))
            assertTrue(selfResult!!.isSuccess);assertNull(sharedResult)
            assertEquals("self",h.gateway.pinned!!.scope)
            release.countDown();assertTrue(sharedDone.await(5,TimeUnit.SECONDS))
            assertTrue(sharedResult!!.isFailure);assertEquals("self",h.gateway.pinned!!.scope)
            assertEquals(0,h.gateway.sendCount)
        } finally { release.countDown();serial.shutdownNow() }
    }
    @Test fun refreshUpdatesReadAndMuteFieldsEvenWhenLatestMessageTimeHasNotChanged() {
        val old=conversation.copy(preview="",unread=5,muted=false)
        val refreshed=conversation.copy(preview="当前消息",unread=0,muted=true)
        assertEquals(refreshed,mergeConversations(listOf(old),listOf(refreshed)).single())
        assertEquals(old.copy(time=99),mergeConversations(listOf(old.copy(time=99)),listOf(refreshed)).single())
    }
    @Test fun markAllReadTraversesEverySdkPageInsteadOfOnlyLoadedConversations() {
        val h=Harness()
        h.gateway.listed=(0..204).map { conversation.copy(target=ChatTarget("si_$it",1,"peer"),unread=1) }
        var result:Result<String>?=null
        h.controller.markAllConversationsRead { result=it }
        assertTrue(result!!.isSuccess);assertEquals(205,h.gateway.readCount)
        assertEquals(listOf(0,100,200),h.gateway.offsets.takeLast(3))
    }
    @Test fun globalSearchUsesSdkWholeStoreAndKeepsRawPageEndAfterRetentionFiltering() {
        val h=Harness(true)
        val group=h.gateway.peerResult
        var result:ChatGlobalSearchPage?=null
        h.controller.searchAllMessages("hello",2,60) { result=it.getOrThrow() }
        h.gateway.globalDone(Result.success(ChatGlobalSearchPage(listOf(ChatGlobalHit(group,ChatMessage("old","hello",false,1,seq=9)),ChatGlobalHit(group,ChatMessage("new","hello",false,1,seq=10))),2,false)))
        assertEquals(listOf("new"),result!!.hits.map { it.message.id });assertEquals(2,result!!.page);assertFalse(result!!.end)
    }
    @Test fun clearAllChecksOutboxBeforeBusinessRequestAndOnlyCallsCurrentAccountClear() {
        val queue=LinkedBlockingQueue<()->Unit>();val cleared=mutableListOf<JsonObject>()
        var latest=ChatState()
        val gateway=Gateway(conversation)
        val controller=ChatController(gateway,{ queue.put(it) },{ _,_ -> },{ latest=it })
        val root=temporary.newFolder()
        controller.start(AccountIdentity("business","im"),"https://service.invalid/api/v1","token","https://im.invalid","wss://im.invalid",root)
        fun until(condition:()->Boolean) {
            val deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(5)
            while(!condition()&&System.nanoTime()<deadline)queue.poll(100,TimeUnit.MILLISECONDS)?.invoke()
            assertTrue(condition())
        }
        until { latest.ready }
        controller.open(conversation);assertTrue(controller.send("pending"))
        controller.attachBusiness(object:ChatBusiness {
            override val baseUrl="https://service.invalid/api/v1"
            override fun request(method:String,path:String,body:JsonObject?,query:Map<String,String>):JsonElement {
                assertEquals("POST",method);assertEquals("/im/conversation-messages/clear",path)
                synchronized(cleared) { cleared+=body!!.deepCopy() }
                return JsonParser.parseString("{\"ok\":true}")
            }
        })
        val other=conversation.copy(target=ChatTarget("si_other",1,"12345678123412341234123456789abc"))
        gateway.listed=listOf(conversation,other)
        var result:Result<String>?=null
        controller.clearAllConversations { result=it }
        until { result!=null }
        assertTrue(result!!.isSuccess);assertEquals(1,cleared.size);assertEquals(1,gateway.clearCount)
        assertEquals("c2c",cleared.single().get("peerType").asString)
        assertEquals("12345678-1234-1234-1234-123456789abc",cleared.single().get("peerId").asString)
        assertEquals(OutboxState.SENDING,latest.outbox.single().state)
    }
    @Test fun directForwardClosesPickerAfterLocalDurabilityAndDoesNotWaitForRecipientAcks() {
        val h=Harness();h.controller.open(conversation)
        val entered=CountDownLatch(1);val release=CountDownLatch(1);val sent=CountDownLatch(2)
        h.gateway.resolveEachPeer=true
        h.gateway.sentNotice={ sent.countDown() }
        h.controller.attachBusiness(object:ChatBusiness {
            override val baseUrl="https://service.invalid/api/v1"
            override fun request(method:String,path:String,body:JsonObject?,query:Map<String,String>):JsonElement {
                entered.countDown();check(release.await(5,TimeUnit.SECONDS))
                return JsonParser.parseString("""{"canChat":true,"imUserId":"${path.substringAfterLast('/')}"}""")
            }
        })
        val text=ChatMessage("source","hello",true,1,2,2,"""{"contentType":101,"textElem":{"content":"hello"}}""")
        val targets=listOf("first","second").map { ChatForwardTarget(it,it,"contact",businessUserId=it) }
        var result:Result<ChatForwardResult>?=null
        h.controller.submitForward(listOf(text),ChatForwardSelection(targets),done={ result=it })
        assertTrue(result!!.getOrThrow().queued)
        assertEquals("",h.state.forwardSuccessId)
        assertTrue(File(h.directory,"pending-forwards.json").isFile)
        assertTrue(entered.await(5,TimeUnit.SECONDS));assertEquals(0,h.gateway.sendCount)
        release.countDown();assertTrue(sent.await(5,TimeUnit.SECONDS))
        val plan=h.state.pendingForwards.single().plan
        assertEquals(2,plan.size);assertEquals(2,h.state.outbox.size)
        assertEquals("processing",h.state.pendingForwards.single().status)
        assertEquals("",h.state.forwardSuccessId)
        plan.forEachIndexed { index,item ->
            val accepted=item.message.copy(status=2,seq=20L+index)
            h.gateway.foundMessages[accepted.id]=accepted
            h.gateway.sendCallbacks[index](Result.success(accepted))
            if(index==0)assertEquals("",h.state.forwardSuccessId)
        }
        assertEquals("completed",h.state.pendingForwards.single().status)
        val successId=h.state.pendingForwards.single().id
        assertEquals(successId,h.state.forwardSuccessId)
        assertTrue(h.state.outbox.isEmpty())
        h.controller.consumeForwardNotice(successId,"")
        assertEquals("",h.state.forwardSuccessId)
        // 重复 SDK 回调不重复发出成功事件。
        h.gateway.sendCallbacks.last()(Result.success(plan.last().message.copy(status=2,seq=21)))
        assertEquals("",h.state.forwardSuccessId)
    }
    private fun recoverPreparedForward(foundStatus:Int?,picture:Boolean=false):Harness {
        val h=Harness()
        val owner=AccountStorage.key("https://service.invalid/api/v1","business","im")
        val store=PendingForwards(File(h.directory,"pending-forwards.json"),owner)
        val source=ChatMessage("source","hello",true,1,2,2,"""{"contentType":101,"textElem":{"content":"hello"}}""")
        val prepared=source.copy(id="fixed-forward-id",status=1,seq=0,serialized=if(picture)"""{"clientMsgID":"fixed-forward-id","contentType":102,"pictureElem":{"sourcePath":"","sourcePicture":{"url":"https://cdn.invalid/preserved.jpg","type":""},"snapshotPicture":{"url":"https://cdn.invalid/thumb.jpg","type":""}}}""" else """{"clientMsgID":"fixed-forward-id","contentType":101,"textElem":{"content":"hello"}}""")
        val job=store.put("si_test",listOf(source),ChatForwardSelection(listOf(ChatForwardTarget("peer","peer","contact",businessUserId="peer"))))
        store.update(job.id) { it.copy(status="processing",plan=listOf(PreparedForward(target,prepared,attempted=true))) }
        // 模拟 0.3.3 文档尚未包含新增诊断字段。
        val legacyFile=File(h.directory,"pending-forwards.json")
        val legacy=JsonParser.parseString(legacyFile.readText()).asJsonObject
        legacy.getAsJsonArray("entries").forEach { it.asJsonObject.remove("failureStage");it.asJsonObject.remove("failureCode") }
        legacyFile.writeText(legacy.toString())
        if(foundStatus!=null)h.gateway.foundMessages[prepared.id]=prepared.copy(status=foundStatus,seq=if(foundStatus==2)22 else 0)
        h.controller.attachBusiness(object:ChatBusiness {
            override val baseUrl="https://service.invalid/api/v1"
            override fun request(method:String,path:String,body:JsonObject?,query:Map<String,String>)=JsonParser.parseString("""{"canChat":true}""")
        })
        h.controller.start(AccountIdentity("business","im"),"https://service.invalid/api/v1","token","https://im.invalid","wss://im.invalid",h.root)
        h.controller.open(conversation)
        assertEquals("failed",h.state.pendingForwards.single().status)
        h.controller.forwardTaskAction(job.id,"retry") { assertTrue(it.isSuccess) }
        return h
    }
    @Test fun recoveredForwardWithAcceptedSdkIdNeverSendsAgain() {
        val h=recoverPreparedForward(2)
        h.awaitState { it.pendingForwards.singleOrNull()?.status=="completed" }
        assertEquals(0,h.gateway.sendCount);assertTrue(h.state.outbox.isEmpty())
    }
    @Test fun recoveredForwardWithUncertainSdkIdNeverBlindlyResends() {
        val h=recoverPreparedForward(null)
        h.awaitState { it.pendingForwards.singleOrNull()?.status=="uncertain" }
        assertEquals(0,h.gateway.sendCount);assertTrue(h.state.outbox.isEmpty())
    }
    @Test fun recoveredForwardWithExplicitSdkFailureReusesTheSameId() {
        val h=recoverPreparedForward(3)
        h.awaitState { it.outbox.singleOrNull()?.state==OutboxState.SENDING }
        assertEquals("fixed-forward-id",h.state.outbox.single().id)
        assertEquals(0,h.gateway.forwardCreates)
        assertTrue(h.gateway.sendStarted.await(5,TimeUnit.SECONDS))
        assertEquals(1,h.gateway.sendCallbacks.size)
        assertEquals(1,h.gateway.sendCount)
    }
    @Test fun recoveredFailedImageRepairsOldEmptyTypesWithoutReplacingSdkIdOrArchivedUrls() {
        val h=recoverPreparedForward(3,picture=true)
        h.awaitState { it.outbox.singleOrNull()?.state==OutboxState.SENDING }
        val sent=h.state.outbox.single().message
        assertEquals("fixed-forward-id",sent.id)
        assertEquals(0,h.gateway.forwardCreates)
        val elem=JsonParser.parseString(sent.serialized).asJsonObject.getAsJsonObject("pictureElem")
        listOf("sourcePicture","bigPicture","snapshotPicture").forEach { assertEquals("image/jpeg",elem.getAsJsonObject(it)["type"].asString) }
        assertEquals("https://cdn.invalid/preserved.jpg",elem.getAsJsonObject("sourcePicture")["url"].asString)
        assertEquals("https://cdn.invalid/thumb.jpg",elem.getAsJsonObject("snapshotPicture")["url"].asString)
    }
    @Test fun recoveredUncertainImageKeepsItsPayloadAndNeverResendsWithoutSdkEvidence() {
        val h=recoverPreparedForward(null,picture=true)
        h.awaitState { it.pendingForwards.singleOrNull()?.status=="uncertain" }
        assertEquals(0,h.gateway.sendCount)
        val job=h.state.pendingForwards.single()
        assertEquals("",JsonParser.parseString(job.plan.single().message.serialized).asJsonObject.getAsJsonObject("pictureElem").getAsJsonObject("sourcePicture")["type"].asString)
        assertEquals("",h.state.forwardSuccessId)
        assertEquals(job.id,h.state.forwardFailureId)
    }
    @Test fun failedSdkForwardRecordsCodeAndLateLocalSuccessDoesNotResend() {
        val h=recoverPreparedForward(3)
        h.awaitState { it.outbox.singleOrNull()?.state==OutboxState.SENDING }
        assertTrue(h.gateway.sendStarted.await(5,TimeUnit.SECONDS))
        h.gateway.sendDone(Result.failure(ChatFailure(1001)))
        val failed=h.state.pendingForwards.single()
        assertEquals("uncertain",failed.status)
        assertEquals("sdk",failed.failureStage);assertEquals(1001,failed.failureCode)
        assertEquals("",h.state.forwardSuccessId);assertEquals(failed.id,h.state.forwardFailureId)
        h.controller.consumeForwardNotice("",failed.id)
        val accepted=failed.plan.single().message.copy(status=2,seq=20)
        h.gateway.events.messages(listOf(target to accepted))
        assertEquals("completed",h.state.pendingForwards.single().status)
        assertEquals(failed.id,h.state.forwardSuccessId)
        assertEquals(1,h.gateway.sendCount)
    }
    @Test fun tagForwardUsesBusinessSelectorAndRequiresQueuedAcceptance() {
        val h=Harness();h.controller.open(conversation)
        var requestBody:JsonObject?=null
        val done=CountDownLatch(1)
        h.controller.attachBusiness(object:ChatBusiness {
            override val baseUrl="https://service.invalid/api/v1"
            override fun request(method:String,path:String,body:JsonObject?,query:Map<String,String>):JsonElement {
                assertEquals("/forward-batches",path);requestBody=body
                return JsonParser.parseString("{\"status\":\"queued\",\"taskIds\":[\"task\"]}")
            }
        })
        var result:Result<ChatForwardResult>?=null
        val text=ChatMessage("source","你好",true,1,2,2,"""{"contentType":101,"textElem":{"content":"你好"}}""")
        h.controller.submitForward(listOf(text),ChatForwardSelection(listOf(ChatForwardTarget("tag","朋友","tag",tagId="tag-business"))),done={ result=it;done.countDown() })
        assertTrue(done.await(5,TimeUnit.SECONDS));assertTrue(result!!.getOrThrow().queued)
        h.awaitState { it.pendingForwards.any { job -> job.remoteTaskIds==listOf("task") } }
        assertEquals("tags",requestBody!!.getAsJsonObject("selector").get("mode").asString)
        assertEquals("tag-business",requestBody!!.getAsJsonObject("selector").getAsJsonArray("tagIds").single().asString)
        assertEquals(0,h.gateway.sendCount)
    }
    private fun serverProgress(status:String="processing",success:Int=0,pending:Int=2)=JsonParser.parseString("""{"id":"task","status":"$status","sourceConversationId":"si_test","sourceClientMsgId":"source","targetCount":2,"successCount":$success,"failedCount":0,"skippedCount":0,"cancelledCount":0,"pendingCount":$pending,"processingCount":0,"sourceSnapshot":{"contentType":101,"content":{"content":"hello"}}}""").asJsonObject
    private fun queuedServerForward(response:java.util.concurrent.atomic.AtomicReference<JsonObject>,cacheFails:Boolean=false):Harness {
        val h=Harness();h.controller.open(conversation)
        h.controller.attachBusiness(object:ChatBusiness {
            override val baseUrl="https://service.invalid/api/v1"
            override fun request(method:String,path:String,body:JsonObject?,query:Map<String,String>):JsonElement {
                if(path=="/forward-batches")return JsonParser.parseString("""{"status":"queued","taskIds":["task"]}""")
                assertEquals("/forward-task-progress",path)
                return response.get().deepCopy()
            }
            override fun rememberForwardMedia(source:ChatMessage,preserved:JsonObject) { if(cacheFails)error("optional cache unavailable") }
        })
        val source=ChatMessage("source","hello",true,1,2,2,"""{"contentType":101,"textElem":{"content":"hello"}}""")
        h.controller.submitForward(listOf(source),ChatForwardSelection(listOf(ChatForwardTarget("tag","朋友","tag",tagId="tag"))),done={ assertTrue(it.getOrThrow().queued) })
        h.awaitState { it.pendingForwards.singleOrNull()?.remoteTaskIds==listOf("task") }
        return h
    }
    private fun queryLocalForward(h:Harness):ChatForwardProgress {
        val done=CountDownLatch(1);var result:Result<List<ChatForwardProgress>>?=null
        h.controller.forwardProgress(listOf(h.state.pendingForwards.single().id)) { result=it;done.countDown() }
        assertTrue(done.await(5,TimeUnit.SECONDS))
        return result!!.getOrThrow().single()
    }
    @Test fun queuedServerForwardOnlyAnnouncesSuccessAfterMatchedCompleteCountsAndIgnoresOptionalCacheFailure() {
        val response=java.util.concurrent.atomic.AtomicReference(serverProgress())
        val h=queuedServerForward(response,cacheFails=true)
        assertEquals("processing",queryLocalForward(h).status)
        assertEquals("",h.state.forwardSuccessId)
        response.set(serverProgress("completed",success=2,pending=0))
        assertEquals("completed",queryLocalForward(h).status)
        assertEquals(h.state.pendingForwards.single().id,h.state.forwardSuccessId)
    }
    @Test fun mismatchedOrIncompleteServerCompletionNeverAnnouncesSuccess() {
        val invalid=listOf(
            serverProgress("completed",2,0).apply { addProperty("id","other-task") },
            serverProgress("completed",2,0).apply { addProperty("sourceConversationId","other-room") },
            serverProgress("completed",2,0).apply { addProperty("sourceClientMsgId","other-source") },
            serverProgress("completed",1,1),
            serverProgress("completed",2,1),
            serverProgress("completed",2,0).apply { remove("processingCount") },
            serverProgress("completed",2,0).apply { addProperty("successCount",1.5) }
        )
        invalid.forEach { raw ->
            val h=queuedServerForward(java.util.concurrent.atomic.AtomicReference(raw))
            assertEquals("uncertain",queryLocalForward(h).status)
            assertEquals("",h.state.forwardSuccessId)
            assertEquals("server_unconfirmed",h.state.pendingForwards.single().failureStage)
        }
    }
    @Test fun matchedServerPartialFailureReportsFailureRatherThanSuccess() {
        val raw=serverProgress("partially_completed",success=1,pending=0).apply { addProperty("failedCount",1) }
        val h=queuedServerForward(java.util.concurrent.atomic.AtomicReference(raw))
        assertEquals("failed",queryLocalForward(h).status)
        assertEquals("",h.state.forwardSuccessId)
        assertEquals(h.state.pendingForwards.single().id,h.state.forwardFailureId)
    }
    @Test fun groupMenuDoesNotGrantAdministratorsAuthorityOverOtherAdmins() {
        val h=Harness(true);h.controller.open(h.gateway.peerResult)
        val sender="abcdef12123412341234123456789abc"
        val message=ChatMessage("member","你好",false,1,seq=15,serialized="""{"sendID":"$sender","contentType":101}""")
        h.gateway.member=ChatGroupMember(sender,"admin",true,"公开群昵称")
        var role="admin"
        h.controller.attachBusiness(object:ChatBusiness {
            override val baseUrl="https://service.invalid/api/v1"
            override fun request(method:String,path:String,body:JsonObject?,query:Map<String,String>):JsonElement=when {
                path.startsWith("/im/groups/by-im/") -> JsonParser.parseString("""{"businessGroupId":"123456","role":"$role"}""")
                else -> JsonParser.parseString("""{"items":[]}""")
            }
        })
        fun menu():ChatMessageMenu {
            val done=CountDownLatch(1);var result:Result<ChatMessageMenu>?=null
            h.controller.loadMessageMenu(message) { result=it;done.countDown() }
            assertTrue(done.await(5,TimeUnit.SECONDS));return result!!.getOrThrow()
        }
        val admin=menu()
        assertFalse(admin.canManage);assertFalse(admin.canRecall);assertTrue(admin.muted);assertTrue(admin.senderInGroup)
        assertEquals("公开群昵称",admin.publicName)
        role="owner"
        assertTrue(menu().canManage);assertTrue(menu().canRecall)
        h.gateway.member=ChatGroupMember(sender,"owner",false)
        assertFalse(menu().canManage)
    }
    @Test fun memberPurgeUsesBusinessEndpointAndKeepsRejoinedMessagesVisible() {
        val h=Harness(true);h.controller.open(h.gateway.peerResult)
        val sender="abcdef12123412341234123456789abc"
        val boundary=java.time.Instant.parse("2026-11-13T00:00:00Z").toEpochMilli()
        val old=ChatMessage("old","old",false,boundary-1,seq=12,serialized="""{"sendID":"$sender","contentType":101}""")
        val new=old.copy(id="new",time=boundary+1,seq=13)
        h.gateway.events.messages(listOf(h.groupTarget to old,h.groupTarget to new))
        assertEquals(2,h.state.messages.size)
        var purgeBody:JsonObject?=null
        h.controller.attachBusiness(object:ChatBusiness {
            override val baseUrl="https://service.invalid/api/v1"
            override fun request(method:String,path:String,body:JsonObject?,query:Map<String,String>):JsonElement=when {
                path.startsWith("/im/groups/by-im/") -> JsonParser.parseString("""{"businessGroupId":"123456","role":"owner"}""")
                path=="/group-members/purge-messages" -> {
                    purgeBody=body
                    JsonParser.parseString("""{"userId":"abcdef12-1234-1234-1234-123456789abc","purgedAt":"2026-11-13T00:00:00Z"}""")
                }
                else -> JsonParser.parseString("""{"items":[]}""")
            }
        })
        val done=CountDownLatch(1);var result:Result<Unit>?=null
        h.controller.performAction(old,ChatAction.PURGE) { result=it;done.countDown() }
        assertTrue(done.await(5,TimeUnit.SECONDS));assertTrue(result!!.isSuccess)
        assertEquals("123456",purgeBody!!.get("groupId").asString)
        assertEquals("abcdef12-1234-1234-1234-123456789abc",purgeBody!!.get("memberUserId").asString)
        assertEquals(listOf("new"),h.state.messages.map { it.id })
        assertEquals(0,h.gateway.clearCount)
    }
    @Test fun customStickerLoadsBusinessPagesAndDeletesOnlySelectedSticker() {
        val h=Harness()
        var requestedPage="";var deleted:JsonObject?=null
        h.controller.attachBusiness(object:ChatBusiness {
            override val baseUrl="https://service.invalid/api/v1"
            override fun request(method:String,path:String,body:JsonObject?,query:Map<String,String>):JsonElement {
                if(path=="/stickers/delete") { deleted=body;return JsonObject() }
                assertEquals("/stickers",path);assertEquals("100",query["size"]);requestedPage=query["page"].orEmpty()
                return JsonParser.parseString("""[{"id":"sticker-id","url":"https://cdn.invalid/animated.gif"}]""")
            }
        })
        val loaded=CountDownLatch(1);var page:ChatPickerPage?=null
        h.controller.loadStickers(2) { page=it.getOrThrow();loaded.countDown() }
        assertTrue(loaded.await(5,TimeUnit.SECONDS));assertEquals("2",requestedPage)
        assertTrue(page!!.end);assertEquals("https://cdn.invalid/animated.gif",page!!.items.single().content)
        val removed=CountDownLatch(1)
        h.controller.deleteSticker("sticker-id") { assertTrue(it.isSuccess);removed.countDown() }
        assertTrue(removed.await(5,TimeUnit.SECONDS))
        assertEquals(listOf("sticker-id"),deleted!!.getAsJsonArray("stickerIds").map { it.asString })
    }
    @Test fun customStickerSendsAnImageThroughDurableOutboxAndWaitsForSdkAcceptance() {
        val h=Harness();h.controller.open(conversation)
        var result:Result<ChatMessage>?=null
        h.controller.sendFavorite("image","https://cdn.invalid/animated.gif") { result=it }
        assertNull(result);assertEquals("https://cdn.invalid/animated.gif",h.gateway.remoteImageUrl)
        assertEquals(OutboxState.SENDING,h.state.outbox.single().state)
        h.gateway.sendDone(Result.success(h.gateway.created.copy(status=2,seq=12)))
        assertTrue(result!!.isSuccess);assertEquals(1,h.gateway.sendCount)
    }
    @Test fun imageAppearsAndIsDurableWhileUploadIsBlockedAndLateAccountWorkIsIgnored() {
        val h=Harness();h.controller.open(conversation)
        val local=LocalMedia(File(h.root,"draft.png").apply { writeBytes(byteArrayOf(1,2)) },"image.png","image/png",MediaKind.IMAGE,width=80,height=60)
        val started=CountDownLatch(1);val release=CountDownLatch(1)
        h.controller.attachBusiness(object:ChatBusiness {
            override val baseUrl="https://service.invalid/api/v1"
            override fun request(method:String,path:String,body:JsonObject?,query:Map<String,String>)=JsonParser.parseString("""{"canChat":true}""")
            override fun uploadMedia(media:LocalMedia):UploadedMedia { started.countDown();check(release.await(5,TimeUnit.SECONDS));return UploadedMedia(media,"https://cdn.invalid/upload.png") }
        })
        var accepted=false
        assertTrue(h.controller.sendMedia(local) { accepted=it })
        assertTrue(accepted);assertTrue(started.await(5,TimeUnit.SECONDS))
        assertEquals(1,h.state.messages.size);assertEquals(MediaUploadState.UPLOADING,h.state.mediaUploads.single().state)
        assertTrue(File(h.directory,"media-uploads.json").isFile)
        assertEquals(0,h.gateway.sendCount);assertTrue(h.state.outbox.isEmpty())
        h.deferCallbacks=true;h.controller.logout();release.countDown()
        h.deferred.poll(5,TimeUnit.SECONDS)?.invoke() ?: error("Expected late upload callback")
        assertTrue(h.state.messages.isEmpty());assertTrue(h.state.mediaUploads.isEmpty());assertEquals(0,h.gateway.sendCount)
        val restored=PendingMediaUploads(File(h.directory,"media-uploads.json"),AccountStorage.key("https://service.invalid/api/v1","business","im"))
        assertEquals(MediaUploadState.FAILED,restored.all().single().state)
    }
    @Test fun mediaDraftIsAcknowledgedOnlyAfterUploadAndDurableOutboxWrite() {
        val h=Harness();h.controller.open(conversation)
        val local=LocalMedia(File(h.root,"draft.m4a").apply { writeBytes(byteArrayOf(1,2,3)) },"语音.m4a","audio/mp4",MediaKind.VOICE,duration=2)
        val uploading=CountDownLatch(1);val releaseUpload=CountDownLatch(1);val queued=CountDownLatch(1)
        h.controller.attachBusiness(object:ChatBusiness {
            override val baseUrl="https://service.invalid/api/v1"
            override fun request(method:String,path:String,body:JsonObject?,query:Map<String,String>)=JsonParser.parseString("""{"canChat":true}""")
            override fun uploadMedia(media:LocalMedia):UploadedMedia {
                uploading.countDown();check(releaseUpload.await(5,TimeUnit.SECONDS))
                return UploadedMedia(media,"https://cdn.invalid/voice.m4a")
            }
        })
        val callbacks=java.util.concurrent.CopyOnWriteArrayList<Boolean>()
        assertTrue(h.controller.sendMedia(local) { saved ->
            callbacks+=saved
            if(saved)check(File(h.directory,"app-outbox.json").readText().contains("sdk-id"))
            queued.countDown()
        })
        assertTrue(uploading.await(5,TimeUnit.SECONDS));assertTrue(callbacks.isEmpty())
        assertTrue(h.state.outbox.isEmpty());assertEquals(0,h.gateway.sendCount)
        releaseUpload.countDown();assertTrue(queued.await(5,TimeUnit.SECONDS))
        assertEquals(listOf(true),callbacks)
        assertEquals("sdk-id",h.state.outbox.single().id)
        assertTrue(local.file.exists())
    }
    @Test fun failedUploadKeepsVoiceDraftAndReturnsFalseWithoutSending() {
        val h=Harness();h.controller.open(conversation)
        val local=LocalMedia(File(h.root,"draft.m4a").apply { writeBytes(byteArrayOf(1)) },"语音.m4a","audio/mp4",MediaKind.VOICE)
        h.controller.attachBusiness(object:ChatBusiness {
            override val baseUrl="https://service.invalid/api/v1"
            override fun request(method:String,path:String,body:JsonObject?,query:Map<String,String>)=JsonParser.parseString("""{"canChat":true}""")
            override fun uploadMedia(media:LocalMedia):UploadedMedia=error("fixture upload failed")
        })
        val queued=CountDownLatch(1);val callbacks=java.util.concurrent.CopyOnWriteArrayList<Boolean>()
        assertTrue(h.controller.sendMedia(local) { callbacks+=it;queued.countDown() })
        assertTrue(queued.await(5,TimeUnit.SECONDS));assertEquals(listOf(false),callbacks)
        assertTrue(local.file.exists());assertTrue(h.state.outbox.isEmpty());assertEquals(0,h.gateway.sendCount)
        assertFalse(h.state.uploading)
    }
    @Test fun imageQueueAcknowledgesDurableLocalTaskBeforeUploadAndRetainsItIfOutboxWriteFails() {
        val h=Harness();h.controller.open(conversation)
        val local=LocalMedia(File(h.root,"draft.jpg").apply { writeBytes(byteArrayOf(1)) },"图片.jpg","image/jpeg",MediaKind.IMAGE,width=2,height=2)
        val stored=File(h.directory,"app-outbox.json").apply { mkdirs() }
        File(stored,"preserved").writeText("do not delete")
        h.controller.attachBusiness(object:ChatBusiness {
            override val baseUrl="https://service.invalid/api/v1"
            override fun request(method:String,path:String,body:JsonObject?,query:Map<String,String>)=JsonParser.parseString("""{"canChat":true}""")
            override fun uploadMedia(media:LocalMedia)=UploadedMedia(media,"https://cdn.invalid/image.jpg")
        })
        val queued=CountDownLatch(1);val callbacks=java.util.concurrent.CopyOnWriteArrayList<Boolean>()
        assertTrue(h.controller.sendMedia(local) { callbacks+=it;queued.countDown() })
        assertTrue(queued.await(5,TimeUnit.SECONDS));assertEquals(listOf(true),callbacks)
        h.awaitState { it.mediaUploads.singleOrNull()?.state==MediaUploadState.FAILED }
        assertTrue(local.file.exists());assertTrue(h.state.outbox.isEmpty());assertEquals(0,h.gateway.sendCount)
        assertEquals("do not delete",File(stored,"preserved").readText())
    }
    @Test fun mediaRejectionCompletesDraftCallbackOnceWithoutStartingUpload() {
        val h=Harness()
        val callbacks=mutableListOf<Boolean>()
        assertFalse(h.controller.sendMedia(LocalMedia(File(h.root,"draft"),"draft","audio/mp4",MediaKind.VOICE)) { callbacks+=it })
        assertEquals(listOf(false),callbacks);assertEquals(0,h.gateway.sendCount)
    }
}
