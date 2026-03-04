export interface QueuedEvent {
  agentType: string;
  text: string;
  timestamp: string;
}

export type EventListener = (event: QueuedEvent) => void;

export class EventQueue {
  private listeners: EventListener[] = [];

  onEvent(listener: EventListener): void {
    this.listeners.push(listener);
  }

  push(event: QueuedEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
