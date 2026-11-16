export interface ToolMetrics {
  toolCalls: number;
  toolResultBytes: number;
  largestToolResults: { name: string; bytes: number }[];
}

/** Count payload sizes, never retain tool contents (which may include media or private text). */
export function agentMetrics() {
  const calls = new Map<string, string>(), results = new Map<string, { name: string; bytes: number }>();
  return {
    observe(e: any) {
      for (const part of e.message?.content ?? []) {
        if (e.type === 'assistant' && part.type === 'tool_use') calls.set(part.id, String(part.name));
        if (e.type === 'user' && part.type === 'tool_result') results.set(part.tool_use_id, {
          name: calls.get(part.tool_use_id) ?? 'unknown', bytes: Buffer.byteLength(JSON.stringify(part.content ?? ''), 'utf8'),
        });
      }
    },
    snapshot(): ToolMetrics {
      const sizes = [...results.values()];
      return { toolCalls: calls.size, toolResultBytes: sizes.reduce((n, r) => n + r.bytes, 0), largestToolResults: sizes.sort((a, b) => b.bytes - a.bytes).slice(0, 10) };
    },
  };
}
