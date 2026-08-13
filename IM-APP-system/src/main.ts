import { createApp } from "vue";
import { createPinia } from "pinia";
import ElementPlus from "element-plus";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import * as ElementPlusIcons from "@element-plus/icons-vue";
import "element-plus/dist/index.css";
import "./styles/index.scss";

import App from "./App.vue";
import router from "./router";

const app = createApp(App);
Object.entries(ElementPlusIcons).forEach(([name, component]) => app.component(name, component));
app.use(createPinia()).use(router).use(ElementPlus, { locale: zhCn }).mount("#app");
