# M1.3 React生命周期与结构操作屏障

新增useLayoutPersistence，封装上一批纯协调器。每个sessionKey/挂载拥有独立作用域；useLayoutEffect清理时先标记失效、abort、取消订阅并销毁协调器。会话切换的首个渲染即隐藏旧快照，迟到回执不能写新账号。

replaceBaseline显式初始化/替换基线，不因普通渲染或send回调引用变化自动清空编辑。发送函数在作用域建立时捕获，实际换账号/运输会话需要新sessionKey。captureSession返回绑定实际effect实例的guard/signal，防止StrictMode重放后初次异步加载的旧结果进入新实例；调用方必须在异步加载后、写基线前检查guard。

runStructureOperation只在布局全部确认时执行，期间锁定编辑/撤销/重试及其他结构操作；操作函数接收guard/signal，返回新基线，成功后才更新位置/版本和清空历史。失败保留旧内容与历史，设置reload-required并暂禁编辑，直到调用者获取并显式提交新基线。它不自动重试结构操作，也不承诺abort能撤回服务端已收到的请求。

验证：

- 首批7项先因缺少hook模块失败，实现后通过。
- 补充普通重渲染更换send回调导致草稿丢失回归，先失败，再将transport绑定会话后通过。
- 补充StrictMode首次加载guard用例，先失败，再接入实际作用域guard后通过。
- 定向9项覆盖StrictMode、账号切换、卸载、晚回执、未知布局结果阻断结构写、结构操作期间锁定、失败后重载、异步跨会话回调隔离及回调引用变化。
- 最终全量Vitest：64文件469项通过。
- lint、check:bundle与git diff --check通过，保留既有CRLF提示。
- 独立只读审查未发现可操作问题，覆盖会话失效、StrictMode guard、transport稳定性及结构操作屏障。

本批没有改服务端、运行useJournal或画布UI，不进行数据库迁移、真实API或浏览器验收；先前记录的API/浏览器证据不作为新界面能力的证明。下一批统一迁移useJournal、页面直接导入/恢复入口、刷新和CRUD屏障，然后才能开启保留失败编辑/重试及撤销界面。没有提交、推送或发布。
