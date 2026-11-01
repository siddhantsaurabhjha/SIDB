// Runs in a worker thread so parsing millions of characters of filter rules never blocks the browser UI.
import { parentPort, workerData } from "node:worker_threads";
import { engineStats, loadResources, parseEngine } from "./engine";

interface BuildInput {
  texts: string[];
  resources: string | null;
}

const input = workerData as BuildInput;

try {
  const engine = parseEngine(input.texts.join("\n"));
  if (input.resources) loadResources(engine, input.resources);
  const stats = engineStats(engine);
  const bytes = engine.serialize();
  parentPort?.postMessage({ ok: true, bytes, ...stats }, [bytes.buffer as ArrayBuffer]);
} catch (e) {
  parentPort?.postMessage({ ok: false, error: e instanceof Error ? e.message : String(e) });
}
