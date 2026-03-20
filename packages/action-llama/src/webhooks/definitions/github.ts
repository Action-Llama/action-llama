import type { WebhookDefinition } from "./schema.js";

export const github: WebhookDefinition = {
  id: "github",
  label: "GitHub",
  description: "GitHub webhook events",
  secretCredential: "github_webhook_secret",
  filterSpec: [
    {
      field: "events",
      label: "Events",
      type: "multi-select",
      required: true,
      options: [
        { value: "issues", label: "Issues" },
        { value: "pull_request", label: "Pull requests" },
        { value: "issue_comment", label: "Issue comments" },
        { value: "push", label: "Push" },
        { value: "workflow_run", label: "Workflow runs" },
      ],
    },
    {
      field: "actions",
      label: "Actions",
      type: "multi-select",
      options: [
        { value: "opened", label: "Opened" },
        { value: "closed", label: "Closed" },
        { value: "labeled", label: "Labeled" },
        { value: "synchronize", label: "Synchronized" },
        { value: "completed", label: "Completed" },
        { value: "created", label: "Created" },
      ],
    },
    { field: "repos", label: "Repositories", type: "text[]" },
    { field: "org", label: "Organization", type: "text" },
    { field: "orgs", label: "Organizations", type: "text[]" },
    { field: "labels", label: "Labels", type: "text[]" },
    { field: "assignee", label: "Assignee", type: "text" },
    { field: "branches", label: "Branches", type: "text[]" },
    {
      field: "conclusions",
      label: "Conclusions",
      type: "multi-select",
      options: [
        { value: "success", label: "Success" },
        { value: "failure", label: "Failure" },
        { value: "cancelled", label: "Cancelled" },
        { value: "skipped", label: "Skipped" },
        { value: "timed_out", label: "Timed Out" },
        { value: "action_required", label: "Action Required" },
      ],
    },
  ],
};
