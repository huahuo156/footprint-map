# 画布图片性能基准使用说明

这是缓存计划P0的测量工具，不是缓存实现。默认消费当前生产构建，使用不同URL与不同像素内容的合成WebP，在环回HTTP夹具上测量前端。不会登录真实账号、读取上传目录或连接个人数据库。

## 运行

```powershell
# 正式基线：3档 × 桌面/平板 × 深浅主题 × 5个独立浏览器；最后一例另做10分钟压力测试
npm run test:canvas-perf -- --baseline

# 仪器/开发检查，不能当作完整验收
npm run test:canvas-perf -- --baseline --counts=100 --runs=1 --profiles=desktop --themes=light --stress-ms=0 --path-ms=100

# 当前生产派生图函数的冷/热微基准（临时合成文件，不包含HTTP/鉴权/数据库）
node scripts/canvas-thumbnail-performance.mjs

# 当前源码模型函数的CPU隔离微基准（Node/Vite SSR，不是React或GPU耗时）
node scripts/canvas-model-performance.mjs
```

三个工具应串行运行。默认正式矩阵较长，避免同时运行Vitest、构建、浏览器冒烟或其他性能采样。每个短样本使用新的浏览器进程/上下文，结束关闭；不以跨样本共享浏览器来掩盖冷启动，浏览器内部正常缓存行为保持默认，没有通过setCacheDisabled制造重复请求。所有报告写到本机忽略的`test-results/canvas-performance/`。

## 负载与操作路径

主程序启动时顺序生成最大档位的独立合成缩略图，只在内存持有压缩结果；报告包含每个资源的宽高、字节和SHA256，校验所有图片内容不同。每档图片包含横/竖/方形，布局包含文字、嵌套组和折叠组，几何留有碰撞间距。合成图不是实际旅行照片，其压缩率不能代表所有真实图库。

固定短跑路径为：初始80%局部视角→平移A→平移B→返回初始区域→全局概览→全选（最多500项）/F定位/精确微调/撤销→组折叠展开→真实鼠标拖动/撤销→模拟并发409确认重载→空闲。使用原生鼠标和键盘输入；框架的API是明确模拟的条件布局/分组传输，不能拿该结果代替真实数据库原子性、安全检查或服务端缩略图吞吐。

最后一个最大档位、保守profile、深色样本短跑结束后，继续独立统计10分钟平移/概览/选择/保存/撤销/折叠循环。压力样本与60个短跑的请求和内存比较分开，防止长驻留稀释或放大短跑结果。当前单次批量操作仍最多500个对象，不把2000总对象解释成可一次保存2000项。

## 指标含义

| 字段/数据 | 测量方法 | 限制 |
| --- | --- | --- |
| editableMs | 导航前安装MutationObserver，首次发现画布+保存就绪+可用选择工具时记录performance.now | 不等待页面load取“当前时间”；这是工具可用时间，不是所有图片完成 |
| visible95Ms | 初始视口中至少95%实际img完整解码可显示时的观察时间 | 轮询观察有采样粒度，另看首图时间、可见/就绪数量与错误数 |
| frames/frameP95Ms | rAF间隔原始样本与nearest-rank p95 | 不是GPU渲染耗时；显示器刷新率不同，不能强行套60Hz |
| longTasks | 浏览器PerformanceObserver的长任务 | 不支持时为null；任务归属按阶段起始时间分段 |
| CDP metrics | ScriptDuration、TaskDuration、LayoutDuration、RecalcStyleDuration、JSHeapUsedSize等 | 时间是累积计数，比较阶段差值；不能改名为React提交或某个模型函数耗时 |
| images/cards/nodes | 每个阶段完成时计数，区分实际视口内图片和已就绪图片 | 不只看业务对象总数；概览可能让几乎全部照片成为DOM/解码消费者 |
| 请求/字节/唯一URL | CDP网络事件、响应完成字节与独立HTTP夹具计数 | 峰值logicalRequests包含排队，不等同于同时TCP连接；服务端activeHandlers另报 |
| browser working set/private bytes | 仅查询本次浏览器CDP提供的进程ID，汇总Windows工作集/私有提交 | 工作集和共享页可能重复计数，不是精确页面内存或GPU显存；不支持时缺失 |
| model微基准 | 独立调用当前buildCanvas/组边界/保留尺寸组边界/planCanvasRepair | Node进程中的源码CPU隔离，不等同于浏览器React更新成本；repair使用其本来不带尺寸表的入口 |
| thumbnail微基准 | 每种形状5次首次生成及同源第二次磁盘命中 | 不含HTTP、授权或队列压力，不与前端mock网络相加假装端到端 |

短跑报告的summary包括每档/环境5次的median和worst，原始frames、长任务、阶段DOM/网络/累计CPU计数和内存样本一并保留。压力统计可在原始最后样本的stress阶段单独查看，不能混入短跑内存最大值。若某个阶段失败，保留partialCases和异常，未完成矩阵或无finishedAt的中断报告不能当作正式通过。

## 环境与清理

报告记录Node/浏览器版本、CPU/逻辑核数/系统内存、视口和主题、固定20ms夹具媒体延迟、未限速环回网络、生产index/JS/CSS哈希以及runner/fixture/统计源码哈希。物理平板尚需单独测量；没有添加COOP/COEP部署头来强行开启measureUserAgentSpecificMemory，跨源隔离不足时页面总内存标记为不可用。

程序finally关闭浏览器、上下文和HTTP服务；微基准的临时目录删除前检查其绝对路径仍位于系统临时目录且有本次专属前缀。压力测试遇到可用物理内存低于1GiB或本次浏览器工作集汇总超过3GiB时保护性停止，并将其作为失败记录，不放宽阈值或默默降低档位。

在完成真实基线前，不宣称已实现500张优化、80%缓存命中收益、GPU内存下降或实体设备达标。若浏览器本身已消除回访网络请求，应记录真实结果，不能人为关闭浏览器缓存给新缓存层制造优势。
