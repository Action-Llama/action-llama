---
"@action-llama/action-llama": patch
---

Fixed agent Docker builds failing with `COPY static/ /app/static/: not found`. The static/
directory was written to a temp build context but Docker was invoked with the package root
as its build context, so it could never find the files. Now the temp directory is used as
Docker's build context when extra files are present.
