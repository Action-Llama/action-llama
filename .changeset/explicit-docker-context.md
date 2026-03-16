---
"@action-llama/action-llama": patch
---

Fixed local Docker builds failing with `COPY static/ /app/static/: not found` by passing
the build directory as an explicit absolute path to Docker instead of relying on `cwd` + `"."`.
Also restructured `buildImage()` into three linear phases (resolve content, inject COPY,
prepare context) to reduce nesting and branching.
