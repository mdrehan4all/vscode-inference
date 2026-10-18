const assert = require('node:assert/strict');
const test = require('node:test');
const { parseToolCalls, toPrompt } = require('../extension.cjs');

const vscode = {
  LanguageModelChatMessage: {
    User: (content) => ({ role: 'user', content }),
    Assistant: (content) => ({ role: 'assistant', content })
  }
};

const tools = [{
  type: 'function',
  function: {
    name: 'lookup',
    description: 'Look up a value.',
    parameters: { type: 'object', properties: { query: { type: 'string' } } }
  }
}];

test('tool definitions and prior tool results are included in the prompt', () => {
  const prompt = toPrompt(vscode, [
    { role: 'assistant', content: null, tool_calls: [{
      function: { name: 'lookup', arguments: '{"query":"weather"}' }
    }] },
    { role: 'tool', tool_call_id: 'call_previous', name: 'lookup', content: 'Sunny' }
  ], tools);

  assert.match(prompt[0].content, /"name":"lookup"/);
  assert.match(prompt[1].content, /TOOL_CALLS:/);
  assert.match(prompt[2].content, /Result from function lookup: Sunny/);
});

test('tool-call output becomes OpenAI-compatible function calls', () => {
  const calls = parseToolCalls(
    'TOOL_CALLS: {"tool_calls":[{"name":"lookup","arguments":{"query":"weather"}}]}',
    tools
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, 'function');
  assert.equal(calls[0].function.name, 'lookup');
  assert.equal(calls[0].function.arguments, '{"query":"weather"}');
  assert.match(calls[0].id, /^call_/);
});

test('ordinary responses are not treated as tool calls', () => {
  assert.equal(parseToolCalls('Here is the answer.', tools), undefined);
});