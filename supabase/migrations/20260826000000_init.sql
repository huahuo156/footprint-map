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
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
) ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'guide-covers',
  'guide-covers',
  true,
  5242880,
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
