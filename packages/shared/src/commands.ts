// Operator commands sent to a satellite (via the simulator) and the ingest chaos-mode configuration.
import { z } from 'zod';

export const FAULT_KINDS = ['battery', 'thermal', 'tumble', 'comms'] as const;
export const FaultKind = z.enum(FAULT_KINDS);
export type FaultKind = z.infer<typeof FaultKind>;

export const COMMAND_KINDS = ['inject_fault', 'clear_fault', 'safe_mode', 'nominal_mode'] as const;

export const Command = z
  .strictObject({
    satId: z.int().min(0),
    kind: z.enum(COMMAND_KINDS),
    fault: FaultKind.optional(),
  })
  .refine((c) => c.kind !== 'inject_fault' || c.fault !== undefined, {
    error: 'inject_fault requires a fault type',
    path: ['fault'],
  });
export type Command = z.infer<typeof Command>;

/** Rates are probabilities per event, 0..1. */
export const ChaosConfig = z.strictObject({
  enabled: z.boolean(),
  duplicateRate: z.number().min(0).max(1),
  reorderRate: z.number().min(0).max(1),
  malformedRate: z.number().min(0).max(1),
});
export type ChaosConfig = z.infer<typeof ChaosConfig>;

export const CHAOS_DEFAULTS: ChaosConfig = {
  enabled: false,
  duplicateRate: 0.05,
  reorderRate: 0.1,
  malformedRate: 0.02,
};
