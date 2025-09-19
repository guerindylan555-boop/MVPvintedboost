export const LISTINGS_EVENT_CHANNEL = "vb:listings";
export const LISTINGS_EVENT_STORAGE_KEY = "vb:listings:last-update";
export const LISTINGS_EVENT_WINDOW = "vb:listings-updated";

export function broadcastListingsUpdated() {
  if (typeof window === "undefined") return;

  try {
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(LISTINGS_EVENT_CHANNEL);
      channel.postMessage({ type: "updated", at: Date.now() });
      channel.close();
    }
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.error("Failed to broadcast listings update via channel", err);
    }
  }

  try {
    window.localStorage.setItem(LISTINGS_EVENT_STORAGE_KEY, `${Date.now()}`);
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.error("Failed to broadcast listings update via storage", err);
    }
  }

  try {
    window.dispatchEvent(new CustomEvent(LISTINGS_EVENT_WINDOW, { detail: Date.now() }));
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.error("Failed to broadcast listings update via window event", err);
    }
  }
}

export function subscribeToListingsUpdates(listener) {
  if (typeof window === "undefined") return () => {};

  const wrapped = () => listener();
  let channel;

  if (typeof BroadcastChannel !== "undefined") {
    try {
      channel = new BroadcastChannel(LISTINGS_EVENT_CHANNEL);
      channel.onmessage = wrapped;
    } catch (err) {
      if (process.env.NODE_ENV !== "production") {
        console.error("Failed to subscribe to listings channel", err);
      }
      channel = undefined;
    }
  }

  const handleStorage = (event) => {
    if (event.key === LISTINGS_EVENT_STORAGE_KEY) {
      wrapped();
    }
  };

  const handleWindowEvent = () => wrapped();

  window.addEventListener("storage", handleStorage);
  window.addEventListener(LISTINGS_EVENT_WINDOW, handleWindowEvent);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(LISTINGS_EVENT_WINDOW, handleWindowEvent);
    if (channel) {
      try {
        channel.close();
      } catch (err) {
        if (process.env.NODE_ENV !== "production") {
          console.error("Failed to close listings channel", err);
        }
      }
    }
  };
}
