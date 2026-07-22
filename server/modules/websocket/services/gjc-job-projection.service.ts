import type { WebSocket } from 'ws';

import { WS_OPEN_STATE } from '@/modules/websocket/services/websocket-state.service.js';

import { isJobProjectionEvent, isJobProjectionInboundFrame, isJobProjectionOutboundFrame, type JobProjectionErrorCode, type JobProjectionOutboundFrame, type JobProjectionEvent } from '../../../../shared/gjc-job-projection-protocol.js';

type Authority = { get(params: { jobId: string }): Promise<unknown>; replayEvents(params: { jobId: string; after: number; byteBudget: number }): Promise<unknown> };
type Subscription = { id: string; jobId: string; watermark: number; lastSent: number; lastEventId?: string; buffer: JobProjectionEvent[]; bufferBytes: number; timer?: NodeJS.Timeout; state: 'REPLAY_WAIT' | 'REPLAY_IO' | 'FLUSHING' | 'LIVE' };
const MIN_BUDGET = 4 * 1024;
const MAX_BUDGET = 48 * 1024;
const MAX_BUFFER_EVENTS = 5000;
const MAX_BUFFER_BYTES = 4 * 1024 * 1024;
let nextId = 0;

export function clampByteBudget(value: unknown): number { const budget = typeof value === 'number' && Number.isSafeInteger(value) ? value : MIN_BUDGET; return Math.max(MIN_BUDGET, Math.min(MAX_BUDGET, budget)); }
function errorCode(error: unknown): Extract<JobProjectionErrorCode, 'authority_unavailable' | 'not_found' | 'storage_failure'> { const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''; return code === 'not_found' ? 'not_found' : code === 'storage_failure' ? 'storage_failure' : 'authority_unavailable'; }
function recognized(data: Record<string, unknown>): boolean { return data.type === 'gjc.job.subscribe' || data.type === 'gjc.job.replay' || data.type === 'gjc.job.unsubscribe'; }

/** Durable replay is authoritative; this only bridges committed broadcasts without replay races. */
export class GjcJobProjectionService {
  private readonly bySocket = new Map<WebSocket, Map<string, Subscription>>();
  constructor(private readonly authority: Authority, private readonly replayTimeoutMs = 30_000) {}
  private send(ws: WebSocket, frame: JobProjectionOutboundFrame): void { if (ws.readyState === WS_OPEN_STATE && isJobProjectionOutboundFrame(frame)) ws.send(JSON.stringify(frame)); }
  private error(ws: WebSocket, code: JobProjectionErrorCode, retryable = false, context: Partial<Pick<Subscription, 'id' | 'jobId'>> = {}): void { this.send(ws, { protocolVersion: 1, kind: 'gjc_job_error', code, retryable, message: code, ...(context.id ? { subscriptionId: context.id } : {}), ...(context.jobId ? { jobId: context.jobId } : {}) }); }
  private current(ws: WebSocket, sub: Subscription): boolean { return this.bySocket.get(ws)?.get(sub.id) === sub; }
  private close(ws: WebSocket, sub: Subscription, code?: JobProjectionErrorCode, retryable = false): void { clearTimeout(sub.timer); if (!this.current(ws, sub)) return; this.bySocket.get(ws)?.delete(sub.id); if (code) this.error(ws, code, retryable, sub); }
  attach(ws: WebSocket): void { if (this.bySocket.has(ws)) return; this.bySocket.set(ws, new Map()); ws.once('close', () => this.detach(ws)); }
  detach(ws: WebSocket): void { const subs = this.bySocket.get(ws); if (!subs) return; for (const sub of subs.values()) clearTimeout(sub.timer); this.bySocket.delete(ws); }
  async handle(ws: WebSocket, data: Record<string, unknown>): Promise<boolean> {
    if (!recognized(data)) return false;
    const inbound = data;
    if (!isJobProjectionInboundFrame(inbound)) { this.error(ws, 'invalid_request'); return true; }
    const subscriptions = this.bySocket.get(ws) ?? (this.attach(ws), this.bySocket.get(ws)!);
    if (inbound.type === 'gjc.job.unsubscribe') {
      const sub = subscriptions.get(inbound.subscriptionId);
      if (!sub || sub.jobId !== inbound.jobId) { this.error(ws, 'invalid_request'); return true; }
      this.close(ws, sub); this.send(ws, { protocolVersion: 1, kind: 'gjc_job_unsubscribed', subscriptionId: sub.id, jobId: sub.jobId }); return true;
    }
    if (inbound.type === 'gjc.job.subscribe') {
      const cursor = inbound.after ?? 0;
      const sub: Subscription = { id: `gjc-${++nextId}`, jobId: inbound.jobId, watermark: 0, lastSent: cursor, buffer: [], bufferBytes: 0, state: 'REPLAY_WAIT' };
      subscriptions.set(sub.id, sub);
      try {
        const value = await this.authority.get({ jobId: sub.jobId });
        if (!this.current(ws, sub)) return true;
        const watermark = value && typeof value === 'object' && Number.isSafeInteger((value as { lastSequence?: unknown }).lastSequence) ? Number((value as { lastSequence: number }).lastSequence) : 0;
        sub.watermark = watermark;
        if (cursor > watermark) { this.close(ws, sub, 'cursor_ahead'); return true; }
        this.send(ws, { protocolVersion: 1, kind: 'gjc_job_subscribed', subscriptionId: sub.id, jobId: sub.jobId, cursor, watermark, snapshot: value as any });
      } catch (error) { if (this.current(ws, sub)) { const code = errorCode(error); this.close(ws, sub, code, code === 'authority_unavailable'); } }
      return true;
    }
    const sub = subscriptions.get(inbound.subscriptionId);
    if (!sub || sub.jobId !== inbound.jobId) { this.error(ws, 'invalid_request'); return true; }
    if (sub.state === 'LIVE') { this.close(ws, sub, 'protocol_violation'); return true; }
    if (sub.state !== 'REPLAY_WAIT' || inbound.after !== sub.lastSent) { this.close(ws, sub, sub.state === 'REPLAY_IO' ? 'protocol_violation' : 'cursor_mismatch'); return true; }
    await this.replay(ws, sub, inbound.after, clampByteBudget(inbound.byteBudget)); return true;
  }
  private async replay(ws: WebSocket, sub: Subscription, after: number, byteBudget: number): Promise<void> {
    if (!this.current(ws, sub) || sub.state !== 'REPLAY_WAIT') return;
    sub.state = 'REPLAY_IO';
    sub.timer = setTimeout(() => this.close(ws, sub, 'authority_unavailable', true), this.replayTimeoutMs);
    try {
      const response = await this.authority.replayEvents({ jobId: sub.jobId, after, byteBudget });
      if (!this.current(ws, sub) || sub.state !== 'REPLAY_IO') return;
      clearTimeout(sub.timer); sub.timer = undefined;
      const events = response && typeof response === 'object' && Array.isArray((response as { events?: unknown }).events) ? (response as { events: unknown[] }).events.filter(isJobProjectionEvent).filter(event => event.sequence > after && event.sequence <= sub.watermark) : [];
      let expected = after + 1;
      if (events.some(event => event.sequence !== expected++)) { this.close(ws, sub, 'protocol_violation'); return; }
      const last = events.at(-1)?.sequence;
      const done = !last || last >= sub.watermark;
      if (!done && !last) { this.close(ws, sub, 'protocol_violation'); return; }
      this.send(ws, { protocolVersion: 1, kind: 'gjc_job_replay_chunk', subscriptionId: sub.id, jobId: sub.jobId, after, watermark: sub.watermark, events, nextCursor: done ? null : last, done });
      if (last) { sub.lastSent = last; sub.lastEventId = events.at(-1)?.eventId; }
      if (done && this.current(ws, sub)) { sub.state = 'FLUSHING'; this.flush(ws, sub); if (this.current(ws, sub)) sub.state = 'LIVE'; }
      else if (this.current(ws, sub)) sub.state = 'REPLAY_WAIT';
    } catch (error) { if (this.current(ws, sub)) { clearTimeout(sub.timer); const code = errorCode(error); this.close(ws, sub, code, code === 'authority_unavailable'); } }
  }
  publish(jobId: string, event: JobProjectionEvent): void {
    if (!isJobProjectionEvent(event)) return;
    for (const [ws, subs] of this.bySocket) for (const sub of [...subs.values()]) if (sub.jobId === jobId) {
      if (sub.state !== 'LIVE') { const bytes = Buffer.byteLength(JSON.stringify(event)); sub.buffer.push(event); sub.bufferBytes += bytes; if (sub.buffer.length > MAX_BUFFER_EVENTS || sub.bufferBytes > MAX_BUFFER_BYTES) this.close(ws, sub, 'buffer_overflow'); continue; }
      this.deliver(ws, sub, event);
    }
  }
  private flush(ws: WebSocket, sub: Subscription): void { const events = sub.buffer.filter(event => event.sequence > sub.watermark).sort((a, b) => a.sequence - b.sequence); sub.buffer = []; sub.bufferBytes = 0; for (const event of events) { if (!this.current(ws, sub)) return; this.deliver(ws, sub, event); } }
  private deliver(ws: WebSocket, sub: Subscription, event: JobProjectionEvent): void { if (!this.current(ws, sub)) return; if (event.sequence === sub.lastSent) { if (event.eventId === sub.lastEventId) return; this.close(ws, sub, 'protocol_violation'); return; } if (event.sequence < sub.lastSent) return; if (event.sequence !== sub.lastSent + 1) { this.close(ws, sub, 'protocol_violation'); return; } sub.lastSent = event.sequence; sub.lastEventId = event.eventId; this.send(ws, { protocolVersion: 1, kind: 'gjc_job_event', subscriptionId: sub.id, jobId: sub.jobId, event }); }
}
