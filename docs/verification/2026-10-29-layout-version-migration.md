# M1.3 第二批：布局版本迁移基础

实现 [迁移实施计划](../superpowers/plans/2026-10-29-layout-version-migration.md)，依据已确认的保存设计。新增 `server/migrate-layout-versions.js`，导入无数据库副作用，调用者显式提供 connection：

- `migrateLayoutVersions`：三类对象增加非空、无符号 BIGINT layout_version 默认0；建立账号结构令牌表并补已有账号。保留所有坐标与已有非零版本，最后写迁移标记；命名锁保护并在失败时释放，DDL可重试。
- `assertLayoutVersions`：只读取标记、列定义、表引擎、主键、完整单列外键和缺失账号行；不静默修复错误结构或缺失行。

**集成边界：本批尚未接入 db:migrate、服务启动、建号及布局API。** 现有产品行为不变，不能宣称已有请求版本保护；后续需要协调新账号令牌初始化、全部布局/结构写入口及系统备份目录后再切换运行入口。迁移模块不是单独部署说明。

## 验证证据

首次单元执行因模块缺失而失败，新增实现后通过。真实驱动使用大整数字符串配置时，锁结果可能为字符串，新增 `0`、`"0"`、null 三种失败用例；`"0"` 观察到失败后改为精确数字判断。首次数据库脚本的 IS_FREE_LOCK 断言也因字符串/数字差异失败，已按返回类型修正，没有忽略失败。

独立审查发现复合外键可绕过旧检查；在真实 MySQL 中预建 `(owner_id, owner_email) → users(id,email)`，观察到“本应拒绝却通过”的失败。修改为检查全部外键成员、同库引用、单列owner_id→users.id及CASCADE规则，再次通过。

专用容器 `footprint-layout-migration-0efe589e`，MySQL 8.4.11，仅环回33317，512MiB内存、1CPU、tmpfs临时数据库目录。每次脚本生成随机 `footprint_layout_test_<24 hex>` 库，finally校验名称后删除；未读取 `.env` 或使用应用pool。原有个人容器仍运行在3307。

`npm run test:layout-migration` 要求显式 LAYOUT_TEST_MYSQL_PORT/PASSWORD，新增CI步骤使用CI临时MySQL服务。验证空库、已有行升级、重复迁移、模拟部分DDL后恢复、超过2^53的版本保留、错误对象/结构版本列拒绝、复合外键拒绝、释放锁和readiness不补缺行；最终退出0。

最终 `npm test`：51文件354项通过，43.35秒。定向6项通过；lint与diff检查通过。本批没有修改前端业务，未重复运行浏览器。新增CI配置尚未推送或取得远程运行结果。

结束时核对本次容器完整ID，再停止该容器；--rm与tmpfs清理专用环境。已确认个人3307容器仍在运行，未操作其卷、凭据或业务资料。
