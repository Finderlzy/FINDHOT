#!/usr/bin/env bash
# 在本机构建前端并打包，产物放在家目录。上传到服务器解压后，用 deploy/Dockerfile.prebuilt 构建镜像，服务器上不再编译前端。
# 用法：bash deploy/pack.sh
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build -w @aihot/web
out="$HOME/release-$(date +%Y%m%d-%H%M).tgz"
tar czf "$out" --exclude=node_modules --exclude=./.git --exclude=./.data --exclude=./apps/web/.react-router \
  --exclude=./.env --exclude=./CLAUDE.local.md --exclude=./.claude .
echo "打好了：$out（$(du -h "$out" | cut -f1)）"
