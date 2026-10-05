// Minimal event bus for cross-component imperative actions (e.g. start a call).
const handlers = {};
export const bus = {
  on(ev, fn) { (handlers[ev] ||= new Set()).add(fn); return () => handlers[ev]?.delete(fn); },
  emit(ev, data) { handlers[ev]?.forEach((fn) => fn(data)); },
};
