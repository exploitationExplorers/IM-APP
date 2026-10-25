export {}

declare module "vue" {
  type Hooks = App.AppInstance & Page.PageInstance;
  // 声明合并：把 uni 页面钩子并进组件选项，接口本身不新增字段
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ComponentCustomOptions extends Hooks {}
}