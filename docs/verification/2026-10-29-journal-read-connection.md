# M1.3 第五批：完整手帐查询统一连接

提取server/read-journal.js与read-notebooks.js，两个模块不导入全局pool、auth或.env。所有12类读取均接收显式database和ownerId，包括记录/照片/标注、组成员与子组、手札/页/三类页内引用；保持原有SQL的所有权校验、排序、日期格式、封面缺省值与嵌套组展开。

运行中的普通GET已改用新查询实现的legacy包装，返回结构及数据库要求不变；notebooks.js保留readNotebooks默认包装。readJournalSnapshot额外提供完整同连接RR只读查询，将三类对象版本CAST为字符串，并返回同快照的账号结构令牌。**普通GET尚未启用版本快照；等待迁移、建号、备份和写入入口配套后统一切换。**

## 验证

3项定向用例先因模块缺失失败，提取后通过。检查全部12查询同连接、同账号，版本CAST只在新模式启用，嵌套读取失败不返回半套数据。

专用MySQL8.4容器footprint-journal-reader-7e2b7cc1，环回33317、512MiB/1CPU/tmpfs。扩展test:layout-migration的随机库：两账号、嵌套组、手札页，以及故意交叉的组成员/子组/手札引用；确认读取仍排除跨账号资料。

在真实entries读取返回之后、photos与notebooks读取之前，用另一连接在一个事务更新记录坐标/版本、照片坐标/版本、账号结构令牌和手札名；整个当前返回与原快照深比较相等，下一次读取同时看到全部新值。另验证最大无符号BIGINT精确字符串、超过2^53的版本递增，以及legacy根返回shape保持原样。

最终test:layout-migration通过；完整npm test：54文件375项通过，46.23秒。显式指向33317专用MySQL运行test:api：15项真实接口测试通过，含大备份、两账号完整图与私有资源；系统恢复演练覆盖legacy+journal、日期/JSON/BIGINT、图片哈希及失败清理，通过。所有脚本生成并清理随机临时库，不访问个人业务库。lint与diff检查通过；独立只读审查无重要发现。

结束后核对本次容器完整ID再停止，--rm/tmpfs清理专用环境。个人3307容器仍运行，未操作其数据库或卷。尚未对外推送、发布或更改生产迁移状态。
