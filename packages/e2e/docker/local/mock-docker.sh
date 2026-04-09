#!/bin/bash
# Mock Docker CLI for e2e tests.
#
# The scheduler uses Docker to provision and connect to agent containers via the
# transport layer. Since real Docker is unavailable inside the test container,
# this mock simulates the essential commands:
#
#   info  — startup health check
#   run   — provision a container (returns a fake ID)
#   exec  — run a command directly in this container (no real container)
#   cp    — copy files locally (source/dest both resolve to local paths)
#   rm    — container cleanup (no-op)

case "$1" in
  info)
    echo "Server Version: 24.0.0"
    ;;
  run)
    # The transport calls `docker run -d --name <name> ... <image> tail -f /dev/null`
    # Return a fake container ID so provisionContainer() succeeds.
    echo "mock-container-$(head -c 8 /dev/urandom | od -A n -t x1 | tr -d ' \n')"
    ;;
  exec)
    # The transport calls `docker exec [-i] [-u user] <container> <cmd> [args...]`
    # Skip flags and the container name, then exec the command directly.
    shift  # remove "exec"
    while [ "${1#-}" != "$1" ]; do
      # skip flag and its value for flags that take an argument
      case "$1" in
        -u|-w|--user|--workdir) shift; shift ;;
        *) shift ;;
      esac
    done
    shift  # remove container name
    exec "$@"
    ;;
  cp)
    # The transport uses two patterns:
    #   docker cp <local-path> <container>:<remote-path>   (write)
    #   docker cp <container>:<remote-path> <local-path>   (read)
    #   docker cp - <container>:/                          (tar stream write — unused in practice)
    shift  # remove "cp"
    src="$1"
    dst="$2"
    if [ "$src" = "-" ]; then
      # tar stream on stdin — extract to root
      tar x -C / 2>/dev/null || true
    elif echo "$src" | grep -q ':'; then
      # Read from "container:path" → local path
      remote_path="${src#*:}"
      if [ -f "$remote_path" ]; then
        cp "$remote_path" "$dst"
      elif [ -d "$remote_path" ]; then
        cp -r "$remote_path" "$dst"
      fi
    elif echo "$dst" | grep -q ':'; then
      # Write local path → "container:path"
      remote_path="${dst#*:}"
      mkdir -p "$(dirname "$remote_path")"
      if [ -f "$src" ]; then
        cp "$src" "$remote_path"
      elif [ -d "$src" ]; then
        cp -r "$src" "$remote_path"
      fi
    fi
    ;;
  rm)
    # Container cleanup — no-op
    ;;
  build)
    echo "Successfully built mock-image"
    ;;
  image)
    echo "mock-image"
    ;;
  network)
    echo "action-llama"
    ;;
  tag|ps)
    ;;
  *)
    ;;
esac
exit 0
