import * as vscode from 'vscode';
import { BaseAIViewProvider } from './BaseAIViewProvider';
import { getApiConfig } from '../config/aiProviders';

export class GeminiViewProvider extends BaseAIViewProvider {
    public static readonly viewType = 'geminiView';

    constructor(extensionUri: vscode.Uri, outputChannel: vscode.OutputChannel) {
        const config = getApiConfig('gemini');
        if (!config) {
            throw new Error('Gemini configuration not found');
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
                        await vscode.commands.executeCommand('workbench.action.openSettings', 'gemini');
                        break;
                    case 'sendMessage':
                        if (message.text) {
                            const response = await this.callAPI(message.text);
                            if (response.candidates && response.candidates[0]) {
                                this.sendMessageToWebview('response', response.candidates[0].content.parts[0].text);
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
            contents: [{
                parts: [{
                    text: prompt
                }]
            }],
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 2000
            }
        };
    }
}