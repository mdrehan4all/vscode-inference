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

You can get available models to use from this url with GET Method `http://127.0.0.1:3210/v1/chat/completions`


```json
{
    "object": "list",
    "data": [
        {
            "id": "gpt-4o-mini",
            "object": "model",
            "created": 0,
            "owned_by": "vscode",
            "name": "GPT-4o mini",
            "family": "gpt-4o-mini"
        },
        {
            "id": "auto",
            "object": "model",
            "created": 0,
            "owned_by": "vscode",
            "name": "Auto",
            "family": "claude-fable-5.1"
        },
        {
            "id": "copilot-utility-small",
            "object": "model",
            "created": 0,
            "owned_by": "vscode",
            "name": "GPT-4o mini",
            "family": "copilot-utility-small"
        },
        {
            "id": "copilot-utility",
            "object": "model",
            "created": 0,
            "owned_by": "vscode",
            "name": "GPT-5 mini",
            "family": "copilot-utility"
        },
        {
            "id": "copilot-dictation-cleanup-nano",
            "object": "model",
            "created": 0,
            "owned_by": "vscode",
            "name": "GPT-5.4 nano",
            "family": "copilot-dictation-cleanup-nano"
        },
        {
            "id": "copilot-dictation-cleanup-luna",
            "object": "model",
            "created": 0,
            "owned_by": "vscode",
            "name": "GPT-5.6 Luna",
            "family": "copilot-dictation-cleanup-luna"
        },
        {
            "id": "gpt-5.6-luna",
            "object": "model",
            "created": 0,
            "owned_by": "vscode",
            "name": "GPT-5.6 Luna",
            "family": "gpt-5.6-luna"
        }
    ]
}
```

You can use end point with POST Method `http://127.0.0.1:3210/v1/chat/completions` with the following payload.

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

OpenAI-compatible function tools are passed to the model as instructions and returned as standard `tool_calls` responses. The calling client is responsible for executing each function and sending its result back as a `tool` message; the bridge does not execute client functions. Tool selection is generated through the model's text response, because VS Code's Language Model API does not expose native function calling.

Note: If you are not getting any model, check point 3 from the start of this document.