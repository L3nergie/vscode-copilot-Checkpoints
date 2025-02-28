import * as vscode from 'vscode';

export class MSCodeViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'mscodePanel';

    private _view?: vscode.WebviewView;

    constructor(private readonly _extensionUri: vscode.Uri) {}

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

        webviewView.webview.onDidReceiveMessage(message => {
            switch (message.command) {
                case 'mscodeAction':
                    this.handleMSCodeAction(message.data);
                    break;
            }
        });
    }

    private _getWebviewContent(webview: vscode.Webview): string {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>MSCode</title>
        </head>
        <body>
            <h1>MSCode Panel</h1>
            <button onclick="performAction()">Perform Action</button>
            <script>
                const vscode = acquireVsCodeApi();
                function performAction() {
                    vscode.postMessage({
                        command: 'mscodeAction',
                        data: 'Action performed'
                    });
                }
            </script>
        </body>
        </html>`;
    }

    private handleMSCodeAction(data: any) {
        vscode.window.showInformationMessage(`MSCode Action: ${data}`);
    }
}