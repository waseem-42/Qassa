import { expect, it } from 'vitest';
import { agentMetrics } from '../src/agent-metrics.ts';

it('counts unique calls/results and records byte sizes without retaining their contents', () => {
  const m = agentMetrics(), call = { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'a', name: 'project_state' }] } };
  m.observe(call); m.observe(call);
  m.observe({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'a', content: 'سرّي' }] } });
  const stats = m.snapshot();
  expect(stats.toolCalls).toBe(1);
  expect(stats.toolResultBytes).toBe(Buffer.byteLength(JSON.stringify('سرّي')));
  expect(stats.largestToolResults).toEqual([{ name: 'project_state', bytes: stats.toolResultBytes }]);
  expect(JSON.stringify(stats)).not.toContain('سرّي');
});
