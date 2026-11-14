package com.im.nativebootstrap.chat

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import com.im.nativebootstrap.NativeChatCallbacks
import com.im.nativebootstrap.media.MediaIO
import com.im.nativebootstrap.media.MediaKind
import com.im.nativebootstrap.media.MediaURLs
import com.im.nativebootstrap.media.RemoteMediaImage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import android.os.Handler
import android.os.Looper

private fun stickerUI(action:()->Unit) { if(Looper.myLooper()==Looper.getMainLooper())action() else Handler(Looper.getMainLooper()).post(action) }

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun NativeEmojiStickerPanel(callbacks:NativeChatCallbacks,selectEmoji:(String)->Unit,selectSticker:(String)->Unit,manage:()->Unit,close:()->Unit={}) {
    val context=LocalContext.current
    val factor=LocalConfiguration.current.screenWidthDp/750f
    fun rpx(value:Int)=(value*factor).dp
    val scope=rememberCoroutineScope()
    var tab by remember { mutableIntStateOf(0) }
    var stickers by remember { mutableStateOf<List<ChatPickerItem>>(emptyList()) }
    var page by remember { mutableIntStateOf(0) }
    var end by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    var uploading by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf(false) }
    var selected by remember { mutableStateOf<ChatPickerItem?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    fun load(refresh:Boolean=false) {
        if(loading)return
        loading=true;error=null
        val request=if(refresh)1 else page+1
        callbacks.onLoadStickers(request) { result -> stickerUI {
            loading=false
            result.fold(onSuccess={ value ->
                val old=if(refresh)emptyList() else stickers
                val next=(old+value.items).distinctBy { it.id }
                if(!refresh&&!value.end&&next.size==old.size)error="表情分页暂未推进，请刷新重试"
                else { stickers=next;page=request;end=value.end }
            },onFailure={ error=it.message ?: "表情列表读取失败，请重试" })
        } }
    }
    LaunchedEffect(tab) { if(tab==1)load(true) }
    val pick=rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if(uris.isNotEmpty()&&!uploading) {
            uploading=true;error=null
            var index=0;var success=0;var failed=0
            fun next() {
                if(index>=minOf(9,uris.size)) {
                    uploading=false
                    load(true)
                    if(failed>0)error="$success 张成功，$failed 张未完成，可重试"
                    return
                }
                val uri=uris[index++]
                scope.launch {
                    val result=withContext(Dispatchers.IO) { runCatching { MediaIO.stage(context,uri,MediaKind.IMAGE) } }
                    result.fold(onSuccess={ media -> callbacks.onAddSticker(media) { saved ->
                        media.file.delete()
                        stickerUI { if(saved.isSuccess)success++ else failed++;next() }
                    } },onFailure={ failed++;next() })
                }
            }
            next()
        }
    }
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(topStart=rpx(20),topEnd=rpx(20))).background(Color.White).semantics { contentDescription="表情面板" }) {
        Row(Modifier.fillMaxWidth().padding(start=rpx(20),end=rpx(20),top=rpx(18),bottom=rpx(12)),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(rpx(16))) {
            for(index in 0..1)Box(Modifier.size(rpx(64)).clip(RoundedCornerShape(rpx(14))).background(if(tab==index)Color(0xFFF3F4F7) else Color.White).semantics { contentDescription=if(index==0)"常用表情" else "收藏表情" }.clickable { tab=index },contentAlignment=Alignment.Center) {
                Canvas(Modifier.size(rpx(34))) {
                    val ink=Color(0xFF666666);val unit=size.width/24
                    if(index==0) {
                        drawCircle(ink,10*unit,Offset(12*unit,12*unit),style=Stroke(1.4f*unit))
                        drawCircle(ink,unit,Offset(8*unit,9*unit));drawCircle(ink,unit,Offset(16*unit,9*unit))
                        drawArc(ink,0f,180f,false,Offset(6*unit,7*unit),Size(12*unit,10*unit),style=Stroke(1.4f*unit,cap=StrokeCap.Round))
                    } else drawPath(Path().apply { moveTo(12*unit,21*unit);cubicTo(3*unit,15*unit,0f,8*unit,5*unit,4*unit);cubicTo(8*unit,2*unit,11*unit,4*unit,12*unit,6*unit);cubicTo(13*unit,4*unit,16*unit,2*unit,19*unit,4*unit);cubicTo(24*unit,8*unit,21*unit,15*unit,12*unit,21*unit);close() },ink)
                }
            }
            Spacer(Modifier.weight(1f))
            Box(Modifier.size(rpx(64)).clip(CircleShape).semantics { contentDescription="关闭表情面板" }.clickable(onClick=close),contentAlignment=Alignment.Center) { Text("×",fontSize=(32*factor).sp,color=Color(0xFF666666)) }
        }
        if(uploading)Text("表情上传中…",Modifier.padding(horizontal=14.dp,vertical=6.dp),fontSize=12.sp,color=Color.Gray)
        error?.let { Text(it,Modifier.fillMaxWidth().clickable(enabled=!loading) { if(tab==1)load(page==0) }.padding(10.dp),fontSize=12.sp,color=Color(0xFF9B6C2F)) }
        if(tab==0)LazyVerticalGrid(GridCells.Fixed(8),Modifier.fillMaxWidth().height(rpx(460)),contentPadding=PaddingValues(horizontal=rpx(12),vertical=rpx(18))) {
            items(emojiValues) { value -> Box(Modifier.height(rpx(80)).clickable { selectEmoji(value) },contentAlignment=Alignment.Center) { Text(value,fontSize=(46*factor).sp) } }
        }
        else LazyVerticalGrid(GridCells.Fixed(4),Modifier.fillMaxWidth().height(rpx(460)),contentPadding=PaddingValues(horizontal=rpx(20),vertical=rpx(22)),horizontalArrangement=Arrangement.spacedBy(rpx(16)),verticalArrangement=Arrangement.spacedBy(rpx(16))) {
            item { Box(Modifier.fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(rpx(12))).border(1.dp,Color(0xFFA0A5B3),RoundedCornerShape(rpx(12))).clickable(enabled=!uploading&&!deleting) { pick.launch(arrayOf("image/*")) },contentAlignment=Alignment.Center) { Text("+",fontSize=(48*factor).sp,color=Color(0xFFA0A5B3)) } }
            items(stickers,key={ it.id }) { sticker ->
                Box(Modifier.fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(rpx(12))).background(Color(0xFFF5F6F8))) {
                    RemoteMediaImage(MediaURLs.image(sticker.content),Modifier.fillMaxSize().combinedClickable(enabled=!uploading&&!deleting,onClick={ selectSticker(sticker.content) },onLongClick={ selected=sticker }),edge=200,scale=ContentScale.Crop,description="自定义表情")
                    Box(Modifier.align(Alignment.TopEnd).padding(rpx(4)).size(rpx(32)).clip(CircleShape).background(Color(0x8C000000)).clickable(enabled=!uploading&&!deleting) { selected=sticker },contentAlignment=Alignment.Center) { Text("×",fontSize=(24*factor).sp,color=Color.White) }
                }
            }
            item(span={ androidx.compose.foundation.lazy.grid.GridItemSpan(4) }) {
                Text(if(loading)"读取中…" else if(stickers.isEmpty())"点击 + 添加表情" else if(end)"管理表情" else "加载更多",Modifier.fillMaxWidth().clickable(enabled=!loading&&!uploading) { if(end||stickers.isEmpty())manage() else load() }.padding(10.dp).wrapContentWidth(),color=Color.Gray,fontSize=12.sp)
            }
        }
    }
    selected?.let { sticker -> AlertDialog(onDismissRequest={ if(!deleting)selected=null },title={ Text("删除表情") },text={ Text("确定删除这个表情？") },confirmButton={ TextButton(enabled=!deleting,onClick={
        deleting=true
        callbacks.onDeleteSticker(sticker.id) { result -> stickerUI {
            deleting=false
            result.fold(onSuccess={ stickers=stickers.filterNot { it.id==sticker.id };selected=null },onFailure={ error=it.message ?: "删除表情失败";selected=null })
        } }
    }) { Text(if(deleting)"删除中…" else "删除") } },dismissButton={ TextButton(enabled=!deleting,onClick={ selected=null }) { Text("取消") } }) }
}

private val emojiValues=(
    "😀 😁 😂 🤣 😃 😄 😅 😆 😉 😊 😋 😎 😍 😘 🥰 😗 😙 😚 🙂 🤗 🤩 🤔 🤨 😐 "+
    "😑 😶 🙄 😏 😣 😥 😮 🤐 😯 😪 😫 🥱 😴 😌 😛 😜 😝 🤤 😒 😓 😔 😕 🙃 😲 "+
    "😖 😞 😟 😤 😢 😭 😦 😧 😨 😩 🤯 😬 😱 🥵 🥶 😳 🤪 😵 🤠 🥳 😡 😠 🤬 😷 "+
    "👍 👎 👌 🤌 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👏 🙌 👐 🤝 🙏 💪 🫶 ❤️ 💔 💖 "+
    "💗 💘 💝 💞 💓 ✨ 🌟 🔥 💥 ✅ ❌ ⚠️ ⭐ 🌈 ☀️ 🌙 ☁️ ❄️ 🎉 🎊 🎵 🎶 📌 📎 "+
    "🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐵 🐔 🐧 🐦 🐤 🦄 🐝 🦋 🐌 🐞 🐜 "+
    "🍉 🍊 🍋 🍌 🍇 🍓 🍒 🍑 🥭 🍍 🥝 🍅 🍔 🍟 🍕 🍜 🍲 🍣 🍱 🍡 🍰 🎂 🧁 🍪 "+
    "☕ 🍵 🥤 🍺 🍻 ⚽ 🏀 🎮 🎯 🎲"
).split(' ')
