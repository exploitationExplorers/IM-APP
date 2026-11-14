package com.im.nativebootstrap

import com.google.gson.*
import com.im.nativebootstrap.business.*
import com.im.nativebootstrap.core.*
import com.im.nativebootstrap.data.*
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class BusinessParityTest {
    private val user=BusinessProfile("business-owner","用户","chat001","130****0000","https://media.invalid/a.png","签名")
    private val tokens=TokenPair("synthetic-access","synthetic-refresh",86400)
    private suspend fun awaitReady(controller:BusinessController) {withTimeout(5000){while(controller.state.value.loading)delay(10)}}

    @Test fun sessionRoundTripKeepsRealExpiryAndNoPassword() {
        val now=1_700_000_000_000L
        val encoded=SessionPersistenceCodec.encode("https://api.invalid",tokens,user,now)
        val stored=SessionPersistenceCodec.decode(encoded,now+60_000)
        assertEquals(now+86_400_000L,stored.expiresAt)
        assertEquals(86340L,stored.tokens.expiresIn)
        assertEquals(user.avatar,stored.profile.avatar)
        assertFalse(JsonParser.parseString(encoded).asJsonObject.has("password"))
        assertTrue(SessionPersistenceCodec.decode(encoded,now+90_000_000L).tokens.expiresIn<0)
        val updated=SessionPersistenceCodec.withProfile(encoded,BusinessProfile(user.businessUserId,"新昵称",avatar="https://media.invalid/new.png"))
        assertEquals(stored.expiresAt,SessionPersistenceCodec.decode(updated,now+60_000).expiresAt)
        assertEquals("新昵称",SessionPersistenceCodec.decode(updated,now+60_000).profile.nickname)
    }
    @Test fun malformedStoredIdentityCannotBeRestored() {
        val raw=SessionPersistenceCodec.encode("https://api.invalid",tokens,user,1000)
        for((key,value) in listOf("schema" to JsonPrimitive(2),"baseURL" to JsonPrimitive("http://api.invalid"),"accessToken" to JsonPrimitive(""),"expiresAt" to JsonPrimitive(1.5))) {
            val changed=JsonParser.parseString(raw).asJsonObject.apply{add(key,value)}
            assertThrows(Exception::class.java){SessionPersistenceCodec.decode(changed.toString(),1000)}
        }
    }
    @Test fun tokenRotationRejectsWrongOwnerAndLateCredentials() {
        val session=BusinessSession();session.restore(tokens,user)
        val rotated=TokenPair("next","next-refresh",3600)
        assertFalse(session.replaceTokens("other",tokens.accessToken,rotated))
        assertTrue(session.replaceTokens(user.businessUserId,tokens.accessToken,rotated))
        assertFalse(session.replaceTokens(user.businessUserId,tokens.accessToken,tokens))
        session.logout()
        assertFalse(session.replaceProfile(user))
        assertFalse(session.replaceTokens(user.businessUserId,rotated.accessToken,tokens))
    }
    @Test fun businessEnvelopePreservesArraysNullAndAuthStatus() {
        for((raw,expected) in listOf("[]" to true,"null" to false)) {
            val api=NativeAPI("https://api.invalid",HTTPTransport{APIResponse(200,"{\"code\":0,\"data\":$raw}")})
            val value=api.businessRequest("DELETE","/contacts/fixture")
            assertEquals(expected,value.isJsonArray)
            assertEquals(!expected,value.isJsonNull)
        }
        for(code in listOf(401,403)) {
            val api=NativeAPI("https://api.invalid",HTTPTransport{APIResponse(200,"{\"code\":$code,\"message\":\"认证拒绝\"}")})
            assertEquals(code,assertThrows(APIException::class.java){api.businessRequest("PATCH","/me")}.httpStatus)
        }
    }
    @Test fun businessQueriesAreEncodedAndWritesAreNotReplayed() {
        val calls=mutableListOf<APIRequest>()
        val api=NativeAPI("https://api.invalid",HTTPTransport{calls+=it;APIResponse(500,"unavailable")})
        assertThrows(APIException::class.java){api.businessRequest("PUT","/contact-tags/one/members","synthetic",obj("userIds" to listOf("first")),mapOf("keyword" to "甲 & 乙"))}
        assertEquals(1,calls.size)
        assertEquals("PUT",calls.single().method)
        assertFalse(calls.single().url.contains("甲"))
        assertTrue(calls.single().url.contains("%26"))
        assertEquals(listOf("first"),stringValues(JsonParser.parseString(calls.single().body).asJsonObject.get("userIds")))
    }
    @Test fun addingTagMembersMergesLatestServerMembership() = runBlocking {
        val requests=mutableListOf<Pair<String,JsonObject?>>()
        val scope=CoroutineScope(SupervisorJob()+Dispatchers.Unconfined)
        val controller=BusinessController(scope,{method,path,body,_->
            synchronized(requests){requests+=method to body}
            if(method=="GET")JsonParser.parseString("[{\"id\":\"existing-a\"},{\"id\":\"existing-b\"}]") else JsonNull.INSTANCE
        },{_,_,_,_->},{})
        controller.addTagMembers("tag",setOf("existing-b","new-c"));awaitReady(controller)
        val saved=requests.last{it.first=="PUT"}.second!!
        assertEquals(setOf("existing-a","existing-b","new-c"),stringValues(saved.get("userIds")).toSet())
        scope.cancel()
    }
    @Test fun jsonQrPayloadIsParsedBeforeTryingUriSyntax() = runBlocking {
        val requests=java.util.Collections.synchronizedList(mutableListOf<String>())
        val scope=CoroutineScope(SupervisorJob()+Dispatchers.Unconfined)
        val controller=BusinessController(scope,{method,path,body,_->
            requests+=path
            if(path=="/users/qrcode/resolve") {
                assertEquals("qr-token",body!!.text("token"))
                obj("user" to obj("id" to "user-fixture"),"relation" to "friend")
            } else JsonNull.INSTANCE
        },{_,_,_,_->},{})
        controller.resolveQr("{\"type\":\"user\",\"token\":\"qr-token\"}");awaitReady(controller)
        assertEquals("scan-result",controller.state.value.route.page)
        assertEquals(listOf("/users/qrcode/resolve"),requests.toList())
        scope.cancel()
    }
    @Test fun membersSearchHasAllPagesAndRemovingTagMembersKeepsOthers() = runBlocking {
        val scope=CoroutineScope(SupervisorJob()+Dispatchers.Unconfined)
        var saved:JsonObject?=null
        val controller=BusinessController(scope,{method,path,body,query->
            when {
                path=="/group-members"&&query["cursor"].isNullOrBlank()->JsonParser.parseString("{\"items\":[{\"id\":\"first\",\"role\":\"owner\"}],\"hasMore\":true,\"nextCursor\":\"next\"}")
                path=="/group-members"->JsonParser.parseString("{\"items\":[{\"id\":\"second\",\"role\":\"member\"}],\"hasMore\":false}")
                path.endsWith("/members")&&method=="GET"->JsonParser.parseString("[{\"id\":\"keep\"},{\"id\":\"remove\"},{\"id\":\"concurrent-new\"}]")
                method=="PUT"->{saved=body;JsonNull.INSTANCE}
                else->JsonNull.INSTANCE
            }
        },{_,_,_,_->},{})
        controller.open("members","group");awaitReady(controller)
        assertEquals(listOf("first","second"),controller.state.value.items.map{it.identifier()})
        controller.removeTagMembers("tag",setOf("remove"));awaitReady(controller)
        assertEquals(setOf("keep","concurrent-new"),stringValues(saved!!.get("userIds")).toSet())
        scope.cancel()
    }
    @Test fun switchingRouteDiscardsSlowPreviousPage() = runBlocking {
        val entered=CountDownLatch(1);val release=CountDownLatch(1)
        val scope=CoroutineScope(SupervisorJob()+Dispatchers.Unconfined)
        val controller=BusinessController(scope,{_,path,_,_->
            if(path=="/contacts"){entered.countDown();check(release.await(4,TimeUnit.SECONDS));JsonParser.parseString("[{\"id\":\"stale-contact\"}]")}
            else JsonParser.parseString("[{\"id\":\"tag-current\"}]")
        },{_,_,_,_->},{})
        try {
            controller.refresh();assertTrue(entered.await(3,TimeUnit.SECONDS))
            controller.open("tags");awaitReady(controller);release.countDown();delay(100)
            assertEquals("tags",controller.state.value.route.page)
            assertEquals("tag-current",controller.state.value.items.single().identifier())
        }finally {release.countDown();scope.cancel()}
    }
    @Test fun nicknamePatchKeepsAvatarContractAndGroupCreateKeepsMemberIds() = runBlocking {
        val writes=mutableListOf<Triple<String,String,JsonObject?>>()
        val scope=CoroutineScope(SupervisorJob()+Dispatchers.Unconfined)
        val controller=BusinessController(scope,{method,path,body,_->
            if(method!="GET")synchronized(writes){writes+=Triple(method,path,body?.deepCopy())}
            JsonNull.INSTANCE
        },{_,_,_,_->},{})
        controller.saveProfile("新昵称","签名");awaitReady(controller)
        assertEquals("PATCH",writes.single().first)
        assertEquals("",writes.single().third!!.text("avatarFileId"))
        controller.createGroup("测试群",setOf("business-a","business-b"));awaitReady(controller)
        val created=writes.single{it.first=="POST"&&it.second=="/groups"}
        assertEquals(setOf("business-a","business-b"),stringValues(created.third!!.get("memberIds")).toSet())
        scope.cancel()
    }
    @Test fun onlyMutedExistingGroupTargetsMayEnterReadonlyRoom() {
        for(reason in listOf("member_muted","group_muted")) {
            val target=obj("canChat" to false,"denyReason" to reason,"imGroupId" to "im-existing")
            assertTrue(canOpenBusinessChat(target,true))
            assertFalse(canOpenBusinessChat(target,false))
            target.remove("imGroupId");assertFalse(canOpenBusinessChat(target,true))
        }
        for(reason in listOf("group_inactive","not_member","","unrecognized"))assertFalse(canOpenBusinessChat(obj("canChat" to false,"denyReason" to reason,"imGroupId" to "im-existing"),true))
        assertTrue(canOpenBusinessChat(obj("canChat" to true),false))
    }
    @Test fun groupDetailLoadsBoundedPreviewAndPendingCountWithoutBlockingMainDetail() = runBlocking {
        val entered=CountDownLatch(1);val release=CountDownLatch(1)
        val scope=CoroutineScope(SupervisorJob()+Dispatchers.Unconfined)
        val controller=BusinessController(scope,{_,path,_,query->when(path){
            "/groups/detail"->obj("id" to "group","name" to "测试群","myRole" to "owner","memberCount" to 9000)
            "/group-members"->{assertEquals("4",query["limit"]);assertFalse(query.containsKey("cursor"));entered.countDown();check(release.await(4,TimeUnit.SECONDS));JsonParser.parseString("{\"items\":[{\"id\":\"preview\"}],\"hasMore\":true,\"nextCursor\":\"must-not-fetch\"}")}
            "/groups/group/join-requests"->JsonParser.parseString("[{\"id\":\"pending\",\"status\":\"pending\"},{\"id\":\"accepted\",\"status\":\"accepted\"}]")
            else->throw IllegalArgumentException("Unexpected request $path")
        }},{_,_,_,_->},{})
        try {
            controller.open("group","group");assertTrue(entered.await(3,TimeUnit.SECONDS));awaitReady(controller)
            assertEquals("测试群",controller.state.value.detail.text("name"))
            withTimeout(3000){while(!controller.state.value.detail.has("_pendingJoinCount"))delay(10)}
            release.countDown()
            withTimeout(4000){while(!controller.state.value.detail.has("_previewMembers")||!controller.state.value.detail.has("_pendingJoinCount"))delay(10)}
            assertEquals("preview",elements(controller.state.value.detail.get("_previewMembers")).single().identifier())
            assertEquals("1",controller.state.value.detail.text("_pendingJoinCount"))
        }finally{release.countDown();scope.cancel()}
    }
    @Test fun slowGroupPreviewCannotReplaceNewRouteAndDissolvedLookupIsExplicit() = runBlocking {
        val entered=CountDownLatch(1);val release=CountDownLatch(1)
        val scope=CoroutineScope(SupervisorJob()+Dispatchers.Unconfined)
        val controller=BusinessController(scope,{_,path,_,_->when(path){
            "/groups/detail"->obj("id" to "group","myRole" to "member")
            "/group-members"->{entered.countDown();check(release.await(4,TimeUnit.SECONDS));JsonParser.parseString("[{\"id\":\"old-preview\"}]")}
            "/groups/dead/dissolved"->obj("id" to "dead","status" to "dismissed")
            else->JsonArray()
        }},{_,_,_,_->},{})
        try {
            controller.open("group","group");assertTrue(entered.await(3,TimeUnit.SECONDS));controller.open("tags");awaitReady(controller)
            release.countDown();delay(100)
            assertEquals("tags",controller.state.value.route.page);assertFalse(controller.state.value.detail.has("_previewMembers"))
            controller.open("group","dead","dissolved");awaitReady(controller)
            assertTrue(controller.state.value.detail.flag("_dissolved"))
        }finally{release.countDown();scope.cancel()}
    }
    @Test fun returningToMassDraftTrimsStackAndGroupsRestoreOwnerTab() = runBlocking {
        val scope=CoroutineScope(SupervisorJob()+Dispatchers.Unconfined)
        val controller=BusinessController(scope,{_,_,_,_->JsonArray()},{_,_,_,_->},{})
        controller.open("mass-assistant");awaitReady(controller)
        controller.open("mass-select");awaitReady(controller)
        controller.open("mass-compose");awaitReady(controller)
        controller.open("mass-targets");awaitReady(controller)
        controller.returnTo("mass-compose");awaitReady(controller)
        assertEquals("mass-compose",controller.state.value.route.page)
        assertEquals(1,controller.state.value.stack.count{it.page=="mass-compose"})
        controller.returnTo("mass-assistant");awaitReady(controller)
        assertEquals(listOf("contacts","mass-assistant"),controller.state.value.stack.map{it.page})
        controller.open("groups");awaitReady(controller);assertEquals("owner",controller.state.value.keyword)
        controller.open("group-admin","group");awaitReady(controller);controller.back();awaitReady(controller)
        assertEquals("groups",controller.state.value.route.page);assertEquals("owner",controller.state.value.keyword)
        scope.cancel()
    }
}
