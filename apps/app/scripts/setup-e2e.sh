#!/bin/bash
set -euo pipefail
exec bun --no-env-file "$(dirname "$0")/setup-e2e.ts" "$@"
