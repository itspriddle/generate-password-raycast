import { LocalStorage } from "@raycast/api";
import { useCallback, useEffect, useRef, useState } from "react";
import { GeneratorType } from "./generate";
import { GeneratorState, parseStoredState } from "./options";

const STORAGE_KEY = "generator-state";

/**
 * Generator type and option tweaks, persisted across launches.
 * Updates are applied to React state immediately and written through to LocalStorage.
 */
export function useGeneratorState(fallbackType: GeneratorType) {
  const [state, setState] = useState<GeneratorState>({ type: fallbackType, overrides: {} });
  const [isLoading, setIsLoading] = useState(true);
  const loaded = useRef(false);

  useEffect(() => {
    let cancelled = false;

    LocalStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!cancelled) {
          setState(parseStoredState(raw, fallbackType));
        }
      })
      .catch((error) => console.error(error))
      .finally(() => {
        if (!cancelled) {
          loaded.current = true;
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [fallbackType]);

  useEffect(() => {
    if (loaded.current) {
      LocalStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch((error) => console.error(error));
    }
  }, [state]);

  const update = useCallback((fn: (current: GeneratorState) => GeneratorState) => setState(fn), []);

  return { state, update, isLoading };
}
