/** Anonymous usage events. No text, images, or personal data leave the device. */
export function track(event: string, properties: Record<string, string | number | boolean> = {}) {
  const body = JSON.stringify({ event, ...properties });
  if (!navigator.sendBeacon?.("/api/event", new Blob([body], { type: "application/json" }))) {
    fetch("/api/event", { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true }).catch(() => {});
  }
}
