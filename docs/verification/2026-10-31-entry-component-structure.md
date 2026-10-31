# 记录与照片组件结构版本修复验收

## 范围

修复以下遗漏：照片或记录组件中的旅程、日期变化现在会递增画布结构版本，避免旧页面继续使用过期结构令牌写入布局。

- `server/journal.js`：`/photos/components` 与 `saveEntry` 现在会在组件物化后的旅程/日期发生变化时递增 `structure_version`。
- 新增 `tests/entry-component-structure.test.js`，覆盖照片与无照片记录的结构版本行为。
- 扩展 `tests/photo-layout-routes.test.js`，补充照片组件结构版本回归。
- 更新 `docs/layout-protocol.md` 与 `CHANGELOG.md` 说明该边界。

## 验证

- `npm run lint`：通过，0 warnings 0 errors。
- `npm test`：70 个文件、625 项全部通过。
- `npm run test:security`：12 项身份测试 + 5 个安全专项测试套件共 23 项通过。
- `npm run check:bundle`：生产构建与分包预算通过。
- 未运行真实数据库 E2E 或浏览器冒烟测试；本次变更不涉及前端渲染。
