# GitHub画布焦点检查失败定位

日期：2026-10-31。运行：https://github.com/huahuo156/footprint-map/actions/runs/41201136339 ，提交08643b2，开发分支codex/publication-v1。

## 已确认的失败

唯一失败步骤为test:canvas-ui。npm test、安全、真实API、迁移/生命周期、构建门禁、依赖审计、真实账号E2E和十状态冒烟均成功。

失败位置scripts/canvas-ui-smoke.mjs原第133行：切换浏览器标签页后，trusted window.blur计数保持0，5秒等待超时；不是已经确认取消回滚错误，也不是所有多账号检查都失败。

## 调整

常规交互继续在无头浏览器运行（CANVAS_UI_MODE=interactions），窗口失焦测试单独运行（CANVAS_UI_MODE=window-focus，强制有窗口模式），Linux使用xvfb-run -a提供虚拟显示器。default all模式保留，非法模式启动前失败。

两轮共同保留所有原断言；窗口模式在可信blur、位置回滚、零布局写入检查后记录结果并结束当前配置，finally仍保存追踪并关闭context。输出目录/JSON/日志注明模式，不增加超时、不注入假blur、不关闭失败断言。

依据：https://playwright.dev/docs/ci#running-headed 。这说明Linux有窗口CI运行方式，不单独证明本项目Linux修复已通过。

## 本地验证及限制

默认无头四配置通过；初次把整个套件改为有窗口时，blur检查通过，但后续快捷键选择检查失败。因此拆成独立窗口专项，未将该初次尝试宣称成功。

拆分后interactions四配置、window-focus有窗口四配置均通过，lint/diff检查通过。早先本地全量尝试发生V8分配失败，以及随后Rolldown构建子测试内存分配失败（774通过、1失败），保留日志；将Rust构建线程限制为1串行复核后，87文件775项全部通过；仅为本地验证环境设置，不改变产品或CI测试断言。

Ubuntu的实际验证仍需推送后重跑GitHub Actions。不要把本地Edge通过等同于远端CI已恢复。
