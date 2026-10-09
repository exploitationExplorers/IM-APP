import { createSSRApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { installH5MediaProxy } from '@/utils/chatMedia'

installH5MediaProxy()

export function createApp() {
  const app = createSSRApp(App)
  const pinia = createPinia()
  app.use(pinia)
  return {
    app,
  }
}
