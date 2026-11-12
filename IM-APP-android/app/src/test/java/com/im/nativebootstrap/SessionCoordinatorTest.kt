package com.im.nativebootstrap

import com.im.nativebootstrap.core.*
import org.junit.Assert.*
import org.junit.Test

class SessionCoordinatorTest {
    @Test fun accountSwitchAndLogoutRejectOldTickets() {
        val core = SessionCoordinator()
        val old = core.bind(AccountIdentity("business-a", "im-a"))
        val next = core.bind(AccountIdentity("business-b", "im-b"))
        assertFalse(core.storeReadable(old))
        assertTrue(core.accepts(next))
        core.logout()
        assertFalse(core.storeReadable(next))
        assertEquals(StoreStatus.CLOSED, core.snapshot().store)
    }
    @Test fun retrySameAccountInvalidatesPriorGeneration() {
        val core = SessionCoordinator()
        val owner = AccountIdentity("business", "im")
        val old = core.bind(owner)
        val current = core.bind(owner)
        assertFalse(core.accepts(old))
        assertTrue(core.accepts(current))
    }
    @Test fun failuresNeverCompleteOrEraseReadableStore() {
        for (failure in listOf(SyncStatus.FAILED, SyncStatus.TIMED_OUT, SyncStatus.CANCELLED)) {
            val core = SessionCoordinator()
            val ticket = core.bind(AccountIdentity("business", "im"))
            core.storeReadable(ticket)
            val attempt = core.beginSync(ticket)!!
            assertTrue(core.failSync(attempt, failure, "synthetic-error"))
            assertEquals(failure, core.snapshot().sync)
            assertEquals(StoreStatus.READABLE, core.snapshot().store)
            assertFalse(core.completeSync(attempt))
        }
    }
    @Test fun previousSyncAttemptCannotCompleteLaterRetry() {
        val core = SessionCoordinator()
        val ticket = core.bind(AccountIdentity("business", "im"))
        core.storeReadable(ticket)
        val old = core.beginSync(ticket)!!
        val next = core.beginSync(ticket)!!
        assertFalse(core.completeSync(old))
        assertTrue(core.completeSync(next))
        assertEquals(SyncStatus.COMPLETED, core.snapshot().sync)
    }
    @Test fun reopeningOrFailedStoreInvalidatesPriorSync() {
        for (failStore in listOf(true, false)) {
            val core = SessionCoordinator()
            val ticket = core.bind(AccountIdentity("business", "im"))
            core.storeReadable(ticket)
            val old = core.beginSync(ticket)!!
            if (failStore) core.storeFailed(ticket, "synthetic-store-error") else core.storeOpening(ticket)
            assertEquals(SyncStatus.CANCELLED, core.snapshot().sync)
            core.storeReadable(ticket)
            assertFalse(core.completeSync(old))
            val replacement = core.beginSync(ticket)!!
            assertTrue(core.completeSync(replacement))
        }
    }
    @Test fun cannotCompleteBeforeStoreReadableOrAfterSwitch() {
        val core = SessionCoordinator()
        val ticket = core.bind(AccountIdentity("business", "im"))
        val attempt = core.beginSync(ticket)!!
        assertFalse(core.completeSync(attempt))
        core.bind(AccountIdentity("other-business", "other-im"))
        assertFalse(core.completeSync(attempt))
    }
}
