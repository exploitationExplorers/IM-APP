package com.im.nativebootstrap.core

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.io.FileNotFoundException
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** 仅保存业务会话 JSON，不保存密码；调用方在 IO 队列解析和校验账号/环境。 */
class SecureSessionStore(context: Context, namespace: String = "business_session") {
    private val file: AtomicFile
    private val alias: String
    init {
        require(namespace.matches(Regex("[a-z_]{1,48}")))
        file = AtomicFile(File(context.noBackupFilesDir, "$namespace.enc"))
        alias = "${context.packageName}.$namespace.v1"
    }

    fun save(json: String) = synchronized(lock) {
        val plain = json.toByteArray(Charsets.UTF_8)
        require(plain.isNotEmpty() && plain.size <= MAX_BYTES) { "登录信息格式无效" }
        try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, key(create = true))
            cipher.updateAAD(alias.toByteArray(Charsets.UTF_8))
            val ciphertext = cipher.doFinal(plain)
            val bytes = ByteArrayOutputStream().also { buffer ->
                DataOutputStream(buffer).use { out ->
                    out.writeInt(VERSION)
                    out.writeInt(cipher.iv.size)
                    out.write(cipher.iv)
                    out.write(ciphertext)
                }
            }.toByteArray()
            val stream = file.startWrite()
            try {
                stream.write(bytes)
                stream.fd.sync()
                file.finishWrite(stream)
            } catch (error: Exception) {
                file.failWrite(stream)
                throw error
            }
        } catch (_: Exception) {
            throw IllegalStateException("无法安全保存登录信息，请检查设备存储。")
        } finally {
            plain.fill(0)
        }
    }

    /** 损坏/密钥不可用时保留原件并报错，不能把无法解密当成一次正常退出。 */
    fun load(): String? = synchronized(lock) {
        val bytes = try {
            file.openRead().use { input ->
                val content = input.readBytesBounded(MAX_BYTES + 128)
                check(content.isNotEmpty())
                content
            }
        } catch (_: FileNotFoundException) {
            return@synchronized null
        } catch (_: Exception) {
            throw IllegalStateException("无法读取已保存的登录信息，请重新登录；聊天记录未删除。")
        }
        try {
            DataInputStream(ByteArrayInputStream(bytes)).use { input ->
                check(input.readInt() == VERSION)
                val ivSize = input.readInt()
                check(ivSize == 12)
                val iv = ByteArray(ivSize).also(input::readFully)
                val ciphertext = ByteArray(input.available()).also(input::readFully)
                check(ciphertext.size >= 16)
                val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                cipher.init(Cipher.DECRYPT_MODE, key(create = false), GCMParameterSpec(128, iv))
                cipher.updateAAD(alias.toByteArray(Charsets.UTF_8))
                val plain = cipher.doFinal(ciphertext)
                try { plain.toString(Charsets.UTF_8) } finally { plain.fill(0) }
            }
        } catch (_: Exception) {
            throw IllegalStateException("已保存的登录信息暂不可用，请重新登录；聊天记录未删除。")
        }
    }

    fun clear() = synchronized(lock) {
        file.delete()
        check(!file.baseFile.exists()) { "登录信息清除失败，请重试。" }
    }

    private fun key(create: Boolean): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        if (store.containsAlias(alias)) return store.getKey(alias, null) as SecretKey
        check(create) { "登录密钥不可用" }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)
                .build())
        }.generateKey()
    }

    private fun java.io.InputStream.readBytesBounded(limit: Int): ByteArray {
        val buffer = ByteArrayOutputStream()
        val chunk = ByteArray(4096)
        while (true) {
            val count = read(chunk)
            if (count < 0) return buffer.toByteArray()
            check(buffer.size() + count <= limit)
            buffer.write(chunk, 0, count)
        }
    }

    companion object {
        private val lock = Any()
        private const val VERSION = 1
        private const val MAX_BYTES = 256 * 1024
    }
}
