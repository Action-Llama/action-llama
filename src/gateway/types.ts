export interface ContainerRegistration {
  containerName: string;
  credentials?: Record<string, Record<string, Record<string, string>>>;
  onLogLine?: (line: string) => void;
}
