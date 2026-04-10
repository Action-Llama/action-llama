export interface AttachCommand {
  type: "get_state" | "steer" | "abort";
  message?: string;
}

export interface AttachEvent {
  type: string;
  [key: string]: unknown;
}
