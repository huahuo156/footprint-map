# M1.3 首批：纯布局历史模型

设计已由用户在当前会话确认。实施计划见 [历史模型计划](../superpowers/plans/2026-10-29-canvas-history-model.md)，本批仅落实纯函数层，不代表完整 M1.3 上线。

新增 `src/journal/canvas/history.js`：createHistory、recordHistory、undoHistory、redoHistory。一次批量移动是一条命令；按 kind+id 匹配 before/after，过滤无变化成员，空操作保留重做分支；新编辑截断分支；保留最后 100 条命令。命令与状态使用独立的冻结快照，不冻结调用者原始输入，不受后续输入变动影响。非法/重复/超限输入在修改历史前拒绝。

新增 21 项测试。首次执行因历史模块尚不存在而无法加载，随后实现四个函数；定向测试 21 项通过。覆盖单次/整组/旋转/负坐标、重新排列的成员、跨 kind 同名 id、空操作、分支与100条边界、500项批量边界、冻结快照以及非法输入。

第一次完整 `npm test`：50 文件中49通过，347项中346通过；唯一失败是 `tests/bundle-performance.test.js` 的构建子进程报告 `memory allocation of 69632 bytes failed`，不是断言不符。PowerShell另一次启动也因系统分页内存不足失败；改用 cmd 后 lint 退出0。重跑在子进程局部设置 RAYON_NUM_THREADS=1、UV_THREADPOOL_SIZE=1、NODE_OPTIONS 的较小堆参数，没有改全局环境或测试门槛。

降低子进程内存配置后，第一次全量重跑50文件347项通过。独立审查指出稀疏数组会因 map/some/filter 跳过空槽而绕过校验；追加第22项用例观察失败，改用 Array.from 对所有位置执行成员校验后通过。最终完整 `npm test`：50文件348项通过，43.06秒；最终定向22项通过，lint与diff检查通过。测试刻意构造空槽，采用显式 length 赋值避免 new Array 的静态告警。

该模块尚未接入 UI、useJournal 或服务端；保存失败仍沿用当前产品行为。没有修改数据库、私人数据或对外发布。后续依次推进版本协议、保存协调器及UI，不把当前模块交付标为M1.3整体完成。
