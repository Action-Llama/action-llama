import type { WebhookDefinition } from "./schema.js";

export const github: WebhookDefinition = {
  id: "github",
  label: "GitHub",
  description: "GitHub webhook events",
  secretCredential: "github-webhook-secret",
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
    { field: "labels", label: "Labels", type: "text[]" },
    { field: "assignee", label: "Assignee", type: "text" },
    { field: "branches", label: "Branches", type: "text[]" },
  ],
};
