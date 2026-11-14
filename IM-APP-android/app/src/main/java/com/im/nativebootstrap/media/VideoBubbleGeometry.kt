package com.im.nativebootstrap.media

data class VideoBubbleSize(val width:Float,val height:Float)

/** 同一缩放因子约束宽高，竖视频不会被独立最小宽度撑成横卡。单位为原稿 rpx。 */
object VideoBubbleGeometry {
    fun fit(width:Int,height:Int):VideoBubbleSize {
        if(width<=0||height<=0)return VideoBubbleSize(280f,210f)
        val scale=minOf(280f/width,360f/height)
        return VideoBubbleSize(width*scale,height*scale)
    }
    fun duration(seconds:Long):String {
        val value=seconds.coerceAtLeast(0)
        return "%02d:%02d".format(java.util.Locale.ROOT,value/60,value%60)
    }
}
