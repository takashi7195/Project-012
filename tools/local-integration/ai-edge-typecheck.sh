#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
docker_config_dir="$(mktemp -d)"
chmod 700 "$docker_config_dir"
export DOCKER_CONFIG="$docker_config_dir"
cleanup() { rm -rf "$docker_config_dir"; }
trap cleanup EXIT INT TERM

docker info >/dev/null
docker pull denoland/deno:alpine
docker run --rm --network none \
  --mount "type=bind,source=$repo_root,target=/workspace,readonly" \
  --workdir /workspace denoland/deno:alpine \
  deno check --no-config supabase/functions/predictions/index.ts
