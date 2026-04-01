#!/bin/sh
# Shell initialization script sourced before every agent command.
# Defines helpers and restores persisted environment variables.
#
# This file is sourced (not executed), so functions and exports
# take effect in the caller's shell.
#
# Written in POSIX sh so it works under bash, dash, busybox sh, etc.

# ---------- setenv ----------
# Persist an environment variable across shell tool calls.
#
# Usage:
#   setenv NAME value
#   setenv NAME1 value1 NAME2 value2   (multiple pairs)
#   setenv NAME1 value1 setenv NAME2 value2   (tolerates stray "setenv" tokens)
#
# Each shell tool call spawns a fresh shell, so variables set with plain
# `export` are lost. setenv writes them to a file that this init script
# re-sources on each call.

_AL_ENV_FILE="${AL_ENV_FILE:-/tmp/env.sh}"

setenv() {
  if [ $# -lt 2 ]; then
    echo 'usage: setenv NAME value [NAME2 value2 ...]' >&2
    return 1
  fi

  _al_count=0

  while [ $# -ge 1 ]; do
    # Skip stray "setenv" tokens (LLMs sometimes repeat the command name
    # between pairs: `setenv A 1 setenv B 2`).
    if [ "$1" = "setenv" ]; then
      shift
      continue
    fi

    if [ $# -lt 2 ]; then
      echo 'usage: setenv NAME value [NAME2 value2 ...]' >&2
      return 1
    fi

    # Validate variable name using case (POSIX replacement for [[ =~ ]]).
    # Rejects names that start with a non-letter/underscore, or contain
    # any non-alphanumeric/underscore character.
    case "$1" in
      [!a-zA-Z_]* | *[!a-zA-Z0-9_]*)
        echo "setenv: invalid variable name: $1" >&2
        return 1
        ;;
    esac

    _al_name="$1"
    _al_value="$2"
    shift 2

    # Write to env file using single-quote escaping (POSIX-safe alternative
    # to printf %q, which is a bash extension).
    # Replaces every ' in the value with '\'', then wraps in single quotes.
    _al_escaped=$(printf '%s' "$_al_value" | sed "s/'/'\\\\''/g")
    printf "export %s='%s'\n" "$_al_name" "$_al_escaped" >> "$_AL_ENV_FILE"

    # Set the variable in the current shell.
    # eval with $name=$value (unquoted RHS) is safe: variable assignment
    # does not perform word-splitting, so spaces are preserved.
    eval "$_al_name=\$_al_value"
    export "$_al_name"

    _al_count=$((_al_count + 1))
  done

  # Confirm so the agent knows it worked.
  if [ "$_al_count" -eq 1 ]; then
    echo "set 1 variable"
  else
    echo "set $_al_count variables"
  fi
}

# ---------- Restore persisted env ----------
[ -f "$_AL_ENV_FILE" ] && . "$_AL_ENV_FILE"
