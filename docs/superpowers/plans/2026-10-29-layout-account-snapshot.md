# M1.3 账号令牌与一致性快照 Implementation Plan

> executing-plans 延续已确认设计，先实现可复用服务，运行入口待所有相关迁移/备份/写入升级后统一切换。

**Goal:** 新账号与结构令牌原子创建，读取布局及令牌使用同一只读一致快照。

**Architecture:** `server/layout-session.js` 不导入全局pool。`createLayoutUser(database,user)` 从池借连接，自行事务提交/回滚并释放；调用者负责邮箱验证和密码散列。`readLayoutSnapshot(database,authenticatedOwnerId,reader)` 明确RR隔离与一致性只读事务，reader接收同一connection与ownerId，所有内容查询必须使用该连接。

**Tech Stack:** 现有Node/mysql2/Vitest/MySQL8.4，无新增依赖。

**Spec:** [已确认设计](../specs/2026-10-29-canvas-history-save-design.md)。

## Global Constraints / Review Focus

- 账号与令牌同事务；state插入失败不能遗留账号。
- 注册邮箱/密码规则由现有入口负责，服务仅接受已校验数据与passwordHash，不自行散列。
- 明确事务隔离级别，不能继承池连接的READ COMMITTED默认设置。
- 令牌与内容不能混合新旧版本，readonly期间写入由数据库拒绝；版本通过CAST AS CHAR返回。
- 任何失败都rollback并release；缺令牌503，不在读请求里建行。
- 这里只实现快照容器，具体业务reader仍必须按owner过滤、统一连接；旧GET尚未切换。

### Task 1: 服务与验证

Files: `server/layout-session.js`、`tests/layout-account-snapshot.test.js`、`scripts/test-layout-session-cases.js`，由隔离迁移脚本运行真实数据库用例。

- [x] 定向测试先观察缺模块失败；实现同连接建号/令牌、失败回滚、只读快照、缺令牌及reader异常释放。
- [x] 专用MySQL验证建号成功、重复邮箱、令牌表不可用时账号回滚；池连接默认READ COMMITTED下仍读取一致旧快照，下一快照看到并发提交；只读禁止写、BIGINT精确、缺令牌不修复。
- [x] 全量测试、lint、独立审查及最终数据库脚本通过，更新记录并清理本次专用容器。

后续：将现有journal/readNotebooks查询改为接收同连接；升级迁移/建号入口与系统备份目录，再统一接入运行路由和其他坐标/结构写操作。

Task 1 complete：5项单元、372项全量及隔离MySQL并发快照验证通过，审查无重要发现。见 [验证记录](../../verification/2026-10-29-layout-account-snapshot.md)。
