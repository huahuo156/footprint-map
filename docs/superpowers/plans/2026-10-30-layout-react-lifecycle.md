# M1.3 React生命周期与操作屏障

继续已确认设计，使用executing-plans/TDD；保留既有工作区，不提交或发布。

- [x] hook先失败测试：StrictMode、会话切换、卸载、晚回执、初次基线加载和订阅。
- [x] 使用useLayoutEffect建立每次sessionKey生命周期并捕获transport；基线显式初始化，不因普通渲染或数据变化自动覆盖草稿。
- [x] 结构操作屏障仅在布局已确认时开放，操作期间禁止新布局编辑；操作成功后以返回的新快照更新基线/清空历史。操作失败保留历史和内容，要求重新获取基线后才重新开放编辑。
- [x] 刷新/CRUD屏障、失败后重载和传输abort定向验证；全量、lint、构建和独立审查。

Ruling：此批提供useLayoutPersistence及runStructureOperation，不切换运行useJournal/UI；页面中直接导入/恢复等入口必须一并迁移后才能启用，避免只锁一部分入口。调用者以每个账号/挂载会话唯一的sessionKey隔离。操作函数接收signal/guard，返回完整新布局基线；hook不替调用者猜测请求已撤回或自动重试结构操作。

Ruling：send在每个会话建立时捕获，普通重渲染改变回调引用不能重建会话/清空草稿。captureSession捕获实际effect实例而非仅账号key，使StrictMode重放期间首次加载的旧回执也能被拒绝；调用者在异步读取后、更新基线前必须调用guard。
