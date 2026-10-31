# M1.3 布局版本迁移 Implementation Plan

> 使用 executing-plans 原地继续已确认设计，不操作个人数据库。本批完成显式迁移模块与验收入口，暂不接入产品启动或写接口。

**Goal:** 为后续版本协议建立可重复、可恢复的对象版本与账号结构令牌。

**Architecture:** 独立迁移函数接收调用者的 MySQL connection；只允许显式调用，不在导入时建连接。三类对象各有 BIGINT UNSIGNED layout_version；账号令牌表使用 owner_id 主键及外键。

**Tech Stack:** 现有 Node ESM、mysql2、Vitest、MySQL 8.4。

**Spec:** [已确认设计](../specs/2026-10-29-canvas-history-save-design.md)。版本字符串、请求协议与坐标写入口升级是后续实施批。

## Global Constraints / Review Focus

- 坐标及已有版本不可被迁移覆盖；版本必须无符号、非空、默认0。
- 使用数据库命名锁串行迁移，锁失败不写入，异常仍释放锁；DDL隐式提交，逐项可重复。
- 发现已有同名列/表的定义不符合预期时明确拒绝，不自动修改或截断已有数据。
- 新表 owner_id 与 users(id)关联；已有账号补0，不覆盖现存结构令牌。
- readiness仅检查不修改；新账号初始化与运行入口切换留给后续集成。

### Task 1: 迁移模块与真实数据库验证

Files: `server/migrate-layout-versions.js`、`tests/layout-version-migration.test.js`、`scripts/test-layout-version-migration.js`。

Interfaces: `migrateLayoutVersions(connection)`、`assertLayoutVersions(connection)`。前者在显式调用时迁移，后者只检查列、表、外键与缺失账号行。无副作用导入、无全局pool。

- [x] 先写替身边界测试，观察缺模块失败；覆盖锁失败、错误列类型、finally释放与readiness缺标记。
- [x] 实现迁移、读取检查；列/表均先检查定义，合法再继续，最后写 journal_migrations 标记 layout-versions-v1。
- [x] 增加真实数据库验证脚本：随机临时库、原项目schema、两个账号和布局样本；测试升级、重复执行、部分完成后重试、已有非零版本保留、错误定义拒绝、只读检查。
- [x] 专用MySQL 8.4容器在环回33317运行，和个人3307容器隔离；测试库由脚本创建清理，结束只移除本次专用容器。
- [x] 定向/全量测试、lint、数据库脚本均通过，记录结果及尚未接入运行时的边界。已有其他未提交文件不自动提交。

Pre-flight: 本批只有一项，无任务间共享接口；后续调用方需要先迁移再初始化账号令牌。

Task 1: complete。6项定向、354项全量与隔离MySQL验证通过；独立审查的复合外键问题已复现修复。见 [验证记录](../../verification/2026-10-29-layout-version-migration.md)。
