CREATE TABLE IF NOT EXISTS journal_trips (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  region VARCHAR(120),
  color VARCHAR(20) NOT NULL DEFAULT 'sage',
  canvas_x DOUBLE NOT NULL DEFAULT 0,
  canvas_y DOUBLE NOT NULL DEFAULT 0,
  legacy_key VARCHAR(64) UNIQUE,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
);
CREATE TABLE IF NOT EXISTS journal_entries (
  id CHAR(36) PRIMARY KEY,
  trip_id CHAR(36),
  entry_date DATE NOT NULL,
  captured_on DATE,
  components JSON,
  title VARCHAR(160),
  caption TEXT,
  place_name VARCHAR(255),
  landmark_id INT,
  lat DOUBLE,
  lng DOUBLE,
  spot_key VARCHAR(40),
  mood VARCHAR(20),
  canvas_x DOUBLE,
  canvas_y DOUBLE,
  rotation DOUBLE NOT NULL DEFAULT 0,
  legacy_checkin_id INT UNIQUE,
  layout_version BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  FOREIGN KEY (trip_id) REFERENCES journal_trips(id),
  FOREIGN KEY (landmark_id) REFERENCES landmarks(id) ON DELETE SET NULL,
  INDEX idx_journal_date (entry_date, id)
);
CREATE TABLE IF NOT EXISTS journal_photos (
  id CHAR(36) PRIMARY KEY,
  entry_id CHAR(36) NOT NULL,
  url TEXT NOT NULL,
  crop_x INT NOT NULL DEFAULT 50,
  image_filter VARCHAR(20) NOT NULL DEFAULT 'original',
  components JSON,
  canvas_x DOUBLE,
  canvas_y DOUBLE,
  canvas_absolute BOOLEAN NOT NULL DEFAULT FALSE,
  rotation DOUBLE NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  layout_version BIGINT UNSIGNED NOT NULL DEFAULT 0,
  FOREIGN KEY (entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE,
  INDEX idx_journal_photos_entry (entry_id)
);
CREATE TABLE IF NOT EXISTS journal_migrations (
  name VARCHAR(100) PRIMARY KEY,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS journal_canvas_groups (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  color VARCHAR(20) NOT NULL DEFAULT 'sage',
  collapsed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
);
CREATE TABLE IF NOT EXISTS journal_canvas_group_photos (
  photo_id CHAR(36) PRIMARY KEY,
  group_id CHAR(36) NOT NULL,
  FOREIGN KEY (photo_id) REFERENCES journal_photos(id) ON DELETE CASCADE,
  FOREIGN KEY (group_id) REFERENCES journal_canvas_groups(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS journal_canvas_group_children (
  child_id CHAR(36) PRIMARY KEY,
  parent_id CHAR(36) NOT NULL,
  FOREIGN KEY (child_id) REFERENCES journal_canvas_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES journal_canvas_groups(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS journal_marks (
  id CHAR(36) PRIMARY KEY,
  kind VARCHAR(20) NOT NULL,
  text VARCHAR(500),
  sticker VARCHAR(30),
  color VARCHAR(20) NOT NULL DEFAULT 'ink',
  size VARCHAR(20) NOT NULL DEFAULT 'medium',
  canvas_x DOUBLE NOT NULL DEFAULT 0,
  canvas_y DOUBLE NOT NULL DEFAULT 0,
  rotation DOUBLE NOT NULL DEFAULT 0,
  captured_on DATE NOT NULL,
  layout_version BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
);
CREATE TABLE IF NOT EXISTS journal_notebooks (
 id CHAR(36) PRIMARY KEY, name VARCHAR(120) NOT NULL, cover_url VARCHAR(500),
 cover_label VARCHAR(60) NOT NULL DEFAULT 'MEMO', cover_text VARCHAR(500) NOT NULL DEFAULT '',
 cover_mode VARCHAR(10) NOT NULL DEFAULT 'solid', cover_color CHAR(7) NOT NULL DEFAULT '#e3e9dd',
 bookmark_page_id CHAR(36) NULL, last_read_page_id CHAR(36) NULL,
 canvas_x DOUBLE NOT NULL DEFAULT 0, canvas_y DOUBLE NOT NULL DEFAULT 0, rotation DOUBLE NOT NULL DEFAULT 0,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
);
CREATE TABLE IF NOT EXISTS journal_notebook_pages (
 id CHAR(36) PRIMARY KEY, notebook_id CHAR(36) NOT NULL, sort_order INT NOT NULL,
 FOREIGN KEY (notebook_id) REFERENCES journal_notebooks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS journal_notebook_photo_items (
 id CHAR(36) PRIMARY KEY, page_id CHAR(36) NOT NULL, x DOUBLE NOT NULL, y DOUBLE NOT NULL, rotation DOUBLE NOT NULL DEFAULT 0,
 FOREIGN KEY (id) REFERENCES journal_photos(id) ON DELETE CASCADE,
 FOREIGN KEY (page_id) REFERENCES journal_notebook_pages(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS journal_notebook_mark_items (
 id CHAR(36) PRIMARY KEY, page_id CHAR(36) NOT NULL, x DOUBLE NOT NULL, y DOUBLE NOT NULL, rotation DOUBLE NOT NULL DEFAULT 0,
 FOREIGN KEY (id) REFERENCES journal_marks(id) ON DELETE CASCADE,
 FOREIGN KEY (page_id) REFERENCES journal_notebook_pages(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS journal_notebook_entry_items (
 id CHAR(36) PRIMARY KEY, page_id CHAR(36) NOT NULL, x DOUBLE NOT NULL, y DOUBLE NOT NULL, rotation DOUBLE NOT NULL DEFAULT 0,
 FOREIGN KEY (id) REFERENCES journal_entries(id) ON DELETE CASCADE,
 FOREIGN KEY (page_id) REFERENCES journal_notebook_pages(id) ON DELETE CASCADE
);
