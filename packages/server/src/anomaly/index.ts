// Public surface of the anomaly engine: pure, deterministic alert detection for telemetry frames.
export { createAnomalyEngine } from './engine.js';
export type { AlertTransition, AnomalyEngine, AnomalyEngineOptions } from './engine.js';
export { DEFAULT_RULES } from './domainRules.js';
