import * as vscode from 'vscode';
import { BaseAIViewProvider } from './BaseAIViewProvider';
import { getApiConfig } from '../config/aiProviders';

export class ClaudeViewProvider extends BaseAIViewProvider {
    public static readonly viewType = 'claudeView';

    constructor(extensionUri: vscode.Uri, outputChannel: vscode.OutputChannel) {
        const config = getApiConfig('claude');
        if (!config) {
            throw new Error('Claude configuration not found');
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
                        await vscode.commands.executeCommand('workbench.action.openSettings', 'claude');
                        break;
                    case 'sendMessage':
                        if (message.text) {
                            const response = await this.callAPI(message.text);
                            if (response.completion) {
                                this.sendMessageToWebview('response', response.completion);
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
            model: 'claude-3-sonnet',
            prompt: prompt,
            max_tokens_to_sample: 2000,
            temperature: 0.7,
        };
    }
}