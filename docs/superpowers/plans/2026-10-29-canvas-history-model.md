# M1.3 历史模型 Implementation Plan

> **For agentic workers:** Use `executing-plans` 在当前会话实现。用户已确认总设计，沿用当前执行方式，不再次索要同一设计批准。

**Goal:** 实现可测试、不可变的布局命令历史，为保存协调器提供撤销/重做目标。

**Architecture:** 新增纯函数模块，不接网络或 DOM。历史记录和持久化版本分离；当前批次不暴露尚无版本保护的撤销按钮。

**Tech Stack:** 现有 JavaScript ESM、Vitest，无新增依赖。

**Spec:** [已确认设计](../specs/2026-10-29-canvas-history-save-design.md)。本计划覆盖其第一项交付；后续继续版本迁移/API、协调器、UI 和真实 API 验收。

## Global Constraints

- 单命令最多 500 个对象；历史最多 100 条；对象键为 kind+id。
- 支持 photo/entry/mark；不接入手帐、删除、导入、组结构历史。
- before/after 同一对象集合；保留位置和旋转，空变化不入栈。
- 不修改现有布局接口、数据库或其他未提交工作；当前分支 `codex/publication-v1` 原地继续。

## Review Focus

- 用户修改输入数组/对象不能改变已有历史（Task 1）。
- 非法命令不能部分进入历史或清除 redo（Task 1）。
- 一次组移动的所有成员同时撤销/重做（Task 1）。
- 空命令保留 redo 分支，真正新编辑截断 redo（Task 1）。
- 连续超过 100 条操作仍能恢复到保留窗口的正确边界（Task 1）。

### Task 1: 不可变布局历史

**Files:** Create `src/journal/canvas/history.js`; Test `tests/canvas-history.test.js`。

**Interfaces:**
- `createHistory() -> { past: Command[], future: Command[] }`。
- `recordHistory(history, { id, before, after }) -> History`：归一化 rotation 缺省 0，按 before 顺序配对，过滤未变化对象，保存独立冻结快照；最多保留最后 100 个 command。
- `undoHistory(history) / redoHistory(history) -> { history, items }`：不可用时返回原历史和空 items；可用时 items 分别为 before/after。返回快照只读。
- 命令 id 和对象 id 为非空字符串；kind 枚举；x/y 为有限 Number，范围 [-1e7,1e7]；rotation 范围 [-20,20]。不匹配、重复、超限或非法数值抛 TypeError，不改变输入历史。

- [x] 写测试：单条与两成员批量、重新排序的 after、按 kind 区分同名 id、无变化过滤、空撤销、分支截断、101 条边界、输入快照隔离、只读返回、非法集合与坐标边界。
- [x] 运行 `npm test -- tests/canvas-history.test.js`，确认缺少实现导致失败；记录实际失败。
- [x] 实现上述四个纯函数，不导入 React、model 或 API。
- [x] 定向测试和 `npm test` 全部通过；`npm run lint`、`git diff --check` 通过。Expected：0 failures，实际数量写入执行记录。
- [x] 复核整个模块的逻辑和测试覆盖，更新执行记录；本批保留工作区供后续协议改造，不自动提交已有其他改动。

## 执行记录

Pre-flight: no shared interfaces（本批只有一项；后续协调器依赖上述四个接口）。

Ruling: Windows 环境用 PowerShell 管理同格式的逐计划 ledger，避免依赖 Bash；沿用已有功能分支和本会话未提交改动，不新建会遗漏前置改动的 worktree。用户确认设计视为继续执行授权，不重复询问实施方式。

Task 1: complete。最终定向22项、全量50文件348项通过；lint通过。独立审查仅指出稀疏数组绕过校验，已补失败测试并修复。见 [验证记录](../../verification/2026-10-29-canvas-history-model.md)。下一实施批为布局版本与结构令牌协议，历史尚未接UI。
