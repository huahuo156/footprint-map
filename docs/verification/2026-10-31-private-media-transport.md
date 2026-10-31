# P1 私有媒体传输层

日期：2026-10-31。范围：缓存计划P1的传输子批次，尚未启用缓存。

- `src/lib/privateMedia.js` 仅接受现有 `/uploads/<filename>.jpg|png|webp` 与固定 `?thumbnail=1`，统一请求缩略图；拒绝外域、任意查询、路径穿越及SVG。
- fetch使用same-origin credentials、no-store和redirect:error；默认2MiB/10秒，读取流时累加实际字节；MIME仅允许WebP/JPEG/PNG，拒绝空body。
- 请求前、头后及每次读取body后检查API代际。reset立即取消；超时/取消即使底层忽略AbortSignal也及时拒绝；读取器及监听器在结束时清理。
- 401沿用账号失效事件和会话清理；404/503保留状态供未来资源池处理，本层不重试、不回退原图。
- `api.js`增加只读epoch及同步reset订阅；同账号重新accept同样变更epoch。订阅异常隔离，通知按快照进行。

验证：新增测试最初因实现模块缺失而失败，随后26项专项通过。全量 `npm test`：69文件617项通过，63.19秒，退出码0。`npm run lint`无警告；`npm run build`与`npm run check:bundle`通过（保留既有地理模块大分包提示）。`git diff --check`无空白错误。日志保存在 `.superpowers/private-media-full-tests.log`。

边界：不含decode/资源池/TTL/Provider/实际HTTP双账号E2E，当前画布仍走既有图片路径。本批不能证明请求减少或500张编辑性能提升。下一步实现P1资源池的合并请求、预算预留、租约、LRU与解码生命周期。
