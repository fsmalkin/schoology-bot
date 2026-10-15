// Fabricated wire bytes only; no provider, credential, state or service access.
export function streamBytes(text, chunkSize = 1) {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });
}

export function sseEvent(name, payload, newline = "\n") {
  return `event: ${name}${newline}data: ${JSON.stringify(payload)}${newline}${newline}`;
}
