# M1.3 条件布局写入 Implementation Plan

> executing-plans 延续已确认的设计。只实现独立服务，暂不切换运行路由，防止尚未初始化令牌的账号访问失败。

**Goal:** 实现拥有事务边界的整批条件写入和严格同值重试。

**Architecture:** `writeLayout(connection, authenticatedOwnerId, payload)` 自行 begin/commit/rollback，不管理连接池或释放连接。先锁账号令牌，再按kind+id排序锁所有对象，所有验证完成后才统一更新。版本通过CAST AS CHAR读取、BigInt计算、字符串返回。

**Tech Stack:** 现有 Node ESM/mysql2/Vitest/MySQL8.4，无新增依赖。

**Spec:** [已确认设计](../specs/2026-10-29-canvas-history-save-design.md)。

## Global Constraints / Review Focus

- items为1–500项，坐标/旋转沿用现有范围，重复ID大小写归一后拒绝；三类kind固定映射白名单表。
- 新请求所有对象携带expected_version和账号expected_structure_version；旧无版本调用允许，但仍增版本。
- 冲突409 LAYOUT_CONFLICT；无所有权对象404，不暴露他人数据；缺账号令牌503，禁止隐式建行。
- 同值重试全批都必须是expected+1且坐标/旋转相同，照片必须已绝对定位；混合新写与重试拒绝。
- 大整数精确；版本达到无符号64位上限时拒绝继续写，不能溢出。
- SQL中途失败回滚先前已更新行；同账号并发由结构行锁和对象行锁串行。

### Task 1: 条件写入服务与数据库验证

Files: `server/layout-versions.js`、`tests/layout-protocol.test.js`、`scripts/test-layout-protocol-cases.js`，扩展现有隔离迁移脚本调用协议验收。

- [x] 先写验证缺模块失败的测试，再实现writeLayout接口；覆盖正常写、同值重试、不部分写、非法请求、缺失所有权。
- [x] 真实MySQL验证：新写/重试、混合批次冲突、跨账号、结构变化、大整数、两连接不同值竞争和同值重放、entry/mark批量写、SQL CHECK失败回滚及最大版本拒绝。
- [x] 定向/全量测试、lint与隔离数据库脚本通过；独立审查后修复重要问题，更新记录。

本批仅服务层，不宣称运行中的PATCH /layout已有条件写入。下一批需一致性读取、建号/迁移入口接入及其他坐标/结构写入升级。

Task 1 complete：13项单元、367项全量及隔离MySQL验证通过，独立审查无重要发现。见 [验证记录](../../verification/2026-10-29-layout-conditional-write.md)。
