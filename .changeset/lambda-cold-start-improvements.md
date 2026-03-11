---
"@action-llama/action-llama": patch
---

Reduced Lambda cold start time through multiple optimizations: bake shell scripts
into the Docker image instead of writing them at container startup, switch to Alpine
base image (~100-150MB smaller), parallelize AWS Secrets Manager lookups, cache Lambda
function image URIs to skip redundant update/wait API calls on repeated launches, split
container entry into init/invocation phases so Lambda can reuse model and config across
warm starts, convert credential builtins to a static import, and add `--omit=optional`
to the container npm install.
