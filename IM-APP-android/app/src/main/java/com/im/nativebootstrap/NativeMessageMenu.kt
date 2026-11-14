package com.im.nativebootstrap

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.im.nativebootstrap.chat.MessageMenuEntry

internal data class ChatMenuOption(val entry:MessageMenuEntry,val action:()->Unit)

/** 气泡菜单与旧端同为两列，管理操作独占底部整行，点遮罩或返回关闭。 */
@Composable
internal fun ChatActionMenu(options:List<ChatMenuOption>,anchor:Offset?,dismiss:()->Unit,footer:@Composable ()->Unit) {
    val density=LocalDensity.current
    var height by remember { mutableIntStateOf(0) }
    Dialog(onDismissRequest=dismiss,properties=DialogProperties(usePlatformDefaultWidth=false,decorFitsSystemWindows=false)) {
        BoxWithConstraints(Modifier.fillMaxSize().background(Color(0x73000000)).clickable(onClick=dismiss)) {
            val menuWidth=(maxWidth*.5f).coerceIn(120.dp,320.dp)
            val widthPx=with(density) { menuWidth.toPx() }
            val viewWidth=with(density) { maxWidth.toPx() };val viewHeight=with(density) { maxHeight.toPx() }
            val pad=with(density) { 8.dp.toPx() };val gap=with(density) { 12.dp.toPx() }
            val grid=options.filterNot { it.entry.wide }
            val wide=options.filter { it.entry.wide }
            val estimated=with(density) { (((grid.size+1)/2)*44+wide.size*48).dp.toPx() }
            val menuHeight=if(height>0)height.toFloat() else estimated
            val left=((anchor?.x ?: viewWidth/2)-widthPx/2).coerceIn(pad,maxOf(pad,viewWidth-widthPx-pad))
            val below=if(anchor==null)(viewHeight-menuHeight)/2 else anchor.y+gap
            val top=(if(below+menuHeight+pad>viewHeight&&anchor!=null)anchor.y-menuHeight-gap else below).coerceIn(pad,maxOf(pad,viewHeight-menuHeight-pad))
            Column(Modifier.offset { IntOffset(left.toInt(),top.toInt()) }.width(menuWidth).heightIn(max=maxHeight-16.dp).onSizeChanged { height=it.height }.shadow(12.dp,RoundedCornerShape(12.dp)).clip(RoundedCornerShape(12.dp)).background(Color.White).clickable {}.verticalScroll(rememberScrollState())) {
                grid.chunked(2).forEachIndexed { rowIndex,row ->
                    Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min)) {
                        row.forEachIndexed { index,option ->
                            MenuCell(option,Modifier.weight(1f).fillMaxHeight())
                            if(index==0)Box(Modifier.width(1.dp).fillMaxHeight().background(Color(0xFFECECEC)))
                        }
                        if(row.size==1)Spacer(Modifier.weight(1f))
                    }
                    if(rowIndex<((grid.size+1)/2)-1||wide.isNotEmpty())MenuDivider()
                }
                wide.forEachIndexed { index,option ->
                    MenuCell(option,Modifier.fillMaxWidth(),wide=true)
                    if(index<wide.lastIndex)MenuDivider()
                }
                footer()
            }
        }
    }
}

@Composable private fun MenuDivider() { Box(Modifier.fillMaxWidth().height(1.dp).background(Color(0xFFECECEC))) }
@Composable private fun MenuCell(option:ChatMenuOption,modifier:Modifier,wide:Boolean=false) {
    Box(modifier.heightIn(min=if(wide)48.dp else 44.dp).clickable(onClick=option.action).padding(horizontal=6.dp,vertical=12.dp),contentAlignment=Alignment.Center) {
        Text(option.entry.label,fontSize=14.sp,lineHeight=20.sp,color=Color(0xFF1A1A1A),fontWeight=if(wide)FontWeight.SemiBold else FontWeight.Normal,textAlign=TextAlign.Center)
    }
}
