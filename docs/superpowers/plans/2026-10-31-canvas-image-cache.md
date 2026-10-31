# 数百张图片画布缓存层计划书

> 使用executing-plans逐项TDD执行，仅在末尾进行一次独立代码审查。用户已要求继续按计划推进，P0已完成，当前推进P1核心；缓存尚未接入产品，不授权部署或读取个人图片。

**目标：** 500张照片画布流畅编辑，2000张作压力档，优先桌面、兼顾平板；用户已确认这一规模和设备方向。

**方案：** 保留服务端私有缩略图磁盘缓存，新增有界的浏览器账号会话资源池，配合视口驻留/低倍概览和尺寸批量提交。缓存重复资源，限制同时显示和解码的资源，不把500张照片全部长期放入解码内存。

**技术栈：** 现有React、浏览器Fetch/Blob/Image、Vitest、Playwright、Express/Sharp；第一期不增加依赖、Redis、Service Worker、数据库字段或新渲染器。

**设计依据：** [详细设计](../specs/2026-10-31-canvas-image-cache-design.md)。资源预算已按[P0报告](../../verification/2026-10-31-canvas-image-cache-p0.md)冻结为首轮验收值；概览表现仍需样例审阅，不沿用上一批579项测试证明本方案达标。

## 一、为什么现在需要这一层

已有server/thumbnails.js负责512px派生图、磁盘命中与鉴权，JournalImage负责lazy/async和失败重试。当前缺口是前端重复挂载时缺乏统一资源复用、没有应用内存/请求并发预算，以及缩小到概览后可能同时挂载大量图片。单独增加一个无限Map或浏览器持久缓存，会把网络压力变成内存压力，不能单独解决数百张画布。

本计划交付三个相互配合的部分：**资源池减少重复请求，驻留规划限制活跃图片，尺寸缓存减少重复布局计算**。完整业务与碰撞模型保留，不能为省内存删掉视口外对象或破坏500项原子布局保存。

## 二、全局约束与实施边界

- 私有HTTP继续private,no-store，每次真实网络请求先鉴权；会话显示资源不落IndexedDB/Cache API/Service Worker，不改公开URL。
- 不缓存大图/打印；演示与本地上传预览保持原生命周期，不回收其他模块的Object URL。首期只接画布及其分组封面。
- 本地会话失效必须清理旧资源；同账号重新确认也重置资源scope，但不能重挂载整个编辑器而丢失未保存布局。
- 桌面建议编码预算24MiB、解码估算64MiB、48个实际img、4并发fetch、2并发主动decode；平板分别12/32MiB、24个img、2/1并发。完整预算与TTL/退化规则以设计稿第4–6节为准。
- 同一环境串行测试、每次只保留必要浏览器/服务；缓存自身必须有条目、字节、在途预留、解码消费者计数和可观察的关闭状态。
- 现有工作区有大量未提交成果，原地续接并保留归属，不自动提交全部内容，不推送或部署。真实API只用随机隔离数据库和合成照片。

## 三、文件与接口分工

| 文件（拟新增/修改） | 责任与固定接口 |
| --- | --- |
| `scripts/canvas-image-performance.mjs`、`tests/fixtures/canvas-images.js` | 生产构建的100/500/2000独立媒体URL夹具、固定相机路径、cold/warm/回访报告；夹具只用合成素材 |
| `src/journal/images/imageResourceCache.js` | 纯调度/状态机、共享任务、租约、字节预留、LRU和销毁；`createImageResourceCache({scope,limits,fetchMedia,clock})`，返回acquire({src,priority,role})/invalidateSources/dispose/getStats |
| `src/lib/privateMedia.js` | 同源/uploads网络读取、session guard、流式大小上限/超时/401；`fetchPrivateThumbnail(src,{signal,guard,maxBytes})`返回`{blob}`，只接固定缩略图变体 |
| `src/lib/api.js` | 增加`getApiSessionEpoch()`与`subscribeApiSessionReset(listener)`，不改变现有API调用约定；reset通知不能因一个监听器异常而阻断其他清理 |
| `src/journal/images/ImageResourceProvider.jsx`、`useImageResource.js` | 账号/API/media代际资源scope、React租约订阅、StrictMode和同账号重新accept；关闭旧scope而不重挂载JournalPage |
| `src/journal/canvas/imageResidency.js` | `planImageResidency({model,groups,camera,viewport,previous,pinnedIds,limits})`返回`{detailIds,imageIds,prefetchIds,overviewCells}`；世界边界相交、预算、稳定排名与交互节点保留 |
| `src/journal/canvas/imageDimensions.js` | 账号/源/媒体代际尺寸表；`record(key,{width,height})`、`flush()`、`invalidate(keys)`、`dispose()`；每帧至多一次批量通知 |
| `JournalImage.jsx`、`CanvasItem.jsx`、`JourneyCanvas.jsx` | 可选资源策略接入、实际img租约与尺寸批量更新、概览/驻留消费；没有provider或开关关闭时走既有路径 |
| `docs/verification/*`、现有浏览器/E2E测试 | 基线、A/B原始样本、内存和请求计数、私有边界、回退及已知限制 |

`scope={ownerId,apiEpoch,mediaEpoch}`；`acquire({src,priority,role})`的role为display/prefetch，租约为`{getSnapshot,subscribe,release}`，快照状态deferred/queued/loading/ready/error/closed。display的ready包含objectUrl/width/height；prefetch只取得Blob，不创建可渲染URL/主动解码。stats包含residentBlobBytes、reservedFetchBytes、entryCount、activeFetch、activeDecode、queuedKeys、activeDisplayLeases、objectUrlCount、hit/miss/abort/evict计数。一个实际img必须对应一个display租约，名额先预留，实际DOM图片数另测；统计不泄露私有路径，只用匿名夹具ID。

## 四、阶段任务与完成标准

### P0：建立基线与冻结预算（首个执行批次）

- [x] 在`tests/fixtures/canvas-images.js`生成100/500/2000张**不同URL和不同内容**的横竖缩略图及对应布局、文字、两层嵌套/折叠组。每个案例记录源尺寸/字节、总对象、视口候选和实际img数，不使用一张URL复用500次的假负载。
- [x] `scripts/canvas-image-performance.mjs`只消费生产构建和隔离夹具，固定路径：冷开→平移A/B→返回A→低倍全局概览→F局部定位→拖动/撤销→折叠展开→空闲。已实现独立压力循环和runtime清理；已完成正式60例和600.58秒独立压力段。
- [x] 首先对未改缓存的基线测量，不改运行产品逻辑：request/bytes、同时请求峰值、img/DOM数量、rAF帧间隔、长任务、model/React提交、JS heap与页面/进程内存。真实服务端冷/热派生图另测，不与完全模拟API的浏览器结果混算。
- [x] 每档至少5次，桌面1440×1000/平板1024×844及深浅主题；记录机器、浏览器、构建、带宽/延迟、工具和时间。缺失的内存API写为不可用，不能写0或用JS heap代替GPU/总内存。
- [x] 发布[P0报告](../../verification/2026-10-31-canvas-image-cache-p0.md)：明确主要瓶颈和资源预算；冻结首次可操作与总内存设备预算、500档rAF p95≤32ms目标及A/B退化阈值。只采集500/2000一次无法作通过结论。

**测量边界：** React提交、精确页面/GPU内存不可用；模型函数另测，自有浏览器进程工作集作明确标注的内存代理。60例无失败，压力段191轮；服务端微基准不含真实HTTP/鉴权。

**验证：** 已新增`npm run test:canvas-perf -- --baseline`；期望可重复原始报告和环境记录，不要求当前基线先达标。若布局/React CPU是主要瓶颈，先在P4补对应数据边界，不以加大缓存掩盖。

### P1：会话媒体传输与有界资源池

2026-10-31 续接：已实现第一子批次 `src/lib/privateMedia.js` 与 API epoch/reset 订阅接口；26项传输专项通过。覆盖固定缩略图路径、会话切换、流式大小限制、MIME、401、取消与超时。见[传输层验收记录](../../verification/2026-10-31-private-media-transport.md)。

同日第二子批次：已新增 `src/journal/images/imageResourceCache.js` 纯调度核心与8项专项测试，覆盖共享 fetch、display/prefetch 角色、字节/条目预算、deferred、LRU、invalidate 与 dispose；71文件633项全量、安全专项、lint 与分包门禁通过。见[资源池核心验收](../../verification/2026-10-31-image-resource-cache-p1.md)。React Provider、useImageResource、JournalImage 接入、共享重试退避、媒体代际失效与 TTL 仍未实现；尚未获得性能收益结论。

- [ ] RED：`tests/private-media.test.js`覆盖同源固定变体、头后/body后会话切换、body超限、超时、401、MIME和取消；`tests/image-resource-cache.test.js`覆盖同key多消费者一次fetch、重复release、取消一个不影响另一个、在途预算、队列抢占、全部在用时deferred而非强制驱逐。
- [ ] RED：已ready/LRU命中、最后一个消费者离开时URL撤销但Blob可复用、decode失败/晚回执、任务代际替换、共享两次退避、失败不回退原图、dispose全部计数归零与拒绝新租约。
- [ ] RED：同key的prefetch与display共享一次fetch，前者不占img/主动decode名额，后者按需解码；任一角色release不取消另一角色需求，Blob就绪不等于display就绪。
- [ ] GREEN：实现privateMedia和资源状态机；流式读取按实际字节计数，decode任务/实际img计费分开，Object URL只能由其创建者撤销，clock和fetch/decode适配器可注入测试。
- [ ] 执行`npm test -- tests/private-media.test.js tests/image-resource-cache.test.js`，期望全部通过；内存预算/并发/条目上限在每次状态变化断言，不只检查最终值。

### P2：会话清理、数据失效与React租约

- [ ] RED：reset订阅、退出/401/A→B/同账号accept、StrictMode挂载卸载、旧body/decode晚到、同源多挂载、provider切换资源scope但草稿及布局历史仍保留；不能只以userId作为资源生命周期。
- [ ] RED：本地删除/替换/恢复、标题/布局变化不失效图片、资源60秒硬TTL不因命中续期、前台校验、离线到期占位、只读session校验不调用accept造成清缓存循环。
- [ ] GREEN：实现epoch订阅、Provider与useImageResource；修改JournalImage仅提供可选策略，无provider/fullSize/公共或本地预览时保持原行为；400/401/404与503分别处理。
- [ ] 执行`npm test -- tests/image-resource-provider.test.jsx tests/journal-image.test.jsx tests/account-gate.test.jsx`和P1测试，期望全部通过；mocked generation验证之外补真实账号双会话E2E。

### P3：驻留、低倍概览与尺寸批量提交

- [ ] 先以500张样例审阅概览：过小照片不挂完整img/卡片，旅程/色块优先封面，散落照片网格聚合且有进入局部入口。这个表现属于产品交互，确认后再合入；不能静默让未分配img名额的内容消失或失去可选性。
- [ ] RED：`tests/canvas-image-residency.test.js`覆盖相机变换、旋转边界、横竖长图边缘、折叠/嵌套、稳定排名、当前焦点/拖动节点、全选500不pin500、不同profile硬上限、低倍率2000张概览和预取退让。
- [ ] RED：尺寸表缓存命中、同值零通知、同帧批量一次通知、媒体代际失效、4096项上限；图片进出缓存不改坐标、不引发布局修复写入，未知尺寸仍用保留边界。
- [ ] GREEN：接入JourneyCanvas及组封面，必要时提取memoized卡片层；完整业务/碰撞/选择模型不裁剪。所有img消费者包括封面计入名额，轨迹中优先保留既有交互DOM，而非重建造成捕获/焦点丢失。
- [ ] 执行驻留/尺寸专项和现有canvas-input、分组、键盘、历史/保存测试；期望图像资源预算通过，同时500项布局操作仍是一个原子命令。2000总对象压力档不扩大单次500项API上限。

### P4：A/B验收、回退与启用

- [ ] 通过构建开关`VITE_CANVAS_IMAGE_RESIDENCY`与`VITE_CANVAS_IMAGE_CACHE`比较三组：旧路径、仅驻留控制、驻留+缓存。默认均关闭，禁止缓存单开而跳过驻留预算；三组保持同一合成资料、相机路径、接口授权与布局格式。
- [ ] 执行`npm run test:canvas-perf -- --compare`，同环境同轨迹至少5次：500预热rAF p95≤32ms，已冻结首次可操作/内存预算达标；预算/TTL内、关缓存存在重复请求的回访负载，在相同驻留策略下开缓存相对关缓存至少减少80%（零重复基线记N/A），再另报整体新路径对旧路径收益，字节/解码/CPU/DOM分别报告。2000档10分钟无崩溃且能编辑/保存/撤销；不因500项API限额而把全选2000当一次成功写入。
- [ ] 按真实私有URL检验跨账号热缓存拒绝、退出不显示旧图、会话重确认不丢草稿、源删除/恢复、硬过期、队列取消、503、截图/焦点和无离线缓存；所有私有响应头与服务端热磁盘缓存鉴权回归保留。
- [ ] 运行全量、lint、check:bundle、security、隔离API/恢复、桌面/手机E2E、画布四配置及页面十状态。测试串行、记录每步退出码；真实数据库不可用明确标记，不把组件或mock性能结果替代。
- [ ] 一次独立审查，修复重要发现并回归；记录feature flag回退演练和最终profile值，验收后才建议启用。关闭runtime、核对专用容器ID再停服务，不影响个人库或Codex核心进程。

## 五、投入、风险与决策点

初步估计6–10个开发日，含自动化验证，不含实体设备/用户体验安排；这是规划范围，不是交付日期，P0后按真实瓶颈重估。

| 风险/条件 | 决策与验收 |
| --- | --- |
| 缓存命中却内存上涨 | 压缩Blob与实际解码消费者分账，低倍img硬上限，清理URL/探测器；用进程曲线而非只看Map大小 |
| no-store与私有资源边界 | 不启用HTTP/磁盘持久缓存；会话scope、硬TTL、前台校验、本地删除失效，明确已显示像素无法远程即时抹除 |
| 同账号session刷新 | 只换资源scope，不重挂载编辑器；测试未保存布局/历史保持 |
| 500张低倍都入视口 | 资源池与低细节驻留共同启用；具体聚合表现先看样例，不靠无限pin或任意隐藏对象 |
| 网络不是主要瓶颈 | P0分项归因，尺寸批量更新/memo边界优先；空间索引或新渲染器另有测量与设计，不顺手引入 |
| 不同浏览器释放内存不同 | 只对自有计数/上限作硬断言；总内存报告环境和回收观察，不承诺立即归零 |

## 六、本轮交付状态

- [x] 用户确认500/2000档位、桌面优先/兼顾平板。
- [x] 复查当前缩略图、私有响应、图片组件、会话清理与画布可见性路径。
- [x] 撰写分层设计、接口、预算、分阶段任务与验收/回退计划。
- [x] 独立设计审查未发现关键缺口；已补充display/prefetch租约及其预算区别，完成本地链接检查。
- [x] [P0基线测量与报告](../../verification/2026-10-31-canvas-image-cache-p0.md)：60例及10分钟压力段完成，68文件591项测试与lint通过；后续P1核心已开始实现，缓存尚未接入产品，使用方法见[基准说明](../../canvas-performance.md)。

计划编写轮只修改文档。当前P0轮新增合成夹具、测量/统计脚本与测试命令，不改运行产品逻辑或连接个人数据库；工具和基线结果不证明新缓存已工作。

同日第三子批次：P1 调度核心加固，修复队列续跑、请求预算转移、旧解码发布及关闭后计数。13 项专项与 71 文件 638 项全量测试通过，lint、生产构建及分包门禁通过。P1 队列/显示/解码预算硬上限、优先级及共享重试仍待实施，随后进入 P2；本轮不宣称性能提升。详见资源池核心验收的续推记录。

同日第四子批次：补齐 resident Blob + 在途请求的 maxEntries 硬上限，关闭资源清理 Blob/pending/租约订阅引用；独立审查发现的失效通知重入已补 RED→GREEN 回归。18 项资源池专项、71 文件 643 项最终全量、lint、生产构建及分包门禁通过。待办转为队列/显示/解码工作集硬上限、优先级/共享重试，再进入 P2 会话与 React 接入。细节和首轮随机端口失败记录见 P1 验收报告。

2026-10-31 用户授权子代理并行推进：P1 有界队列/显示/解码预算、共享重试、可取消原生解码及 profiles 已合并；P2 会话控制器、硬过期、Provider/Hook 与 JournalImage 可选策略已实现。78文件715项测试、lint、安全专项、生产构建、十状态浏览器冒烟与分包门禁通过。画布未挂载，真实账号双会话 E2E 和 P3/P4 继续保留。详见[本轮验收](../../verification/2026-10-31-image-resources-parallel.md)。

2026-10-31 P3并行续推：完成纯驻留规划器、4096项尺寸LRU和帧批量Hook，尺寸批量已接入JourneyCanvas且不写布局。500张概览样例已交互验证；用户接受方向并反馈封面布局/下方按钮抢眼，已放大封面并改轻量文字入口。82文件734项、lint/构建/分包、画布四配置、页面十状态及样例浏览器检查通过。驻留/封面统一预算、概览产品接线及P4尚未完成，见[P3验收](../../verification/2026-10-31-image-residency-p3.md)。

2026-10-31 P3接线续推：稳定资源壳已接入JournalPage，照片/色块/旅程/手札封面统一图片预算，文字/记录/手札纳入详细节点预算；低倍概览与最大缩放分页兜底可逐项访问，焦点保持。默认构建开关均关闭；86文件756项、lint及原生八场景500/2000桌面/平板缓存开关硬上限检查通过，详见[接线验收](../../verification/2026-10-31-canvas-residency-wiring.md)。实际预取、手势后自动切档及P4定量验收仍待完成。

2026-10-31 预取/切档与对比续推：近视口预取租约及可见需求退让、手势结束后原子切档已实现。87文件770项、原生八场景加真实鼠标切档通过。修复三组对比低倍拖动定位后，500张桌面浅色三组各5次完成：缓存组最差可编辑418.7ms、首视口956.4ms、平移p95 6.2ms达标；工作集最差661.8MiB超过650MiB，暖回访重复请求基线0导致80%门禁N/A。开关保持关闭，P4未验收；见[续推记录](../../verification/2026-10-31-prefetch-profile-compare.md)。

2026-10-31 P4内存与回访续推：探测器复用资源池URL，增加取消所有权回归；修订真实A/B/A回访并补细粒度内存采样。500张桌面浅色三组各5次完成，回访重复请求仅驻留21→缓存0（五次一致，100%减少），缓存最差采样工作集643.0MiB满足650MiB，最差可编辑415.6ms/首视口968ms/平移p95 6.2ms。本子集已配置门禁通过，但平板/深色、2000张10分钟压力、真实账号及完整P4尚未验收，开关仍关闭。详见[本轮记录](../../verification/2026-10-31-memory-revisit.md)。
