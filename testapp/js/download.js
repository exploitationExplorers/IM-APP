/**
 * 下载页：安卓 apk / iOS itms-services + 去信任
 */
(function () {
  var CONFIG = {
    appName: "易可聊",
    // 相对本目录，对应网站 /testapp/app.apk。不要改成站点根目录的客户包。
    androidUrl: "app.apk",
    /** iOS 企业签 OTA，清单指向本目录的 canary ipa */
    iosUrl:
      "itms-services://?action=download-manifest&url=https://www.xn--jprz53bj9s.com/testapp/manifest.plist",
    /** 旧版 iOS 尝试跳转设置；失败则弹引导 */
    iosTrustUrls: [
      "App-Prefs:root=General&path=VPNController",
      "prefs:root=General&path=ManagedConfigurationList",
      "app.mobileconfig",
    ],
  };

  var ua = navigator.userAgent.toLowerCase();

  function isIOS() {
    return (
      /iphone os|iph os|ipad|ipod/.test(ua) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
    );
  }

  function isAndroid() {
    return /android|adr/.test(ua);
  }

  function isWeixin() {
    return ua.indexOf("micromessenger") !== -1;
  }

  function iosMajorVersion() {
    var m = navigator.userAgent.match(/OS (\d+)_/i);
    return m ? parseInt(m[1], 10) : 0;
  }

  function getDeviceType() {
    if (isIOS()) return "ios";
    if (isAndroid()) return "android";
    return "pc";
  }

  function showWeixinTip() {
    if (!isWeixin()) return;
    var el = isIOS() ? document.getElementById("weixin") : document.getElementById("weixin_an");
    if (el) el.classList.add("show");
  }

  function showTrustGuide() {
    var el = document.getElementById("trust_guide");
    if (el) el.classList.remove("hidden");
  }

  function hideTrustGuide() {
    var el = document.getElementById("trust_guide");
    if (el) el.classList.add("hidden");
  }

  function initLayout() {
    var type = getDeviceType();
    var mobilePage = document.querySelector(".contain-page");
    var pcPage = document.querySelector(".pc-box");

    if (type === "pc") {
      if (mobilePage) mobilePage.classList.add("hidden");
      if (pcPage) pcPage.classList.remove("hidden");
      renderPcQr();
    } else {
      if (pcPage) pcPage.classList.add("hidden");
      if (mobilePage) mobilePage.classList.remove("hidden");
      showWeixinTip();
    }
  }

  function renderPcQr() {
    var box = document.getElementById("Dqcode");
    if (!box || typeof QRCode === "undefined") return;
    box.innerHTML = "";
    var url = window.location.href.split("#")[0];
    new QRCode(box, {
      text: url,
      width: 248,
      height: 248,
      colorDark: "#000000",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.L,
    });
  }

  function downSoft() {
    if (isWeixin()) {
      showWeixinTip();
      return;
    }

    if (isIOS()) {
      window.location.href = CONFIG.iosUrl;
      return;
    }

    if (isAndroid()) {
      window.location.href = CONFIG.androidUrl;
      return;
    }

    alert("请使用手机扫描上方二维码下载安装");
  }

  function goTrust() {
    if (isWeixin()) {
      showWeixinTip();
      return;
    }

    if (!isIOS()) {
      alert("请在 iPhone 的 Safari 中打开本页，安装后点「去信任」");
      return;
    }

    // iOS 17+ 系统基本拦掉 prefs 跳转，直接给操作引导
    if (iosMajorVersion() >= 17) {
      showTrustGuide();
      return;
    }

    var urls = CONFIG.iosTrustUrls;
    var i = 0;
    function tryNext() {
      if (i >= urls.length) {
        showTrustGuide();
        return;
      }
      var url = urls[i++];
      try {
        window.location.href = url;
      } catch (e) {
        /* continue */
      }
      setTimeout(tryNext, 600);
    }
    tryNext();
  }

  function bindEvents() {
    var installBtn = document.getElementById("install_btn");
    if (installBtn) {
      installBtn.addEventListener("click", function (e) {
        e.preventDefault();
        downSoft();
      });
    }

    var trustBtn = document.getElementById("trust_btn");
    if (trustBtn) {
      trustBtn.addEventListener("click", function (e) {
        e.preventDefault();
        goTrust();
      });
    }

    var closeBtn = document.getElementById("trust_guide_close");
    var mask = document.getElementById("trust_guide_mask");
    if (closeBtn) closeBtn.addEventListener("click", hideTrustGuide);
    if (mask) mask.addEventListener("click", hideTrustGuide);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      initLayout();
      bindEvents();
    });
  } else {
    initLayout();
    bindEvents();
  }

  window.APP_DOWNLOAD_CONFIG = CONFIG;
})();
