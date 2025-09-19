"use client";

import { useEffect, useRef, useState } from "react";

function defaultSerialize(value) {
  if (value === undefined) return undefined;
  if (value === null) return "null";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch (error) {
    try {
      return String(value);
    } catch {
      return undefined;
    }
  }
}

function defaultDeserialize(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (trimmed === "") return "";
  if (trimmed === "null") return null;
  if (trimmed === "undefined") return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function usePersistentState(key, initialValue, options = {}) {
  const {
    enabled = true,
    storage: providedStorage,
    serialize = defaultSerialize,
    deserialize = defaultDeserialize,
    resetWhenDisabled = true,
  } = options;

  const storage = providedStorage ?? (typeof window !== "undefined" ? window.localStorage : undefined);

  const defaultGetterRef = useRef();
  if (!defaultGetterRef.current) {
    defaultGetterRef.current = typeof initialValue === "function" ? initialValue : () => initialValue;
  }

  const [state, setState] = useState(() => {
    if (!enabled || !storage || !key) return defaultGetterRef.current();
    try {
      const stored = storage.getItem(key);
      if (stored !== null) {
        const parsed = deserialize(stored);
        if (parsed !== undefined) return parsed;
      }
    } catch {}
    return defaultGetterRef.current();
  });

  const enabledRef = useRef(enabled);

  useEffect(() => {
    if (!storage || !key) {
      enabledRef.current = enabled;
      return;
    }

    const wasEnabled = enabledRef.current;

    if (enabled) {
      if (!wasEnabled) {
        try {
          const stored = storage.getItem(key);
          if (stored !== null) {
            const parsed = deserialize(stored);
            if (parsed !== undefined) {
              setState(parsed);
            } else if (resetWhenDisabled) {
              setState(defaultGetterRef.current());
            }
          } else if (resetWhenDisabled) {
            setState(defaultGetterRef.current());
          }
        } catch {
          if (resetWhenDisabled) setState(defaultGetterRef.current());
        }
      }
    } else if (wasEnabled && resetWhenDisabled) {
      setState(defaultGetterRef.current());
    }

    enabledRef.current = enabled;
  }, [enabled, key, storage, deserialize, resetWhenDisabled]);

  useEffect(() => {
    if (!enabled || !storage || !key) return;
    try {
      const serialized = serialize(state);
      if (serialized === undefined) {
        storage.removeItem(key);
      } else {
        storage.setItem(key, serialized);
      }
    } catch {}
  }, [state, enabled, key, storage, serialize]);

  return [state, setState];
}
