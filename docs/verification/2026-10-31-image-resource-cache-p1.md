# P1 会话图片资源池核心验收

日期：2026-10-31。范围：P1 第二子批次，交付 `src/journal/images/imageResourceCache.js` 的纯调度核心与专项测试；尚未接入 React/画布，尚未使用 `fetchPrivateMedia` 作为默认适配器。

## 已实现

- `createImageResourceCache({scope,limits,fetchMedia,decode,clock})`
- `acquire({src,priority,role})` 返回 `getSnapshot/subscribe/release` 租约；`role` 区分 `display/prefetch`
- 同 key 共享一次 fetch；display 只在需要时创建 objectUrl 并安排 decode；prefetch 不创建 URL、不主动 decode、不占显示名额
- 字节/条目预算、LRU、deferred、last-consumer 取消、invalidate/dispose
- 可注入 `fetchMedia/decode/clock`，当前生产接入仍走既有图片路径

## 验证

- `npm test -- tests/image-resource-cache.test.js`：8 项通过
- `npm test`：71 个文件、633 项全部通过
- `npm run lint`：通过，0 warnings 0 errors
- `npm run test:security`：12 项身份测试 + 5 个安全专项测试套件共 23 项通过
- `npm run check:bundle`：生产构建与分包预算通过

## 边界

- 未实现 React Provider / `useImageResource`，也未接入 `JournalImage`。
- 未做共享重试退避、媒体代际失效、前台校验、TTL。
- 不能据此宣称画布重复请求或内存压力已改善；该结论必须等 P3/P4 A/B。

## P1 核心加固（2026-10-31 续推）

- Ruling：保留 codex/publication-v1 上上一轮未提交的资源池代码，在原工作区继续；本轮先修复调度不变量，再进入 React 接入，不重置或提交他人改动。
- RED：新增测试复现并发队列不续跑、旧 decode 污染重新取得的显示租约、dispose 后晚回执导致负数计数，以及完成响应的 Blob 与预留字节重复计费。
- GREEN：任务完成自动续跑；每次启动前校验 resident + reserved 预算并淘汰无引用 LRU；在发布 ready 前转移响应预留；decode 绑定具体显示任务身份；关闭后的异步回执不再更新计数。
- 专项：13 项通过；lint、生产构建及构建后的分包门禁通过。构建仍有既有地图/场景大分包提示。
- 全量回归：71 个文件、638 项通过；独立审查结论见下文。P1 仍不是完整验收：队列与显示/解码工作集硬上限、优先级退让、共享重试，以及 P2 会话/硬 TTL/React 接入未完成。以上不得用这 13 项测试替代。

独立只读审查：本轮队列续跑、字节预留转移、decode 任务身份和关闭后计数修复未发现新增重要问题。审查同时确认前序核心仍有待办：maxEntries 对持有租约的项尚非硬约束；closeResource 从 Map 移除后，外部仍持有的租约闭包可能继续引用 resource.blob，计数归零不能作为 Blob 引用已释放的证据。这两项需在 P1 完整验收及 P2 接入前解决。本轮未启用生产缓存路径。

## 条目硬上限与关闭引用清理（2026-10-31 续推）

- 已修复上轮审查的两项遗留：关闭资源在通知前清除 Blob/pending 引用，并在通知后清理租约与订阅；释放已关闭租约幂等，不再修改显示计数。
- 条目预算按 resident Blob + 在途 fetch 预留计算，启动请求前检查；满额时只淘汰无引用 LRU，全部被租用则等待释放。maxEntries 限制的是压缩资源与在途槽位，不宣称待处理元数据队列已有限额。
- 即使适配器暂不响应 abort，也保留其在途槽位直到实际回执，避免错误声称应用并发/内存预算已释放。
- 独立审查发现关闭通知中重新申请可能使 live Map 失效遍历反复关闭新资源。新增失败测试后改为遍历初始目标快照，回归通过。
- 专项 18 项通过；lint 通过。最终全量回归：71 文件、643 项通过；生产构建、构建后的分包门禁及 diff --check 通过。
- 边界：只能清除资源池自己持有的引用，不能撤回消费者此前保存的 Blob 快照或保证浏览器立即回收内存。队列/显示/解码工作集硬上限、优先级和共享重试仍待完成；尚未接入 React 或启用画布缓存。

验证过程保留：前一次全量运行在 place-search-api.test.js 出现 2 项 fetch bad port 失败，该文件使用 app.listen(0) 分配随机端口；属于端口环境偶发的判断，未修改测试或产品代码。该文件单独复跑 4 项通过，最终完整 npm test 643 项通过。构建仍有既有地图/场景大分包提示。
