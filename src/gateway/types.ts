export interface ContainerRegistration {
  containerName: string;
  agentName: string;
  credentials?: Record<string, Record<string, Record<string, string>>>;
  onLogLine?: (line: string) => void;
}
