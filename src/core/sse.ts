/** Incremental SSE block parser. Shared by the desk and the API tests. */
export function createSseParser(onData: (data: string) => void): {
  push: (chunk: string) => void;
  flush: () => void;
} {
  let buffer = "";
  const consume = (block: string): void => {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (data) onData(data);
  };
  return {
    push(chunk: string) {
      buffer += chunk;
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) consume(part);
    },
    flush() {
      if (!buffer.trim()) {
        buffer = "";
        return;
      }
      consume(buffer);
      buffer = "";
    },
  };
}
