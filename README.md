# VS Code Inference

This VS Code extension exposes models available through VS Code's Language Model API as a local OpenAI-compatible chat completions API. VS Code must remain open while the bridge is running.

## Start

1. Open this folder in VS Code and press `F5` to launch the Extension Development Host.
2. The local API starts automatically. Open `http://127.0.0.1:3210/v1/models` to confirm it is responding; it initially returns an empty model list.
3. Click **Enable Models** in the startup notification or **Enable Model Access** in the status bar. Approve model access if prompted.
4. Copy the Base URL and API key from the **VS Code OpenAI Bridge** output channel.

The server binds to `127.0.0.1` only. Set `vscodeOpenAI.port` to change the default port (`3210`); set it to `0` to choose an available port. Run **VS Code OpenAI Bridge: Stop Server** to stop it.

The model-list endpoint does not require an API key; chat completions still do. It lists models after model access has been enabled.

## OpenAI SDK Example

Install the OpenAI JavaScript SDK `npm install openai` in your client project, then use the bridge's Base URL and API key:

```js
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://127.0.0.1:3210/v1',
  apiKey: process.env.VSCODE_BRIDGE_API_KEY || 'without-api-key'
});

const models = await client.models.list();
const completion = await client.chat.completions.create({
  model: 'auto',
  messages: [
    { role: 'system', content: 'Answer clearly and concisely.' },
    { role: 'user', content: 'What is an ES module?' }
  ]
});

console.log(completion.choices[0].message.content);
```

## Endpoint Example

You can use end point `http://127.0.0.1:3210/v1/chat/completions` with follow payload

```json
{
    "model": "gpt-4o-mini",
    "messages": [
        { "role": "system", "content": "Answer clearly and concisely." },
        { "role": "user", "content": "What is full form of LED" }
    ]
}
```

The bridge automatically prefers the `gpt-4o` family when available, otherwise it uses the first available VS Code model. Use `model: 'auto'` or omit the model to use that default; you can still pass a listed model ID to select one explicitly. The root endpoint reports the chosen default.

Streaming completions are supported. Since VS Code's Language Model API does not support system messages, `system` and `developer` messages are passed as user-provided instructions. Model access and usage remain subject to VS Code and the selected provider's consent, availability, and rate limits.