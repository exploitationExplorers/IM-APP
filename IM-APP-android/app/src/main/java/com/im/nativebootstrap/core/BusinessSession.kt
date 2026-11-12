package com.im.nativebootstrap.core

import com.im.nativebootstrap.data.BusinessProfile
import com.im.nativebootstrap.data.NativeAPI
import com.im.nativebootstrap.data.TokenPair
import java.util.concurrent.CancellationException

class BusinessLoginAttempt internal constructor(val generation: Long)
class BusinessLoginResult(val profile: BusinessProfile, val profileWarning: String? = null)

/** 业务凭据只驻留本次进程内存，与尚未接入的 IM 会话完全分开。 */
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
    fun currentProfile(): BusinessProfile? = synchronized(lock) { profile }
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
    fun login(attempt: BusinessLoginAttempt, api: NativeAPI, country: String, phone: String, secret: String, deviceId: String, password: Boolean): BusinessLoginResult? {
        if (!session.accepts(attempt)) return null
        val auth = if (password) api.passwordLogin(country, phone, secret, deviceId) else api.smsLogin(country, phone, secret, deviceId)
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
