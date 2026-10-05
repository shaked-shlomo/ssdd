#!/bin/sh
# Back-compat entry point: `inject.sh <target> [adapters]` is
# `node bin/ssdd.mjs install <target> [adapters]`. See bin/ssdd.mjs for
# install / update / adopt / status.
exec node "$(cd "$(dirname "$0")" && pwd)/bin/ssdd.mjs" install "$@"
