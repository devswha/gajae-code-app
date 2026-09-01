import { useEffect, useState, type DependencyList } from 'react';

type ApiSourceOptions<T, R> = {
  enabled: boolean;
  deps: DependencyList;
  fetcher: (signal: AbortSignal) => Promise<Response>;
  parse: (raw: R) => T[];
};

function wasCancelled(signal: AbortSignal, error?: unknown): boolean {
  return signal.aborted || (error instanceof DOMException && error.name === 'AbortError');
}

export function useApiSource<T, R = unknown>(options: ApiSourceOptions<T, R>): T[] {
  const [results, setResults] = useState<T[]>([]);
  const { deps, enabled, fetcher, parse } = options;

  useEffect(() => {
    if (!enabled) {
      setResults([]);
      return;
    }

    const request = new AbortController();
    const load = async () => {
      try {
        const response = await fetcher(request.signal);
        const payload = await response.json() as R;
        if (!wasCancelled(request.signal)) setResults(parse(payload));
      } catch (error) {
        if (!wasCancelled(request.signal, error)) setResults([]);
      }
    };

    void load();
    return () => request.abort();
    // The caller supplies the values that define a request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  return results;
}
