#!/usr/bin/env sh
set -e

STORAGE_ROOT="${APP_STORAGE_ROOT:-/data}"

mkdir -p "${STORAGE_ROOT}/credentials" "${STORAGE_ROOT}/data"
chown -R node:node "${STORAGE_ROOT}"

cd /srv/warest

[ -e credentials ] && [ ! -L credentials ] && rm -rf credentials
[ -e data ] && [ ! -L data ] && rm -rf data
ln -sf "${STORAGE_ROOT}/credentials" credentials
ln -sf "${STORAGE_ROOT}/data" data

echo "[entrypoint] APP_STORAGE_ROOT=${STORAGE_ROOT}"
echo "[entrypoint] credentials -> ${STORAGE_ROOT}/credentials"
echo "[entrypoint] data        -> ${STORAGE_ROOT}/data"
echo "[entrypoint] drop privilege to node"

exec su-exec node:node "$@"
