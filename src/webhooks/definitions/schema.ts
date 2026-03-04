export interface FilterFieldOption {
  value: string;
  label: string;
}

export interface FilterFieldSpec {
  field: string;
  label: string;
  type: "multi-select" | "text" | "text[]";
  options?: FilterFieldOption[];
  required?: boolean;
}

export interface WebhookDefinition {
  id: string;
  label: string;
  description: string;
  secretCredential?: string;
  filterSpec: FilterFieldSpec[];
}
