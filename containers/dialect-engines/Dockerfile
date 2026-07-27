FROM docker.io/cloudflare/sandbox:0.10.3

USER root

ENV DEBIAN_FRONTEND=noninteractive

# The Sandbox base is Ubuntu 22.04. Install PostgreSQL from Ubuntu and Oracle
# MySQL 8.4 LTS from the official MySQL APT repository. Do not substitute
# MariaDB: the lab verifies MySQL-specific parser and execution semantics.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gnupg \
    jq \
    postgresql \
    postgresql-client \
  && curl -fsSL https://repo.mysql.com/RPM-GPG-KEY-mysql-2023 \
    | gpg --dearmor -o /usr/share/keyrings/mysql-archive-keyring.gpg \
  && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/mysql-archive-keyring.gpg] https://repo.mysql.com/apt/ubuntu/ jammy mysql-8.4-lts" \
    > /etc/apt/sources.list.d/mysql-community.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
    mysql-community-client \
    mysql-community-server-core \
  && (getent group mysql >/dev/null || groupadd --system mysql) \
  && (id -u mysql >/dev/null 2>&1 || useradd --system --gid mysql --home-dir /nonexistent --shell /usr/sbin/nologin mysql) \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /opt/sql-academy-dialect-runner \
  && chmod 0755 /opt/sql-academy-dialect-runner \
  && mysqld --version \
  && mysql --version \
  && pg_config --version

COPY runner.mjs /opt/sql-academy-dialect-runner/runner.mjs

RUN chmod 0555 /opt/sql-academy-dialect-runner/runner.mjs

# Preserve the Cloudflare Sandbox base image entrypoint and API port.
EXPOSE 3000
