package com.im.nativebootstrap.core

import com.im.nativebootstrap.data.BusinessProfile
import com.im.nativebootstrap.data.NativeAPI
import com.im.nativebootstrap.data.TokenPair
import java.util.concurrent.CancellationException

class BusinessLoginAttempt internal constructor(val generation: Long)
class BusinessLoginResult(val profile: BusinessProfile, val profileWarning: String? = null)

/** 业务凭据与 IM 身份分开管理；安全持久化由上层 Keystore 存储负责。 */
class BusinessSession {
    private val lock = Any()
    private var generation = 0L
    private var active: BusinessLoginAttempt? = null
    private var tokens: TokenPair? = null
    private var profile: BusinessProfile? = null

    fun beginLogin(): BusinessLoginAttempt = synchronized(lock) {
        generation += 1
        tokens = null
        profile = null
        BusinessLoginAttempt(generation).also { active = it }
    }
    fun accepts(attempt: BusinessLoginAttempt): Boolean = synchronized(lock) { active === attempt }
    internal fun complete(attempt: BusinessLoginAttempt, credentials: TokenPair, user: BusinessProfile): Boolean = synchronized(lock) {
        if (active !== attempt) return@synchronized false
        tokens = credentials
        profile = user
        true
    }
    /** 仅把当前账号访问凭据交给一次请求，不写入 UI 状态。 */
    internal fun <T> withAccessToken(userId:String, action:(String)->T):T? {
        val captured=synchronized(lock) { if(profile?.businessUserId==userId) tokens?.accessToken else null } ?: return null
        return action(captured)
    }
    fun currentProfile(): BusinessProfile? = synchronized(lock) { profile }
    internal fun replaceProfile(next:BusinessProfile):Boolean = synchronized(lock) {
        if(profile?.businessUserId!=next.businessUserId)return@synchronized false
        profile=next;true
    }
    internal fun currentTokens(): TokenPair? = synchronized(lock) { tokens }
    internal fun replaceTokens(userId:String,expectedAccessToken:String,next:TokenPair):Boolean = synchronized(lock) {
        if(profile?.businessUserId!=userId||tokens?.accessToken!=expectedAccessToken)return@synchronized false
        tokens=next;true
    }
    internal fun restore(credentials:TokenPair,user:BusinessProfile):BusinessLoginAttempt = synchronized(lock) {
        generation+=1
        tokens=credentials;profile=user
        BusinessLoginAttempt(generation).also {active=it}
    }
    internal fun hasCredentials(): Boolean = synchronized(lock) { tokens != null }
    fun logout() = synchronized(lock) {
        generation += 1
        active = null
        tokens = null
        profile = null
    }
}

/** 每次业务登录只调用 auth/login（或显式短信登录）与 me，不申请 IM Token。 */
class BusinessLoginFlow(private val session: BusinessSession) {
    fun login(attempt: BusinessLoginAttempt, api: NativeAPI, country: String, phone: String, secret: String, deviceId: String, password: Boolean, registerCode: String? = null): BusinessLoginResult? {
        if (!session.accepts(attempt)) return null
        val auth = if (registerCode != null) api.register(country, phone, registerCode, secret, deviceId) else if (password) api.passwordLogin(country, phone, secret, deviceId) else api.smsLogin(country, phone, secret, deviceId)
        if (!session.accepts(attempt)) return null
        var warning: String? = null
        val user = try {
            val loaded = api.profile(auth.tokens.accessToken)
            if (loaded.businessUserId == auth.businessUserId) loaded else {
                warning = "个人资料校验未通过，当前显示本次登录资料。"
                auth.profile
            }
        } catch (error: Exception) {
            if (error is CancellationException) throw error
            warning = "个人资料加载失败，当前显示本次登录资料。"
            auth.profile
        }
        return if (session.complete(attempt, auth.tokens, user)) BusinessLoginResult(user, warning) else null
    }
}
