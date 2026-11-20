package com.im.nativebootstrap

import androidx.compose.ui.graphics.Color

/** 深浅色跟随系统。深浅切换会重建 Activity，顶层 getter 重新取值即生效，无需 CompositionLocal。 */
object AppTheme { var dark: Boolean = false }

/**
 * 语义色板：收敛原先散落在各页面的硬编码色值。
 * 收敛原则：浅色套保持原主流值不变（视觉零漂移）；深色套背景下沉（页面 < 卡片 < 输入底）、文字上浮、
 * 品牌蓝在深色下提亮保证对比度。白字永远只出现在品牌蓝/彩色填充上，两种模式通用。
 */
object C {
    private val d get() = AppTheme.dark

    /** 品牌蓝：按钮/选中态填充，两种模式同色（白字对比度足够）。 */
    val primary get() = Color(0xFF0A2FC2)

    /** 品牌蓝的文字/链接/图标形态：深色下提亮。 */
    val primaryText get() = if (d) Color(0xFF8AA3FF) else Color(0xFF0A2FC2)

    /** 我方消息气泡（品牌蓝亮色，两种模式通用）。 */
    val mineBubble get() = Color(0xFF2B5CFF)

    /** 对方消息气泡/群名片卡片：浅色保持白，深色下沉（比 field 略亮，保证引用块 C.field 可辨）。 */
    val bubble get() = if (d) Color(0xFF2A2E3A) else Color(0xFFFFFFFF)

    /** 页面背景。 */
    val page get() = if (d) Color(0xFF101218) else Color(0xFFE6E8EE)

    /** 卡片/列表行/弹层表面。 */
    val card get() = if (d) Color(0xFF1A1D26) else Color(0xFFFFFFFF)

    /** 输入框/次级填充/骨架屏。 */
    val field get() = if (d) Color(0xFF252933) else Color(0xFFF3F4F7)

    /** 分割线/描边。 */
    val line get() = if (d) Color(0xFF2E3240) else Color(0xFFE1E3EA)

    /** 主文字。 */
    val text get() = if (d) Color(0xFFE9EBF2) else Color(0xFF212121)

    /** 强调文字（更黑/更白一档）。 */
    val textStrong get() = if (d) Color(0xFFF5F6FA) else Color(0xFF111111)

    /** 次级文字。 */
    val textSub get() = if (d) Color(0xFFA9B0C2) else Color(0xFF666666)

    /** 提示/说明文字。 */
    val hint get() = if (d) Color(0xFF8C93A6) else Color(0xFF626E8D)

    /** 弱提示（时间戳、辅助说明）。 */
    val faint get() = if (d) Color(0xFF6E7484) else Color(0xFF8A8F9C)

    /** 占位/禁用/箭头。 */
    val placeholder get() = if (d) Color(0xFF5A6070) else Color(0xFFB0B0B0)

    /** 危险/删除。 */
    val danger get() = Color(0xFFE54D4D)

    /** 危险操作的浅红底（滑动删除、禁言标签）。 */
    val dangerBg get() = if (d) Color(0xFF3A1D1D) else Color(0xFFFFE5E5)

    /** 警示条背景（公告黄条）。 */
    val warnBg get() = if (d) Color(0xFF3A3119) else Color(0xFFFFF5DF)

    /** 警示条文字。 */
    val warnText get() = if (d) Color(0xFFD9B877) else Color(0xFF805F29)

    /** 半透明遮罩（两种模式通用）。 */
    val scrim get() = Color(0x73000000)
}
