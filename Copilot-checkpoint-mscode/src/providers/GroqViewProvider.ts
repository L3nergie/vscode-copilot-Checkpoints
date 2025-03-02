import * as vscode from 'vscode';
import { BaseAIViewProvider } from './BaseAIViewProvider';
import { getApiConfig } from '../config/aiProviders';
import { Logger } from '../utils/logger';

export class GroqViewProvider extends BaseAIViewProvider {
    public static readonly viewType = 'groqView';

    constructor(extensionUri: vscode.Uri, outputChannel: vscode.OutputChannel) {
        const config = getApiConfig('groq');
        if (!config) {
            throw new Error('Groq configuration not found');
        }
        super(extensionUri, config, outputChannel);
    }

    async resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };
        webviewView.webview.html = this.getWebviewContent(this.extensionUri);

        webviewView.webview.onDidReceiveMessage(async (message) => {
            try {
                switch (message.command) {
                    case 'openSettings':
                        await vscode.commands.executeCommand('workbench.action.openSettings', 'groq');
                        break;
                    case 'sendMessage':
                        if (message.text) {
                            const response = await this.callAPI(message.text);
                            const content = this.extractResponseContent(response);
                            if (content) {
                                this.sendMessageToWebview('response', content);
                            } else {
                                this.sendErrorToWebview('No valid response content received');
                            }
                        }
                        break;
                }
            } catch (error) {
                this.sendErrorToWebview(error instanceof Error ? error.message : 'Une erreur est survenue');
                Logger.error(`Error in Groq provider: ${error}`);
            }
        });
    }

    private extractResponseContent(response: any): string | undefined {
        if (!response || !response.choices || !response.choices[0]) {
            return undefined;
        }
        return response.choices[0].text || undefined;
    }

    protected prepareAPIRequest(prompt: string) {
        return {
            model: 'mixtral-8x7b-32768',
            messages: [
                {
                    role: 'user',
                    content: prompt
                }
            ],
            temperature: 0.7,
            max_tokens: 2000
        };
    }
}