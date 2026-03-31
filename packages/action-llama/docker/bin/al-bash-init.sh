#!/bin/bash
# Bash initialization script sourced before every agent command.
# Defines helpers and restores persisted environment variables.
#
# This file is sourced (not executed), so functions and exports
# take effect in the caller's shell.

# ---------- setenv ----------
# Persist an environment variable across bash tool calls.
#
# Usage:
#   setenv NAME value
#   setenv NAME1 value1 NAME2 value2   (multiple pairs)
#   setenv NAME1 value1 setenv NAME2 value2   (tolerates stray "setenv" tokens)
#
# Each bash tool call spawns a fresh shell, so variables set with plain
# `export` are lost. setenv writes them to a file that this init script
# re-sources on each call.

_AL_ENV_FILE="${AL_ENV_FILE:-/tmp/env.sh}"

setenv() {
  # Strip any stray "setenv" tokens (LLMs sometimes repeat the command name
  # between pairs: `setenv A 1 setenv B 2`).
  local args=()
  for _x in "$@"; do
    [ "$_x" != "setenv" ] && args+=("$_x")
  done
  set -- "${args[@]}"

  if [ $# -lt 2 ]; then
    echo 'usage: setenv NAME value [NAME2 value2 ...]' >&2
    return 1
  fi

  local _count=0

  # Process NAME VALUE pairs.
  while [ $# -ge 2 ]; do
    # Stop if the key isn't a valid variable name.
    if [[ ! "$1" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]]; then
      echo "setenv: invalid variable name: $1" >&2
      return 1
    fi
    printf 'export %s=%q\n' "$1" "$2" >> "$_AL_ENV_FILE"
    export "$1"="$2"
    _count=$((_count + 1))
    shift 2
  done

  # Confirm so the agent knows it worked.
  if [ $_count -eq 1 ]; then
    echo "set 1 variable"
  else
    echo "set $_count variables"
  fi
}

# ---------- Restore persisted env ----------
[ -f "$_AL_ENV_FILE" ] && . "$_AL_ENV_FILE"
