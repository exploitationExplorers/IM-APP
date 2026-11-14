package com.im.nativebootstrap.media

import android.content.Context
import android.graphics.Bitmap
import android.graphics.drawable.Animatable
import android.graphics.drawable.BitmapDrawable
import androidx.core.graphics.drawable.toBitmap
import coil.ImageLoader
import coil.decode.GifDecoder
import coil.decode.ImageDecoderDecoder
import coil.disk.DiskCache
import coil.memory.MemoryCache
import coil.request.ErrorResult
import coil.request.ImageRequest
import coil.request.SuccessResult
import coil.size.Scale
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import java.io.File
import java.util.concurrent.ConcurrentHashMap

data class MediaAccess(val scope: String, val base: String, val generation: Long, val clearing: Boolean = false)

/** 网络取消、同资源合并、磁盘日志及解码交给 Coil；业务管理身份与可见性。 */
@OptIn(coil.annotation.ExperimentalCoilApi::class)
internal class MediaImagePipeline(context: Context, client: okhttp3.OkHttpClient = MediaHttp.images,
                                  directory: File = File(context.cacheDir, "images-v2"), sharedDisk: DiskCache? = null,
                                  observeNetwork: Boolean = true) {
    val loader = ImageLoader.Builder(context.applicationContext)
        .okHttpClient(client)
        .memoryCache { MemoryCache.Builder(context).maxSizeBytes(24 * 1024 * 1024).build() }
        .diskCache { sharedDisk ?: DiskCache.Builder().directory(directory).maxSizeBytes(384L * 1024 * 1024).build() }
        .respectCacheHeaders(true)
        .networkObserverEnabled(observeNetwork)
        .eventListenerFactory { request -> object : coil.EventListener {
            private var fetchAt = 0L
            private var decodeAt = 0L
            private val token = request.diskCacheKey.orEmpty()
            override fun fetchStart(request: ImageRequest, fetcher: coil.fetch.Fetcher, options: coil.request.Options) { fetchAt = System.nanoTime() }
            override fun fetchEnd(request: ImageRequest, fetcher: coil.fetch.Fetcher, options: coil.request.Options, result: coil.fetch.FetchResult?) {
                MediaMetrics.record(token, "FETCH", (System.nanoTime() - fetchAt) / 1_000_000)
            }
            override fun decodeStart(request: ImageRequest, decoder: coil.decode.Decoder, options: coil.request.Options) { decodeAt = System.nanoTime() }
            override fun decodeEnd(request: ImageRequest, decoder: coil.decode.Decoder, options: coil.request.Options, result: coil.decode.DecodeResult?) {
                MediaMetrics.record(token, "DECODE", (System.nanoTime() - decodeAt) / 1_000_000)
            }
        } }
        .components { if (android.os.Build.VERSION.SDK_INT >= 28) add(ImageDecoderDecoder.Factory()) else add(GifDecoder.Factory()) }
        .build()
    private fun memoryKey(id: String, edge: Int) = "$id/$edge"
    private val work = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private data class Flight(val task: Deferred<MediaVisual>, var consumers: Int, var animationClaimed: Boolean = false)
    private val flights = mutableMapOf<String, Flight>()
    private val imageSlots = Semaphore(4)
    private val avatarSlots = Semaphore(1)
    fun peek(id: String, edge: Int): MediaVisual? = loader.memoryCache?.get(MemoryCache.Key(memoryKey(id, edge)))
        ?.let { MediaVisual(bitmap = it.bitmap) }
    fun alias(source:String,destination:String) {
        if(source==destination)return
        listOf(128,360,960,1920).forEach { edge ->
            loader.memoryCache?.get(MemoryCache.Key(memoryKey(source,edge)))?.let { loader.memoryCache?.set(MemoryCache.Key(memoryKey(destination,edge)),it) }
        }
        // 只有已有合规磁盘项才能建立别名；no-store 没有磁盘项，不写成持久副本。
        loader.diskCache?.openSnapshot(source)?.use { snapshot ->
            loader.diskCache?.openEditor(destination)?.let { editor ->
                try { snapshot.metadata.toFile().copyTo(editor.metadata.toFile(),overwrite=true);snapshot.data.toFile().copyTo(editor.data.toFile(),overwrite=true);editor.commit() }
                catch(error:Exception) { editor.abort();throw error }
            }
        }
    }
    suspend fun load(context: Context, url: String, id: String, edge: Int, local:File?=null,discardLocal:()->Unit={}): MediaVisual {
        val key = memoryKey(id, edge)
        val flight = synchronized(flights) {
            flights[key]?.also { it.consumers++ } ?: Flight(work.async(start = CoroutineStart.LAZY) {
                execute(context, url, id, edge,local,discardLocal)
            }, 1).also { flights[key] = it }
        }
        try {
            val result = flight.task.await()
            if(result.animation == null)return result
            // Coil 动画包装器不能通过 ConstantState 复制播放配置；每个视图独占一个实例。
            val claim = synchronized(flights) { if(flight.animationClaimed)false else { flight.animationClaimed=true;true } }
            return if(claim)result else execute(context, url, id, edge,local,discardLocal)
        } finally {
            synchronized(flights) {
                flight.consumers--
                if (flight.consumers == 0) { if (flights[key] === flight) flights.remove(key); flight.task.cancel() }
            }
        }
    }
    private suspend fun execute(context: Context, url: String, id: String, edge: Int,local:File?,discardLocal:()->Unit): MediaVisual {
        val queuedAt = System.nanoTime()
        suspend fun scheduled(): MediaVisual = imageSlots.withPermit {
            MediaMetrics.record(id,"QUEUE",(System.nanoTime()-queuedAt)/1_000_000)
            decodeRequest(context,url,id,edge,local,discardLocal)
        }
        // 头像最多占一个图片槽，给正在查看的聊天图保留资源；离屏取消自动移除等待者。
        return if(edge <= 128)avatarSlots.withPermit { scheduled() } else scheduled()
    }
    private suspend fun decodeRequest(context: Context, url: String, id: String, edge: Int,local:File?,discardLocal:()->Unit): MediaVisual {
        val started = System.nanoTime()
        try {
            val result = loader.execute(ImageRequest.Builder(context.applicationContext).data(local ?: url)
                .diskCacheKey(id).memoryCacheKey(memoryKey(id, edge)).size(edge.coerceIn(32, 1920))
                .scale(Scale.FIT).allowHardware(false).allowRgb565(true).build())
            if (result is ErrorResult) throw result.throwable
            result as SuccessResult
            MediaMetrics.record(id, result.dataSource.name, (System.nanoTime() - started) / 1_000_000)
            return when (val drawable = result.drawable) {
                is BitmapDrawable -> MediaVisual(bitmap = drawable.bitmap)
                is Animatable -> MediaVisual(animation = drawable)
                else -> MediaVisual(bitmap = drawable.toBitmap())
            }
        } catch (cancelled: CancellationException) {
            MediaMetrics.record(id, "CANCELLED", (System.nanoTime() - started) / 1_000_000); throw cancelled
        } catch (error: Throwable) {
            loader.diskCache?.remove(id)
            if(local!=null) {
                discardLocal()
                MediaMetrics.record(id,"LOCAL_CORRUPT",(System.nanoTime()-started)/1_000_000)
                return decodeRequest(context,url,id,edge,null,{})
            }
            MediaMetrics.record(id, "FAILED", (System.nanoTime() - started) / 1_000_000)
            throw error
        }
    }
    fun clear(): Long {
        synchronized(flights) { flights.values.forEach { it.task.cancel() }; flights.clear() }
        loader.memoryCache?.clear()
        val bytes = loader.diskCache?.size ?: 0
        loader.diskCache?.clear()
        return bytes
    }
    fun close() { work.cancel(); loader.shutdown() }
}

object MediaLoader {
    private val state = MutableStateFlow(MediaAccess(MediaCacheIdentity.scope(MediaURLs.DEFAULT_BASE, "anonymous"), MediaURLs.DEFAULT_BASE, 0))
    val access = state.asStateFlow()
    private val pending = ConcurrentHashMap<Job, Long>()
    @Volatile private var pipeline: MediaImagePipeline? = null
    private fun images(context: Context): MediaImagePipeline = pipeline ?: synchronized(this) {
        pipeline ?: MediaImagePipeline(context).also { pipeline = it }
    }
    @Synchronized fun setScope(base: String, account: String) {
        MediaURLs.businessBase = base
        val scope = MediaCacheIdentity.scope(base, account)
        if (scope == state.value.scope) return
        state.value = MediaAccess(scope, base, state.value.generation + 1)
        pending.keys.forEach { it.cancel() }
        MediaHttp.cancelDownloads()
        pipeline?.loader?.memoryCache?.clear()
        MediaMetrics.reset()
    }
    internal fun id(url: String, captured: MediaAccess = state.value) = MediaCacheIdentity.key(url, captured.scope, captured.base)
    internal fun encodedCache(context: Context) = images(context).loader.diskCache
    @Volatile private var copies:MediaLocalCopies?=null
    private fun localCopies(context:Context)=copies ?: synchronized(this) {
        copies ?: MediaLocalCopies(File(context.cacheDir,"media-local-v1")).also { copies=it }
    }
    fun rememberUploaded(context:Context,media:UploadedMedia,base:String,account:String) {
        val captured=state.value
        if(media.local.kind!=MediaKind.IMAGE||captured.scope!=MediaCacheIdentity.scope(base,account))return
        val root=File(context.filesDir,"outgoing").canonicalFile.toPath()
        val owned=media.local.file.canonicalFile.toPath()
        val pending=File(context.filesDir,"native-chat").canonicalFile
        val isPending=media.local.file.canonicalFile.parentFile?.let { directory -> directory.name=="upload-images"&&directory.parentFile?.name?.matches(Regex("[0-9a-f]{64}"))==true&&directory.parentFile?.parentFile==pending }==true
        if(!owned.startsWith(root)&&!isPending)return
        val urls=listOf(media.url,media.thumbnail).filter(String::isNotBlank).flatMap { raw ->
            ImageVariant.entries.map { MediaURLs.image(raw,it,base) }
        }.filter(String::isNotBlank).distinct()
        val keys=urls.map { id(it,captured) }
        localCopies(context).put(captured.scope,keys,media.local.file) { captured==state.value&&!captured.clearing }
        val draftKey=MediaCacheIdentity.digest(captured.scope+"/draft/"+media.local.file.canonicalPath)
        if(captured==state.value)keys.forEach { images(context).alias(draftKey,it) }
    }
    fun rememberForwarded(context:Context,source:com.im.nativebootstrap.chat.ChatMessage,preserved:com.google.gson.JsonObject,base:String,account:String) {
        val captured=state.value
        if(captured.clearing||captured.scope!=MediaCacheIdentity.scope(base,account))return
        val old=MessageContents.parse(source.serialized,source.text)
        val fresh=MessageContents.parse(preserved.toString())
        if(old.type!=102||fresh.type!=102)return
        val pairs=listOf(old.url to fresh.url,old.thumbnail.ifBlank { old.url } to fresh.thumbnail.ifBlank { fresh.url })
        pairs.filter { it.first.isNotBlank()&&it.second.isNotBlank() }.forEach { (from,to) ->
            ImageVariant.entries.forEach { variant ->
                if(captured!=state.value)return
                val sourceKey=id(MediaURLs.image(from,variant,base),captured)
                val destination=id(MediaURLs.image(to,variant,base),captured)
                images(context).alias(sourceKey,destination)
                localCopies(context).alias(captured.scope,sourceKey,listOf(destination))
            }
        }
    }
    fun peek(url: String, edge: Int): MediaVisual? {
        val captured = state.value
        if(captured.clearing)return null
        return pipeline?.peek(id(url, captured), edge)?.also { MediaMetrics.record(id(url, captured), "MEMORY_CACHE", 0) }
    }
    suspend fun loadOwnedDraft(context:Context,file:File,edge:Int):MediaVisual {
        val captured=state.value
        check(!captured.clearing)
        val directory=file.canonicalFile.parentFile
        check(directory?.name=="upload-images"&&directory.parentFile?.name?.matches(Regex("[0-9a-f]{64}"))==true&&directory.parentFile?.parentFile==File(context.filesDir,"native-chat").canonicalFile) { "本地预览文件不属于当前发送任务" }
        check(file.isFile&&file.length() in 1..32L*1024*1024)
        val key=MediaCacheIdentity.digest(captured.scope+"/draft/"+file.canonicalPath)
        val visual=images(context).load(context,"",key,edge,file)
        if(captured!=state.value)throw CancellationException("媒体会话已变化")
        return visual
    }
    suspend fun load(context: Context, raw: String, edge: Int): MediaVisual = coroutineScope {
        val captured = state.value
        val job = currentCoroutineContext().job
        pending[job] = captured.generation
        try {
            ensureActive()
            check(!captured.clearing && captured == state.value) { "媒体会话已变化" }
            val url = MediaURLs.remote(raw, captured.base)
            require(url.isNotEmpty()) { "媒体地址不受支持" }
            val local=withContext(Dispatchers.IO) { localCopies(context).get(captured.scope,id(url,captured)) }
            val value = images(context).load(context, url, id(url, captured), edge,local) { localCopies(context).discard(captured.scope,id(url,captured)) }
            ensureActive()
            if (captured != state.value) throw CancellationException("媒体会话已变化")
            value
        } finally { pending.remove(job) }
    }
    // 二维码与既有同步导出只在后台调用；聊天 UI 使用可取消 suspend 入口。
    fun visual(context: Context, url: String, edge: Int) = runBlocking(Dispatchers.IO) { load(context, url, edge) }
    fun bitmap(context: Context, url: String, edge: Int): Bitmap = visual(context, url, edge).let {
        it.bitmap ?: it.animation?.toBitmap() ?: error("图片解码失败")
    }
    fun fetch(context: Context, raw: String, maxBytes: Long = 256L * 1024 * 1024): File {
        val captured = state.value
        check(!captured.clearing) { "媒体缓存正在清理，请稍后重试" }
        val url = MediaURLs.remote(raw, captured.base)
        require(url.isNotEmpty()) { "媒体地址不受支持" }
        localCopies(context).get(captured.scope,id(url,captured))?.let { if(captured==state.value&&it.length()<=maxBytes)return it }
        return MediaHttp.download(context, url, id(url, captured), maxBytes, { captured == state.value }, images(context).loader.diskCache)
    }
    suspend fun clearDownloads(context: Context): Long {
        synchronized(this) {
            state.value = state.value.copy(generation = state.value.generation + 1, clearing = true)
            pending.keys.forEach { it.cancel() }
            MediaHttp.cancelDownloads()
        }
        return try { withContext(Dispatchers.IO) { images(context).clear() + MediaHttp.clear(context)+localCopies(context).clear() } }
        finally { synchronized(this) { state.value = state.value.copy(generation = state.value.generation + 1, clearing = false) } }
    }
}
