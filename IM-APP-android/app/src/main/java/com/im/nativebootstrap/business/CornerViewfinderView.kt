package com.im.nativebootstrap.business

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Shader
import android.os.SystemClock
import android.util.AttributeSet
import com.journeyapps.barcodescanner.ViewfinderView

/** 扫码框绘制：半透明遮罩 + 蓝色四角 + 循环下扫的扫描线（对标 H5/uni.scanCode 扫码页） */
class CornerViewfinderView(context:Context,attrs:AttributeSet?):ViewfinderView(context,attrs) {
    private val density=context.resources.displayMetrics.density
    private val maskPaint=Paint().apply{color=0x73000000}
    private val cornerPaint=Paint(Paint.ANTI_ALIAS_FLAG).apply{color=Color.rgb(0,145,255);style=Paint.Style.STROKE;strokeWidth=4*density;strokeCap=Paint.Cap.ROUND}
    private val laserPaint=Paint(Paint.ANTI_ALIAS_FLAG)

    override fun onDraw(canvas:Canvas) {
        val frame=framingRect
        if(frame==null||frame.width()<=0){super.onDraw(canvas);return}
        val w=width.toFloat();val h=height.toFloat()
        canvas.drawRect(0f,0f,w,frame.top.toFloat(),maskPaint)
        canvas.drawRect(0f,frame.top.toFloat(),frame.left.toFloat(),frame.bottom.toFloat(),maskPaint)
        canvas.drawRect(frame.right.toFloat(),frame.top.toFloat(),w,frame.bottom.toFloat(),maskPaint)
        canvas.drawRect(0f,frame.bottom.toFloat(),w,h,maskPaint)
        val corner=22*density;val inset=2*density
        val l=frame.left+inset;val t=frame.top+inset;val r=frame.right-inset;val b=frame.bottom-inset
        canvas.drawLine(l,t+corner,l,t,cornerPaint);canvas.drawLine(l,t,l+corner,t,cornerPaint)
        canvas.drawLine(r-corner,t,r,t,cornerPaint);canvas.drawLine(r,t,r,t+corner,cornerPaint)
        canvas.drawLine(l,b-corner,l,b,cornerPaint);canvas.drawLine(l,b,l+corner,b,cornerPaint)
        canvas.drawLine(r-corner,b,r,b,cornerPaint);canvas.drawLine(r,b,r,b-corner,cornerPaint)
        val pad=10*density;val span=frame.height()-pad*2
        if(span>0) {
            val progress=(SystemClock.uptimeMillis()%2200L)/2200f
            val y=frame.top+pad+span*progress
            laserPaint.shader=LinearGradient(0f,y-6*density,0f,y+2*density,Color.TRANSPARENT,Color.rgb(0,145,255),Shader.TileMode.CLAMP)
            canvas.drawRect(frame.left+pad,y-6*density,frame.right-pad,y+2*density,laserPaint)
        }
        if(isShown)postInvalidateDelayed(30)
    }
}
