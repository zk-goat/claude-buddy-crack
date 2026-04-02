import { workerData, parentPort } from 'node:worker_threads';
import { crack } from './algorithm.js';

const { rarity, shiny, species, useUuid, cursed, maxAttempts } = workerData;

const result = crack({
  rarity,
  shiny,
  species: species ?? null,
  useUuid,
  cursed: cursed ?? false,
  maxAttempts,
  onProgress: (n) => parentPort.postMessage({ type: 'progress', attempts: n }),
});

parentPort.postMessage({ type: 'result', result });
