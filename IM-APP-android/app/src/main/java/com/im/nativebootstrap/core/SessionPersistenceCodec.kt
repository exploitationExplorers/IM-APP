package com.im.nativebootstrap.core

import com.google.gson.JsonParser
import com.im.nativebootstrap.business.*
import com.im.nativebootstrap.data.*

class StoredBusinessSession(val baseURL:String,val tokens:TokenPair,val profile:BusinessProfile,val expiresAt:Long)
object SessionPersistenceCodec {
    private fun profileValue(p:BusinessProfile)=obj("id" to p.businessUserId,"nickname" to p.nickname,"publicId" to p.publicId,"phoneMasked" to p.phoneMasked,"avatar" to p.avatar,"bio" to p.bio,"countryCode" to p.countryCode,"hasPassword" to p.hasPassword)
    fun withProfile(raw:String,profile:BusinessProfile):String {
        val existing=decode(raw)
        require(existing.profile.businessUserId==profile.businessUserId)
        return JsonParser.parseString(raw).asJsonObject.apply{add("profile",profileValue(profile))}.toString()
    }
    fun encode(baseURL:String,tokens:TokenPair,p:BusinessProfile,now:Long=System.currentTimeMillis()):String {
        NativeAPI(baseURL)
        require(tokens.expiresIn>0 && tokens.expiresIn<(Long.MAX_VALUE-now)/1000L)
        return obj("schema" to 1,"baseURL" to baseURL,"expiresAt" to (now+tokens.expiresIn*1000L),"accessToken" to tokens.accessToken,"refreshToken" to tokens.refreshToken,
            "profile" to profileValue(p)).toString()
    }
    fun decode(raw:String,now:Long=System.currentTimeMillis()):StoredBusinessSession {
        val value=JsonParser.parseString(raw).asJsonObject
        require(value.get("schema")?.asBigDecimal?.intValueExact()==1)
        val base=value.text("baseURL");NativeAPI(base)
        val expiry=value.get("expiresAt")?.asBigDecimal?.longValueExact()?:0L
        require(expiry>0)
        val profile=value.child("profile")
        val id=profile.identifier();val access=value.text("accessToken");val refresh=value.text("refreshToken")
        require(id.isNotBlank()&&access.isNotBlank()&&refresh.isNotBlank())
        val user=BusinessProfile(id,profile.text("nickname"),profile.text("publicId"),profile.text("phoneMasked"),profile.text("avatar"),profile.text("bio"),profile.text("countryCode").ifBlank{"+86"},profile.flag("hasPassword"))
        return StoredBusinessSession(base,TokenPair(access,refresh,(expiry-now)/1000L),user,expiry)
    }
}
