import { useCallback, useEffect, useRef, useState } from "react";
import type { DataTopic } from "../../shared/types/data";

/**
 * Loads data through `fetcher` and reloads it whenever one of `topics` changes in the main process.
 * Stale responses (from an older request) are discarded.
 */
export function useLive<T>(fetcher: () => Promise<T>, topics: DataTopic[], deps: unknown[] = []): { data: T | undefined; error: string | null; reload: () => void } {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;

  const reload = useCallback(() => {
    const mine = ++seq.current;
    fetchRef.current().then(
      (value) => {
        if (mine === seq.current) {
          setData(value);
          setError(null);
        }
      },
      (e: unknown) => {
        if (mine === seq.current) setError(e instanceof Error ? e.message : String(e));
      },
    );
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- deps are supplied by the caller
  useEffect(reload, deps);

  useEffect(() => window.sidb.data.onChange((topic) => topics.includes(topic) && reload()), [reload, topics.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, error, reload };
}
