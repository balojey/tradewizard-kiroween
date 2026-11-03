#!/usr/bin/env bash
#
# Run a Next.js command with an explicit env file.
#
# Why this exists: Next.js only auto-loads .env, .env.local, .env.development and
# .env.production — a `.env.prod` file is invisible to it. Node's own
# `--env-file` looks like the answer but breaks the build: Next propagates its
# exec flags into the worker NODE_OPTIONS, and Node refuses `--env-file` there
# ("--env-file= is not allowed in NODE_OPTIONS"), so page-data collection dies
# with exit code 9.
#
# So: export the file into the process environment and let the child inherit it.
# Next's loader only fills variables that are still undefined, which means these
# values win over .env.local — the behaviour we want for a prod artifact.
#
# NEXT_PUBLIC_* is inlined at BUILD time, so use this for `build`, not only for
# `start`; setting the values at runtime cannot change an already-built bundle.
#
# Usage: with-env-file.sh <env-file> <next-subcommand> [args...]

set -euo pipefail

env_file="${1:?usage: with-env-file.sh <env-file> <next-subcommand> [args...]}"
command="${2:?usage: with-env-file.sh <env-file> <next-subcommand> [args...]}"
shift 2

cd "$(dirname "$0")/.."

if [ ! -f "$env_file" ]; then
  echo "error: $env_file not found in $(pwd) (see .env.example)" >&2
  exit 1
fi

set -a
# shellcheck source=/dev/null
. "./$env_file"
set +a

exec node node_modules/next/dist/bin/next "$command" "$@"
