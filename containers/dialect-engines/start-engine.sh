#!/usr/bin/env bash
set -euo pipefail

engine="${1:-}"

start_postgresql() {
  if pg_isready -q -h /var/run/postgresql -U postgres; then
    exit 0
  fi
  version="$(pg_lsclusters --no-header | awk 'NR==1 {print $1}')"
  cluster="$(pg_lsclusters --no-header | awk 'NR==1 {print $2}')"
  test -n "$version"
  test -n "$cluster"
  pg_ctlcluster "$version" "$cluster" start
  for _ in $(seq 1 60); do
    if pg_isready -q -h /var/run/postgresql -U postgres; then
      exit 0
    fi
    sleep 0.25
  done
  echo "PostgreSQL did not become ready" >&2
  exit 1
}

start_mysql() {
  install -d -o mysql -g mysql /var/run/mysqld
  if mysqladmin --protocol=socket --socket="${MYSQL_SOCKET:-/var/run/mysqld/mysqld.sock}" ping --silent; then
    exit 0
  fi
  mysqld_safe \
    --user=mysql \
    --skip-name-resolve \
    --bind-address=127.0.0.1 \
    --max-connections=16 \
    --performance-schema=OFF \
    >/tmp/mysql-startup.log 2>&1 &
  for _ in $(seq 1 120); do
    if mysqladmin --protocol=socket --socket="${MYSQL_SOCKET:-/var/run/mysqld/mysqld.sock}" ping --silent; then
      exit 0
    fi
    sleep 0.25
  done
  tail -n 80 /tmp/mysql-startup.log >&2 || true
  echo "MySQL did not become ready" >&2
  exit 1
}

case "$engine" in
  postgresql) start_postgresql ;;
  mysql) start_mysql ;;
  *) echo "Unsupported engine" >&2; exit 64 ;;
esac
