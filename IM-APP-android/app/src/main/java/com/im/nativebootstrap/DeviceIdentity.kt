package com.im.nativebootstrap

import android.content.Context
import java.util.UUID

/** 随机安装标识，不使用硬件 ID；保存在禁止备份的应用私有目录。 */
object DeviceIdentity {
    @Synchronized
    fun get(context: Context): String {
        val preferences = context.applicationContext.getSharedPreferences("native-device", Context.MODE_PRIVATE)
        return getOrCreate(
            read = { preferences.getString("device-id", null) },
            persist = { preferences.edit().putString("device-id", it).commit() },
        )
    }

    internal fun getOrCreate(read: () -> String?, persist: (String) -> Boolean, generate: () -> String = { "native-android-${UUID.randomUUID()}" }): String {
        read()?.takeIf { it.isNotBlank() }?.let { return it }
        val value = generate()
        check(value.isNotBlank() && persist(value)) { "设备标识保存失败，请检查存储空间后重试。" }
        return value
    }
}
