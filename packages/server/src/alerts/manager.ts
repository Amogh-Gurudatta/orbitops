// Alert lifecycle: turns anomaly-engine transitions into Alert documents plus real-time events, and exposes
// ack/resolve for operators. A change-stream listener relays writes made by OTHER server instances.
import { Types, trusted, type QueryFilter } from 'mongoose';
import type { Alert, AlertState } from '@orbitops/shared';
import type { AlertTransition } from '../anomaly/index.js';
import type { AuthUser } from '../auth/tokens.js';
import { HttpError } from '../http/errors.js';
import type { Logger } from '../logger.js';
import { AlertModel, type AlertDoc } from '../models/alert.js';

export interface AlertEmitter {
  opened(alert: Alert): void;
  updated(alert: Alert): void;
}

type StoredAlert = AlertDoc & { _id: Types.ObjectId };

const UNRESOLVED = { $in: ['open', 'acked'] } as const;

export function toAlert(doc: StoredAlert): Alert {
  const alert: Alert = {
    id: doc._id.toString(),
    key: doc.key,
    satId: doc.satId,
    ruleId: doc.ruleId,
    subsystem: doc.subsystem,
    severity: doc.severity,
    state: doc.state,
    message: doc.message,
    value: doc.value,
    threshold: doc.threshold,
    openedAt: doc.openedAt.getTime(),
    lastSeenAt: doc.lastSeenAt.getTime(),
    count: doc.count,
  };
  if (doc.ackedBy) alert.ackedBy = doc.ackedBy;
  if (doc.ackedAt) alert.ackedAt = doc.ackedAt.getTime();
  if (doc.resolvedAt) alert.resolvedAt = doc.resolvedAt.getTime();
  return alert;
}

export class AlertManager {
  /** Transitions are applied strictly in order so an 'update' never overtakes its 'open'. */
  private chain: Promise<void> = Promise.resolve();
  private stream: ReturnType<typeof AlertModel.watch> | undefined;

  constructor(
    private readonly emitter: AlertEmitter,
    private readonly instanceId: string,
    private readonly log: Logger,
  ) {}

  handleTransitions(transitions: AlertTransition[]): void {
    for (const t of transitions) {
      this.chain = this.chain
        .then(() => this.apply(t))
        .catch((err: unknown) => this.log.error({ err, key: t.key }, 'alert transition failed'));
    }
  }

  /** Resolves when all queued transitions have been written (tests, shutdown). */
  idle(): Promise<void> {
    return this.chain;
  }

  private async apply(t: AlertTransition): Promise<void> {
    const at = new Date(t.ts);
    if (t.kind === 'open') {
      // After a restart the engine reopens alerts that may still be unresolved in the database.
      const existing = await AlertModel.findOneAndUpdate(
        { key: t.key, state: trusted(UNRESOLVED) },
        {
          $set: { lastSeenAt: at, value: t.value, message: t.message, instanceId: this.instanceId },
        },
        { returnDocument: 'after', lean: true },
      );
      if (existing) return void this.emitter.updated(toAlert(existing as StoredAlert));
      const created = await AlertModel.create({
        key: t.key,
        satId: t.satId,
        ruleId: t.ruleId,
        subsystem: t.subsystem,
        severity: t.severity,
        state: 'open',
        message: t.message,
        value: t.value,
        threshold: t.threshold,
        openedAt: at,
        lastSeenAt: at,
        count: Math.max(1, t.count),
        instanceId: this.instanceId,
      });
      this.emitter.opened(toAlert(created.toObject() as StoredAlert));
      return;
    }

    const set =
      t.kind === 'update'
        ? { lastSeenAt: at, count: Math.max(1, t.count), value: t.value, message: t.message }
        : { lastSeenAt: at, state: 'resolved', resolvedAt: at };
    const doc = await AlertModel.findOneAndUpdate(
      { key: t.key, state: trusted(UNRESOLVED) },
      { $set: { ...set, instanceId: this.instanceId } },
      { returnDocument: 'after', lean: true },
    );
    if (doc) this.emitter.updated(toAlert(doc as StoredAlert));
  }

  ackAlert(id: string, user: AuthUser): Promise<Alert> {
    return this.operatorTransition(id, ['open'], {
      state: 'acked',
      ackedBy: user.email,
      ackedAt: new Date(),
    });
  }

  resolveAlert(id: string, _user: AuthUser): Promise<Alert> {
    return this.operatorTransition(id, ['open', 'acked'], {
      state: 'resolved',
      resolvedAt: new Date(),
    });
  }

  /** Idempotent: if the alert is already past the requested step it is returned unchanged. */
  private async operatorTransition(
    id: string,
    from: AlertState[],
    set: Partial<AlertDoc>,
  ): Promise<Alert> {
    if (!Types.ObjectId.isValid(id)) throw new HttpError(404, 'alert_not_found');
    const filter: QueryFilter<AlertDoc> = {
      _id: new Types.ObjectId(id),
      state: trusted({ $in: from }),
    };
    const updated = await AlertModel.findOneAndUpdate(
      filter,
      { $set: { ...set, instanceId: this.instanceId } },
      { returnDocument: 'after', lean: true },
    );
    if (updated) {
      const alert = toAlert(updated as StoredAlert);
      this.emitter.updated(alert);
      return alert;
    }
    const current = await AlertModel.findById(id).lean();
    if (!current) throw new HttpError(404, 'alert_not_found');
    return toAlert(current as StoredAlert);
  }

  /** Relays alert writes from other instances. Needs a replica set; otherwise logs and carries on. */
  startChangeStream(): void {
    try {
      const stream = AlertModel.watch([], { fullDocument: 'updateLookup' });
      this.stream = stream;
      stream.on('change', (change) => {
        if (change.operationType !== 'insert' && change.operationType !== 'update') return;
        const doc = change.fullDocument as StoredAlert | undefined;
        if (!doc || doc.instanceId === this.instanceId) return;
        const alert = toAlert(doc);
        if (change.operationType === 'insert') this.emitter.opened(alert);
        else this.emitter.updated(alert);
      });
      stream.on('error', (err: unknown) => {
        this.log.warn(
          { err },
          'alert change stream unavailable (replica set required); cross-instance relay off',
        );
        void stream.close().catch(() => undefined);
      });
    } catch (err) {
      this.log.warn({ err }, 'could not start alert change stream');
    }
  }

  async stop(): Promise<void> {
    await this.stream?.close().catch(() => undefined);
    await this.chain;
  }
}
