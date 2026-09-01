export {};

declare global {
  interface EventSourceEventMap { done: MessageEvent; progress: MessageEvent; result: MessageEvent; }
  interface Window { __ROUTER_BASENAME__?: string; }
}
