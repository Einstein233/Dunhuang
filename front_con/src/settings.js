module.exports = {
  /**
   默认标题
   */
  logo: '',
  /**
   默认标题
   */
  title: '敦煌多场耦合后台管理',
  /**
   是否显示悬浮设置图标
   */
  showSettings: false,

  /**
   是否显示横向菜单tab
   */
  tagsView: false,

  /**
    是否固定横向菜单组件
   */
  fixedHeader: true,

  /**
    是否显示右上角logo和名称
   */
  sidebarLogo: true,

  /**
   * @type {boolean} true | false
   * @description Whether support pinyin search in headerSearch
   * Bundle size minified 47.3kb,minified + gzipped 63kb
   */
  supportPinyinSearch: true,

  /**
   * @type {string | array} 'production' | ['production', 'development']
   * @description Need show err logs component.
   * The default is only used in the production env
   * If you want to also use it in dev, you can pass ['production', 'development']
   */
  errorLog: 'production'
}
