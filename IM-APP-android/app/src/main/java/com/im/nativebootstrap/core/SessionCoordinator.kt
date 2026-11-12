package com.im.nativebootstrap.core

data class AccountIdentity(val businessUserId: String, val imUserId: String)
class SessionTicket internal constructor(val identity: AccountIdentity, val generation: Long)
class SyncAttempt internal constructor(val session: SessionTicket, val operation: Long)
enum class StoreStatus { CLOSED, OPENING, READABLE, FAILED }
enum class SyncStatus { IDLE, RUNNING, COMPLETED, FAILED, TIMED_OUT, CANCELLED }
data class SessionSnapshot(
    val ticket: SessionTicket? = null,
    val store: StoreStatus = StoreStatus.CLOSED,
    val sync: SyncStatus = SyncStatus.IDLE,
    val error: String? = null,
)

/** 全部会话字段在同一个锁内读取和更新，避免 owner 与 generation 撕裂。 */
class SessionCoordinator {
    private val lock = Any()
    private var generation = 0L
    private var operation = 0L
    private var activeSync: SyncAttempt? = null
    private var state = SessionSnapshot()

    fun bind(identity: AccountIdentity): SessionTicket = synchronized(lock) {
        require(identity.businessUserId.isNotBlank() && identity.imUserId.isNotBlank())
        generation += 1
        val ticket = SessionTicket(identity, generation)
        activeSync = null
        state = SessionSnapshot(ticket = ticket)
        ticket
    }

    fun logout() = synchronized(lock) {
        generation += 1
        activeSync = null
        state = SessionSnapshot()
    }

    fun snapshot(): SessionSnapshot = synchronized(lock) { state }
    fun accepts(ticket: SessionTicket): Boolean = synchronized(lock) { state.ticket == ticket }

    fun storeOpening(ticket: SessionTicket): Boolean = update(ticket) {
        copy(store = StoreStatus.OPENING, error = null)
    }
    fun storeReadable(ticket: SessionTicket): Boolean = update(ticket) {
        copy(store = StoreStatus.READABLE, error = null)
    }
    fun storeFailed(ticket: SessionTicket, reason: String): Boolean = update(ticket) {
        copy(store = StoreStatus.FAILED, error = reason)
    }

    fun beginSync(ticket: SessionTicket): SyncAttempt? = synchronized(lock) {
        if (state.ticket != ticket) return@synchronized null
        operation += 1
        val attempt = SyncAttempt(ticket, operation)
        activeSync = attempt
        state = state.copy(sync = SyncStatus.RUNNING, error = null)
        attempt
    }

    fun completeSync(attempt: SyncAttempt): Boolean = synchronized(lock) {
        if (!isActive(attempt) || state.store != StoreStatus.READABLE) return@synchronized false
        state = state.copy(sync = SyncStatus.COMPLETED, error = null)
        activeSync = null
        true
    }

    fun failSync(attempt: SyncAttempt, status: SyncStatus, reason: String): Boolean = synchronized(lock) {
        require(status in setOf(SyncStatus.FAILED, SyncStatus.TIMED_OUT, SyncStatus.CANCELLED))
        if (!isActive(attempt)) return@synchronized false
        // 网络失败不能抹掉本地可读状态，更不能触发删除数据库。
        state = state.copy(sync = status, error = reason)
        activeSync = null
        true
    }

    private fun isActive(attempt: SyncAttempt): Boolean =
        state.ticket == attempt.session && activeSync == attempt && state.sync == SyncStatus.RUNNING

    private fun update(ticket: SessionTicket, change: SessionSnapshot.() -> SessionSnapshot): Boolean = synchronized(lock) {
        if (state.ticket != ticket) return@synchronized false
        val next = state.change()
        if (next.store != StoreStatus.READABLE) {
            activeSync = null
            state = if (next.sync == SyncStatus.RUNNING) next.copy(sync = SyncStatus.CANCELLED) else next
        } else {
            state = next
        }
        true
    }
}
