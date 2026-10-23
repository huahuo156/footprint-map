CREATE TABLE IF NOT EXISTS landmarks (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  province VARCHAR(64) NOT NULL,
  city VARCHAR(255),
  lat DOUBLE NOT NULL,
  lng DOUBLE NOT NULL,
  category VARCHAR(64),
  description TEXT,
  INDEX idx_landmarks_province (province)
);
CREATE TABLE IF NOT EXISTS checkins (
  id INT PRIMARY KEY AUTO_INCREMENT,
  landmark_id INT,
  lat DOUBLE NOT NULL,
  lng DOUBLE NOT NULL,
  image_url TEXT NOT NULL,
  caption TEXT,
  province VARCHAR(64),
  likes_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (landmark_id) REFERENCES landmarks(id) ON DELETE SET NULL,
  INDEX idx_checkins_province (province)
);
CREATE TABLE IF NOT EXISTS guides (
  id INT PRIMARY KEY AUTO_INCREMENT,
  title VARCHAR(255) NOT NULL,
  content MEDIUMTEXT,
  cover_image_url TEXT,
  province VARCHAR(64),
  landmark_ids JSON NOT NULL,
  likes_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_guides_province (province)
);
CREATE TABLE IF NOT EXISTS likes (
  target_id INT NOT NULL,
  target_type ENUM('checkin', 'guide') NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (target_id, target_type)
);
