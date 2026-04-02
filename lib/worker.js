import { workerData, parentPort } from 'node:worker_threads';
import { crack } from './algorithm.js';

const { rarity, shiny, species, useUuid, maxAttempts } = workerData;

const result = crack({
  rarity,
  shiny,
  species: species ?? null,
  useUuid,
  maxAttempts,
  onProgress: (n) => parentPort.postMessage({ type: 'progress', attempts: n }),
});

parentPort.postMessage({ type: 'result', result });
