import * as vscode from 'vscode';
import { AIConfig, getApiKey } from '../config/aiProviders';

export abstract class BaseAIViewProvider implements vscode.WebviewViewProvider {
    protected _view?: vscode.WebviewView;
    protected fileWatcher?: vscode.FileSystemWatcher;
    protected validationTimeout?: NodeJS.Timeout;

    constructor(
        protected readonly extensionUri: vscode.Uri,
        protected readonly config: AIConfig,
        protected readonly outputChannel: vscode.OutputChannel
    ) {
        this.setupFileWatcher();
    }

    abstract resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        token: vscode.CancellationToken
    ): void | Promise<void>;

    protected setupFileWatcher() {
        this.fileWatcher = vscode.workspace.createFileSystemWatcher('**/*');
        this.fileWatcher.onDidChange(uri => this.handleFileChange(uri));
    }

    protected async handleFileChange(uri: vscode.Uri) {
        // Cette méthode peut être surchargée par les classes enfants
    }

    protected async callAPI(prompt: string): Promise<any> {
        try {
            const apiKey = await getApiKey(this.config);
            const response = await fetch(this.config.apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify(this.prepareAPIRequest(prompt))
            });

            if (!response.ok) {
                throw new Error(`API error: ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            this.outputChannel.appendLine(`Error calling ${this.config.name} API: ${error}`);
            throw error;
        }
    }

    protected abstract prepareAPIRequest(prompt: string): any;

    protected getWebviewContent(): string {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body {
                    padding: 10px;
                    color: var(--vscode-foreground);
                    font-family: var(--vscode-font-family);
                }
                .messages {
                    margin-bottom: 10px;
                    overflow-y: auto;
                    max-height: 300px;
                }
                .message {
                    margin: 5px 0;
                    padding: 8px;
                    border-radius: 4px;
                }
                .user-message {
                    background: var(--vscode-textBlockQuote-background);
                }
                .bot-message {
                    background: var(--vscode-editor-background);
                }
                .input-container {
                    display: flex;
                    gap: 5px;
                }
                textarea {
                    flex: 1;
                    resize: vertical;
                    min-height: 60px;
                    padding: 5px;
                    background: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border);
                }
                button {
                    padding: 4px 8px;
                    background: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    cursor: pointer;
                }
                button:hover {
                    background: var(--vscode-button-hoverBackground);
                }
                .provider-header {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    margin-bottom: 10px;
                    padding: 5px;
                    background: var(--vscode-editor-background);
                    border-radius: 4px;
                }
                .provider-icon {
                    font-size: 1.2em;
                }
                .provider-name {
                    font-weight: bold;
                }
                .settings-button {
                    margin-left: auto;
                    background: none;
                    border: none;
                    padding: 4px;
                    cursor: pointer;
                    color: var(--vscode-foreground);
                }
                .settings-button:hover {
                    color: var(--vscode-textLink-foreground);
                }
            </style>
        </head>
        <body>
            <div class="provider-header">
                <span class="provider-icon">${this.config.icon}</span>
                <span class="provider-name">${this.config.name}</span>
                <button class="settings-button" onclick="openSettings()">⚙️</button>
            </div>
            <div id="messages" class="messages"></div>
            <div class="input-container">
                <textarea 
                    id="userInput" 
                    placeholder="Posez votre question..."
                    onkeydown="handleKeyDown(event)"
                ></textarea>
                <button onclick="sendMessage()">Envoyer</button>
            </div>
            <script>
                const vscode = acquireVsCodeApi();
                const messagesContainer = document.getElementById('messages');
                const userInput = document.getElementById('userInput');

                function addMessage(content, isUser = false, isError = false) {
                    const messageDiv = document.createElement('div');
                    messageDiv.className = isError ? 'message error' : 
                                         'message ' + (isUser ? 'user-message' : 'bot-message');
                    messageDiv.textContent = content;
                    messagesContainer.appendChild(messageDiv);
                    messagesContainer.scrollTop = messagesContainer.scrollHeight;
                }

                function sendMessage() {
                    const message = userInput.value.trim();
                    if (message) {
                        addMessage(message, true);
                        vscode.postMessage({
                            command: 'sendMessage',
                            text: message
                        });
                        userInput.value = '';
                    }
                }

                function handleKeyDown(event) {
                    if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        sendMessage();
                    }
                }

                function openSettings() {
                    vscode.postMessage({
                        command: 'openSettings'
                    });
                }

                window.addEventListener('message', event => {
                    const message = event.data;
                    switch (message.command) {
                        case 'response':
                            addMessage(message.text, false);
                            break;
                        case 'error':
                            addMessage(message.text, false, true);
                            break;
                    }
                });
            </script>
        </body>
        </html>`;
    }

    protected sendMessageToWebview(command: string, text: string) {
        if (this._view) {
            this._view.webview.postMessage({ command, text });
        }
    }

    protected sendErrorToWebview(errorMessage: string) {
        this.sendMessageToWebview('error', errorMessage);
    }

    public dispose() {
        this.fileWatcher?.dispose();
        if (this.validationTimeout) {
            clearTimeout(this.validationTimeout);
        }
    }
}