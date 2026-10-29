# 第三方依赖与素材说明

维护者已选择 MIT 授权项目自有代码，见 [LICENSE](../LICENSE)。第三方代码、地理数据及照片保留各自条款，不因本仓库许可证而改为 MIT。此表是本地声明盘点，不是全部权利已核验的结论。

## 直接运行依赖

根据 M0 独立源码快照 `npm ci` 后的包元数据记录；精确传递依赖以锁文件为准，分发前保留对应许可证。

| 依赖 | 锁定安装版本 | 包内许可证声明 |
| --- | --- | --- |
| @tailwindcss/vite | 4.3.3 | MIT |
| argon2 | 0.45.1 | MIT |
| dotenv | 18.0.7 | BSD-2-Clause |
| express | 5.3.0 | MIT |
| leaflet | 1.9.4 | BSD-2-Clause |
| leaflet.markercluster | 1.5.3 | MIT |
| lucide-react | 1.34.0 | ISC |
| multer | 2.5.0 | MIT |
| mysql2 | 3.24.6 | MIT |
| nodemailer | 10.2.1 | MIT-0 |
| react | 19.2.8 | MIT |
| react-dom | 19.2.8 | MIT |
| react-leaflet | 5.0.0 | Hippocratic-2.1 |
| react-router-dom | 7.18.2 | MIT |
| sharp | 0.35.5 | Apache-2.0 |
| tailwindcss | 4.3.3 | MIT |
| three | 0.149.0 | MIT |

`react-leaflet` 声明为 Hippocratic-2.1，并非 MIT；不能将其表述为普通 MIT 依赖。发布前需阅读该版本随附条款并记录分发条件。Sharp 的原生依赖也有各自声明，需随产物保留相关 notices。

## 静态素材与数据

| 路径 | 已有来源 | M0 核查状态 |
| --- | --- | --- |
| `public/journal-demo/` | [来源记录](../public/journal-demo/ATTRIBUTION.md)，来自 China-Travel-Map | 来源可追溯，但现有文件未提供逐图授权依据；公开分发前核实或替换 |
| `public/notebook-covers/` | [Unsplash 来源记录](../public/notebook-covers/Attribution.md) | 已有逐图链接与许可说明，保留原声明；非项目 MIT 素材 |
| `public/scenes/` | [OSM、地形数据记录](../public/scenes/ATTRIBUTION.md) | 需随分发保留来源与适用的数据许可 |
| `src/data/china-*.json` | [DataV 来源记录](../src/data/china-boundary-attribution.md) | 已记录来源，尚需核实离线再分发条件 |
| `server/landmarks.sql` | README 记录的 China-Travel-Map | 需核实数据分发依据 |

## 公开发布前仍需处理

- 核实祖先项目中沿用的代码、景点资料和示例照片的授权，不能仅因仓库公开就推定允许再授权。
- 未核实的照片可以替换为原创或明确允许分发的样例，但应单独处理并更新相关测试、署名和截图。
- 已知来源、逐文件许可、修改说明和随产物分发要求应保留；本次不删除或替换既有素材。
- 许可证变更不代表生产部署、公共注册或素材合规已经验收。
