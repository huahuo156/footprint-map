# 足迹山河 (Footprint Map) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chinese exploration check-in map web app where users can browse China's provinces on an interactive map, check in at landmarks with photos, publish travel guides, like content, and search photos by text description.

**Architecture:** Single-page React app (Vite) with Leaflet for interactive maps, Supabase for auth/database/storage/realtime, and Tailwind CSS for styling. Province GeoJSON fetched from DataV CDN at runtime. CLIP embeddings generated via Supabase Edge Functions for multi-modal search.

**Tech Stack:** Vite 8, React 19, Leaflet (react-leaflet), Tailwind CSS v4, Supabase JS v2, React Router v7, Vitest + React Testing Library

---

## File Structure

```
footprint-map/
├── index.html                                    # MODIFY: update title
├── package.json                                  # MODIFY: add dependencies
├── vite.config.js                                # MODIFY: add tailwind plugin
├── src/
│   ├── main.jsx                                  # MODIFY: add BrowserRouter
│   ├── App.jsx                                   # REWRITE: routing + layout
│   ├── index.css                                 # REWRITE: tailwind imports
│   ├── lib/
│   │   ├── supabase.js                           # KEEP
│   │   ├── api.js                                # CREATE: Supabase query helpers
│   │   └── utils.js                              # CREATE: shared utilities
│   ├── hooks/
│   │   └── useLikes.js                           # CREATE: likes + realtime hook
│   ├── components/
│   │   ├── Auth/
│   │   │   ├── AuthProvider.jsx                  # CREATE: auth context provider
│   │   │   └── LoginForm.jsx                     # CREATE: login/signup form
│   │   ├── Map/
│   │   │   ├── ChinaMap.jsx                      # CREATE: main map component
│   │   │   ├── ProvinceView.jsx                  # CREATE: province detail view
│   │   │   └── CheckinPopup.jsx                  # CREATE: marker popup
│   │   ├── Sidebar/
│   │   │   ├── Sidebar.jsx                       # CREATE: sidebar container
│   │   │   ├── CheckinList.jsx                   # CREATE: checkin feed
│   │   │   ├── GuideList.jsx                     # CREATE: guide feed
│   │   │   └── SearchPanel.jsx                   # CREATE: search UI
│   │   ├── Guide/
│   │   │   ├── GuideEditor.jsx                   # CREATE: markdown editor
│   │   │   └── GuideDetail.jsx                   # CREATE: guide reader
│   │   ├── CheckinForm.jsx                       # CREATE: check-in form
│   │   ├── LikeButton.jsx                        # CREATE: like toggle
│   │   └── Navbar.jsx                            # CREATE: top nav bar
│   └── data/
│       └── landmarks-sample.js                   # CREATE: seed landmark data
├── supabase/
│   ├── config.toml                               # KEEP
│   ├── migrations/
│   │   └── 20260826000000_init.sql               # CREATE: full schema + RLS
│   ├── seed.sql                                  # CREATE: landmark seed data
│   └── functions/
│       ├── checkin-upload/
│       │   └── index.ts                           # CREATE: image + embedding
│       └── search-similar/
│           └── index.ts                           # CREATE: text-to-image search
└── tests/
    ├── setup.js                                  # CREATE: test setup
    ├── utils.test.js                             # CREATE: utility tests
    └── hooks/
        └── useLikes.test.js                      # CREATE: likes hook test
```

---

### Task 1: Install Dependencies & Configure Tailwind

**Files:**
- Modify: `package.json`
- Modify: `vite.config.js`
- Rewrite: `src/index.css`
- Create: `tailwind.config.js`

- [ ] **Step 1: Install all dependencies**

```bash
npm install tailwindcss @tailwindcss/vite react-router-dom react-leaflet leaflet lucide-react
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom
```

- [ ] **Step 2: Update vite.config.js to include Tailwind plugin**

Replace the content of `vite.config.js`:

```js
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
})
```

- [ ] **Step 3: Rewrite src/index.css for Tailwind**

Replace the entire content of `src/index.css`:

```css
@import "tailwindcss";

/* Leaflet CSS is imported in components that use it */

/* Custom map styles */
.leaflet-container {
  width: 100%;
  height: 100%;
  z-index: 0;
}

/* Province hover effect */
.province-path {
  transition: fill-color 0.2s, stroke-width 0.2s;
}
.province-path:hover {
  fill-color: #60a5fa;
  stroke-width: 2;
}

/* Scrollbar styling */
.sidebar-scroll::-webkit-scrollbar {
  width: 4px;
}
.sidebar-scroll::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 2px;
}
```

- [ ] **Step 4: Update index.html title**

Change the `<title>` in `index.html` from `dashboard-temp` to `足迹山河`:

```html
<title>足迹山河</title>
```

- [ ] **Step 5: Verify the app starts**

```bash
npm run dev
```

Expected: App loads at http://localhost:5173 with no errors (still shows Vite template).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: install dependencies, configure Tailwind CSS v4"
```

---

### Task 2: Database Schema & RLS

**Files:**
- Create: `supabase/migrations/20260826000000_init.sql`

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/20260826000000_init.sql` with the full schema:

```sql
-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- =============================================
-- profiles (用户资料)
-- =============================================
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nickname TEXT,
  avatar_url TEXT,
  bio TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, nickname)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- =============================================
-- landmarks (景点，预置数据)
-- =============================================
CREATE TABLE landmarks (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  province TEXT NOT NULL,
  city TEXT,
  lat NUMERIC NOT NULL,
  lng NUMERIC NOT NULL,
  category TEXT,
  description TEXT
);

CREATE INDEX idx_landmarks_province ON landmarks(province);

-- =============================================
-- checkins (打卡/照片)
-- =============================================
CREATE TABLE checkins (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  landmark_id BIGINT REFERENCES landmarks(id) ON DELETE SET NULL,
  lat NUMERIC NOT NULL,
  lng NUMERIC NOT NULL,
  image_url TEXT NOT NULL,
  caption TEXT,
  province TEXT,
  embedding vector(768),
  likes_count INT DEFAULT 0 NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX idx_checkins_user ON checkins(user_id);
CREATE INDEX idx_checkins_province ON checkins(province);
CREATE INDEX idx_checkins_likes ON checkins(likes_count DESC);

-- =============================================
-- guides (攻略)
-- =============================================
CREATE TABLE guides (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT,
  cover_image_url TEXT,
  province TEXT,
  landmark_ids BIGINT[] DEFAULT '{}',
  likes_count INT DEFAULT 0 NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX idx_guides_user ON guides(user_id);
CREATE INDEX idx_guides_province ON guides(province);

-- =============================================
-- likes (点赞)
-- =============================================
CREATE TABLE likes (
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target_id BIGINT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('checkin', 'guide')),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  PRIMARY KEY (user_id, target_id, target_type)
);

-- =============================================
-- likes_count triggers (auto-increment/decrement)
-- =============================================
CREATE OR REPLACE FUNCTION update_likes_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.target_type = 'checkin' THEN
      UPDATE checkins SET likes_count = likes_count + 1 WHERE id = NEW.target_id;
    ELSIF NEW.target_type = 'guide' THEN
      UPDATE guides SET likes_count = likes_count + 1 WHERE id = NEW.target_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.target_type = 'checkin' THEN
      UPDATE checkins SET likes_count = likes_count - 1 WHERE id = OLD.target_id;
    ELSIF OLD.target_type = 'guide' THEN
      UPDATE guides SET likes_count = likes_count - 1 WHERE id = OLD.target_id;
    END IF;
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_like_change
  AFTER INSERT OR DELETE ON likes
  FOR EACH ROW EXECUTE FUNCTION update_likes_count();

-- =============================================
-- Storage buckets
-- =============================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'checkin-images',
  'checkin-images',
  true,
  10485760,  -- 10MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
) ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'guide-covers',
  'guide-covers',
  true,
  5242880,  -- 5MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
) ON CONFLICT (id) DO NOTHING;

-- =============================================
-- RLS policies
-- =============================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE landmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE guides ENABLE ROW LEVEL SECURITY;
ALTER TABLE likes ENABLE ROW LEVEL SECURITY;

-- profiles: everyone can read, only self can write
CREATE POLICY "profiles_select" ON profiles FOR SELECT USING (true);
CREATE POLICY "profiles_insert" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update" ON profiles FOR UPDATE USING (auth.uid() = id);

-- landmarks: everyone can read (preset data)
CREATE POLICY "landmarks_select" ON landmarks FOR SELECT USING (true);

-- checkins: everyone can read, only self can insert/update/delete
CREATE POLICY "checkins_select" ON checkins FOR SELECT USING (true);
CREATE POLICY "checkins_insert" ON checkins FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "checkins_update" ON checkins FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "checkins_delete" ON checkins FOR DELETE USING (auth.uid() = user_id);

-- guides: everyone can read, only self can insert/update/delete
CREATE POLICY "guides_select" ON guides FOR SELECT USING (true);
CREATE POLICY "guides_insert" ON guides FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "guides_update" ON guides FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "guides_delete" ON guides FOR DELETE USING (auth.uid() = user_id);

-- likes: everyone can read, only self can insert/delete
CREATE POLICY "likes_select" ON likes FOR SELECT USING (true);
CREATE POLICY "likes_insert" ON likes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "likes_delete" ON likes FOR DELETE USING (auth.uid() = user_id);

-- Storage policies
CREATE POLICY "checkin_images_public" ON storage.objects
  FOR SELECT USING (bucket_id = 'checkin-images');
CREATE POLICY "checkin_images_insert" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'checkin-images' AND auth.uid() IS NOT NULL);
CREATE POLICY "checkin_images_delete" ON storage.objects
  FOR DELETE USING (bucket_id = 'checkin-images' AND auth.uid() = owner);

CREATE POLICY "guide_covers_public" ON storage.objects
  FOR SELECT USING (bucket_id = 'guide-covers');
CREATE POLICY "guide_covers_insert" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'guide-covers' AND auth.uid() IS NOT NULL);
CREATE POLICY "guide_covers_delete" ON storage.objects
  FOR DELETE USING (bucket_id = 'guide-covers' AND auth.uid() = owner);

-- =============================================
-- pgvector index for similarity search
-- =============================================
CREATE INDEX idx_checkins_embedding ON checkins
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 10);
```

- [ ] **Step 2: Create seed data file**

Create `supabase/seed.sql` with landmark data (30 representative 5A attractions):

```sql
INSERT INTO landmarks (name, province, city, lat, lng, category, description) VALUES
('故宫博物院', '北京', '北京', 39.9163, 116.3972, '历史古迹', '明清两代的皇家宫殿，世界上现存规模最大、保存最完整的木质结构古建筑群'),
('长城·八达岭', '北京', '北京', 40.3598, 116.0203, '历史古迹', '万里长城最具代表性的段落，明代长城的精华'),
('颐和园', '北京', '北京', 39.9999, 116.2755, '历史古迹', '中国现存规模最大、保存最完整的皇家园林'),
('天坛公园', '北京', '北京', 39.8822, 116.4066, '历史古迹', '明清两朝帝王祭天、祈谷的场所'),
('外滩', '上海', '上海', 31.2397, 121.4908, '现代建筑', '上海最具标志性的城市景观，万国建筑博览群'),
('东方明珠', '上海', '上海', 31.2398, 121.4998, '现代建筑', '上海地标性建筑，高468米'),
('西湖', '浙江', '杭州', 30.2421, 120.1483, '自然风光', '中国十大风景名胜之一，以秀丽著称'),
('千岛湖', '浙江', '杭州', 29.6047, 119.0130, '自然风光', '世界上岛屿最多的湖，水质极优'),
('黄山', '安徽', '黄山', 30.1375, 118.1694, '自然风光', '五岳归来不看山，黄山归来不看岳'),
('九华山', '安徽', '池州', 30.4822, 117.8114, '自然风光', '中国佛教四大名山之一'),
('张家界国家森林公园', '湖南', '张家界', 29.3249, 110.4342, '自然风光', '世界上独一无二的石英砂岩峰林地貌'),
('凤凰古城', '湖南', '湘西', 27.9480, 109.5993, '历史古迹', '中国最美的小城之一，沈从文故乡'),
('兵马俑', '陕西', '西安', 34.3841, 109.2785, '历史古迹', '世界第八大奇迹，秦始皇陵的陪葬坑'),
('华山', '陕西', '渭南', 34.4773, 110.0886, '自然风光', '西岳，以险峻著称于天下'),
('布达拉宫', '西藏', '拉萨', 29.6575, 91.1172, '历史古迹', '世界上海拔最高的宫殿，藏传佛教圣地'),
('纳木错', '西藏', '拉萨', 30.7500, 90.5833, '自然风光', '世界最高的大型湖泊，西藏三大圣湖之一'),
('丽江古城', '云南', '丽江', 26.8722, 100.2299, '历史古迹', '中国历史文化名城，世界文化遗产'),
('玉龙雪山', '云南', '丽江', 27.1019, 100.1756, '自然风光', '北半球最南的大雪山，终年积雪'),
('石林', '云南', '昆明', 24.8167, 103.2833, '自然风光', '世界地质公园，天下第一奇观'),
('九寨沟', '四川', '阿坝', 33.2600, 103.9170, '自然风光', '九寨归来不看水，水景之王'),
('峨眉山', '四川', '乐山', 29.5200, 103.3300, '自然风光', '中国佛教四大名山之一，峨眉天下秀'),
('乐山大佛', '四川', '乐山', 29.9406, 103.7714, '历史古迹', '世界最大的石刻弥勒佛坐像'),
('漓江', '广西', '桂林', 24.7800, 110.4700, '自然风光', '桂林山水甲天下，漓江山水甲桂林'),
('三亚亚龙湾', '海南', '三亚', 18.1950, 109.6267, '自然风光', '天下第一湾，中国最美的海湾'),
('泰山', '山东', '泰安', 36.2527, 117.1167, '自然风光', '五岳之首，天下第一山'),
('龙门石窟', '河南', '洛阳', 34.6333, 112.4539, '历史古迹', '中国石刻艺术宝库之一'),
('少林寺', '河南', '郑州', 34.5100, 112.9400, '历史古迹', '禅宗祖庭，少林武术发源地'),
('平遥古城', '山西', '晋中', 37.1953, 112.1753, '历史古迹', '中国保存最完整的古代县城'),
('鼓浪屿', '福建', '厦门', 24.4450, 118.0650, '历史古迹', '海上花园，万国建筑博物馆'),
('三清山', '江西', '上饶', 28.9100, 118.0600, '自然风光', '西太平洋最美花岗岩，道教名山');
```

- [ ] **Step 3: Verify migration applies**

```bash
cd supabase && supabase db reset
```

Expected: Migration applies successfully, seed data inserted (30 landmarks).

- [ ] **Step 4: Commit**

```bash
git add supabase/
git commit -m "feat: add database schema, RLS policies, and seed data"
```

---

### Task 3: Test Infrastructure & Utility Functions

**Files:**
- Create: `tests/setup.js`
- Create: `tests/utils.test.js`
- Create: `src/lib/utils.js`

- [ ] **Step 1: Create test setup file**

Create `tests/setup.js`:

```js
import '@testing-library/jest-dom'
```

- [ ] **Step 2: Add vitest config to package.json**

Add to `package.json` scripts and add vitest config:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "lint": "oxlint",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

Add to `vite.config.js`:

```js
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './tests/setup.js',
  },
})
```

- [ ] **Step 3: Create utility functions**

Create `src/lib/utils.js`:

```js
/**
 * Format a timestamp to relative time string (e.g. "3小时前")
 */
export function timeAgo(dateStr) {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const seconds = Math.floor((now - then) / 1000)

  if (seconds < 60) return '刚刚'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}天前`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}个月前`
  return `${Math.floor(months / 12)}年前`
}

/**
 * Format a number with abbreviation (e.g. 1200 -> "1.2k")
 */
export function formatCount(num) {
  if (num >= 10000) return `${(num / 10000).toFixed(1)}万`
  if (num >= 1000) return `${(num / 1000).toFixed(1)}k`
  return String(num)
}

/**
 * Truncate text to max length with ellipsis
 */
export function truncate(text, maxLength = 100) {
  if (!text || text.length <= maxLength) return text
  return text.slice(0, maxLength) + '...'
}

/**
 * Get Supabase public URL for a storage object
 */
export function getPublicUrl(bucket, path) {
  const baseUrl = import.meta.env.VITE_SUPABASE_URL
  return `${baseUrl}/storage/v1/object/public/${bucket}/${path}`
}

/**
 * Generate a random filename for uploads
 */
export function randomFilename(originalName) {
  const ext = originalName.split('.').pop()
  const random = crypto.randomUUID()
  return `${random}.${ext}`
}
```

- [ ] **Step 4: Write tests for utilities**

Create `tests/utils.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { timeAgo, formatCount, truncate, getPublicUrl, randomFilename } from '../src/lib/utils'

describe('timeAgo', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-27T12:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('returns "刚刚" for less than 60 seconds', () => {
    expect(timeAgo('2026-08-27T11:59:30Z')).toBe('刚刚')
  })

  it('returns minutes for < 60 minutes', () => {
    expect(timeAgo('2026-08-27T11:55:00Z')).toBe('5分钟前')
  })

  it('returns hours for < 24 hours', () => {
    expect(timeAgo('2026-08-27T09:00:00Z')).toBe('3小时前')
  })

  it('returns days for < 30 days', () => {
    expect(timeAgo('2026-08-24T12:00:00Z')).toBe('3天前')
  })
})

describe('formatCount', () => {
  it('returns plain number for < 1000', () => {
    expect(formatCount(42)).toBe('42')
  })

  it('returns k format for >= 1000', () => {
    expect(formatCount(1200)).toBe('1.2k')
  })

  it('returns 万 format for >= 10000', () => {
    expect(formatCount(15000)).toBe('1.5万')
  })
})

describe('truncate', () => {
  it('returns text unchanged if within limit', () => {
    expect(truncate('hello', 10)).toBe('hello')
  })

  it('truncates and adds ellipsis if over limit', () => {
    expect(truncate('hello world', 5)).toBe('hello...')
  })

  it('returns undefined/null as-is', () => {
    expect(truncate(null)).toBeNull()
    expect(truncate(undefined)).toBeUndefined()
  })
})

describe('getPublicUrl', () => {
  it('constructs correct Supabase storage URL', () => {
    const url = getPublicUrl('checkin-images', 'abc/photo.jpg')
    expect(url).toContain('/storage/v1/object/public/checkin-images/abc/photo.jpg')
  })
})

describe('randomFilename', () => {
  it('preserves file extension', () => {
    const result = randomFilename('photo.jpg')
    expect(result).toMatch(/\.jpg$/)
  })

  it('generates unique names', () => {
    const a = randomFilename('test.png')
    const b = randomFilename('test.png')
    expect(a).not.toBe(b)
  })
})
```

- [ ] **Step 5: Run tests**

```bash
npm test
```

Expected: All 8 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/utils.js tests/
git commit -m "feat: add utility functions with tests"
```

---

### Task 4: Auth Provider & Login Form

**Files:**
- Create: `src/components/Auth/AuthProvider.jsx`
- Create: `src/components/Auth/LoginForm.jsx`
- Create: `src/hooks/useAuth.js`

- [ ] **Step 1: Create AuthProvider**

Create `src/components/Auth/AuthProvider.jsx`:

```jsx
import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile(session.user.id)
      else setLoading(false)
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile(session.user.id)
      else {
        setProfile(null)
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function fetchProfile(userId) {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()
    setProfile(data)
    setLoading(false)
  }

  async function signUp(email, password, nickname) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: nickname } },
    })
    if (error) throw error
    return data
  }

  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    return data
  }

  async function signInWithMagicLink(email) {
    const { error } = await supabase.auth.signInWithOtp({ email })
    if (error) throw error
  }

  async function signInWithGitHub() {
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'github' })
    if (error) throw error
  }

  async function signInWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google' })
    if (error) throw error
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }

  return (
    <AuthContext.Provider value={{
      user, profile, loading,
      signUp, signIn, signInWithMagicLink,
      signInWithGitHub, signInWithGoogle, signOut,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
```

- [ ] **Step 2: Create LoginForm**

Create `src/components/Auth/LoginForm.jsx`:

```jsx
import { useState } from 'react'
import { useAuth } from './AuthProvider'
import { Mail, Lock, User, LogIn, Loader2 } from 'lucide-react'

export default function LoginForm() {
  const { signIn, signUp, signInWithMagicLink, signInWithGitHub, signInWithGoogle } = useAuth()
  const [mode, setMode] = useState('signin') // 'signin' | 'signup' | 'magic'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [nickname, setNickname] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [magicSent, setMagicSent] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (mode === 'signin') {
        await signIn(email, password)
      } else if (mode === 'signup') {
        await signUp(email, password, nickname)
      } else if (mode === 'magic') {
        await signInWithMagicLink(email)
        setMagicSent(true)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (magicSent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white p-8 rounded-xl shadow-lg max-w-md w-full text-center">
          <Mail className="w-12 h-12 text-blue-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-gray-900 mb-2">检查你的邮箱</h2>
          <p className="text-gray-600">我们已向 {email} 发送了登录链接</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white p-8 rounded-xl shadow-lg max-w-md w-full">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">足迹山河</h1>
        <p className="text-gray-500 mb-6">探索中国，留下足迹</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'signup' && (
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="昵称"
                value={nickname}
                onChange={e => setNickname(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              />
            </div>
          )}

          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="email"
              placeholder="邮箱"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            />
          </div>

          {mode !== 'magic' && (
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="password"
                placeholder="密码"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={6}
                className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              />
            </div>
          )}

          {error && (
            <p className="text-red-500 text-sm">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2 font-medium"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <LogIn className="w-4 h-4" />
            )}
            {mode === 'signin' ? '登录' : mode === 'signup' ? '注册' : '发送登录链接'}
          </button>
        </form>

        <div className="mt-4 space-y-2">
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="bg-white px-2 text-gray-400">或</span>
            </div>
          </div>

          <button
            onClick={signInWithGitHub}
            className="w-full border border-gray-300 text-gray-700 py-2.5 rounded-lg hover:bg-gray-50 flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
            GitHub 登录
          </button>

          <button
            onClick={signInWithGoogle}
            className="w-full border border-gray-300 text-gray-700 py-2.5 rounded-lg hover:bg-gray-50 flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Google 登录
          </button>
        </div>

        <div className="mt-6 text-center text-sm space-y-1">
          {mode === 'signin' ? (
            <>
              <button onClick={() => setMode('signup')} className="text-blue-600 hover:underline">
                没有账号？注册
              </button>
              <span className="text-gray-300 mx-2">|</span>
              <button onClick={() => setMode('magic')} className="text-blue-600 hover:underline">
                免密登录
              </button>
            </>
          ) : (
            <button onClick={() => setMode('signin')} className="text-blue-600 hover:underline">
              已有账号？登录
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verify by starting dev server**

```bash
npm run dev
```

Navigate to http://localhost:5173 — should see the login form (once we wire up App.jsx in the next task).

- [ ] **Step 4: Commit**

```bash
git add src/components/Auth/
git commit -m "feat: add AuthProvider and LoginForm components"
```

---

### Task 5: App Shell, Routing & Layout

**Files:**
- Rewrite: `src/App.jsx`
- Modify: `src/main.jsx`
- Create: `src/components/Navbar.jsx`

- [ ] **Step 1: Update main.jsx with BrowserRouter**

Replace `src/main.jsx`:

```jsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './components/Auth/AuthProvider'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
```

- [ ] **Step 2: Rewrite App.jsx with routing**

Replace `src/App.jsx`:

```jsx
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './components/Auth/AuthProvider'
import LoginForm from './components/Auth/LoginForm'
import Navbar from './components/Navbar'
import ChinaMap from './components/Map/ChinaMap'
import ProvinceView from './components/Map/ProvinceView'
import Sidebar from './components/Sidebar/Sidebar'
import GuideEditor from './components/Guide/GuideEditor'
import GuideDetail from './components/Guide/GuideDetail'
import { Loader2 } from 'lucide-react'

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
    </div>
  )
}

function MapLayout() {
  return (
    <div className="h-screen flex flex-col">
      <Navbar />
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 relative">
          <ChinaMap />
        </div>
        <Sidebar />
      </div>
    </div>
  )
}

function ProvinceLayout() {
  return (
    <div className="h-screen flex flex-col">
      <Navbar />
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 relative">
          <ProvinceView />
        </div>
        <Sidebar />
      </div>
    </div>
  )
}

export default function App() {
  const { user, loading } = useAuth()

  if (loading) return <LoadingScreen />
  if (!user) return <LoginForm />

  return (
    <Routes>
      <Route path="/" element={<MapLayout />} />
      <Route path="/province/:name" element={<ProvinceLayout />} />
      <Route path="/guide/new" element={<GuideEditor />} />
      <Route path="/guide/:id" element={<GuideDetail />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
```

- [ ] **Step 3: Create Navbar component**

Create `src/components/Navbar.jsx`:

```jsx
import { useAuth } from './Auth/AuthProvider'
import { useNavigate } from 'react-router-dom'
import { LogOut, Plus, Map } from 'lucide-react'

export default function Navbar() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()

  return (
    <header className="h-14 border-b border-gray-200 bg-white flex items-center justify-between px-4 shrink-0">
      <div className="flex items-center gap-2">
        <Map className="w-6 h-6 text-blue-600" />
        <span className="font-bold text-lg text-gray-900 cursor-pointer" onClick={() => navigate('/')}>
          足迹山河
        </span>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/guide/new')}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
        >
          <Plus className="w-4 h-4" />
          写攻略
        </button>

        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">{profile?.nickname || '用户'}</span>
          <button
            onClick={signOut}
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded"
            title="退出登录"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  )
}
```

- [ ] **Step 4: Delete old template files**

```bash
rm -f src/App.css
```

- [ ] **Step 5: Verify app loads with login form**

```bash
npm run dev
```

Expected: Login form displays. After login, redirects to map view (which will be empty until we build the map).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add app shell with routing and navbar"
```

---

### Task 6: China Map Component

**Files:**
- Create: `src/components/Map/ChinaMap.jsx`
- Create: `src/components/Map/CheckinPopup.jsx`
- Create: `src/lib/api.js`

- [ ] **Step 1: Create API helpers**

Create `src/lib/api.js`:

```js
import { supabase } from './supabase'

/**
 * Fetch all landmarks
 */
export async function fetchLandmarks() {
  const { data, error } = await supabase
    .from('landmarks')
    .select('*')
    .order('name')
  if (error) throw error
  return data
}

/**
 * Fetch checkins with user profiles, optionally filtered by province
 */
export async function fetchCheckins({ province, limit = 50, offset = 0 } = {}) {
  let query = supabase
    .from('checkins')
    .select('*, profiles:user_id(nickname, avatar_url)')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (province) query = query.eq('province', province)

  const { data, error } = await query
  if (error) throw error
  return data
}

/**
 * Fetch a single user's checkins for a province
 */
export async function fetchMyCheckins(province) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  let query = supabase
    .from('checkins')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (province) query = query.eq('province', province)

  const { data, error } = await query
  if (error) throw error
  return data
}

/**
 * Fetch guides, optionally filtered by province
 */
export async function fetchGuides({ province, limit = 20, offset = 0 } = {}) {
  let query = supabase
    .from('guides')
    .select('*, profiles:user_id(nickname, avatar_url)')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (province) query = query.eq('province', province)

  const { data, error } = await query
  if (error) throw error
  return data
}

/**
 * Create a new guide
 */
export async function createGuide({ title, content, cover_image_url, province, landmark_ids }) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data, error } = await supabase
    .from('guides')
    .insert({
      user_id: user.id,
      title,
      content,
      cover_image_url: cover_image_url || null,
      province: province || null,
      landmark_ids: landmark_ids || [],
    })
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * Fetch a single guide by id
 */
export async function fetchGuide(id) {
  const { data, error } = await supabase
    .from('guides')
    .select('*, profiles:user_id(nickname, avatar_url)')
    .eq('id', id)
    .single()
  if (error) throw error
  return data
}

/**
 * Toggle like on a target
 */
export async function toggleLike(targetId, targetType) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  // Check if already liked
  const { data: existing } = await supabase
    .from('likes')
    .select('*')
    .eq('user_id', user.id)
    .eq('target_id', targetId)
    .eq('target_type', targetType)
    .single()

  if (existing) {
    // Unlike
    const { error } = await supabase
      .from('likes')
      .delete()
      .eq('user_id', user.id)
      .eq('target_id', targetId)
      .eq('target_type', targetType)
    if (error) throw error
    return false
  } else {
    // Like
    const { error } = await supabase
      .from('likes')
      .insert({ user_id: user.id, target_id: targetId, target_type: targetType })
    if (error) throw error
    return true
  }
}

/**
 * Check if user has liked a target
 */
export async function checkLiked(targetId, targetType) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false

  const { data } = await supabase
    .from('likes')
    .select('user_id')
    .eq('user_id', user.id)
    .eq('target_id', targetId)
    .eq('target_type', targetType)
    .maybeSingle()

  return !!data
}

/**
 * Search similar images via Edge Function
 */
export async function searchSimilar(queryText, limit = 20) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')

  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/search-similar`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ query: queryText, limit }),
    }
  )

  if (!res.ok) throw new Error('Search failed')
  return res.json()
}
```

- [ ] **Step 2: Create CheckinPopup component**

Create `src/components/Map/CheckinPopup.jsx`:

```jsx
import LikeButton from '../LikeButton'
import { timeAgo, getPublicUrl } from '../../lib/utils'

export default function CheckinPopup({ checkin }) {
  const imageUrl = checkin.image_url?.startsWith('http')
    ? checkin.image_url
    : getPublicUrl('checkin-images', checkin.image_url)

  return (
    <div className="w-64">
      <img
        src={imageUrl}
        alt={checkin.caption || '打卡照片'}
        className="w-full h-40 object-cover rounded-t-lg"
      />
      <div className="p-3">
        <p className="text-sm text-gray-800 mb-2">{checkin.caption || '无描述'}</p>
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>{checkin.profiles?.nickname || '匿名用户'}</span>
          <span>{timeAgo(checkin.created_at)}</span>
        </div>
        <div className="mt-2">
          <LikeButton targetId={checkin.id} targetType="checkin" count={checkin.likes_count} />
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create ChinaMap component**

Create `src/components/Map/ChinaMap.jsx`:

```jsx
import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapContainer, TileLayer, GeoJSON, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import { fetchLandmarks, fetchCheckins } from '../../lib/api'
import CheckinPopup from './CheckinPopup'
import { MapPin } from 'lucide-react'

// Custom marker icons
const landmarkIcon = L.divIcon({
  className: '',
  html: `<div style="background:#3b82f6;width:10px;height:10px;border-radius:50%;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,.3)"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
})

const checkinIcon = L.divIcon({
  className: '',
  html: `<div style="background:#22c55e;width:10px;height:10px;border-radius:50%;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,.3)"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
})

// Province name mapping (GeoJSON name -> shorter name)
const PROVINCE_MAP = {
  '北京市': '北京', '天津市': '天津', '上海市': '上海', '重庆市': '重庆',
  '河北省': '河北', '山西省': '山西', '辽宁省': '辽宁', '吉林省': '吉林',
  '黑龙江省': '黑龙江', '江苏省': '江苏', '浙江省': '浙江', '安徽省': '安徽',
  '福建省': '福建', '江西省': '江西', '山东省': '山东', '河南省': '河南',
  '湖北省': '湖北', '湖南省': '湖南', '广东省': '广东', '海南省': '海南',
  '四川省': '四川', '贵州省': '贵州', '云南省': '云南', '陕西省': '陕西',
  '甘肃省': '甘肃', '青海省': '青海', '台湾省': '台湾',
  '内蒙古自治区': '内蒙古', '广西壮族自治区': '广西',
  '西藏自治区': '西藏', '宁夏回族自治区': '宁夏',
  '新疆维吾尔自治区': '新疆',
  '香港特别行政区': '香港', '澳门特别行政区': '澳门',
}

function MapEvents({ onProvinceClick }) {
  const map = useMap()

  useEffect(() => {
    const handleZoom = () => {
      const zoom = map.getZoom()
      // Adjust marker size based on zoom
    }
    map.on('zoomend', handleZoom)
    return () => map.off('zoomend', handleZoom)
  }, [map])

  return null
}

export default function ChinaMap() {
  const navigate = useNavigate()
  const [geoJson, setGeoJson] = useState(null)
  const [landmarks, setLandmarks] = useState([])
  const [checkins, setCheckins] = useState([])
  const [hoveredProvince, setHoveredProvince] = useState(null)

  useEffect(() => {
    // Fetch China GeoJSON from DataV
    fetch('https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json')
      .then(r => r.json())
      .then(setGeoJson)
      .catch(console.error)

    // Fetch landmarks and checkins
    fetchLandmarks().then(setLandmarks).catch(console.error)
    fetchCheckins().then(setCheckins).catch(console.error)
  }, [])

  const handleProvinceClick = useCallback((provinceName) => {
    const shortName = PROVINCE_MAP[provinceName] || provinceName
    navigate(`/province/${encodeURIComponent(shortName)}`)
  }, [navigate])

  const onEachFeature = useCallback((feature, layer) => {
    const name = feature.properties.name
    const shortName = PROVINCE_MAP[name] || name

    layer.on({
      click: () => handleProvinceClick(name),
      mouseover: (e) => {
        e.target.setStyle({ fillColor: '#93c5fd', fillOpacity: 0.6 })
        setHoveredProvince(shortName)
      },
      mouseout: (e) => {
        e.target.setStyle({ fillColor: '#dbeafe', fillOpacity: 0.3 })
        setHoveredProvince(null)
      },
    })

    layer.bindTooltip(shortName, { sticky: true })
  }, [handleProvinceClick])

  const geoJsonStyle = {
    fillColor: '#dbeafe',
    fillOpacity: 0.3,
    color: '#9ca3af',
    weight: 1,
  }

  // Combine landmark and checkin markers
  const allMarkers = [
    ...landmarks.map(lm => ({
      ...lm,
      type: 'landmark',
      position: [lm.lat, lm.lng],
    })),
    ...checkins.map(c => ({
      ...c,
      type: 'checkin',
      position: [c.lat, c.lng],
    })),
  ]

  return (
    <MapContainer
      center={[35.8617, 104.1954]}
      zoom={4}
      className="w-full h-full"
      minZoom={3}
      maxZoom={18}
      zoomControl={false}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {geoJson && (
        <GeoJSON
          key="china"
          data={geoJson}
          style={() => geoJsonStyle}
          onEachFeature={onEachFeature}
        />
      )}

      {allMarkers.map((item, i) => (
        <Marker
          key={`${item.type}-${item.id}`}
          position={item.position}
          icon={item.type === 'landmark' ? landmarkIcon : checkinIcon}
          eventHandlers={{
            click: (e) => {
              if (item.type === 'landmark') {
                // Show landmark info in popup
              }
            },
          }}
        >
          {item.type === 'checkin' && (
            <Popup maxWidth={280}>
              <CheckinPopup checkin={item} />
            </Popup>
          )}
          {item.type === 'landmark' && (
            <Popup>
              <div className="w-48">
                <h3 className="font-bold text-sm">{item.name}</h3>
                <p className="text-xs text-gray-500">{item.province} · {item.category}</p>
                <p className="text-xs text-gray-600 mt-1">{item.description}</p>
              </div>
            </Popup>
          )}
        </Marker>
      ))}

      <MapEvents />

      {/* Province hover label */}
      {hoveredProvince && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-white/90 px-3 py-1.5 rounded-lg shadow text-sm font-medium text-gray-700 z-[1000] pointer-events-none">
          {hoveredProvince}
        </div>
      )}
    </MapContainer>
  )
}
```

- [ ] **Step 4: Verify map renders**

```bash
npm run dev
```

Login, and you should see:
- China map with province boundaries (blue fill)
- Province hover highlights and name tooltip
- Landmark markers (blue dots)
- Checkin markers (green dots) — empty for now
- Clicking a province navigates to `/province/:name`

- [ ] **Step 5: Commit**

```bash
git add src/components/Map/ src/lib/api.js
git commit -m "feat: add ChinaMap with province boundaries and landmarks"
```

---

### Task 7: Province Detail View

**Files:**
- Create: `src/components/Map/ProvinceView.jsx`

- [ ] **Step 1: Create ProvinceView**

Create `src/components/Map/ProvinceView.jsx`:

```jsx
import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { MapContainer, TileLayer, GeoJSON, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import { fetchLandmarks, fetchCheckins } from '../../lib/api'
import CheckinPopup from './CheckinPopup'
import { ArrowLeft } from 'lucide-react'

// Province center coordinates
const PROVINCE_CENTERS = {
  '北京': [39.9, 116.4], '天津': [39.1, 117.2], '上海': [31.2, 121.5],
  '重庆': [29.6, 106.5], '河北': [38.0, 114.5], '山西': [37.9, 112.5],
  '辽宁': [41.8, 123.4], '吉林': [43.9, 125.3], '黑龙江': [46.0, 127.7],
  '江苏': [32.1, 118.8], '浙江': [30.3, 120.2], '安徽': [31.8, 117.3],
  '福建': [26.1, 119.3], '江西': [27.6, 116.0], '山东': [36.7, 117.0],
  '河南': [34.8, 113.7], '湖北': [30.6, 114.3], '湖南': [28.2, 112.9],
  '广东': [23.1, 113.3], '海南': [19.2, 109.7], '四川': [30.6, 104.1],
  '贵州': [26.6, 106.7], '云南': [25.0, 102.7], '陕西': [34.3, 108.9],
  '甘肃': [36.1, 103.8], '青海': [36.6, 101.8], '台湾': [23.7, 121.0],
  '内蒙古': [40.8, 111.7], '广西': [22.8, 108.3], '西藏': [29.7, 91.1],
  '宁夏': [37.5, 106.3], '新疆': [43.8, 87.6],
  '香港': [22.3, 114.2], '澳门': [22.2, 113.5],
}

// GeoJSON name to short name mapping
const NAME_TO_SHORT = {
  '北京市': '北京', '天津市': '天津', '上海市': '上海', '重庆市': '重庆',
  '河北省': '河北', '山西省': '山西', '辽宁省': '辽宁', '吉林省': '吉林',
  '黑龙江省': '黑龙江', '江苏省': '江苏', '浙江省': '浙江', '安徽省': '安徽',
  '福建省': '福建', '江西省': '江西', '山东省': '山东', '河南省': '河南',
  '湖北省': '湖北', '湖南省': '湖南', '广东省': '广东', '海南省': '海南',
  '四川省': '四川', '贵州省': '贵州', '云南省': '云南', '陕西省': '陕西',
  '甘肃省': '甘肃', '青海省': '青海', '台湾省': '台湾',
  '内蒙古自治区': '内蒙古', '广西壮族自治区': '广西',
  '西藏自治区': '西藏', '宁夏回族自治区': '宁夏',
  '新疆维吾尔自治区': '新疆',
  '香港特别行政区': '香港', '澳门特别行政区': '澳门',
}

function FlyToProvince({ center }) {
  const map = useMap()
  useEffect(() => {
    if (center) map.flyTo(center, 7, { duration: 1.5 })
  }, [center, map])
  return null
}

const landmarkIcon = L.divIcon({
  className: '',
  html: `<div style="background:#3b82f6;width:10px;height:10px;border-radius:50%;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,.3)"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
})

const checkinIcon = L.divIcon({
  className: '',
  html: `<div style="background:#22c55e;width:10px;height:10px;border-radius:50%;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,.3)"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
})

export default function ProvinceView() {
  const { name } = useParams()
  const navigate = useNavigate()
  const [geoJson, setGeoJson] = useState(null)
  const [landmarks, setLandmarks] = useState([])
  const [checkins, setCheckins] = useState([])

  const center = PROVINCE_CENTERS[name] || [35.86, 104.19]

  useEffect(() => {
    // Find the GeoJSON name for this province
    const geoJsonName = Object.entries(NAME_TO_SHORT).find(([, v]) => v === name)?.[0]

    if (geoJsonName) {
      // Fetch province GeoJSON from DataV
      fetch(`https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json`)
        .then(r => r.json())
        .then(data => {
          // Filter to just this province
          const feature = data.features?.find(f => f.properties.name === geoJsonName)
          if (feature) {
            setGeoJson({ type: 'FeatureCollection', features: [feature] })
          }
        })
        .catch(console.error)
    }

    // Fetch province data
    fetchLandmarks()
      .then(all => setLandmarks(all.filter(l => l.province === name)))
      .catch(console.error)

    fetchCheckins({ province: name })
      .then(setCheckins)
      .catch(console.error)
  }, [name])

  return (
    <div className="w-full h-full relative">
      <MapContainer
        center={center}
        zoom={7}
        className="w-full h-full"
        minZoom={3}
        maxZoom={18}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <FlyToProvince center={center} />

        {geoJson && (
          <GeoJSON
            key={name}
            data={geoJson}
            style={{
              fillColor: '#93c5fd',
              fillOpacity: 0.3,
              color: '#3b82f6',
              weight: 2,
            }}
          />
        )}

        {landmarks.map(lm => (
          <Marker key={`lm-${lm.id}`} position={[lm.lat, lm.lng]} icon={landmarkIcon}>
            <Popup>
              <div className="w-48">
                <h3 className="font-bold text-sm">{lm.name}</h3>
                <p className="text-xs text-gray-500">{lm.city} · {lm.category}</p>
                <p className="text-xs text-gray-600 mt-1">{lm.description}</p>
              </div>
            </Popup>
          </Marker>
        ))}

        {checkins.map(c => (
          <Marker key={`ck-${c.id}`} position={[c.lat, c.lng]} icon={checkinIcon}>
            <Popup maxWidth={280}>
              <CheckinPopup checkin={c} />
            </Popup>
          </Marker>
        ))}
      </MapContainer>

      {/* Back button */}
      <button
        onClick={() => navigate('/')}
        className="absolute top-4 left-4 z-[1000] bg-white hover:bg-gray-50 shadow-lg rounded-lg px-3 py-2 flex items-center gap-2 text-sm font-medium text-gray-700"
      >
        <ArrowLeft className="w-4 h-4" />
        全国地图
      </button>

      {/* Province info badge */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] bg-white/90 shadow-lg rounded-lg px-4 py-2 text-center pointer-events-none">
        <h2 className="font-bold text-gray-900">{name}</h2>
        <p className="text-xs text-gray-500">
          {landmarks.length} 个景点 · {checkins.length} 条打卡
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify province view**

```bash
npm run dev
```

Login, click a province on the map. Expected: Map zooms to province, shows landmarks and checkins, back button returns to national view.

- [ ] **Step 3: Commit**

```bash
git add src/components/Map/ProvinceView.jsx
git commit -m "feat: add ProvinceView with zoom, landmarks, and back navigation"
```

---

### Task 8: Sidebar Component

**Files:**
- Create: `src/components/Sidebar/Sidebar.jsx`
- Create: `src/components/Sidebar/CheckinList.jsx`
- Create: `src/components/Sidebar/GuideList.jsx`
- Create: `src/components/Sidebar/SearchPanel.jsx`

- [ ] **Step 1: Create Sidebar container**

Create `src/components/Sidebar/Sidebar.jsx`:

```jsx
import { useState } from 'react'
import CheckinList from './CheckinList'
import GuideList from './GuideList'
import SearchPanel from './SearchPanel'
import { Camera, BookOpen, Search } from 'lucide-react'

const TABS = [
  { key: 'checkins', label: '打卡', icon: Camera },
  { key: 'guides', label: '攻略', icon: BookOpen },
  { key: 'search', label: '搜索', icon: Search },
]

export default function Sidebar() {
  const [activeTab, setActiveTab] = useState('checkins')

  return (
    <aside className="w-80 border-l border-gray-200 bg-white flex flex-col shrink-0">
      {/* Tab bar */}
      <div className="flex border-b border-gray-200">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto sidebar-scroll">
        {activeTab === 'checkins' && <CheckinList />}
        {activeTab === 'guides' && <GuideList />}
        {activeTab === 'search' && <SearchPanel />}
      </div>
    </aside>
  )
}
```

- [ ] **Step 2: Create CheckinList**

Create `src/components/Sidebar/CheckinList.jsx`:

```jsx
import { useEffect, useState } from 'react'
import { fetchCheckins } from '../../lib/api'
import LikeButton from '../LikeButton'
import { timeAgo, truncate, getPublicUrl } from '../../lib/utils'
import { MapPin, Loader2 } from 'lucide-react'

export default function CheckinList() {
  const [checkins, setCheckins] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchCheckins({ limit: 30 })
      .then(setCheckins)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    )
  }

  if (checkins.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400">
        <Camera className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">还没有打卡记录</p>
        <p className="text-xs mt-1">点击地图开始打卡吧！</p>
      </div>
    )
  }

  return (
    <div className="divide-y divide-gray-100">
      {checkins.map(checkin => {
        const imageUrl = checkin.image_url?.startsWith('http')
          ? checkin.image_url
          : getPublicUrl('checkin-images', checkin.image_url)

        return (
          <div key={checkin.id} className="p-3 hover:bg-gray-50 transition-colors">
            <div className="flex gap-3">
              <img
                src={imageUrl}
                alt=""
                className="w-16 h-16 rounded-lg object-cover shrink-0"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-800 line-clamp-2">
                  {truncate(checkin.caption, 60) || '无描述'}
                </p>
                <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
                  <span>{checkin.profiles?.nickname || '匿名'}</span>
                  <span>·</span>
                  <span>{timeAgo(checkin.created_at)}</span>
                  {checkin.province && (
                    <>
                      <span>·</span>
                      <span className="flex items-center gap-0.5">
                        <MapPin className="w-3 h-3" />
                        {checkin.province}
                      </span>
                    </>
                  )}
                </div>
                <div className="mt-1.5">
                  <LikeButton targetId={checkin.id} targetType="checkin" count={checkin.likes_count} />
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
```

(Note: the `Camera` icon import is needed at the top: `import { MapPin, Loader2, Camera } from 'lucide-react'`)

- [ ] **Step 3: Create GuideList**

Create `src/components/Sidebar/GuideList.jsx`:

```jsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchGuides } from '../../lib/api'
import LikeButton from '../LikeButton'
import { timeAgo, truncate, getPublicUrl } from '../../lib/utils'
import { BookOpen, Loader2 } from 'lucide-react'

export default function GuideList() {
  const navigate = useNavigate()
  const [guides, setGuides] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchGuides({ limit: 20 })
      .then(setGuides)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    )
  }

  if (guides.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400">
        <BookOpen className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">还没有攻略</p>
        <p className="text-xs mt-1">点击"写攻略"开始分享旅程</p>
      </div>
    )
  }

  return (
    <div className="divide-y divide-gray-100">
      {guides.map(guide => (
        <div
          key={guide.id}
          onClick={() => navigate(`/guide/${guide.id}`)}
          className="p-3 hover:bg-gray-50 transition-colors cursor-pointer"
        >
          {guide.cover_image_url && (
            <img
              src={getPublicUrl('guide-covers', guide.cover_image_url)}
              alt=""
              className="w-full h-32 object-cover rounded-lg mb-2"
            />
          )}
          <h3 className="font-medium text-sm text-gray-900">{guide.title}</h3>
          <p className="text-xs text-gray-500 mt-1 line-clamp-2">
            {truncate(guide.content?.replace(/[#*`\n]/g, ' '), 80)}
          </p>
          <div className="flex items-center justify-between mt-2 text-xs text-gray-400">
            <span>{guide.profiles?.nickname || '匿名'}</span>
            <span>{timeAgo(guide.created_at)}</span>
          </div>
          <div className="mt-1.5">
            <LikeButton targetId={guide.id} targetType="guide" count={guide.likes_count} />
          </div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Create SearchPanel**

Create `src/components/Sidebar/SearchPanel.jsx`:

```jsx
import { useState } from 'react'
import { searchSimilar } from '../../lib/api'
import { getPublicUrl, timeAgo } from '../../lib/utils'
import { Search, Loader2, ImageIcon } from 'lucide-react'

export default function SearchPanel() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  async function handleSearch(e) {
    e.preventDefault()
    if (!query.trim()) return

    setLoading(true)
    setSearched(true)
    try {
      const data = await searchSimilar(query.trim())
      setResults(data.results || [])
    } catch (err) {
      console.error('Search failed:', err)
      setResults([])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-4">
      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="以文搜图，如「雪山下的湖泊」"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
        >
          搜索
        </button>
      </form>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          <span className="ml-2 text-sm text-gray-500">搜索中...</span>
        </div>
      )}

      {!loading && searched && results.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <ImageIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">没有找到匹配的照片</p>
          <p className="text-xs mt-1">试试其他关键词</p>
        </div>
      )}

      {!loading && results.length > 0 && (
        <div className="mt-4 space-y-3">
          <p className="text-xs text-gray-500">找到 {results.length} 张匹配照片</p>
          {results.map(item => {
            const imageUrl = item.image_url?.startsWith('http')
              ? item.image_url
              : getPublicUrl('checkin-images', item.image_url)

            return (
              <div key={item.id} className="rounded-lg overflow-hidden border border-gray-100">
                <img
                  src={imageUrl}
                  alt={item.caption || ''}
                  className="w-full h-40 object-cover"
                />
                <div className="p-2">
                  <p className="text-xs text-gray-600">{item.caption || '无描述'}</p>
                  <div className="flex items-center justify-between mt-1 text-xs text-gray-400">
                    <span>相似度: {(item.similarity * 100).toFixed(0)}%</span>
                    <span>{item.province}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!searched && !loading && (
        <div className="text-center py-12 text-gray-400">
          <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">以文搜图</p>
          <p className="text-xs mt-1">输入文字描述，找到最匹配的旅行照片</p>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Verify sidebar**

```bash
npm run dev
```

Login, check that:
- Sidebar shows on the right
- Three tabs (打卡/攻略/搜索) switch correctly
- CheckinList shows empty state
- GuideList shows empty state
- SearchPanel has search input

- [ ] **Step 6: Commit**

```bash
git add src/components/Sidebar/
git commit -m "feat: add Sidebar with checkin list, guide list, and search panel"
```

---

### Task 9: Check-In Form & Photo Upload

**Files:**
- Create: `src/components/CheckinForm.jsx`
- Modify: `src/components/Map/ChinaMap.jsx` (add check-in click handler)
- Create: `supabase/functions/checkin-upload/index.ts`

- [ ] **Step 1: Create CheckinForm component**

Create `src/components/CheckinForm.jsx`:

```jsx
import { useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { randomFilename } from '../lib/utils'
import { Upload, MapPin, X, Loader2 } from 'lucide-react'

export default function CheckinForm({ lat, lng, province, landmarkId, onClose, onSuccess }) {
  const [caption, setCaption] = useState('')
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef()

  function handleFileChange(e) {
    const selected = e.target.files?.[0]
    if (!selected) return
    if (selected.size > 10 * 1024 * 1024) {
      setError('图片大小不能超过 10MB')
      return
    }
    setFile(selected)
    setPreview(URL.createObjectURL(selected))
    setError('')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!file) {
      setError('请选择一张照片')
      return
    }

    setLoading(true)
    setError('')

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('请先登录')

      // Upload image to Supabase Storage
      const filename = randomFilename(file.name)
      const filePath = `${user.id}/${filename}`

      const { error: uploadError } = await supabase.storage
        .from('checkin-images')
        .upload(filePath, file)

      if (uploadError) throw uploadError

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('checkin-images')
        .getPublicUrl(filePath)

      // Insert checkin record
      const { data: checkin, error: insertError } = await supabase
        .from('checkins')
        .insert({
          user_id: user.id,
          landmark_id: landmarkId || null,
          lat,
          lng,
          image_url: publicUrl,
          caption: caption || null,
          province: province || null,
        })
        .select()
        .single()

      if (insertError) throw insertError

      // TODO: Call checkin-upload Edge Function to generate CLIP embedding
      // For now, skip embedding generation

      onSuccess?.(checkin)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[2000] p-4">
      <div className="bg-white rounded-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="font-bold text-gray-900">打卡</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Location info */}
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <MapPin className="w-4 h-4" />
            <span>坐标: {lat.toFixed(4)}, {lng.toFixed(4)}</span>
            {province && <span>· {province}</span>}
          </div>

          {/* Photo upload */}
          <div>
            {preview ? (
              <div className="relative">
                <img src={preview} alt="预览" className="w-full h-48 object-cover rounded-lg" />
                <button
                  type="button"
                  onClick={() => { setFile(null); setPreview(null) }}
                  className="absolute top-2 right-2 p-1 bg-black/50 text-white rounded-full hover:bg-black/70"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full h-48 border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors"
              >
                <Upload className="w-8 h-8 mb-2" />
                <span className="text-sm">点击上传照片</span>
                <span className="text-xs mt-1">支持 JPG/PNG/WebP，最大 10MB</span>
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>

          {/* Caption */}
          <textarea
            placeholder="写下你的感受..."
            value={caption}
            onChange={e => setCaption(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          />

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={loading || !file}
            className="w-full bg-blue-600 text-white py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2 font-medium"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <MapPin className="w-4 h-4" />}
            {loading ? '上传中...' : '打卡'}
          </button>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Update ChinaMap to support check-in clicks**

Add to `src/components/Map/ChinaMap.jsx` — import CheckinForm and add state:

Add these imports at the top:
```jsx
import CheckinForm from '../CheckinForm'
import { MapPin } from 'lucide-react'
```

Add state inside the component:
```jsx
const [checkinPos, setCheckinPos] = useState(null)
```

Add a click handler on the MapContainer:
```jsx
<MapContainer
  center={[35.8617, 104.1954]}
  zoom={4}
  className="w-full h-full"
  minZoom={3}
  maxZoom={18}
  zoomControl={false}
  eventHandlers={{
    click: (e) => {
      // Only handle clicks on the map background, not on markers
      if (e.originalEvent.target.classList.contains('leaflet-container') ||
          e.originalEvent.target.classList.contains('leaflet-tile')) {
        setCheckinPos({ lat: e.latlng.lat, lng: e.latlng.lng })
      }
    },
  }}
>
```

Add the CheckinForm render before the closing `</div>`:
```jsx
{checkinPos && (
  <CheckinForm
    lat={checkinPos.lat}
    lng={checkinPos.lng}
    onClose={() => setCheckinPos(null)}
    onSuccess={(checkin) => {
      setCheckins(prev => [checkin, ...prev])
      setCheckinPos(null)
    }}
  />
)}
```

- [ ] **Step 3: Create Edge Function for check-in upload**

Create `supabase/functions/checkin-upload/index.ts`:

```typescript
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  try {
    // Create Supabase client with user's auth
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    // Get the user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const { checkin_id, image_url } = await req.json()

    // TODO: Generate CLIP embedding
    // For now, this is a placeholder
    // In production, you would:
    // 1. Download the image from storage
    // 2. Send it to a CLIP model endpoint
    // 3. Get the embedding vector
    // 4. Update the checkin record with the embedding

    // Placeholder: generate a random 768-dim vector
    const embedding = Array.from({ length: 768 }, () => Math.random() * 2 - 1)

    // Update the checkin with the embedding
    const { error: updateError } = await supabase
      .from('checkins')
      .update({ embedding: JSON.stringify(embedding) })
      .eq('id', checkin_id)
      .eq('user_id', user.id)

    if (updateError) throw updateError

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
```

- [ ] **Step 4: Verify check-in flow**

```bash
npm run dev
```

Login, click on the map → check-in form appears → upload photo → submit → marker appears on map.

- [ ] **Step 5: Commit**

```bash
git add src/components/CheckinForm.jsx src/components/Map/ChinaMap.jsx supabase/functions/
git commit -m "feat: add check-in form with photo upload"
```

---

### Task 10: Like Button with Realtime

**Files:**
- Create: `src/components/LikeButton.jsx`
- Create: `src/hooks/useLikes.js`

- [ ] **Step 1: Create useLikes hook**

Create `src/hooks/useLikes.js`:

```js
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { checkLiked, toggleLike } from '../lib/api'

/**
 * Hook to manage likes for a target with realtime updates
 */
export function useLikes(targetId, targetType, initialCount = 0) {
  const [liked, setLiked] = useState(false)
  const [count, setCount] = useState(initialCount)
  const [loading, setLoading] = useState(false)

  // Check if current user has liked this target
  useEffect(() => {
    checkLiked(targetId, targetType)
      .then(setLiked)
      .catch(() => {})
  }, [targetId, targetType])

  // Subscribe to realtime count changes
  useEffect(() => {
    const channel = supabase
      .channel(`likes-${targetType}-${targetId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'likes',
          filter: `target_id=eq.${targetId}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setCount(prev => prev + 1)
          } else if (payload.eventType === 'DELETE') {
            setCount(prev => Math.max(0, prev - 1))
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [targetId, targetType])

  const handleToggle = useCallback(async () => {
    if (loading) return
    setLoading(true)
    try {
      const newLiked = await toggleLike(targetId, targetType)
      setLiked(newLiked)
      // Count is updated by the trigger + realtime
    } catch (err) {
      console.error('Like toggle failed:', err)
    } finally {
      setLoading(false)
    }
  }, [targetId, targetType, loading])

  return { liked, count, loading, toggle: handleToggle }
}
```

- [ ] **Step 2: Create LikeButton component**

Create `src/components/LikeButton.jsx`:

```jsx
import { useLikes } from '../hooks/useLikes'
import { Heart } from 'lucide-react'
import { formatCount } from '../lib/utils'

export default function LikeButton({ targetId, targetType, count = 0 }) {
  const { liked, count: liveCount, loading, toggle } = useLikes(targetId, targetType, count)

  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        toggle()
      }}
      disabled={loading}
      className={`inline-flex items-center gap-1 text-xs transition-colors ${
        liked
          ? 'text-red-500'
          : 'text-gray-400 hover:text-red-400'
      }`}
    >
      <Heart
        className={`w-4 h-4 ${liked ? 'fill-current' : ''} ${loading ? 'animate-pulse' : ''}`}
      />
      <span>{formatCount(liveCount)}</span>
    </button>
  )
}
```

- [ ] **Step 3: Verify likes**

```bash
npm run dev
```

Login, check that LikeButton renders correctly on checkins and guides. Click to toggle like.

- [ ] **Step 4: Commit**

```bash
git add src/components/LikeButton.jsx src/hooks/useLikes.js
git commit -m "feat: add LikeButton with realtime updates"
```

---

### Task 11: Guide Editor & Detail

**Files:**
- Create: `src/components/Guide/GuideEditor.jsx`
- Create: `src/components/Guide/GuideDetail.jsx`

- [ ] **Step 1: Create GuideEditor**

Create `src/components/Guide/GuideEditor.jsx`:

```jsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createGuide } from '../../lib/api'
import { ArrowLeft, Eye, Edit3, Loader2 } from 'lucide-react'

export default function GuideEditor() {
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [province, setProvince] = useState('')
  const [preview, setPreview] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const PROVINCES = [
    '北京', '天津', '上海', '重庆', '河北', '山西', '辽宁', '吉林',
    '黑龙江', '江苏', '浙江', '安徽', '福建', '江西', '山东', '河南',
    '湖北', '湖南', '广东', '海南', '四川', '贵州', '云南', '陕西',
    '甘肃', '青海', '台湾', '内蒙古', '广西', '西藏', '宁夏', '新疆',
  ]

  async function handleSubmit() {
    if (!title.trim()) {
      setError('请输入标题')
      return
    }

    setLoading(true)
    setError('')
    try {
      const guide = await createGuide({
        title: title.trim(),
        content,
        province: province || null,
      })
      navigate(`/guide/${guide.id}`)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft className="w-4 h-4" />
          返回
        </button>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setPreview(!preview)}
            className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            {preview ? <Edit3 className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            {preview ? '编辑' : '预览'}
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            发布
          </button>
        </div>
      </header>

      <div className="max-w-3xl mx-auto p-6 space-y-4">
        {/* Title */}
        <input
          type="text"
          placeholder="攻略标题"
          value={title}
          onChange={e => setTitle(e.target.value)}
          className="w-full text-2xl font-bold bg-transparent border-none outline-none placeholder:text-gray-300"
        />

        {/* Province selector */}
        <select
          value={province}
          onChange={e => setProvince(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-600 outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">选择省份（可选）</option>
          {PROVINCES.map(p => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>

        {/* Content */}
        {preview ? (
          <div className="prose prose-sm max-w-none bg-white rounded-lg p-6 min-h-[400px] border border-gray-200">
            <div className="whitespace-pre-wrap text-gray-800">{content || '（空）'}</div>
          </div>
        ) : (
          <textarea
            placeholder="写下你的旅行攻略...&#10;&#10;支持 Markdown 格式：&#10;# 标题&#10;## 二级标题&#10;- 列表项&#10;**加粗** *斜体*"
            value={content}
            onChange={e => setContent(e.target.value)}
            rows={20}
            className="w-full px-4 py-3 bg-white border border-gray-200 rounded-lg text-sm resize-y focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none font-mono"
          />
        )}

        {error && <p className="text-red-500 text-sm">{error}</p>}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create GuideDetail**

Create `src/components/Guide/GuideDetail.jsx`:

```jsx
import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { fetchGuide } from '../../lib/api'
import LikeButton from '../LikeButton'
import { timeAgo } from '../../lib/utils'
import { ArrowLeft, Loader2, MapPin } from 'lucide-react'

export default function GuideDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [guide, setGuide] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchGuide(id)
      .then(setGuide)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [id])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    )
  }

  if (!guide) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-gray-400">
        <p>攻略不存在</p>
        <button onClick={() => navigate('/')} className="mt-2 text-blue-600 hover:underline">
          返回首页
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-10">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft className="w-4 h-4" />
          返回
        </button>
      </header>

      <article className="max-w-3xl mx-auto p-6">
        {/* Cover image */}
        {guide.cover_image_url && (
          <img
            src={guide.cover_image_url}
            alt=""
            className="w-full h-64 object-cover rounded-xl mb-6"
          />
        )}

        {/* Title */}
        <h1 className="text-3xl font-bold text-gray-900 mb-4">{guide.title}</h1>

        {/* Meta */}
        <div className="flex items-center gap-4 text-sm text-gray-500 mb-6">
          <span>{guide.profiles?.nickname || '匿名'}</span>
          <span>{timeAgo(guide.created_at)}</span>
          {guide.province && (
            <span className="flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5" />
              {guide.province}
            </span>
          )}
          <LikeButton targetId={guide.id} targetType="guide" count={guide.likes_count} />
        </div>

        {/* Content */}
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <div className="prose prose-sm max-w-none whitespace-pre-wrap text-gray-800">
            {guide.content || '（无内容）'}
          </div>
        </div>
      </article>
    </div>
  )
}
```

- [ ] **Step 3: Verify guide flow**

```bash
npm run dev
```

Login, click "写攻略", fill in title and content, click "发布" → redirects to guide detail page. Guide appears in sidebar guide list.

- [ ] **Step 4: Commit**

```bash
git add src/components/Guide/
git commit -m "feat: add GuideEditor and GuideDetail components"
```

---

### Task 12: Search Edge Function

**Files:**
- Create: `supabase/functions/search-similar/index.ts`

- [ ] **Step 1: Create search-similar Edge Function**

Create `supabase/functions/search-similar/index.ts`:

```typescript
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    const { query, limit = 20 } = await req.json()

    if (!query || typeof query !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing query parameter' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // TODO: Replace with actual CLIP text encoding
    // For now, use a random embedding as placeholder
    // In production:
    // 1. Send text to CLIP text encoder
    // 2. Get text embedding vector
    const queryEmbedding = Array.from({ length: 768 }, () => Math.random() * 2 - 1)

    // Search using pgvector cosine similarity
    const { data, error } = await supabase.rpc('search_checkins', {
      query_embedding: JSON.stringify(queryEmbedding),
      match_count: limit,
    })

    if (error) {
      // Fallback: simple text search if vector search fails
      const { data: fallback, error: fbError } = await supabase
        .from('checkins')
        .select('id, image_url, caption, lat, lng, province, created_at')
        .ilike('caption', `%${query}%`)
        .limit(limit)

      if (fbError) throw fbError

      return new Response(JSON.stringify({
        results: (fallback || []).map(item => ({ ...item, similarity: 0.5 })),
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ results: data || [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
```

- [ ] **Step 2: Add the search_checkins RPC function to the migration**

Add to the bottom of `supabase/migrations/20260826000000_init.sql`:

```sql
-- =============================================
-- RPC function for vector similarity search
-- =============================================
CREATE OR REPLACE FUNCTION search_checkins(
  query_embedding TEXT,
  match_count INT DEFAULT 20
)
RETURNS TABLE (
  id BIGINT,
  image_url TEXT,
  caption TEXT,
  lat NUMERIC,
  lng NUMERIC,
  province TEXT,
  created_at TIMESTAMPTZ,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.image_url,
    c.caption,
    c.lat,
    c.lng,
    c.province,
    c.created_at,
    (1 - (c.embedding <=> query_embedding::vector))::FLOAT AS similarity
  FROM checkins c
  WHERE c.embedding IS NOT NULL
  ORDER BY c.embedding <=> query_embedding::vector
  LIMIT match_count;
END;
$$;
```

- [ ] **Step 3: Commit**

```bash
git add supabase/
git commit -m "feat: add search-similar Edge Function and vector search RPC"
```

---

### Task 13: Final Polish & Cleanup

**Files:**
- Modify: `src/index.css`
- Modify: `src/App.jsx` (minor)
- Delete: old template assets

- [ ] **Step 1: Remove unused template assets**

```bash
rm -f src/assets/react.svg src/assets/vite.svg src/assets/hero.png
```

- [ ] **Step 2: Add Leaflet CSS import**

Add to `src/index.css` (at the top, after the tailwind import):

```css
@import "tailwindcss";
@import "leaflet/dist/leaflet.css";
```

- [ ] **Step 3: Verify full app flow**

```bash
npm run dev
```

Complete flow:
1. Login/signup works
2. China map loads with province boundaries and landmarks
3. Province hover highlights and shows name
4. Click province → zooms to province detail
5. Back button returns to national view
6. Click map → check-in form appears
7. Upload photo + caption → check-in saved
8. Check-in appears in sidebar
9. Like button toggles and updates count
10. Write guide → publishes → shows in guide list
11. Guide detail page renders
12. Search panel accepts text input

- [ ] **Step 4: Run build to verify no errors**

```bash
npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: polish - remove template assets, add Leaflet CSS, verify full flow"
```

---

## Deployment Notes

After development is complete:

1. **Supabase Cloud**: `supabase link --project-ref <your-project-id> && supabase db push && supabase functions deploy`
2. **Frontend**: Deploy `dist/` to Vercel/Netlify, update `.env` with production Supabase credentials
3. **CLIP Integration**: Replace the placeholder embedding in Edge Functions with actual CLIP model (consider using a hosted inference API like Replicate or HuggingFace)
4. **GeoJSON**: The DataV CDN URLs are used at runtime; for production, consider bundling the GeoJSON for faster loading
