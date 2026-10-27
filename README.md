# 拾途 · 私人旅行手帐

用照片、文字与贴纸记录旅程，在自由画布、足迹版图和主题手札中整理回忆。支持桌面和手机、深浅主题，以及按账号隔离的私人内容。

## 功能

- **自由画布**：拖动、缩放、多选与批量编辑，照片、文字、贴纸和可嵌套折叠的色块共同排版，布局自动保存。
- **足迹版图**：使用本地中国行政区数据展示照片地点、到访统计与地点聚焦；支持城市名称、照片 GPS 和可选的高德地点搜索。
- **主题手札**：自定义封面、扉页、内页布局、书签与阅读进度；通过浏览器打印导出 PDF。
- **照片导入**：单次编辑最多 20 张，批量导入最多 500 张，分批保存；读取 JPG EXIF 日期与 GPS，支持逐张组件、滤镜和焦点。
- **备份还原**：导出当前账号的手帐 ZIP，包含展示照片、封面与布局；还原合并为新内容，重复导入会产生副本。
- **账号体系**：邮箱登录、验证、找回和修改密码；服务端会话、资源归属校验和私有图片读取。注册默认关闭。
- **示例与场景**：内置示例手帐；西湖相关照片可进入按需加载的专属 3D 场景。

当前是多账号初版，生产运行边界和升级步骤见 [运行与迁移说明](docs/operations.md)。

## 技术栈

React 19、Vite、Tailwind CSS、Three.js；Node.js 24+、Express、MySQL 8.4。MySQL 由 Docker Compose 提供；图片默认存储在本地 `uploads/`，由 API 鉴权读取。

## 本地启动

需要 Node.js 24+、npm 和已启动的 Docker（Windows 使用 Docker Desktop 的 Linux 容器）。以下命令使用 PowerShell 7。

```powershell
npm ci
Copy-Item .env.example .env
```

编辑 `.env`，设置 `MYSQL_PASSWORD` 和 `MYSQL_ROOT_PASSWORD`。已有 `.env` 时保留原配置并按示例补充字段。

```powershell
npm run db:up
```

**新空库**先迁移，再创建已由运维确认邮箱归属的账号：

```powershell
npm run db:migrate
$env:INITIAL_USER_PASSWORD = Read-Host '设置账号密码（12–128 字符）' -MaskInput
npm run db:create-user -- --email=you@example.com
Remove-Item Env:INITIAL_USER_PASSWORD
npm run dev
```

打开终端显示的前端地址，默认 [http://localhost:5173](http://localhost:5173)，用刚创建的账号登录。`APP_ORIGIN` 必须与实际浏览器来源一致。

**已有资料的数据库**先阅读 [历史数据迁移流程](docs/operations.md#历史数据迁移)，明确旧资料所属账号后再迁移。服务启动只检查迁移状态，不自动修改表结构。

## 配置

完整模板见 [.env.example](.env.example)。数据库密码、SMTP 凭据和高德 Key 仅供后端使用，禁止放入 `VITE_*` 变量。

| 配置 | 用途 |
| --- | --- |
| `MYSQL_HOST` / `MYSQL_PORT` / `MYSQL_DATABASE` | 默认 `127.0.0.1:3307`，数据库 `footprint_map` |
| `MYSQL_USER` / `MYSQL_PASSWORD` | API 的数据库凭据 |
| `MYSQL_ROOT_PASSWORD` | Compose 首次初始化数据库与本地隔离测试 |
| `APP_ORIGIN` | 浏览器来源，默认 `http://localhost:5173`，无尾部斜线 |
| `API_HOST` / `API_PORT` | API 默认监听 `127.0.0.1:3001` |
| `AMAP_WEB_SERVICE_KEY` | 可选，高德 **Web 服务** 类型 Key；未配置时仍可手动填写地点 |
| `AUTH_REGISTRATION_ENABLED` | 默认 `false`；启用前配置并验证 `SMTP_URL`、`MAIL_FROM` |
| `UPLOAD_DIRECTORY` | 可选，私有图片目录；默认 `uploads/`，迁移与运行必须一致 |
| `MIGRATION_MYSQL_USER` / `MIGRATION_MYSQL_PASSWORD` | 可选，独立迁移与建号凭据 |
| `MYSQL_SSL_CA` | 可选，跨主机 MySQL 的 TLS CA PEM |
| `TRUST_PROXY_HOPS` | 可选，按实际反向代理拓扑设置 |
| `TEST_MYSQL_ADMIN_USER` / `TEST_MYSQL_ADMIN_PASSWORD` | 隔离测试凭据，缺省使用 root / `MYSQL_ROOT_PASSWORD` |

高德请求由后端代理，Key 不下发到浏览器。照片展示文件经解码、旋转校正、缩放及去元数据处理，**不另外保存原图**；需要原图时请独立留存。地点组件仍可保存用户选择的 GPS 信息。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 同时运行 API 与 Vite，代理 `/api`、`/uploads` |
| `npm run dev:api` / `npm run dev:web` | 分别启动后端或前端 |
| `npm run build` | 生成前端 `dist/` |
| `npm start` | API 提供构建后的页面，默认 [http://127.0.0.1:3001](http://127.0.0.1:3001) |
| `npm run db:up` / `npm run db:down` | 启动 / 停止 MySQL，保留持久卷 |
| `npm run db:migrate` | 显式执行数据库迁移 |
| `npm run lint` | 静态检查 |
| `npm test` | 前端、模型和 API 边界单元测试 |
| `npm run test:security` | 身份 HTTP 测试及所有权、私有资源回归，使用数据库/邮件替身 |
| `npm run test:api` | 创建随机临时 MySQL 库和图片目录，执行真实接口集成测试后清理 |
| `npm run test:e2e` | 构建并用模拟 API 检查桌面/手机深浅主题、登录、版图和阅读器焦点 |

`test:api` 需要数据库建库权限。浏览器测试在 Windows 使用 Edge，其他平台使用 Playwright Chromium（首次执行 `npx playwright install chromium`）。截图和结果写入 `test-results/ui-smoke/`，不进入版本控制。

CI 见 [.github/workflows/ci.yml](.github/workflows/ci.yml)，在临时 MySQL 服务上执行静态检查、单元测试、安全测试、真实 API 测试、依赖审计和浏览器冒烟测试。

`server/` 的旧单用户测试和 `tests/e2e/` 的旧场景尚未统一更新账号夹具；以上 npm 命令是当前验证入口，直接运行旧测试可能触及配置中的数据库。

## 构建运行与手机访问

```powershell
npm run build
npm start
```

本地构建运行时，将 `APP_ORIGIN` 改为 `http://127.0.0.1:3001`。手机与电脑连接同一局域网时，设置 `API_HOST=0.0.0.0`，把 `APP_ORIGIN` 改为 `http://电脑局域网IP:3001`，重启 API 后从手机访问该地址。浏览器定位需要安全上下文，局域网 HTTP 下可手工填写地点。

生产环境使用 HTTPS 和 `NODE_ENV=production`，设置准确的来源、代理和数据库权限，详见 [运行说明](docs/operations.md)。

## 数据与备份

- 手帐保存在 MySQL `journal_*` 表，账号、会话和图片归属由服务端维护。
- 数据库位于 Compose 的 `mysql_data` 卷，图片位于 `uploads/` 或 `UPLOAD_DIRECTORY`。
- 界面 ZIP 只备份当前账号，上限 **64MiB**，还原后的解压总量同样受限；不支持 ZIP64。
- 完整部署备份需同时保存数据库和图片目录，并验证恢复。`docker compose down -v` 会删除数据库卷。
- 旧打卡通过显式迁移导入手帐；旧攻略、打卡、点赞等 API 返回 410，原始资料仍保留。

## 目录

```text
src/auth/         账号界面与会话状态
src/journal/      自由画布、手札、版图与导入
src/data/         离线地理数据与来源说明
src/lib/          API 客户端
server/           API、权限、图片、备份与数据库迁移
shared/           前后端共用逻辑
scripts/          迁移、建号、数据准备与验证入口
tests/            单元测试与浏览器场景
public/           示例照片、封面与 3D 场景资源
docs/             当前运行与迁移文档
```

## 数据和素材来源

- 景点数据：[China-Travel-Map](https://github.com/marksui/China-Travel-Map)，本地文件 `server/landmarks.sql`。
- 地理边界与城市中心：[地理数据来源说明](src/data/china-boundary-attribution.md)。
- 示例照片：[来源声明](public/journal-demo/ATTRIBUTION.md)。
- 手札封面：[来源声明](public/notebook-covers/Attribution.md)。
- 西湖场景：[来源声明](public/scenes/ATTRIBUTION.md)。
