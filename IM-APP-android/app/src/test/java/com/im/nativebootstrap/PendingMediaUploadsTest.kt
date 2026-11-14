package com.im.nativebootstrap

import com.im.nativebootstrap.chat.*
import com.im.nativebootstrap.media.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import com.google.gson.JsonParser

class PendingMediaUploadsTest {
    @get:Rule val temporary=TemporaryFolder()
    private val target=ChatTarget("si_peer",1,"peer")
    @Test fun localImageAndPreparedMessageSurviveRestartWithoutCreatingAnotherId() {
        val root=temporary.newFolder();val source=File(root,"draft.png").apply { writeBytes(byteArrayOf(1,2,3)) }
        val file=File(root,"media-uploads.json")
        val store=PendingMediaUploads(file,"account-a")
        val entry=store.put(target,LocalMedia(source,"image.png","image/png",MediaKind.IMAGE,width=120,height=80))
        val message=ChatMessage("same-sdk-id","[图片]",true,entry.time,1,0,"""{"clientMsgID":"same-sdk-id","contentType":102}""")
        store.update(entry.id) { it.copy(remoteUrl="https://cdn.invalid/upload.png",prepared=message) }
        source.delete()
        val restored=PendingMediaUploads(file,"account-a").all().single()
        assertEquals(MediaUploadState.FAILED,restored.state)
        assertEquals(message,restored.prepared)
        assertEquals("https://cdn.invalid/upload.png",restored.remoteUrl)
        assertArrayEquals(byteArrayOf(1,2,3),restored.media().file.readBytes())
        assertEquals(1,restored.placeholder().status);assertEquals(0L,restored.placeholder().seq)
        assertThrows(IllegalStateException::class.java) { PendingMediaUploads(file,"account-b") }
        assertTrue(file.isFile)
    }
    @Test fun ownedOutgoingIsMovedOnceAndDiscardRemovesOnlyItsTaskFile() {
        val root=temporary.newFolder();val outgoing=File(root,"outgoing").apply { mkdirs() }
        val account=File(root,"native-chat/account").apply { mkdirs() }
        val source=File(outgoing,"draft.png").apply { writeBytes(byteArrayOf(1,2)) }
        val other=File(outgoing,"other.png").apply { writeBytes(byteArrayOf(3)) }
        val store=PendingMediaUploads(File(account,"media-uploads.json"),"account")
        val entry=store.put(target,LocalMedia(source,"image.png","image/png",MediaKind.IMAGE,width=1,height=1))
        assertFalse(source.exists());assertTrue(entry.media().file.isFile)
        store.remove(entry.id)
        assertFalse(entry.media().file.exists());assertTrue(other.exists());assertTrue(store.all().isEmpty())
    }
    @Test fun videoSourceSurvivesRestartBeforeMetadataIsReadyAndRemainsPlayableAfterHandoff() {
        val root=temporary.newFolder();val source=File(root,"recorded.mp4").apply { writeBytes(byteArrayOf(8,6,4,2)) }
        val file=File(root,"media-uploads.json")
        val uploads=PendingMediaUploads(file,"owner")
        val entry=uploads.put(target,LocalMedia(source,"recorded.mp4","video/mp4",MediaKind.VIDEO))
        val restored=PendingMediaUploads(file,"owner")
        val raw=restored.all().single()
        assertEquals(MediaKind.VIDEO,raw.media().kind)
        assertEquals(0,raw.width);assertEquals(0L,raw.duration)
        assertEquals(MediaUploadState.FAILED,raw.state)
        assertEquals(104,JsonParser.parseString(raw.placeholder().serialized).asJsonObject["contentType"].asInt)
        assertArrayEquals(source.readBytes(),raw.media().file.readBytes())
        val cover=File(raw.media().file.parentFile,entry.id+".cover.jpg").apply { writeBytes(byteArrayOf(1,3,5)) }
        val prepared=restored.update(raw.id) { it.copy(width=360,height=640,duration=9,snapshotPath=cover.absolutePath) }!!
        val videos=SentLocalVideos(File(root,"sent-videos.json"),"owner")
        videos.put("sdk-video-id",prepared.media())
        restored.remove(raw.id,keepFiles=true)
        prepared.media().file.setLastModified(System.currentTimeMillis()-8L*24*60*60*1000)
        val recoveredVideos=SentLocalVideos(File(root,"sent-videos.json"),"owner")
        assertTrue(PendingMediaUploads(file,"owner",recoveredVideos.retainedPaths()).all().isEmpty())
        val playable=recoveredVideos.all().getValue("sdk-video-id")
        assertTrue(playable.file.isFile);assertTrue(playable.snapshot!!.isFile)
        assertEquals(9L,playable.duration);assertEquals(360,playable.width)
        assertArrayEquals(byteArrayOf(8,6,4,2),playable.file.readBytes())
        assertThrows(IllegalStateException::class.java) { SentLocalVideos(File(root,"sent-videos.json"),"other-owner") }
    }
    @Test fun oldImageQueueWithoutVideoFieldsRestoresAndVideoSizeLimitRejectsBeforePlaceholder() {
        val root=temporary.newFolder();val file=File(root,"media-uploads.json")
        val source=File(root,"old.jpg").apply { writeBytes(byteArrayOf(1)) }
        PendingMediaUploads(file,"owner").put(target,LocalMedia(source,"old.jpg","image/jpeg",MediaKind.IMAGE,width=10,height=20))
        val old=JsonParser.parseString(file.readText()).asJsonObject
        old.getAsJsonArray("entries").forEach { it.asJsonObject.remove("kind");it.asJsonObject.remove("duration");it.asJsonObject.remove("snapshotPath") }
        file.writeText(old.toString())
        val restored=PendingMediaUploads(file,"owner")
        assertEquals(MediaKind.IMAGE,restored.all().single().kind)
        val oversized=File(root,"too-big.mp4")
        java.io.RandomAccessFile(oversized,"rw").use { it.setLength(256L*1024*1024+1) }
        assertThrows(IllegalArgumentException::class.java) { restored.put(target,LocalMedia(oversized,"large.mp4","video/mp4",MediaKind.VIDEO)) }
        assertEquals(1,restored.all().size)
    }
    @Test fun forwardQueueKeepsIdempotencyAndAttemptedSdkIdsAcrossRestart() {
        val file=File(temporary.newFolder(),"forwards.json")
        val queue=PendingForwards(file,"owner")
        val source=ChatMessage("source","hello",true,10,2,10,"""{"contentType":101,"textElem":{"content":"hello"}}""")
        val job=queue.put("si_source",listOf(source),ChatForwardSelection(listOf(ChatForwardTarget("target","Peer","contact",businessUserId="peer"))))
        queue.update(job.id) { it.copy(status="processing",plan=listOf(PreparedForward(target,source.copy(id="fixed-id"),attempted=true))) }
        val recovered=PendingForwards(file,"owner").all().single()
        assertEquals(job.idempotencyKey,recovered.idempotencyKey)
        assertEquals("failed",recovered.status)
        assertEquals("fixed-id",recovered.plan.single().message.id)
        assertTrue(recovered.plan.single().attempted)
        assertFalse(recovered.plan.single().accepted)
    }
}
