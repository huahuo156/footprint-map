# 足迹山河 — 设计文档

> 版本：MVP + Social Phase
> 日期：2026-08-26

## 1. 项目概述

一个网页端的中国探险打卡地图应用。用户登录后可以看到中国全图及标注的著名景点，上传旅行照片并打卡标注位置，发布图文攻略，给打卡和攻略点赞。支持以文搜图（多模态检索）。支持省份级别的详细地图。

**项目定位：** CS 本科生闲暇练手项目，技术驱动，多模态检索是核心亮点。

## 2. 技术栈

| 层 | 技术 |
|----|------|
| 前端 | Vite + React + Leaflet + Tailwind CSS |
| 后端 | Supabase（Auth / Database / Storage / Edge Functions / Realtime） |
| 数据库 | PostgreSQL + pgvector 扩展 |
| 地图数据 | datav-geo-atlas（DataV 开源中国 GeoJSON） |
| Embedding | CLIP（通过 Edge Function 调用） |
| 图片存储 | Supabase Storage |

## 3. 整体架构

```
┌─────────────────────────────────────────────┐
│              前端 (Vite + React)              │
│  Leaflet 地图 │ 攻略 UI │ 搜索栏 │ 打卡面板  │
└──────────────┬──────────────────────────────┘
               │ Supabase JS Client
               ▼
┌─────────────────────────────────────────────┐
│              Supabase                        │
│  ┌─────────┐ ┌──────────────┐ ┌──────────┐  │
│  │ Auth    │ │ Database     │ │ Storage  │  │
│  │ 邮箱/   │ │ PostgreSQL   │ │ 图片存储 │  │
│  │ OAuth   │ │ + pgvector   │ │          │  │
│  └─────────┘ └──────────────┘ └──────────┘  │
│  ┌──────────────────┐ ┌───────────────────┐  │
│  │ Edge Functions   │ │ Realtime          │  │
│  │ CLIP embedding   │ │ 点赞即时更新      │  │
│  └──────────────────┘ └───────────────────┘  │
└─────────────────────────────────────────────┘
```

## 4. 数据模型

### profiles（用户资料）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键，关联 auth.users |
| nickname | text | 昵称 |
| avatar_url | text | 头像 URL |
| bio | text | 个人简介 |
| created_at | timestamptz | 创建时间 |

### landmarks（景点，预置数据）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | bigserial | 主键 |
| name | text | 景点名称 |
| province | text | 所在省份 |
| city | text | 所在城市 |
| lat | numeric | 纬度 |
| lng | numeric | 经度 |
| category | text | 分类（自然风光/历史古迹/现代建筑/...） |
| description | text | 简介 |

预置 ~100 个 5A 及热门景点数据。

### checkins（打卡/照片，核心表）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | bigserial | 主键 |
| user_id | UUID | 关联 profiles |
| landmark_id | bigint | 关联 landmarks，可为空（允许标注非景点位置） |
| lat | numeric | 精确纬度 |
| lng | numeric | 精确经度 |
| image_url | text | Storage 中的图片路径 |
| caption | text | 文字描述 |
| province | text | 所在省份（冗余，便于查询） |
| embedding | vector(768) | CLIP 生成的图片向量 |
| likes_count | int | 冗余计数 |
| created_at | timestamptz | 创建时间 |

### guides（攻略）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | bigserial | 主键 |
| user_id | UUID | 关联 profiles |
| title | text | 标题 |
| content | text | Markdown 正文 |
| cover_image_url | text | 封面图 |
| province | text | 所在省份 |
| landmark_ids | bigint[] | 关联景点 ID 数组 |
| likes_count | int | 冗余计数 |
| created_at | timestamptz | 创建时间 |

### likes（点赞）
| 字段 | 类型 | 说明 |
|------|------|------|
| user_id | UUID | 关联 profiles |
| target_id | bigint | 被点赞对象 ID |
| target_type | text | 'checkin' 或 'guide' |
| created_at | timestamptz | 创建时间 |
| — | — | UNIQUE(user_id, target_id, target_type) |

## 5. 地图交互

### 全国视图
- Leaflet 加载 datav-geo-atlas 中国 GeoJSON（省界）
- 各省不同颜色填充，悬停高亮
- 著名景点以 marker 标注（预置数据）
- 用户打卡过的景点 marker 变色（灰 → 绿）
- 右上角搜索框：搜景点名称 / 以文搜图

### 省份详情视图
- 点击省份 → 地图缩放平移聚焦
- 展示省界轮廓 + 城市标注 + 该省所有景点 marker
- 侧边栏显示用户在该省的打卡记录
- 左上角返回按钮 → 全国视图

### 打卡流程
1. 点击地图任意位置（或选择已有景点 marker）
2. 弹出打卡面板：上传图片 + 填写描述
3. 前端调 Edge Function → 图片存入 Storage + CLIP 生成 embedding → 存入 checkins 表
4. 地图上该位置出现用户自己的 marker（自定义脚印图标 🦶）

## 6. 认证

### 支持方式
- 邮箱 + 密码
- Magic Link（邮箱免密登录）
- GitHub OAuth
- Google OAuth

### 流程
- 未登录用户：只能浏览地图和景点，不能打卡/点赞
- 登录后：可打卡、点赞、发布攻略
- 用户资料在首次登录时自动创建（profiles 表触发器）

## 7. 多模态搜索（以文搜图）

### 原理
用户输入文字描述（如"雪山下的湖泊"），将文字通过 CLIP 文本编码器生成向量，与 checkins 表中的图片 embedding 做余弦相似度检索，返回最匹配的打卡照片。

### 实现
1. 用户输入搜索词
2. 前端调 Edge Function，传入文本
3. Edge Function 调用 CLIP 文本编码器生成 query embedding
4. 在 PostgreSQL 中用 pgvector 的 `<=>` 运算符做余弦距离检索
5. 返回匹配的 checkins + 图片

### SQL 查询示意
```sql
SELECT id, image_url, caption, lat, lng,
       1 - (embedding <=> $query_embedding) AS similarity
FROM checkins
WHERE 1 - (embedding <=> $query_embedding) > 0.2
ORDER BY embedding <=> $query_embedding
LIMIT 20;
```

## 8. 攻略发布

- 支持 Markdown 编辑器（轻量级，如 textarea + 预览）
- 可关联景点（从 landmarks 中选择）
- 支持上传封面图
- 攻略列表页：按省份筛选、按时间/点赞数排序

## 9. 点赞（实时）

- 用户点击点赞按钮 → 插入 likes 表 + 更新 likes_count
- 通过 Supabase Realtime 订阅 likes 变化 → 其他用户页面上的点赞数即时 +1
- 取消点赞 → 删除记录 + -1
- 一条 Realtime channel 足够，只推送计数变化

## 10. 推荐发现

MVP 阶段做简单版：
- 首页侧边栏：展示附近/热门打卡点（按 likes_count 排序）
- 按省份筛选：选择省份查看该省热门打卡
- 后续可加：基于用户历史的个性化推荐

## 11. RLS 策略

| 表 | 策略 |
|----|------|
| profiles | 所有人可读；仅自己可写 |
| landmarks | 所有人可读（预置数据） |
| checkins | 所有人可读；仅自己可增删改 |
| guides | 所有人可读；仅自己可增删改 |
| likes | 所有人可读；仅自己可增删 |

## 12. 文件结构

```
footprint-map/
├── index.html
├── package.json
├── vite.config.js
├── tailwind.config.js
├── src/
│   ├── main.jsx
│   ├── App.jsx
│   ├── lib/
│   │   └── supabase.js
│   ├── components/
│   │   ├── Map/
│   │   │   ├── ChinaMap.jsx          # 全国地图主组件
│   │   │   ├── ProvinceMap.jsx       # 省份详情地图
│   │   │   ├── LandmarkMarker.jsx    # 景点标记
│   │   │   └── CheckinPopup.jsx      # 打卡弹窗
│   │   ├── Auth/
│   │   │   ├── LoginForm.jsx
│   │   │   └── AuthProvider.jsx
│   │   ├── Sidebar/
│   │   │   ├── CheckinList.jsx       # 打卡记录列表
│   │   │   ├── GuideList.jsx         # 攻略列表
│   │   │   └── SearchPanel.jsx       # 搜索面板
│   │   ├── Guide/
│   │   │   ├── GuideEditor.jsx       # 攻略编辑器
│   │   │   └── GuideDetail.jsx       # 攻略详情
│   │   └── LikeButton.jsx
│   ├── data/
│   │   ├── china.json                # 中国 GeoJSON
│   │   └── provinces/                # 各省 GeoJSON
│   │       ├── beijing.json
│   │       └── ...
│   └── index.css
├── supabase/
│   ├── config.toml
│   ├── migrations/
│   │   └── 001_init.sql             # 初始表结构
│   └── seed.sql                     # 景点种子数据
└── public/
```

## 13. 后续迭代（不在 MVP 范围）

- 关注/个人主页
- 评论功能
- 以图搜图（反向图片搜索）
- 旅行足迹统计（省份数、打卡数、里程统计）
- 路线规划
- 离线缓存
