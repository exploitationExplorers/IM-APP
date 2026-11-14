package com.im.nativebootstrap.media

import java.io.File

/** 目录由当前账号控制器提供，视频路径从本地状态映射取得，绝不从消息 JSON 读取。 */
object OwnedVideoFiles {
    fun verified(file:File,ownerDirectory:File?,nativeRoot:File):File?=runCatching {
        val owner=ownerDirectory?.canonicalFile ?: return null
        val source=file.canonicalFile
        require(owner.name=="upload-images"&&owner.parentFile?.name?.matches(Regex("[0-9a-f]{64}"))==true&&owner.parentFile?.parentFile==nativeRoot.canonicalFile)
        require(source.parentFile==owner&&source.name.matches(Regex("upload-[0-9a-f-]{36}\\.video"))&&source.isFile&&source.length() in 1..256L*1024*1024)
        source
    }.getOrNull()
}
