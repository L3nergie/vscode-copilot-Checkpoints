import * as vscode from 'vscode';
import { AIConfig, getApiKey } from '../config/aiProviders';
import { Logger } from '../utils/logger';
import { Responsibility } from '../responsibilities/types';
import { RoleManager } from '../services/RoleManager';

interface AIResponse {
    choices?: Array<{
        text?: string;
        message?: {
            content: string;
        };
    }>;
    candidates?: Array<{
        content: {
            parts: Array<{
                text: string;
            }>;
        };
    }>;
    completion?: string;
}

export abstract class BaseAIViewProvider implements vscode.WebviewViewProvider {
    protected _view?: vscode.WebviewView;
    protected fileWatcher?: vscode.FileSystemWatcher;
    protected validationTimeout?: NodeJS.Timeout;
    private requestInProgress: boolean = false;
    private readonly requestQueue: Array<() => Promise<void>> = [];
    protected responsibilities: Map<string, Responsibility> = new Map();
    private roleManager: RoleManager;
    private workspaceRoot: string;

    constructor(
        protected readonly extensionUri: vscode.Uri,
        protected readonly config: AIConfig,
        protected readonly outputChannel: vscode.OutputChannel
    ) {
        this.roleManager = RoleManager.getInstance();
        Logger.info(`Initializing ${config.name} provider with roles`);
        this.setupFileWatcher();
        
        // Ajout de la variable workspaceRoot
        this.workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath || '';
        
        // Assigner un rôle par défaut basé sur le type de provider
        const defaultRole = this.getDefaultRole();
        if (defaultRole) {
            this.roleManager.assignRole(this.config.id, defaultRole);
            Logger.info(`Assigned default role "${defaultRole}" to ${this.config.name}`);
        }
    }

    private getDefaultRole(): string | undefined {
        switch (this.config.name.toLowerCase()) {
            case 'claude':
            case 'openai':
            case 'gemini':
                return 'Administrateur';
            case 'mistral':
            case 'deepseek':
                return 'Correcteur';
            case 'groq':
                return 'Traducteur';
            default:
                return undefined;
        }
    }

    abstract resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        token: vscode.CancellationToken
    ): void | Promise<void>;

    protected async callAPI(prompt: string): Promise<AIResponse> {
        Logger.info(`Calling ${this.config.name} API...`);
        if (this.requestInProgress) {
            Logger.info('Request in progress, queuing...');
            return new Promise((resolve, reject) => {
                this.requestQueue.push(async () => {
                    try {
                        const response = await this.executeAPICall(prompt);
                        resolve(response);
                    } catch (error) {
                        reject(error);
                    }
                });
            });
        }

        return this.executeAPICall(prompt);
    }

    private async validatePermissions(prompt: string): Promise<boolean> {
        // Vérifier les permissions nécessaires basées sur le type de requête
        const requiresWrite = prompt.toLowerCase().includes('modify') || 
                            prompt.toLowerCase().includes('update') ||
                            prompt.toLowerCase().includes('change');
                            
        if (requiresWrite && !await this.checkPermission('write')) {
            return false;
        }
        
        return true;
    }

    private async executeAPICall(prompt: string): Promise<AIResponse> {
        if (!await this.validatePermissions(prompt)) {
            throw new Error('Permission denied');
        }
        
        this.requestInProgress = true;
        Logger.info(`Executing API call to ${this.config.name}...`);
        try {
            const apiKey = await getApiKey(this.config);
            Logger.info('API key retrieved successfully');
            
            if (!apiKey) {
                throw new Error(`API key not found for ${this.config.name}`);
            }
            
            // Add authentication error logging
            try {
                const response = await fetch(this.config.apiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`
                    },
                    body: JSON.stringify(this.prepareAPIRequest(prompt))
                });

                if (!response.ok) {
                    const errorData = await response.text();
                    await Logger.logAuthError({
                        message: `API request failed: ${response.status} ${response.statusText}`,
                        response: {
                            status: response.status,
                            headers: Object.fromEntries(response.headers.entries()),
                            data: errorData
                        }
                    });
                    throw new Error(`API error: ${response.status} - ${response.statusText}`);
                }

                const data = await response.json();
                Logger.info(`Received response from ${this.config.name}`);
                return data as AIResponse;
            } catch (error) {
                await Logger.logAuthError(error);
                throw error;
            }
        } catch (error) {
            Logger.logError(error, `${this.config.name} API call`);
            throw error;
        } finally {
            this.requestInProgress = false;
            if (this.requestQueue.length > 0) {
                Logger.info(`Processing next request from queue (${this.requestQueue.length} remaining)`);
                const nextRequest = this.requestQueue.shift();
                if (nextRequest) nextRequest();
            }
        }
    }

    protected async checkPermission(permission: string): Promise<boolean> {
        const hasPermission = this.roleManager.hasPermission(this.config.id, permission);
        if (!hasPermission) {
            Logger.warn(`Assistant ${this.config.name} doesn't have ${permission} permission`);
            this.sendErrorToWebview(`${this.config.name} n'a pas la permission ${permission}`);
        }
        return hasPermission;
    }

    public async assignResponsibility(responsibility: Responsibility): Promise<void> {
        Logger.info(`Assigning responsibility: ${responsibility.getName()}`);
        try {
            this.responsibilities.set(responsibility.getName(), responsibility);
            Logger.info(`Assigned responsibility: ${responsibility.getName()}`);
            await this.updateWebviewResponsibilities();
            Logger.info('Webview responsibilities updated');
        } catch (error) {
            Logger.error(`Error assigning responsibility: ${error}`);
            throw error;
        }
    }

    public async removeResponsibility(name: string): Promise<void> {
        if (this.responsibilities.delete(name)) {
            Logger.info(`Removed responsibility: ${name}`);
            await this.updateWebviewResponsibilities();
        }
    }

    public async executeResponsibilities(): Promise<void> {
        const sortedResponsibilities = Array.from(this.responsibilities.values())
            .sort((a, b) => b.getPriority() - a.getPriority());

        for (const responsibility of sortedResponsibilities) {
            try {
                await responsibility.execute();
                Logger.info(`Successfully executed: ${responsibility.getName()}`);
            } catch (error) {
                Logger.error(`Error executing ${responsibility.getName()}: ${error}`);
                throw error;
            }
        }
    }

    protected async updateWebviewResponsibilities(): Promise<void> {
        Logger.info('Updating webview responsibilities...');
        if (this._view?.webview) {
            const responsibilitiesList = Array.from(this.responsibilities.values())
                .map(r => ({
                    name: r.getName(),
                    description: r.getDescription(),
                    priority: r.getPriority()
                }));

            Logger.info(`Sending ${responsibilitiesList.length} responsibilities to webview`);
            this._view.webview.postMessage({
                command: 'updateResponsibilities',
                responsibilities: responsibilitiesList
            });
        } else {
            Logger.warn('Webview not available for responsibility update');
        }
    }

    protected setupFileWatcher() {
        Logger.info('Setting up file watcher...');
        this.fileWatcher?.dispose();
        this.fileWatcher = vscode.workspace.createFileSystemWatcher('**/*', false, false, false);
        
        this.fileWatcher.onDidChange(uri => {
            Logger.info(`File changed: ${uri.fsPath}`);
            if (this.validationTimeout) {
                clearTimeout(this.validationTimeout);
            }
            this.validationTimeout = setTimeout(() => {
                this.handleFileChange(uri).catch(error => {
                    Logger.error(`Error handling file change: ${error}`);
                });
            }, 500);
        });
        Logger.info('File watcher setup complete');
    }

    protected async handleFileChange(_uri: vscode.Uri) {
        // Cette méthode peut être surchargée par les classes enfants
    }

    protected abstract prepareAPIRequest(prompt: string): any;

    protected getWebviewContent(uri: vscode.Uri): string {
        // Use uri to load any resources like icons if needed
        const iconPath = vscode.Uri.joinPath(uri, 'media', this.config.icon).fsPath;
        
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
        if (this._view?.webview) {
            try {
                this._view.webview.postMessage({ command, text });
            } catch (error) {
                Logger.error(`Error sending message to webview: ${error}`);
            }
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
        this._view = undefined;
    }

    protected _getWebviewContent(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'media', 'main.js')
        );

        const nonce = this._getNonce();

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https:;">
                <title>AI Assistant</title>
                <style>
                    body {
                        padding: 0;
                        margin: 0;
                        color: var(--vscode-foreground);
                        font-size: 13px;
                        line-height: 1.4;
                    }

                    .chat-container {
                        display: flex;
                        flex-direction: column;
                        height: 100vh;
                        background: var(--vscode-editor-background);
                    }

                    .messages-container {
                        flex: 1;
                        overflow-y: auto;
                        padding: 16px;
                        display: flex;
                        flex-direction: column;
                        gap: 16px;
                    }

                    .message {
                        display: flex;
                        gap: 8px;
                        padding: 8px;
                        border-radius: 4px;
                        background: var(--vscode-editor-background);
                        border: 1px solid var(--vscode-widget-border);
                    }

                    .message.user {
                        background: var(--vscode-textBlockQuote-background);
                    }

                    .message.assistant {
                        background: var(--vscode-editor-background);
                    }

                    .message-content {
                        flex: 1;
                        white-space: pre-wrap;
                    }

                    .input-container {
                        padding: 16px;
                        background: var(--vscode-editor-background);
                        border-top: 1px solid var(--vscode-widget-border);
                        display: flex;
                        gap: 8px;
                    }

                    textarea {
                        flex: 1;
                        min-height: 40px;
                        max-height: 200px;
                        padding: 8px;
                        border: 1px solid var(--vscode-input-border);
                        border-radius: 4px;
                        background: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                        resize: none;
                        font-family: var(--vscode-font-family);
                        font-size: var(--vscode-font-size);
                    }

                    textarea:focus {
                        outline: none;
                        border-color: var(--vscode-focusBorder);
                    }

                    button {
                        padding: 4px 12px;
                        background: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        border-radius: 2px;
                        cursor: pointer;
                        display: flex;
                        align-items: center;
                        gap: 4px;
                    }

                    button:hover {
                        background: var(--vscode-button-hoverBackground);
                    }

                    button:disabled {
                        opacity: 0.5;
                        cursor: not-allowed;
                    }

                    .send-icon {
                        width: 16px;
                        height: 16px;
                    }

                    .code-block {
                        background: var(--vscode-textCodeBlock-background);
                        padding: 8px;
                        border-radius: 4px;
                        font-family: var(--vscode-editor-font-family);
                        white-space: pre;
                        overflow-x: auto;
                    }

                    .code-block::-webkit-scrollbar {
                        height: 8px;
                    }

                    .code-block::-webkit-scrollbar-track {
                        background: var(--vscode-scrollbarSlider-background);
                    }

                    .code-block::-webkit-scrollbar-thumb {
                        background: var(--vscode-scrollbarSlider-hoverBackground);
                        border-radius: 4px;
                    }

                    .typing-indicator {
                        display: flex;
                        gap: 4px;
                        padding: 8px;
                        color: var(--vscode-descriptionForeground);
                    }

                    .typing-dot {
                        width: 4px;
                        height: 4px;
                        border-radius: 50%;
                        background: currentColor;
                        animation: typing 1s infinite;
                    }

                    .typing-dot:nth-child(2) { animation-delay: 0.2s; }
                    .typing-dot:nth-child(3) { animation-delay: 0.4s; }

                    @keyframes typing {
                        0%, 100% { opacity: 0.2; }
                        50% { opacity: 1; }
                    }
                </style>
            </head>
            <body>
                <div class="chat-container">
                    <div class="messages-container" id="messages">
                    </div>
                    <div class="input-container">
                        <textarea id="userInput" placeholder="Entrez votre message..." rows="1"></textarea>
                        <button id="sendButton">
                            <img class="send-icon" src="${webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'send.svg'))}" alt="Send">
                        </button>
                    </div>
                </div>
                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
    }

    protected _getNonce() {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}