import { useCallback, useEffect, useState } from 'react';

/** Loads data with `load()` whenever `deps` change. Returns { data, error, loading, reload }. */
export function useLoad(load, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const run = useCallback(load, deps);
  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      setState({ data: await run(), error: null, loading: false });
    } catch (err) {
      setState((s) => ({ ...s, error: err.message, loading: false }));
    }
  }, [run]);
  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload };
}
