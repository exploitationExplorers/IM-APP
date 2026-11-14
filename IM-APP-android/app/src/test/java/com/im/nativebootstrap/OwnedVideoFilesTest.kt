package com.im.nativebootstrap

import com.im.nativebootstrap.media.OwnedVideoFiles
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class OwnedVideoFilesTest {
    @get:Rule val temporary=TemporaryFolder()
    @Test fun currentAccountDirectoryIsRequiredAndMessagePathsCannotCrossOwners() {
        val root=temporary.newFolder("native-chat")
        val owner=File(root,"a".repeat(64)+"/upload-images").apply { mkdirs() }
        val other=File(root,"b".repeat(64)+"/upload-images").apply { mkdirs() }
        val name="upload-00000000-0000-0000-0000-000000000000.video"
        val local=File(owner,name).apply { writeBytes(byteArrayOf(1,2,3)) }
        val foreign=File(other,name).apply { writeBytes(byteArrayOf(1,2,3)) }
        assertEquals(local.canonicalFile,OwnedVideoFiles.verified(local,owner,root))
        assertNull(OwnedVideoFiles.verified(foreign,owner,root))
        assertNull(OwnedVideoFiles.verified(local,null,root))
        assertNull(OwnedVideoFiles.verified(File(owner,"../"+name),owner,root))
        assertNull(OwnedVideoFiles.verified(File(owner,"untrusted.mp4").apply { writeBytes(byteArrayOf(1)) },owner,root))
    }
}
