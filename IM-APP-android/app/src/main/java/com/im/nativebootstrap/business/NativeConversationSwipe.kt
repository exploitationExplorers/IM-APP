package com.im.nativebootstrap.business

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.roundToInt

/** 与原移动页一致，左滑展开右侧置顶/移除；右滑收起，一次只展开一行。 */
@Composable fun NativeConversationSwipe(open:Boolean,onOpen:()->Unit,onClose:()->Unit,pinned:Boolean,buttonWidth:Dp,onPin:()->Unit,onRemove:()->Unit,content:@Composable ()->Unit) {
    val density=LocalDensity.current
    val limit=with(density){buttonWidth.toPx()*2}
    var target by remember{mutableFloatStateOf(0f)}
    var dragging by remember{mutableStateOf(false)}
    LaunchedEffect(open){if(!dragging)target=if(open)-limit else 0f}
    val offset by animateFloatAsState(target,if(dragging)snap() else tween(160),label="conversation-swipe")
    Box(Modifier.fillMaxWidth().height(IntrinsicSize.Min).clipToBounds()) {
        Row(Modifier.align(Alignment.CenterEnd).fillMaxHeight()) {
            Box(Modifier.width(buttonWidth).fillMaxHeight().background(if(pinned)Color(0xFFE7E8EC) else Color(0xFFF0F1F4)).clickable{onClose();onPin()},contentAlignment=Alignment.Center){Text(if(pinned)"取消置顶" else "置顶",fontSize=14.sp,color=Color(0xFF212121))}
            Box(Modifier.width(buttonWidth).fillMaxHeight().background(Color(0xFFFFE5E5)).clickable{onClose();onRemove()},contentAlignment=Alignment.Center){Text("移除",fontSize=14.sp,color=Color(0xFFE54D42))}
        }
        Box(Modifier.offset{IntOffset(offset.roundToInt(),0)}.draggable(rememberDraggableState{delta->target=(target+delta).coerceIn(-limit,0f)},Orientation.Horizontal,
            onDragStarted={dragging=true},onDragStopped={velocity->
                dragging=false
                val expanded=if(velocity < -500)true else if(velocity>500)false else target < -limit*.35f
                target=if(expanded)-limit else 0f
                if(expanded)onOpen() else onClose()
            })) {content()}
    }
}
