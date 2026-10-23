#!/usr/bin/env bash
# AutoDL 原生 MySQL 启动脚本（替代 docker compose 版 db:up，AutoDL 无法嵌套 Docker）
# 用法：npm run db:up:autodl  或  bash scripts/db-up-autodl.sh
# 幂等：可重复执行；密码以 .env 中 MYSQL_PASSWORD 为准（勿含引号/反斜杠）
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || { echo "缺少 .env 文件"; exit 1; }
set -a; source .env; set +a

DB="${MYSQL_DATABASE:-footprint_map}"
APP_USER="${MYSQL_USER:-footprint}"
APP_PASS="${MYSQL_PASSWORD:?请在 .env 设置 MYSQL_PASSWORD}"
APP_PORT="${MYSQL_PORT:-3306}"

# 1. 安装（已装则跳过）
if ! command -v mysqld >/dev/null 2>&1 && ! command -v mariadbd >/dev/null 2>&1; then
  echo "==> 安装 MySQL ..."
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y mysql-server
fi

# 2. 启动服务（AutoDL 无 systemd，用 service）
echo "==> 启动 MySQL 服务 ..."
service mysql start 2>/dev/null || service mariadb start 2>/dev/null || true
for i in $(seq 1 30); do
  if mysqladmin ping --silent 2>/dev/null; then break; fi
  [ "$i" = 30 ] && { echo "MySQL 启动超时"; exit 1; }
  sleep 1
done

# 3. 建库建用户（幂等，重复执行会同步密码）
echo "==> 初始化数据库 $DB 和用户 $APP_USER ..."
mysql -uroot <<SQL
CREATE DATABASE IF NOT EXISTS \`$DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$APP_USER'@'localhost' IDENTIFIED BY '$APP_PASS';
CREATE USER IF NOT EXISTS '$APP_USER'@'127.0.0.1' IDENTIFIED BY '$APP_PASS';
ALTER USER '$APP_USER'@'localhost' IDENTIFIED BY '$APP_PASS';
ALTER USER '$APP_USER'@'127.0.0.1' IDENTIFIED BY '$APP_PASS';
GRANT ALL PRIVILEGES ON \`$DB\`.* TO '$APP_USER'@'localhost';
GRANT ALL PRIVILEGES ON \`$DB\`.* TO '$APP_USER'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL

# 4. 用应用同款凭证验证连接
mysql -h127.0.0.1 -P"$APP_PORT" -u"$APP_USER" -p"$APP_PASS" -e "SELECT 1" >/dev/null
echo "==> 数据库就绪: 127.0.0.1:$APP_PORT/$DB（表结构由应用启动时自动创建）"
