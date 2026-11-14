package com.im.nativebootstrap

import com.im.nativebootstrap.media.MediaCacheIdentity
import com.im.nativebootstrap.media.MediaLocalCopies
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class MediaLocalCopiesTest {
    @get:Rule val temporary=TemporaryFolder()
    private fun hash(value:String)=MediaCacheIdentity.digest(value)
    @Test fun localAliasesSurviveRecreationAndStayWithinTheOwningAccount() {
        val root=temporary.newFolder();val source=temporary.newFile().apply { writeBytes(byteArrayOf(1,2,3)) }
        MediaLocalCopies(root).put(hash("account-a"),listOf(hash("list"),hash("original")),source)
        val reopened=MediaLocalCopies(root)
        val original=reopened.get(hash("account-a"),hash("original"))!!
        assertEquals(original,reopened.get(hash("account-a"),hash("list")))
        assertArrayEquals(source.readBytes(),original.readBytes())
        assertNull(reopened.get(hash("account-b"),hash("original")))
        reopened.discard(hash("account-a"),hash("original"))
        assertNull(reopened.get(hash("account-a"),hash("list")))
        assertFalse(original.exists())
        reopened.put(hash("account-a"),listOf(hash("list")),source)
        assertTrue(reopened.clear()>0);assertNull(reopened.get(hash("account-a"),hash("original")))
    }
    @Test fun cancelledRegistrationAndMalformedPointerNeverExposeAFile() {
        val root=temporary.newFolder();val source=temporary.newFile().apply { writeText("sample") }
        val store=MediaLocalCopies(root)
        store.put(hash("scope"),listOf(hash("key")),source) { false }
        assertNull(store.get(hash("scope"),hash("key")))
        val directory=File(root,hash("scope")).apply { mkdirs() }
        File(directory,"key-${hash("key")}").writeText("../private/".padEnd(64,'x'))
        assertNull(store.get(hash("scope"),hash("key")))
        assertNull(store.get("../scope",hash("key")))
    }
}
