package com.im.nativebootstrap.chat

import com.im.nativebootstrap.C
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.key.*
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.im.nativebootstrap.R

/** 面板状态单独持有，输入组件只发出明确的打开、关闭事件。 */
@Stable
internal class NativeComposerPanelState {
    var emojiOpen by mutableStateOf(false)
        private set

    fun setEmoji(value:Boolean) { emojiOpen=value }
}

@Composable
internal fun NativeMessageComposer(
    text:String,
    enabled:Boolean,
    canStartVoice:Boolean,
    enterToSend:Boolean,
    emojiOpen:Boolean,
    onTextChange:(String)->Unit,
    cursorRequest:Int?=null,
    onCursorHandled:()->Unit={},
    onEditorTap:()->Unit,
    onEmojiChange:(Boolean)->Unit,
    onToggleMore:()->Unit,
    onStartVoice:()->Unit,
    onSend:()->Unit,
) {
    val factor=LocalConfiguration.current.screenWidthDp/750f
    fun rpx(value:Int)=(value*factor).dp
    val focus=LocalFocusManager.current
    val keyboard=LocalSoftwareKeyboardController.current
    val currentEditorTap by rememberUpdatedState(onEditorTap)
    var value by remember { mutableStateOf(TextFieldValue(text)) }
    LaunchedEffect(text) {
        if(value.text!=text) {
            value=TextFieldValue(text,TextRange((cursorRequest?:text.length).coerceIn(0,text.length)))
        }
    }
    LaunchedEffect(cursorRequest) {
        cursorRequest?.let { position ->
            if(value.text==text) value=value.copy(selection=TextRange(position.coerceIn(0,value.text.length)))
            onCursorHandled()
        }
    }
    Row(Modifier.fillMaxWidth().background(C.field).padding(horizontal=rpx(20),vertical=rpx(16)),verticalAlignment=Alignment.Bottom,horizontalArrangement=Arrangement.spacedBy(rpx(12))) {
        Box(Modifier.size(rpx(64)).clickable(enabled=canStartVoice,onClick=onStartVoice),contentAlignment=Alignment.Center) {
            Image(painterResource(R.drawable.uni_icon_mic),"语音输入",Modifier.size(rpx(44)))
        }
        Row(Modifier.weight(1f).heightIn(min=rpx(72)).clip(RoundedCornerShape(rpx(36))).background(C.card),verticalAlignment=Alignment.Bottom) {
            BasicTextField(value,{ next -> value=next;onTextChange(next.text) },Modifier.weight(1f).heightIn(min=rpx(72),max=160.dp).padding(start=rpx(16),top=rpx(8),bottom=rpx(8)).pointerInput(Unit) {
                awaitEachGesture {
                    awaitFirstDown(requireUnconsumed=false,pass=PointerEventPass.Initial)
                    currentEditorTap()
                }
            }.onPreviewKeyEvent { event ->
                if(enterToSend&&event.key==Key.Enter&&event.type==KeyEventType.KeyDown&&!event.isShiftPressed) { onSend();true } else false
            },enabled=enabled,textStyle=TextStyle(fontSize=16.sp,lineHeight=24.sp,color=C.text),cursorBrush=SolidColor(C.mineBubble),keyboardOptions=KeyboardOptions(imeAction=if(enterToSend)ImeAction.Send else ImeAction.Default),keyboardActions=KeyboardActions(onSend={ onSend() }),decorationBox={ inner ->
                Box(Modifier.fillMaxWidth(),contentAlignment=Alignment.CenterStart) {
                    if(text.isEmpty())Text("输入消息",fontSize=16.sp,lineHeight=24.sp,color=C.placeholder)
                    inner()
                }
            })
            Box(Modifier.padding(end=rpx(6),bottom=rpx(4)).size(rpx(64)).semantics { contentDescription="表情";stateDescription=if(emojiOpen)"表情面板已打开" else "表情面板已关闭" }.clickable {
                onEmojiChange(!emojiOpen)
                focus.clearFocus()
                keyboard?.hide()
            },contentAlignment=Alignment.Center) {
                Canvas(Modifier.size(rpx(36))) {
                    val unit=size.width/24;val ink=C.textSub
                    drawCircle(ink,10*unit,Offset(12*unit,12*unit),style=Stroke(1.4f*unit))
                    drawCircle(ink,1.1f*unit,Offset(8.1f*unit,9*unit));drawCircle(ink,1.1f*unit,Offset(15.9f*unit,9*unit))
                    drawArc(ink,0f,180f,false,Offset(6*unit,7.5f*unit),Size(12*unit,10*unit),style=Stroke(1.4f*unit,cap=StrokeCap.Round))
                }
            }
        }
        Box(Modifier.size(rpx(64)).clickable { onToggleMore();focus.clearFocus();keyboard?.hide() },contentAlignment=Alignment.Center) {
            Image(painterResource(R.drawable.uni_icon_plus),"更多功能",Modifier.size(rpx(40)))
        }
        if(text.isNotBlank())Box(Modifier.height(rpx(64)).widthIn(min=rpx(120)).clip(RoundedCornerShape(rpx(18))).background(C.primary).clickable(enabled=enabled,onClick=onSend).padding(horizontal=rpx(22)),contentAlignment=Alignment.Center) {
            Text("传送",color=Color.White,fontSize=(26*factor).sp,fontWeight=FontWeight.SemiBold)
        }
    }
}
