export const OX_EVENTS = Object.freeze({
  marketChange: "ox:marketchange",
  themeChange: "ox:themechange"
});

export function createEventBus() {
  const listeners = new Map();
  return Object.freeze({
    on(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
      return () => listeners.get(type)?.delete(listener);
    },
    emit(type, detail) {
      listeners.get(type)?.forEach(listener => listener(detail));
    },
    clear(type) {
      if (type) listeners.delete(type);
      else listeners.clear();
    }
  });
}

export const eventBus = createEventBus();
