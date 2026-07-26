FROM docker.io/cloudflare/sandbox:0.10.3

USER root

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    jq \
    mariadb-client \
    mariadb-server \
    postgresql \
    postgresql-client \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /opt/sql-academy-dialect-runner \
  && chmod 0755 /opt/sql-academy-dialect-runner

COPY runner.mjs /opt/sql-academy-dialect-runner/runner.mjs

RUN chmod 0555 /opt/sql-academy-dialect-runner/runner.mjs

# Preserve the Cloudflare Sandbox base image entrypoint and API port.
EXPOSE 3000
