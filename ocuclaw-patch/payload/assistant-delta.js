// openclaw-g2: OpenClaw 2026.10.x projects assistant agent events onto the
// wire as delta-only frames ({ itemId, delta } without `text`) after the first
// snapshot frame. OcuClaw only reads `data.text`, so its run buffer froze at the
// first chunk. Rebuild the cumulative text from the buffer plus the delta.
export function normalizeAssistantDelta(client, data) {
  if (!data || typeof data !== "object") return data;
  if (typeof data.text === "string" || typeof data.delta !== "string") return data;
  const itemId = typeof data.itemId === "string" && data.itemId.trim() ? data.itemId.trim() : null;
  const previous = client && typeof client._runTextBuffer === "string" ? client._runTextBuffer : "";
  const currentItem = client && typeof client._runItemId === "string" ? client._runItemId : null;
  const sameItem = !itemId || !currentItem || itemId === currentItem;
  const base = data.replace === true || !sameItem ? "" : previous;
  return { ...data, text: base + data.delta };
}
