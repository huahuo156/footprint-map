# 维护与监控

API 进程每小时执行一次清理，首次在启动一小时后运行。异常只记固定错误码并增加指标，不终止 API；关闭时调用 `startMaintenance()` 返回的 stop 函数。手动运行：

```sh
node scripts/maintenance.js --dry-run
node scripts/maintenance.js
```

先在隔离测试数据库验证清理和恢复，正式运行前保留数据库与上传目录备份。脚本读取现有 MySQL 环境变量及 `UPLOAD_DIRECTORY`（默认项目 uploads）。它不会创建表，请先执行数据库迁移。

维护通过同一专用 MySQL 连接持有 `shitu-maintenance-v1` 命名锁。已有维护任务时本次跳过；异常和正常退出均释放锁。多实例应使用同一数据库和同一上传存储；GET_LOCK 的作用域是 MySQL 实例，多个独立 MySQL 实例不能协调清理。

清理对象包括已过期 sessions、auth_tokens、rate_limits；资产清理复用现有回收逻辑，逐账号锁定并检查照片和封面引用，回收超过24小时的孤立登记资产与可重试 staged 资产。孤立磁盘文件只处理超过24小时且没有 assets 登记、照片引用、封面引用的以下完整文件名，其中 UUID 必须为标准 8-4-4-4-12 十六进制格式：

- `restore-<UUID>.zip`
- `restore-photo-<UUID>.jpg/png/webp`
- `cover-restore-<UUID>.jpg/png/webp`

未知文件名、目录、符号链接、新文件均保留。dry-run 仅统计预计清理数量；不会删除数据库行或磁盘文件。工作进程中断留下的文件会在24小时后被回收，正常恢复任务应受30分钟时限约束。

## 状态接口

设置独立高熵 `OPERATIONS_TOKEN`（至少32字符，建议随机生成32字节以上）；未配置或太短时 `/api/operations/status` 返回404。使用 `Authorization: Bearer <token>`；不匹配返回401。反向代理应提供 HTTPS，禁止在 URL、查询参数或访问日志中记录凭据，配置 Authorization 头脱敏。接口响应禁止缓存。

响应仅包含磁盘总量和可用字节数、达到512MiB配额90%的账号总数、当前 API 进程的固定数字指标和固定 warnings。不会返回用户ID、邮箱、令牌或资产名。数据库不可用返回503与 `status_unavailable`，磁盘状态读取失败返回 `disk_unavailable`。

`OPS_MIN_FREE_BYTES` 默认1073741824（1GiB），低于该可用空间产生 `disk_low`；`accounts_near_capacity` 表示至少一个账号达到90%配额。需要把阈值设为0时可显式配置；非法或负值使用默认阈值。

指标为每个进程内存中的累计值，重启清零，多进程应分别采集：`mail_success`、`mail_failure`、`http_requests`、`http_server_errors`、`storage_rejections`、`restore_started`、`restore_succeeded`、`restore_failed`、`maintenance_success`、`maintenance_failure`；`restore_active` 是当前活动还原数。计数器拒绝未知名称、非整数和负增量，只有活动数允许负增量且最低为0。快照只含固定名称及数字，无标签。

邮件、HTTP 5xx、维护、恢复失败计数非0分别产生 `mail_failures`、`http_server_errors`、`maintenance_failures`、`restore_failures`。这些告警表示本进程启动后曾出现失败，后续成功不会清零；应由采集系统以增量和时间窗口区分新故障，避免反复通知。多实例指标并非全局总量。

## 外部检查

将 `OPERATIONS_URL` 设为完整状态地址（例如 `https://your-host/api/operations/status`），同时设置相同 `OPERATIONS_TOKEN`，再执行：

```sh
node scripts/check-operations.js
```

无告警退出0；有告警、连接失败、10秒超时、重定向、401/404/503、无效响应均退出1。标准输出仅有成功状态与告警数量，失败日志仅固定错误码，不打印 URL、凭据或服务端原始错误。可由现有定时器或监控平台周期执行并配置告警接收方；此项目不会主动发送外部通知或邮件。

建议发布前在独立数据库演练：并行两次维护只能一个获得锁；人为制造旧孤立文件并保留一个被照片引用的同名文件，确认仅孤立文件消失；中断恢复后确认新临时文件保留、24小时后可清理；分别模拟磁盘不足、SMTP失败、HTTP 5xx和数据库中断，确认受保护接口与检查退出码符合预期。
