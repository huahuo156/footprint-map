# M1.3 标注写入版本保护

本批修改 `server/journal.js` 的 POST/PUT/DELETE marks，共享 `lockLayoutStructure` / `lockLayoutObjects` 并复用既有事务包装器。事务先锁账号，再锁结构行和标注对象；创建/删除使结构令牌递增，旋转变化使行版本递增，纯内容修改保持行版本。携带版本的 PUT 必须同时携带结构及对象版本，过期返回 409，跨账号/缺失返回 404。异常由事务包装器统一回滚。

验证结果：

- 新增 HTTP 回归共 10 项；先观察到缺少版本检查/事务导致的 9 项失败，接入后全部通过（纯内容保持行版本用例原先已通过）。
- 全量 Vitest：57 文件、399 项通过。
- 安全专项：12 项认证测试及 21 项专项通过。
- 隔离 MySQL API：16 项通过，新增并发更新、内容编辑、legacy 写、跨账号、陈旧结构删除拒绝，以及 CHECK 约束强制失败后的内容/版本回滚。
- 系统恢复演练：新旧结构、精确版本令牌、图片和失败清理通过。
- test:e2e：生产构建及桌面/手机 2 项通过。
- check:bundle、lint、git diff --check 通过；保留既有可选地图包体积与 CRLF 提示。
- canvas-ui-smoke：4 配置通过，产物位于 `test-results/canvas-ui/run-1793324499778`。首跑随机端口 6697 被浏览器拒绝（ERR_UNSAFE_PORT），重跑通过，未改变脚本。
- 独立只读审查：覆盖三个标注路由、共享锁工具语义、HTTP 与真实 API 新测试，未发现重要的正确性、安全或死锁问题。

环境：专用 MySQL 8.4 容器 footprint-marks-local-20261030，ID b8dec60fdee47d6ed8df5b0ca518debde6fe39a4ba2b71707f6e0d2624fd0d9a，环回 33319，512MiB/1 CPU/tmpfs。测试脚本创建并清理随机库，未使用个人 3307 数据库。

结束时核对完整容器 ID 后停止专用容器，并确认个人 3307 容器仍运行。最初拉取 docker.io/mysql:8.4 后中断，最终使用本地已有 public.ecr.aws/docker/library/mysql:8.4 镜像启动专用服务。

边界：其他写入口、GET 版本快照及 PATCH 条件布局尚未统一切换，前端仍为现有行为。本批不表示完整并发保存或撤销 UI 已上线。没有推送、部署或生产迁移。
