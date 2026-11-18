package com.im.nativebootstrap.business

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.View
import android.widget.TextView
import android.widget.Toast
import com.im.nativebootstrap.R
import com.journeyapps.barcodescanner.CaptureActivity
import com.journeyapps.barcodescanner.DecoratedBarcodeView

/** 自定义扫码页：标题「扫码」+ 右上角相册 + 手电开关，样式对标 H5/uni.scanCode 扫码页 */
class NativeScanActivity:CaptureActivity() {
    private var torch=false
    // 4.3.0 没有 getLayoutResourceId，覆盖 initializeContent 换自定义布局（zxing_barcode_scanner id 必须保留）
    override fun initializeContent():DecoratedBarcodeView {
        setContentView(R.layout.native_scan_capture)
        return findViewById(R.id.zxing_barcode_scanner)
    }
    override fun onCreate(savedInstanceState:Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor=Color.BLACK
        findViewById<View>(R.id.scan_back).setOnClickListener{finish()}
        findViewById<View>(R.id.scan_album).setOnClickListener{startActivityForResult(Intent(Intent.ACTION_GET_CONTENT).setType("image/*"),PICK_IMAGE)}
        val scanner=findViewById<DecoratedBarcodeView>(R.id.zxing_barcode_scanner)
        val label=findViewById<TextView>(R.id.scan_torch_label)
        findViewById<View>(R.id.scan_torch).setOnClickListener{
            torch=!torch
            if(torch)scanner.setTorchOn() else scanner.setTorchOff()
            label.text=if(torch)"轻触关闭" else "轻触照亮"
        }
    }
    override fun onActivityResult(requestCode:Int,resultCode:Int,data:Intent?) {
        super.onActivityResult(requestCode,resultCode,data)
        val uri=data?.data
        if(requestCode==PICK_IMAGE&&uri!=null)Thread {
            val raw=runCatching{readQr(this,uri)}.getOrNull()
            runOnUiThread{if(raw==null)Toast.makeText(this,"未识别到有效二维码",Toast.LENGTH_SHORT).show() else deliver(raw)}
        }.start()
    }
    private fun deliver(raw:String) {
        setResult(Activity.RESULT_OK,Intent().putExtra("SCAN_RESULT",raw))
        finish()
    }
    companion object{private const val PICK_IMAGE=71}
}
