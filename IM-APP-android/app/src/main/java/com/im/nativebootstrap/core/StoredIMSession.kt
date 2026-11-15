package com.im.nativebootstrap.core

import com.google.gson.JsonParser
import com.im.nativebootstrap.business.*
import com.im.nativebootstrap.chat.AccountStorage
import com.im.nativebootstrap.chat.ChatEndpoints
import com.im.nativebootstrap.data.IMCredentials
import com.im.nativebootstrap.data.NativeAPI

/** 与业务会话分开加密保存；刷新业务 Token 不会丢失 SDK 的本机登录凭据。 */
object StoredIMSession {
    fun encode(base:String,owner:String,value:IMCredentials,now:Long=System.currentTimeMillis()):String {
        NativeAPI(base)
        require(owner.isNotBlank() && value.imUserId.isNotBlank() && value.token.isNotBlank() && value.platform==2)
        require(value.expireSec>0 && value.expireSec<(Long.MAX_VALUE-now)/1000)
        return obj("schema" to 1,"owner" to owner,"scope" to AccountStorage.key(base,owner,value.imUserId),
            "user" to value.imUserId,"token" to value.token,"expiresAt" to now+value.expireSec*1000,
            "api" to ChatEndpoints.normalize(base,value.apiAddr,false),"ws" to ChatEndpoints.normalize(base,value.wsAddr,true)).toString()
    }

    fun decode(raw:String,base:String,owner:String,now:Long=System.currentTimeMillis()):IMCredentials {
        NativeAPI(base)
        val value=JsonParser.parseString(raw).asJsonObject
        require(value.get("schema")?.asBigDecimal?.intValueExact()==1 && owner.isNotBlank() && value.text("owner")==owner)
        val user=value.text("user");val token=value.text("token")
        require(user.isNotBlank() && token.isNotBlank() && value.text("scope")==AccountStorage.key(base,owner,user))
        val expiry=value.get("expiresAt")?.asBigDecimal?.longValueExact()?:0
        require(expiry>0)
        return IMCredentials(user,token,2,(expiry-now)/1000,
            ChatEndpoints.normalize(base,value.text("api"),false),ChatEndpoints.normalize(base,value.text("ws"),true))
    }
}
