package com.im.nativebootstrap

import com.im.nativebootstrap.chat.ChatState
import com.im.nativebootstrap.chat.ConnectionState
import com.im.nativebootstrap.core.SyncStatus
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatRoomLoadingStateTest {
    @Test
    fun waitsWhileGroupHistoryOrSyncIsRunning() {
        assertTrue(chatRoomWaiting(ChatState(ready=true,loggedIn=true,connection=ConnectionState.CONNECTED,historySyncing=true)))
        assertTrue(chatRoomWaiting(ChatState(ready=true,loggedIn=true,connection=ConnectionState.CONNECTED,sync=SyncStatus.RUNNING)))
        assertTrue(chatRoomWaiting(ChatState(ready=false,loggedIn=true,connection=ConnectionState.CONNECTED)))
    }

    @Test
    fun showsRetryInsteadOfEndlessSkeletonOnErrorOrFinishedEmptyRoom() {
        assertFalse(chatRoomWaiting(ChatState(ready=true,loggedIn=true,connection=ConnectionState.CONNECTED,historyEnd=true,error="群历史边界刷新失败")))
        assertFalse(chatRoomWaiting(ChatState(ready=true,loggedIn=true,connection=ConnectionState.CONNECTED,historyEnd=true)))
    }
}
