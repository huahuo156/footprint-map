# M1.3 统一手帐读取连接 Implementation Plan

> executing-plans 继续已确认设计；此批将运行GET的查询提取到统一读取层，保留legacy调用行为，新快照入口独立提供。

**Goal:** 照片、记录、标注、嵌套分组、手札与页内引用的12类查询都可使用同一显式连接与账号。

**Architecture:** 新增无全局pool依赖的read-journal/read-notebooks模块。旧journal()/readNotebooks()保留包装入口；readJournalSnapshot调用既有RR只读快照服务，传入versioned读取模式，三类对象版本CAST AS CHAR。

**Tech Stack:** 现有Node ESM、MySQL8.4、Vitest。

**Spec:** [已确认设计](../specs/2026-10-29-canvas-history-save-design.md)。

## Global Constraints / Review Focus

- 保留每条原有SQL的owner过滤、来源所有权校验、排序、日期格式和返回shape。
- 新查询层不导入全局pool/auth/.env，不能在子查询中逸出快照连接。
- 无版本旧GET不要求尚未迁移的字段；versioned模式才投影字符串版本。
- 部分读取失败直接拒绝，不返回半套资料。
- 跨账号组成员/子组/手札引用即使数据库存在关系也不暴露。

### Task 1: 提取与同连接快照

Files: `server/read-journal.js`、`server/read-notebooks.js`；修改`journal.js`与`notebooks.js`包装调用；新增`tests/journal-read-connection.test.js`与`scripts/test-journal-read-cases.js`。

- [x] 先写3项定向测试观察缺模块失败；提取12类查询并保留默认调用包装。
- [x] 验证所有查询同连接、同owner，版本CAST只在新模式启用，子查询异常不返回半套数据。
- [x] 真实MySQL使用混合账号及故意跨账号关系夹具；读取期间另一连接同时更新记录、照片、结构令牌及手札名，当前快照全旧，下个快照全新；验证最大BIGINT和旧shape。
- [x] 运行完整单元、真实API与恢复演练、lint；独立审查并清理专用环境，记录结果。

运行中的普通GET只切换查询实现，不启用版本协议；尚待迁移/建号/备份及写入口配套后统一切换版本快照。

Task 1 complete：375项全量、15项真实API、系统恢复与隔离MySQL完整快照通过，独立审查无重要发现。见 [验证记录](../../verification/2026-10-29-journal-read-connection.md)。
