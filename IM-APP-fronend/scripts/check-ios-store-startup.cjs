const assert = require('node:assert/strict')
const vm = require('node:vm')
const vue = require('vue')

/** 执行真实编译产物和根组件生命周期，验证首次安装/残留登录态都不会提前联网或加载插件。 */
function checkStoreStartup(service) {
  for (const legacyToken of ['', 'legacy-session']) {
    const calls = []
    const hooks = new Map()
    const instance = {}
    const app = {
      config: { globalProperties: {} },
      _component: null,
      provide() { return this },
      use(plugin) { plugin.install(this); return this },
      mount() { this._component.setup() },
    }
    const Vue = {
      ...vue,
      getCurrentInstance: () => instance,
      injectHook: (name, callback) => hooks.set(name, callback),
      createVueApp(component) { app._component = component; return app },
    }
    const uni = new Proxy({
      requireGlobal: undefined,
      restoreGlobal: undefined,
      getSystemInfoSync: () => ({ uniPlatform: 'app', platform: 'ios', statusBarHeight: 44 }),
      getStorageSync: (key) => key === 'im_token' ? legacyToken : '',
      $on: () => {},
      requireNativePlugin(name) { calls.push(['requireNativePlugin', name]); throw new Error('Plugin loaded before consent') },
    }, {
      get(target, key) {
        if (key in target) return target[key]
        return () => { calls.push([key]); return {} }
      },
    })
    vm.runInNewContext(service, {
      Vue, uni, plus: {}, weex: {}, console,
      setTimeout, clearTimeout, setInterval, clearInterval,
      getCurrentPages: () => [{ route: 'pages/auth/consent' }],
      __definePage: () => {}, __uniConfig: { styles: {} }, getApp: () => ({}),
    })
    assert(hooks.has('onLaunch') && hooks.has('onShow'), '未执行到根组件生命周期注册')
    hooks.get('onLaunch')({})
    hooks.get('onShow')({})
    const forbidden = new Set(['requireNativePlugin', 'request', 'uploadFile', 'downloadFile', 'connectSocket', 'getPushClientId'])
    assert.deepEqual(calls.filter(([method]) => forbidden.has(method)), [], '未同意隐私政策时已触发 SDK 或网络')
  }
}

module.exports = { checkStoreStartup }
