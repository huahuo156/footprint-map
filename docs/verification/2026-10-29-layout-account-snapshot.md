# M1.3 第四批：账号令牌与一致性读取基础

新增 `server/layout-session.js`，不导入全局pool或.env。提供两个借用数据库池连接的服务，均在成功时commit、失败时rollback、最终release：

- createLayoutUser：插入账号与journal_layout_state在同一事务内；只接受上层已经验证的邮箱、passwordHash及验证时间，返回账号ID和字符串结构版本0。调用前复制标量和Date，避免等待连接时输入改变。
- readLayoutSnapshot：显式设置REPEATABLE READ，启动WITH CONSISTENT SNAPSHOT、READ ONLY事务；先读取账号结构令牌，再把同一连接和账号ID交给reader。reader必须使用该连接查询所有业务资料并执行所有权过滤。返回的结构令牌由服务读取，不允许reader覆盖。

**集成边界：现有注册、CLI建号、journal/readNotebooks和GET路由尚未切换。** 当前只验证通用服务及其真实数据库行为，不声称现有GET已经具备整体快照一致性。实际接入还需迁移入口、系统备份目录及其他布局/结构写入配套。

## 验证

5项单元测试先因模块缺失失败，实现后通过；覆盖同连接原子建号、令牌插入失败回滚、事务模式与精确版本、缺令牌不调用reader、reader异常释放。

真实数据库验证扩展既有test:layout-migration脚本：专用MySQL8.4.11容器 `footprint-layout-session-23238eb3`，环回33317、512MiB/1CPU/tmpfs。随机库中创建账号时同时生成令牌；重复邮箱拒绝；临时重命名令牌表后建号失败，确认账号行也不存在，随后恢复测试表。

读取验证先把池连接的会话默认隔离设为READ COMMITTED。快照reader第一次读取后，由另一连接在同一事务更新结构令牌与照片坐标/版本；快照第二次读取仍与第一次完全一致，返回旧令牌。下次快照同时看到新令牌和新布局，验证不混合新旧结果。另验证只读事务写入被ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION拒绝、超过2^53结构版本精确返回，以及缺令牌503且不自动建行。

最终隔离数据库脚本、lint、diff检查通过；完整npm test为53文件372项通过，44.73秒。本轮不修改前端行为，未重复浏览器测试。独立只读审查未发现重要问题。核对本次容器完整ID后停止，--rm/tmpfs清理专用环境；个人3307容器仍运行，未操作其资料或卷。
