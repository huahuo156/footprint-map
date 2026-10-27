# 全系统恢复点与隔离恢复演练

这是维护窗口备份：必须先停止 API、所有 restore worker、定时清理任务及其他会写数据库或图片目录的进程，再执行创建命令，直至备份完成后才能恢复服务。`--offline` 是操作者对这一条件的明确声明；脚本会在导出前、导出后和复制完成后探测 `API_HEALTH_URL`，默认 `http://127.0.0.1:${API_PORT:-3001}/api/health`。收到任何 HTTP 响应（包括 503）都拒绝创建；超时、TLS、DNS 等探测错误也拒绝，只有连接明确被拒绝才接受。健康探测无法证明远程 worker 或其他客户端已停止，必须人工完成停写。此流程不提供在线原子快照保证。

备份包含当前项目所有表的所有行：账号、会话、验证/重置令牌、限流记录、所有账号的 journal、旧 landmarks/checkins/guides/likes、迁移标记，以及整个上传目录中的实际 jpg/png/webp 文件，包括未注册图片。不会打包 `.env`、应用源码或数据库凭据。目录出现其他文件、目录或符号链接时会失败；已登记或引用但不存在的本地图片也会失败。未知表、未知列会拒绝导出，应先更新本地受控恢复 schema，不能静默遗漏数据。

在项目根目录执行（先创建父目录；输出目录必须尚不存在且位于 uploads 之外，推荐仓库和所有 Web 静态目录之外）：

```powershell
node scripts/system-backup.js --offline --out C:\PrivateBackups\footprint-20261027
node scripts/verify-system-backup.js C:\PrivateBackups\footprint-20261027
node scripts/restore-drill.js C:\PrivateBackups\footprint-20261027
```

创建使用 `MYSQL_*` 配置连接原库，只读查询数据，不写账号/业务表。可只给备份账户源库的 SELECT 权限。导出统一 UTC；DATE/DATETIME/TIMESTAMP、JSON、BIGINT 和 DECIMAL 导为字符串，避免 JavaScript 时间转换和大整数精度损失。备份保留密码哈希、会话和令牌，属于敏感数据。POSIX 新目录/文件分别使用 0700/0600；Windows 取消新备份目录继承权限，只授予当前用户 SID 的完整权限，子文件继承该权限。权限配置失败时创建失败。临时演练图片也只进入本进程新建的系统临时目录。异地副本及磁盘应使用操作系统或存储工具加密，并保存恢复时所需的同一版本项目源码；本工具不提供加密。

`manifest.json` 列出 `database.json` 和每张图片的字节数及 SHA-256；`manifest.sha256` 校验清单本身。校验会拒绝缺文件、多余文件、篡改、重复条目、路径穿越和链接。SHA-256 用于发现意外损坏，不证明备份来源；有权同时修改清单与数据的人可以重新计算哈希。需要可信来源时应另存清单哈希或使用外部签名/不可变存储。

恢复演练使用 `TEST_MYSQL_ADMIN_USER` / `TEST_MYSQL_ADMIN_PASSWORD`，缺省 root / `MYSQL_ROOT_PASSWORD`，连接主机端口同 `MYSQL_HOST` / `MYSQL_PORT`。该账户需要创建和删除演练库的权限。目标名称由脚本随机生成，严格限定 `footprint_restore_drill_` 加 24 位十六进制字符，不接受目标库参数；不会使用 `MYSQL_DATABASE` 作为写入目标。演练前先完整校验备份，再创建随机库和系统临时图片目录。只执行本地 `server/*schema.sql` 与固定 ownership 外键结构；备份携带的数据仅经允许的表/列及参数化 INSERT 写入，不运行备份 SQL、不关闭外键检查。按依赖顺序恢复后，逐表比较行数和每行字段数据，重新核对复制后的图片哈希。成功与失败路径都会删除本次创建的演练库与临时图片目录。删除失败则命令失败，不报告清理成功。数据库连接异常或进程被强制终止可能遗留随机演练资源，需管理员在确认名称和归属后处理。

此处不提供写回生产数据库的恢复命令。真实事故恢复必须另行制定停机、权限、版本及切换方案；不要把演练库当成在线业务库。

自动化验证：

```powershell
npm test -- tests/system-backup.test.js
node scripts/restore-drill.js --integration
```

集成验证也可以在 `test:api` 中 `await import('./restore-drill.js').then(({ runSystemBackupIntegration }) => runSystemBackupIntegration())`。它自动新建严格随机前缀的源夹具库，在隔离子进程中调用真实 initializeDatabase、auth schema 和 migrateOwnership；覆盖两个账号、22 张表非空数据、旧数据与 journal、手札封面/内页/三种内页关系、分组嵌套与照片关系、毫秒时间/日期、嵌套 JSON、超出 JS 安全整数范围的 BIGINT、实际 PNG、未登记图片、恢复成功与外键失败的清理。测试结束删除源夹具库、恢复库及临时文件，不向个人数据库写入。建议先在独立 MySQL 测试实例上执行；不会借用现有源库进行写测试。
