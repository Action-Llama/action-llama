import type { WebhookDefinition } from "./schema.js";

export const sentry: WebhookDefinition = {
  id: "sentry",
  label: "Sentry",
  description: "Sentry webhook events",
  secretCredential: "sentry-client-secret",
  filterSpec: [
    {
      field: "resources",
      label: "Event types",
      type: "multi-select",
      required: true,
      options: [
        { value: "event_alert", label: "Issue alerts" },
        { value: "metric_alert", label: "Metric alerts" },
        { value: "issue", label: "Issues" },
        { value: "error", label: "Errors" },
        { value: "comment", label: "Comments" },
      ],
    },
  ],
};
