const target = typeof window !== "undefined" ? new EventTarget() : null;

export function emitInstructionEvent(type, detail = {}) {
  if (target) target.dispatchEvent(new CustomEvent(`navigation:instruction-${type}`, { detail }));
}

export function onInstructionEvent(type, listener) {
  if (!target) return () => {};
  const eventName = `navigation:instruction-${type}`;
  target.addEventListener(eventName, listener);
  return () => target.removeEventListener(eventName, listener);
}
