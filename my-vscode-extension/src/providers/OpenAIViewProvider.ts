import * as vscode from 'vscode';
import { BaseAIViewProvider } from './BaseAIViewProvider';
import { getApiConfig } from '../config/aiProviders';

export class OpenAIViewProvider extends BaseAIViewProvider {
    public static readonly viewType = 'openaiView';

    constructor(extensionUri: vscode.Uri, outputChannel: vscode.OutputChannel) {
        const config = getApiConfig('openai');
        if (!config) {
            throw new Error('OpenAI configuration not found');
        }
        super(extensionUri, config, outputChannel);
    }

    async resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };
        webviewView.webview.html = this.getWebviewContent();

        webviewView.webview.onDidReceiveMessage(async (message) => {
            try {
                switch (message.command) {
                    case 'openSettings':
                        await vscode.commands.executeCommand('workbench.action.openSettings', 'openai');
                        break;
                    case 'sendMessage':
                        if (message.text) {
                            const response = await this.callAPI(message.text);
                            if (response.choices && response.choices[0]) {
                                this.sendMessageToWebview('response', response.choices[0].message.content);
                            }
                        }
                        break;
                }
            } catch (error) {
                this.sendErrorToWebview(error instanceof Error ? error.message : 'Une erreur est survenue');
            }
        });
    }

    protected prepareAPIRequest(prompt: string) {
        return {
            model: 'gpt-4-turbo-preview',
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