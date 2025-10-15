export interface Event {
  eventId: string;
  source: 'facebook' | 'tiktok';
  funnelStage: 'top' | 'bottom';
  eventType: string;
  correlationId?: string;
  timestamp?: string;
  [key: string]: unknown;
}

export type EventBatch = Event[];
