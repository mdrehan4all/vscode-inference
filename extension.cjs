const express = require('express');
const { randomBytes, randomUUID } = require('node:crypto');

const HOST = '127.0.0.1';

function textContent(content) {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    throw new TypeError('Message content must be text.');
  }

  return content.map((part) => {
    if (part.type === 'text' && typeof part.text === 'string') {
      return part.text;
    }

    throw new TypeError('Only text message content is supported.');
  }).join('');
}

function toPrompt(vscode, messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new TypeError('messages must be a non-empty array.');
  }

  const instructions = [];
  const prompt = [];

  for (const message of messages) {
    if (!message || typeof message.role !== 'string') {
      throw new TypeError('Each message must include a role and text content.');
    }

    const content = textContent(message.content);

    if (message.role === 'system' || message.role === 'developer') {
      instructions.push(content);
    } else if (message.role === 'user') {
      prompt.push(vscode.LanguageModelChatMessage.User(content));
    } else if (message.role === 'assistant') {
      prompt.push(vscode.LanguageModelChatMessage.Assistant(content));
    } else {
      throw new TypeError(`The ${message.role} message role is not supported.`);
    }
  }

  if (instructions.length > 0) {
    prompt.unshift(vscode.LanguageModelChatMessage.User(instructions.join('\n\n')));
  }

  return prompt;
}

function selectDefaultModel(models) {
  return models.find((model) => model.family?.toLowerCase() === 'gpt-4o') ??
    models.find((model) => model.name?.toLowerCase().includes('gpt-4o')) ??
    models[0];
}

function createApp(vscode, bridgeState, apiKey) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/', (_request, response) => {
    response.json({
      status: 'ok',
      service: 'VS Code OpenAI Bridge',
      modelsAvailable: bridgeState.models.length > 0,
      defaultModel: bridgeState.defaultModel?.id ?? null,
      models: '/v1/models',
      chatCompletions: '/v1/chat/completions'
    });
  });

  app.get('/v1/models', (_request, response) => {
    response.json({
      object: 'list',
      data: bridgeState.models.map((model) => ({
        id: model.id,
        object: 'model',
        created: 0,
        owned_by: 'vscode',
        name: model.name,
        family: model.family
      }))
    });
  });

  app.use('/v1/chat/completions', (request, response, next) => {
    if (request.get('authorization') !== `Bearer ${apiKey}`) {
      return response.status(401).json({
        error: {
          message: 'Invalid API key.',
          type: 'authentication_error',
          code: 'invalid_api_key'
        }
      });
    }

    next();
  });

  app.post('/v1/chat/completions', async (request, response) => {
    if (bridgeState.models.length === 0) {
      return response.status(503).json({
        error: {
          message: 'Enable model access from the VS Code status bar before sending chat requests.',
          type: 'service_unavailable',
          code: 'models_not_available'
        }
      });
    }

    const requestedModel = request.body?.model;
    const model = !requestedModel || requestedModel === 'auto'
      ? bridgeState.defaultModel
      : bridgeState.models.find((candidate) =>
        candidate.id === requestedModel ||
        candidate.family === requestedModel ||
        candidate.name === requestedModel
      );

    if (!model) {
      return response.status(404).json({
        error: {
          message: 'Model not found. Use "auto" or omit model to use the default. Call GET /v1/models to list available models.',
          type: 'invalid_request_error',
          code: 'model_not_found'
        }
      });
    }

    let prompt;
    try {
      prompt = toPrompt(vscode, request.body.messages);
    } catch (error) {
      return response.status(400).json({
        error: {
          message: error.message,
          type: 'invalid_request_error',
          code: 'invalid_messages'
        }
      });
    }

    const id = `chatcmpl-${randomUUID()}`;
    const created = Math.floor(Date.now() / 1000);
    const cancellation = new vscode.CancellationTokenSource();
    response.on('close', () => {
      if (!response.writableEnded) {
        cancellation.cancel();
      }
    });

    try {
      const result = await model.sendRequest(prompt, {}, cancellation.token);

      if (request.body.stream === true) {
        response.status(200).set({
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive'
        });
        response.flushHeaders();

        for await (const fragment of result.text) {
          if (response.destroyed) {
            break;
          }

          response.write(`data: ${JSON.stringify({
            id,
            object: 'chat.completion.chunk',
            created,
            model: model.id,
            choices: [{ index: 0, delta: { content: fragment }, finish_reason: null }]
          })}\n\n`);
        }

        if (!response.destroyed) {
          response.write(`data: ${JSON.stringify({
            id,
            object: 'chat.completion.chunk',
            created,
            model: model.id,
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
          })}\n\n`);
          response.end('data: [DONE]\n\n');
        }

        return;
      }

      let content = '';
      for await (const fragment of result.text) {
        content += fragment;
      }

      response.json({
        id,
        object: 'chat.completion',
        created,
        model: model.id,
        choices: [{
          index: 0,
          message: { role: 'assistant', content },
          finish_reason: 'stop'
        }]
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Model request failed.';
      if (response.headersSent) {
        if (!response.destroyed) {
          response.write(`data: ${JSON.stringify({
            error: { message, type: 'server_error' }
          })}\n\n`);
          response.end();
        }
      } else {
        response.status(502).json({
          error: { message, type: 'server_error', code: 'model_request_failed' }
        });
      }
    } finally {
      cancellation.dispose();
    }
  });

  app.use((error, _request, response, _next) => {
    const status = error.status === 413 ? 413 : 400;
    response.status(status).json({
      error: {
        message: status === 413 ? 'Request body is too large.' : 'Invalid JSON request body.',
        type: 'invalid_request_error'
      }
    });
  });

  return app;
}

let bridgeServer;
let output;
let bridgeStatusItem;
let bridgeState;
let bridgeApiKey;
let bridgeBaseUrl;

function updateBridgeStatus(modelsAvailable) {
  if (!bridgeStatusItem) {
    return;
  }

  bridgeStatusItem.text = modelsAvailable ? '$(check) Models Available' : '$(play) Enable Model Access';
  bridgeStatusItem.tooltip = modelsAvailable
    ? `Default model: ${bridgeState.defaultModel.id}. Click to stop the bridge.`
    : 'Enable VS Code model access';
  bridgeStatusItem.command = modelsAvailable ? 'vscodeOpenAI.stopBridge' : 'vscodeOpenAI.startBridge';
}

async function ensureBridgeServer(vscode) {
  if (bridgeServer?.listening) {
    return bridgeBaseUrl;
  }

  const configuredPort = vscode.workspace.getConfiguration('vscodeOpenAI').get('port', 3210);
  const app = createApp(vscode, bridgeState, bridgeApiKey);

  await new Promise((resolve, reject) => {
    const server = app.listen(configuredPort, HOST);
    bridgeServer = server;
    server.once('listening', () => {
      const address = server.address();
      bridgeBaseUrl = `http://${HOST}:${address.port}/v1`;
      output.appendLine(`Base URL: ${bridgeBaseUrl}`);
      output.appendLine(`API key: ${bridgeApiKey}`);
      output.appendLine('Model access is not enabled yet.');
      resolve();
    });
    server.once('error', (error) => {
      if (bridgeServer === server) {
        bridgeServer = undefined;
      }
      reject(error);
    });
  });

  return bridgeBaseUrl;
}

function activate(context) {
  const vscode = require('vscode');
  output = vscode.window.createOutputChannel('VS Code OpenAI Bridge');
  context.subscriptions.push(output);
  output.appendLine('Extension activated. Starting the local API server.');
  bridgeState = { models: [] };
  bridgeApiKey = randomBytes(24).toString('hex');
  bridgeStatusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  updateBridgeStatus(false);
  bridgeStatusItem.show();
  context.subscriptions.push(bridgeStatusItem);

  context.subscriptions.push(vscode.commands.registerCommand(
    'vscodeOpenAI.startBridge',
    async () => {
      const vscode = require('vscode');
      if (bridgeState.models.length > 0) {
        output.show(true);
        return;
      }

      output.appendLine('Selecting VS Code Copilot models...');
      output.show(true);

      try {
        await ensureBridgeServer(vscode);
        const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
        if (models.length === 0) {
          output.appendLine('No VS Code Copilot language models are available.');
          updateBridgeStatus(false);
          vscode.window.showErrorMessage('No VS Code Copilot language models are available.');
          return;
        }

        bridgeState.models = models;
        bridgeState.defaultModel = selectDefaultModel(models);
        output.appendLine(`Available models: ${models.map((model) => model.id).join(', ')}`);
        output.appendLine(`Default model: ${bridgeState.defaultModel.id}`);
        updateBridgeStatus(true);
        vscode.window.showInformationMessage(`Default model ${bridgeState.defaultModel.id} is ready.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Model selection failed.';
        output.appendLine(`Could not enable model access: ${message}`);
        updateBridgeStatus(false);
        vscode.window.showErrorMessage(`Could not enable model access: ${message}`);
      }
    }
  ));

  context.subscriptions.push(vscode.commands.registerCommand(
    'vscodeOpenAI.stopBridge',
    () => {
      if (!bridgeServer) {
        return;
      }

      bridgeState.models = [];
      bridgeState.defaultModel = undefined;
      bridgeServer.close();
      bridgeServer = undefined;
      bridgeBaseUrl = undefined;
      output.appendLine('Bridge server stopped.');
      updateBridgeStatus(false);
      vscode.window.showInformationMessage('VS Code OpenAI Bridge stopped.');
    }
  ));

  ensureBridgeServer(vscode).then((baseUrl) => {
    output.appendLine(`Model endpoint: ${baseUrl}/models`);
    output.show(true);
    vscode.window.showInformationMessage(
      `Model API listening at ${baseUrl}/models. Enable model access?`,
      'Enable Models'
    ).then((selection) => {
      if (selection === 'Enable Models') {
        vscode.commands.executeCommand('vscodeOpenAI.startBridge');
      }
    });
  }).catch((error) => {
    const message = error instanceof Error ? error.message : 'Server startup failed.';
    output.appendLine(`Could not start bridge server: ${message}`);
    vscode.window.showErrorMessage(`Could not start bridge server: ${message}`);
  });
}

function deactivate() {
  bridgeServer?.close();
  bridgeServer = undefined;
  bridgeState = undefined;
  bridgeApiKey = undefined;
  bridgeBaseUrl = undefined;
  bridgeStatusItem = undefined;
}

module.exports = { activate, createApp, deactivate, selectDefaultModel };