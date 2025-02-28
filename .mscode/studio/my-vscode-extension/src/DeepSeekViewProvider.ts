import * as vscode from 'vscode';

// Types personnalisés pour les données DeepSeek
interface DeepSeekActionData {
    query: string;
    timestamp?: number;
}

interface Message {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

interface CodeChange {
    filePath: string;
    addedLines: string[];
    removedLines: string[];
    modifiedLines: { old: string; new: string }[];
}

interface DeepSeekAPIRequest {
    model: string;
    messages: Message[];
    stream: boolean;
    codeValidation?: boolean;
    codeChanges?: CodeChange[];
}

interface DeepSeekAPIResponse {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: {
        index: number;
        message: Message;
        finish_reason: string;
    }[];
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

/**
 * Provides the webview implementation for the DeepSeek panel.
 * This class handles all interactions between the webview and the extension.
 */
export class DeepSeekViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'deepseekView';
    private _view?: vscode.WebviewView;
    private fileWatcher?: vscode.FileSystemWatcher;
    private pendingChanges: Map<string, CodeChange> = new Map();
    private validationTimeout?: NodeJS.Timeout;

    constructor(private readonly _extensionUri: vscode.Uri) {
        this.setupFileWatcher();
    }

    /**
     * Initializes and sets up the webview panel
     */
    resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getWebviewContent(webviewView.webview);

        // Écouter tous les messages du webview
        webviewView.webview.onDidReceiveMessage(async (message) => {
            console.log('Message reçu du webview:', message);
            try {
                switch (message.command) {
                    case 'openSettings':
                        console.log('Ouverture des paramètres');
                        await vscode.commands.executeCommand('mscode.configureDeepSeek');
                        break;

                    case 'deepseekAction':
                        console.log('Action DeepSeek reçue:', message.data);
                        if (message.data) {
                            await this.handleDeepSeekAction(message.data);
                        } else {
                            console.error('Données manquantes dans le message');
                            this.sendErrorToWebview('Message invalide reçu');
                        }
                        break;

                    case 'sendMessage':
                        console.log('Message texte reçu:', message.text);
                        if (message.text) {
                            await this.handleUserMessage(message.text);
                        }
                        break;

                    case 'createCheckpoint':
                        console.log('Création d\'un checkpoint');
                        const changes = Array.from(this.pendingChanges.values());
                        if (changes.length > 0) {
                            const validation = await this.validateCodeChanges(changes);
                            this.sendMessageToWebview('response', `Code Change Validation:\n${validation}`);
                            this.pendingChanges.clear();
                        }
                        break;

                    default:
                        console.error('Commande inconnue reçue:', message.command);
                        this.sendErrorToWebview('Commande non reconnue');
                }
            } catch (error) {
                console.error('Erreur lors du traitement du message:', error);
                this.sendErrorToWebview('Une erreur est survenue lors du traitement de votre demande.');
            }
        });
    }

    /**
     * Génère un nonce aléatoire pour la sécurité du contenu
     */
    private getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    private _getStyles(): string {
        return `
            body {
                padding: 15px;
                color: var(--vscode-editor-foreground);
                font-family: var(--vscode-font-family);
                height: 100vh;
                margin: 0;
            }
            .chat-container {
                display: flex;
                flex-direction: column;
                height: calc(100vh - 30px);
                position: relative;
            }
            .messages {
                flex: 1;
                overflow-y: auto;
                margin-bottom: 15px;
                padding: 10px;
                border: 1px solid var(--vscode-panel-border);
                border-radius: 4px;
                background: var(--vscode-editor-background);
            }
            .message {
                margin-bottom: 10px;
                padding: 8px;
                border-radius: 4px;
                word-wrap: break-word;
            }
            .user-message {
                background: var(--vscode-editor-background);
                border: 1px solid var(--vscode-panel-border);
                margin-left: 20%;
                color: var(--vscode-editor-foreground);
            }
            .bot-message {
                background: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                margin-right: 20%;
            }
            .input-container {
                display: flex;
                gap: 10px;
                padding: 10px;
                background: var(--vscode-editor-background);
                border-top: 1px solid var(--vscode-panel-border);
                position: sticky;
                bottom: 0;
            }
            textarea {
                flex: 1;
                padding: 8px;
                border: 1px solid var(--vscode-input-border);
                background: var(--vscode-input-background);
                color: var(--vscode-input-foreground);
                resize: vertical;
                min-height: 60px;
                border-radius: 4px;
                font-family: inherit;
            }
            button {
                padding: 8px 16px;
                background: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border: none;
                border-radius: 4px;
                cursor: pointer;
            }
            button:hover {
                background: var(--vscode-button-hoverBackground);
            }
            .error {
                color: var(--vscode-errorForeground);
                padding: 8px;
                margin: 8px 0;
                border-radius: 4px;
                background: var(--vscode-inputValidation-errorBackground);
                border: 1px solid var(--vscode-inputValidation-errorBorder);
            }
            .settings-button {
                position: absolute;
                top: 10px;
                right: 10px;
                padding: 8px;
                display: flex;
                align-items: center;
                gap: 5px;
            }
        `;
    }

    private _getScripts(nonce: string): string {
        return `
            <script nonce="${nonce}">
                const vscode = acquireVsCodeApi();
                const messagesContainer = document.getElementById('messages');
                const userInput = document.getElementById('userInput');
                let isProcessing = false;

                function addMessage(content, isUser = false, isError = false) {
                    const messageDiv = document.createElement('div');
                    messageDiv.className = isError ? 'message error' : 
                                         'message ' + (isUser ? 'user-message' : 'bot-message');
                    messageDiv.textContent = content;
                    messagesContainer.appendChild(messageDiv);
                    messagesContainer.scrollTop = messagesContainer.scrollHeight;
                }

                async function sendMessage() {
                    if (isProcessing) return;
                    
                    const message = userInput.value.trim();
                    if (!message) return;
                    
                    isProcessing = true;
                    addMessage(message, true);
                    userInput.value = '';
                    
                    try {
                        await vscode.postMessage({
                            command: 'deepseekAction',
                            data: message
                        });
                    } catch (error) {
                        addMessage('Erreur lors de l\\'envoi du message', false, true);
                    } finally {
                        isProcessing = false;
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
                            addMessage(message.data, false);
                            break;
                        case 'error':
                            addMessage(message.data, false, true);
                            break;
                        case 'processingStart':
                            isProcessing = true;
                            break;
                        case 'processingEnd':
                            isProcessing = false;
                            break;
                    }
                });
            </script>
        `;
    }

    private _getWebviewContent(webview: vscode.Webview): string {
        const nonce = this.getNonce();

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>DeepSeek Chat</title>
            <style>${this._getStyles()}</style>
        </head>
        <body>
            <button class="settings-button" onclick="openSettings()">
                ⚙️ Configurer l'API
            </button>
            <div class="chat-container">
                <div class="messages" id="messages">
                    <div class="message bot-message">Bonjour ! Je suis prêt à vous aider. Si vous n'avez pas encore configuré votre clé API, cliquez sur ⚙️ en haut à droite.</div>
                </div>
                <div class="input-container">
                    <textarea 
                        id="userInput" 
                        placeholder="Posez votre question..."
                        onkeydown="handleKeyDown(event)"
                    ></textarea>
                    <button onclick="sendMessage()">Envoyer</button>
                </div>
            </div>
            ${this._getScripts(nonce)}
        </body>
        </html>`;
    }

    /**
     * Gère les actions DeepSeek envoyées depuis le webview
     * @param data Les données envoyées depuis le webview
     */
    private async handleDeepSeekAction(data: unknown) {
        try {
            if (!data || typeof data !== 'string' || data.trim() === '') {
                throw new Error('Données invalides ou vides reçues');
            }

            this.sendMessageToWebview('processingStart', '');
            this.sendMessageToWebview('response', 'Traitement de votre demande...');

            // Vérifier si la clé API est configurée avant d'envoyer la requête
            const apiKey = await this.getApiKey();
            
            if (!apiKey) {
                this.sendErrorToWebview('Veuillez configurer votre clé API DeepSeek. Cliquez sur le bouton ⚙️ en haut à droite.');
                await vscode.commands.executeCommand('mscode.configureDeepSeek');
                return;
            }

            console.log('Envoi de la requête à DeepSeek:', data);
            try {
                const response = await this.processDeepSeekQuery(data);
                console.log('Réponse reçue de DeepSeek:', response);
                
                if (response) {
                    this.sendMessageToWebview('response', response);
                } else {
                    throw new Error('Réponse vide reçue de DeepSeek');
                }
            } catch (error) {
                console.error('Erreur API:', error);
                throw error;
            }

        } catch (error) {
            console.error('Erreur lors du traitement de l\'action DeepSeek:', error);
            const errorMessage = (error as Error).message;
            if (errorMessage.includes('non configurée')) {
                this.sendErrorToWebview('Veuillez configurer votre clé API DeepSeek. Cliquez sur le bouton ⚙️ en haut à droite.');
            } else {
                this.sendErrorToWebview(`Erreur: ${errorMessage}`);
            }
        } finally {
            this.sendMessageToWebview('processingEnd', '');
        }
    }

    /**
     * Appelle l'API DeepSeek
     * @param query La requête à envoyer à l'API
     */
    private async callDeepSeekAPI(query: string, codeChanges?: CodeChange[]): Promise<DeepSeekAPIResponse> {
        const apiKey = await this.getApiKey();
        const apiUrl = this.getDeepSeekApiUrl();

        const requestData: DeepSeekAPIRequest = {
            model: 'deepseek-chat',
            messages: [
                {
                    role: 'system',
                    content: 'You are a helpful coding assistant that can validate code changes and provide detailed feedback. When reviewing code changes, analyze for: 1) Syntax errors 2) Logic issues 3) Best practices 4) Potential improvements'
                },
                {
                    role: 'user',
                    content: query
                }
            ],
            stream: false
        };

        if (codeChanges) {
            requestData.codeValidation = true;
            requestData.codeChanges = codeChanges;
        }

        console.log('Envoi de la requête à:', apiUrl);
        console.log('Données de la requête:', JSON.stringify(requestData));

        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                    'Accept': 'application/json'
                },
                body: JSON.stringify(requestData)
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('Erreur API:', {
                    status: response.status,
                    statusText: response.statusText,
                    error: errorText
                });
                throw new Error(`Erreur API DeepSeek (${response.status}): ${errorText}`);
            }

            const data = await response.json();
            console.log('Réponse API brute:', data);
            
            // Type guard function to validate response structure
            const isDeepSeekResponse = (obj: any): obj is DeepSeekAPIResponse => {
                return obj 
                    && typeof obj === 'object'
                    && 'choices' in obj 
                    && Array.isArray(obj.choices)
                    && obj.choices.length > 0
                    && 'message' in obj.choices[0];
            };
            
            if (!isDeepSeekResponse(data)) {
                console.error('Format de réponse invalide:', data);
                throw new Error('Format de réponse API invalide');
            }
            
            return data;
        } catch (error) {
            console.error('Erreur lors de l\'appel API:', error);
            throw error;
        }
    }

    /**
     * Récupère la clé API depuis les paramètres de l'extension
     */
    private async getApiKey(): Promise<string> {
        const config = vscode.workspace.getConfiguration('deepseek');
        const apiKey = config.get<string>('apiKey');
        
        if (!apiKey || apiKey.trim() === '') {
            throw new Error('Clé API DeepSeek non configurée');
        }

        return apiKey;
    }

    /**
     * Récupère l'URL de l'API DeepSeek depuis les paramètres
     */
    private getDeepSeekApiUrl(): string {
        const config = vscode.workspace.getConfiguration('deepseek');
        return config.get<string>('apiUrl') || 'https://api.deepseek.com/v1/chat/completions';
    }

    /**
     * Traite une requête DeepSeek
     * @param query La requête à traiter
     */
    private async processDeepSeekQuery(query: string, codeChanges?: CodeChange[]): Promise<string> {
        try {
            console.log('Traitement de la requête DeepSeek:', query);
            
            // Si pas de clé API, renvoyer un message d'erreur
            const apiKey = await this.getApiKey();
            if (!apiKey) {
                return "Veuillez d'abord configurer votre clé API.";
            }

            // Tentative d'appel à l'API
            try {
                const apiResponse = await this.callDeepSeekAPI(query, codeChanges);
                console.log('Réponse API reçue:', apiResponse);

                if (apiResponse.choices && apiResponse.choices.length > 0 && apiResponse.choices[0].message) {
                    return apiResponse.choices[0].message.content;
                } else {
                    console.error('Format de réponse invalide:', apiResponse);
                    return 'Désolé, je n\'ai pas pu générer une réponse appropriée.';
                }
            } catch (apiError) {
                console.error('Erreur API:', apiError);
                return `Erreur lors de l'appel à l'API: ${(apiError as Error).message}`;
            }
        } catch (error) {
            console.error('Erreur lors du traitement de la requête DeepSeek:', error);
            throw new Error(`Impossible de traiter la requête: ${(error as Error).message}`);
        }
    }

    private async validateCodeChanges(changes: CodeChange[]): Promise<string> {
        try {
            const validationQuery = `Please validate the following code changes:\n${JSON.stringify(changes, null, 2)}`;
            const response = await this.processDeepSeekQuery(validationQuery, changes);
            return response;
        } catch (error) {
            console.error('Error validating code changes:', error);
            throw new Error(`Failed to validate code changes: ${(error as Error).message}`);
        }
    }

    private setupFileWatcher() {
        this.fileWatcher = vscode.workspace.createFileSystemWatcher('**/*');
        
        this.fileWatcher.onDidChange(async (uri) => {
            await this.handleFileChange(uri);
        });

        this.fileWatcher.onDidCreate(async (uri) => {
            await this.handleFileChange(uri);
        });

        this.fileWatcher.onDidDelete(async (uri) => {
            this.pendingChanges.delete(uri.fsPath);
        });
    }

    private async handleFileChange(uri: vscode.Uri) {
        try {
            const repositoryPath = vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath;
            if (!repositoryPath) {
                return;
            }

            const document = await vscode.workspace.openTextDocument(uri);
            const filePath = uri.fsPath;
            const relativePath = vscode.workspace.asRelativePath(filePath);

            // Get git status for the file
            const gitCommand = `cd "${repositoryPath}" && git diff --unified=0 "${relativePath}"`;
            const result = await new Promise<string>((resolve, reject) => {
                require('child_process').exec(gitCommand, (error: any, stdout: string) => {
                    if (error && error.code !== 1) { // git diff returns 1 if there are changes
                        reject(error);
                    } else {
                        resolve(stdout);
                    }
                });
            });

            const change: CodeChange = {
                filePath: filePath,
                addedLines: [],
                removedLines: [],
                modifiedLines: []
            };

            // Parse git diff output
            const diffLines = result.split('\n');
            let currentHunk: { oldStart: number, oldLines: number, newStart: number, newLines: number } | null = null;

            for (const line of diffLines) {
                if (line.startsWith('@@')) {
                    // Parse hunk header
                    const match = line.match(/@@ -(\d+),?(\d+)? \+(\d+),?(\d+)? @@/);
                    if (match) {
                        currentHunk = {
                            oldStart: parseInt(match[1]),
                            oldLines: match[2] ? parseInt(match[2]) : 1,
                            newStart: parseInt(match[3]),
                            newLines: match[4] ? parseInt(match[4]) : 1
                        };
                    }
                } else if (currentHunk) {
                    if (line.startsWith('-')) {
                        change.removedLines.push(line.substring(1));
                    } else if (line.startsWith('+')) {
                        change.addedLines.push(line.substring(1));
                    } else if (line.startsWith(' ')) {
                        // Context line, can be used to detect modified lines
                        const contextLine = line.substring(1);
                        const lastRemoved = change.removedLines[change.removedLines.length - 1];
                        const lastAdded = change.addedLines[change.addedLines.length - 1];
                        
                        if (lastRemoved && lastAdded) {
                            change.modifiedLines.push({
                                old: lastRemoved,
                                new: lastAdded
                            });
                            // Clear the added/removed lines since we've converted them to a modification
                            change.removedLines.pop();
                            change.addedLines.pop();
                        }
                    }
                }
            }

            if (change.addedLines.length > 0 || change.removedLines.length > 0 || change.modifiedLines.length > 0) {
                this.pendingChanges.set(filePath, change);

                // Debounce validation
                if (this.validationTimeout) {
                    clearTimeout(this.validationTimeout);
                }

                this.validationTimeout = setTimeout(async () => {
                    const changes = Array.from(this.pendingChanges.values());
                    if (changes.length > 0) {
                        try {
                            const validation = await this.validateCodeChanges(changes);
                            this.sendMessageToWebview('response', `Code Change Validation:\n${validation}`);
                            this.pendingChanges.clear();
                        } catch (error) {
                            console.error('Error during code validation:', error);
                            this.sendErrorToWebview(`Code validation failed: ${(error as Error).message}`);
                        }
                    }
                }, 2000);
            }
        } catch (error) {
            console.error('Error handling file change:', error);
            this.sendErrorToWebview(`Failed to analyze code changes: ${(error as Error).message}`);
        }
    }

    public dispose() {
        this.fileWatcher?.dispose();
        if (this.validationTimeout) {
            clearTimeout(this.validationTimeout);
        }
    }

    /**
     * Journalise les erreurs de manière centralisée
     */
    private logError(error: Error): void {
        console.error('Erreur DeepSeek:', {
            message: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString()
        });
        // TODO: Implémenter l'envoi vers un service de journalisation externe si nécessaire
    }

    /**
     * Gère les messages utilisateur
     * @param text Le texte du message
     */
    private async handleUserMessage(text: string) {
        try {
            if (!text || typeof text !== 'string') {
                throw new Error('Message invalide');
            }
            
            // Envoyer un message de confirmation
            this.sendMessageToWebview('response', 'Traitement de votre message...');

            // Vérifier la clé API
            const apiKey = await this.getApiKey();
            if (!apiKey) {
                this.sendErrorToWebview("Veuillez d'abord configurer votre clé API.");
                return;
            }

            // Traiter le message avec l'API
            const response = await this.processDeepSeekQuery(text);
            
            // Envoyer la réponse au webview
            if (response) {
                this.sendMessageToWebview('response', response);
            } else {
                throw new Error('Réponse vide reçue');
            }
        } catch (error) {
            console.error('Erreur lors du traitement du message:', error);
            this.sendErrorToWebview(`Erreur: ${(error as Error).message}`);
        }
    }

    /**
     * Envoie un message au webview
     */
    private sendMessageToWebview(command: string, data: string) {
        if (this._view) {
            console.log('Envoi du message au webview:', { command, data });
            try {
                this._view.webview.postMessage({ command, data });
            } catch (error) {
                console.error('Erreur lors de l\'envoi du message au webview:', error);
            }
        } else {
            console.error('Webview non disponible pour envoyer le message');
        }
    }

    /**
     * Envoie un message d'erreur au webview
     */
    private sendErrorToWebview(errorMessage: string) {
        this.sendMessageToWebview('error', errorMessage);
    }
}