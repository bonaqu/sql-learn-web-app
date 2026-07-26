FROM docker.io/cloudflare/sandbox:0.10.3

USER root
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    postgresql \
    postgresql-client \
    mysql-server \
    mysql-client \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/dialect-engine
COPY containers/dialect-engines/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund

COPY containers/dialect-engines/engine-runner.mjs ./engine-runner.mjs
COPY containers/dialect-engines/start-engine.sh ./start-engine.sh
RUN chmod 0755 ./start-engine.sh

ENV NODE_ENV=production
ENV TZ=UTC
ENV PGHOST=/var/run/postgresql
ENV PGUSER=postgres
ENV MYSQL_SOCKET=/var/run/mysqld/mysqld.sock

CMD ["sleep", "infinity"]
