package com.im.nativebootstrap

import android.app.Activity
import android.app.Instrumentation
import android.os.Bundle
import android.content.Context
import com.im.nativebootstrap.core.SecureSessionStore
import java.io.File

/** 无账号、无网络，实际运行 AndroidKeyStore；测试只用独立 namespace。 */
class SecureSessionStoreInstrumentation : Instrumentation() {
    override fun onCreate(arguments: Bundle?) { super.onCreate(arguments); start() }
    override fun onStart() {
        val result = Bundle()
        try {
            verify(targetContext)
            result.putString("secureSession", "passed: keystore encryption, recreation, replace, tamper rejected and preserved, clear")
            finish(Activity.RESULT_OK, result)
        } catch (error: Exception) {
            result.putString("secureSession", "failed: " + error.javaClass.simpleName)
            finish(Activity.RESULT_CANCELED, result)
        }
    }
    companion object {
        fun verify(context: Context) {
        val store = SecureSessionStore(context, "instrumentation_session")
        try {
            store.clear()
            check(store.load() == null)
            val first = "{\"syntheticSession\":\"local-only-fixture-782915\"}"
            store.save(first)
            val disk = File(context.noBackupFilesDir, "instrumentation_session.enc")
            check(!disk.readBytes().toString(Charsets.UTF_8).contains("local-only-fixture-782915"))
            check(SecureSessionStore(context, "instrumentation_session").load() == first)
            store.save("{\"syntheticSession\":\"replacement\"}")
            check(store.load() == "{\"syntheticSession\":\"replacement\"}")
            val tampered = disk.readBytes()
            tampered[tampered.lastIndex] = (tampered.last().toInt() xor 1).toByte()
            disk.writeBytes(tampered)
            check(runCatching { store.load() }.isFailure)
            check(disk.exists())
            store.clear()
            check(store.load() == null)
        } finally { store.clear() }
        }
    }
}
