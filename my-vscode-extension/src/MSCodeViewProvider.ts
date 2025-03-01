import * as vscode from 'vscode';
import * as fsExtra from 'fs-extra';
import * as path from 'path';

interface CheckpointHistory {
    id: string;
    timestamp: number;
    files: Record<string, any>;
    metadata: {
        description: string;
        isAutomatic: boolean;
    };
}

export class MSCodeViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'mscodePanel';
    private _view?: vscode.WebviewView;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly checkpointManager: any,
        private readonly outputChannel: vscode.OutputChannel
    ) {
        this.outputChannel.appendLine('=== MSCodeViewProvider Initialized ===');
        if (this.checkpointManager) {
            this.outputChannel.appendLine('✓ CheckpointManager disponible');
        } else {
            this.outputChannel.appendLine('⚠ ATTENTION: CheckpointManager non disponible');
        }
    }

    public async refreshCheckpoints() {
        if (!this._view || !this.checkpointManager) return;

        this.outputChannel.appendLine('Rafraichissement des checkpoints...');
        
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
        if (!workspaceRoot) {
            this.outputChannel.appendLine('ERREUR: Pas de workspace ouvert');
            return;
        }

        try {
            const checkpoints = await this.checkpointManager.getAllCheckpoints();
            this.outputChannel.appendLine(`${checkpoints.length} checkpoints a afficher`);

            if (checkpoints.length > 0) {
                const changesDir = path.join(workspaceRoot, '.mscode', 'changes');
                this._view.webview.postMessage({
                    command: 'updateCheckpoints',
                    checkpoints: checkpoints,
                    checkpointFiles: checkpoints.map((cp: { id: string; timestamp: any; }) => ({
                        id: cp.id,
                        path: path.join(changesDir, cp.id),
                        timestamp: cp.timestamp,
                        data: cp
                    }))
                });
                this.outputChannel.appendLine('Checkpoints envoyes au webview');
            } else {
                this.outputChannel.appendLine('Aucun checkpoint a afficher');
            }
        } catch (error) {
            this.outputChannel.appendLine(`ERREUR lors du rafraichissement: ${error}`);
        }
    }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this.outputChannel.appendLine('===== Initialisation du panel MSCode =====');
        this._view = webviewView;

        // Analyser la structure du projet
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
            this.outputChannel.appendLine('\n=== Structure du projet ===');
            this.logDirectoryContents(workspaceRoot);
            
            // Logger le contenu du dossier .mscode
            const mscodeDir = path.join(workspaceRoot, '.mscode');
            if (fsExtra.existsSync(mscodeDir)) {
                this.outputChannel.appendLine('\n=== Contenu du dossier .mscode ===');
                this.logDirectoryContents(mscodeDir);
                
                // Logger les checkpoints
                const changesDir = path.join(mscodeDir, 'changes');
                if (fsExtra.existsSync(changesDir)) {
                    this.outputChannel.appendLine('\n=== Checkpoints existants ===');
                    const checkpoints = fsExtra.readdirSync(changesDir);
                    checkpoints.forEach(cp => {
                        const checkpointPath = path.join(changesDir, cp, 'checkpoint.json');
                        if (fsExtra.existsSync(checkpointPath)) {
                            try {
                                const checkpointData = JSON.parse(fsExtra.readFileSync(checkpointPath, 'utf-8'));
                                this.outputChannel.appendLine(`- ${cp}: ${checkpointData.metadata.description}`);
                                this.outputChannel.appendLine(`  Files: ${Object.keys(checkpointData.files).length} fichiers modifiés`);
                            } catch (error) {
                                this.outputChannel.appendLine(`- ${cp}: Erreur de lecture`);
                            }
                        }
                    });
                }
            }
        }

        if (!this.checkpointManager) {
            this.outputChannel.appendLine('\nERREUR: CheckpointManager non disponible lors de l\'initialisation du panel');
            return;
        }

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getWebviewContent(webviewView.webview);

        // Configurer les gestionnaires d'événements immédiatement
        webviewView.webview.onDidReceiveMessage(async message => {
            this.outputChannel.appendLine(`\n=== Message reçu: ${message.command} ===`);
            switch (message.command) {
                case 'ready':
                    this.outputChannel.appendLine('Webview prêt, chargement initial des checkpoints...');
                    await this.refreshCheckpoints();
                    break;

                case 'getCheckpoints':
                    this.outputChannel.appendLine('Demande de rafraîchissement des checkpoints...');
                    await this.refreshCheckpoints();
                    break;

                case 'createCheckpoint':
                    this.outputChannel.appendLine('Création d\'un nouveau checkpoint...');
                    if (message.description) {
                        this.outputChannel.appendLine(`Description: ${message.description}`);
                    } else {
                        this.outputChannel.appendLine('Aucune description fournie');
                    }
                    break;

                case 'showDiff':
                    this.outputChannel.appendLine(`Affichage du diff pour ${message.filePath} (Checkpoint: ${message.checkpointId})`);
                    const checkpoint = await this.checkpointManager.getCheckpointDetails(message.checkpointId);
                    if (checkpoint && checkpoint.files[message.filePath]) {
                        const fileData = checkpoint.files[message.filePath];
                        if (fileData && fileData.snapshot && fileData.timeline && fileData.timeline.snapshots) {
                            this.outputChannel.appendLine('Diff disponible, envoi au webview...');
                            webviewView.webview.postMessage({
                                command: 'displayDiff',
                                diff: {
                                    original: fileData.snapshot,
                                    modified: fileData.timeline.snapshots[0].content
                                },
                                filePath: message.filePath
                            });
                        } else {
                            this.outputChannel.appendLine('Données de fichier invalides');
                        }
                    } else {
                        this.outputChannel.appendLine('Erreur: Fichier ou checkpoint non trouvé');
                    }
                    break;

                case 'restoreCheckpoint':
                    this.outputChannel.appendLine(`Restauration du checkpoint: ${message.checkpointId}`);
                    await this.restoreCheckpoint(message.checkpointId);
                    break;

                case 'deleteCheckpoint':
                    // TODO: voulez vous vraiment supprimer ce checkpoint
                    this.outputChannel.appendLine(`Suppression du checkpoint: ${message.checkpointId}`);
                    await this.deleteCheckpoint(message.checkpointId);
                    await this.refreshCheckpoints();
                    break;

                case 'sendMessage':
                    if (message.text && message.text.trim()) {
                        this.outputChannel.appendLine(`Message envoyé: "${message.text}"`);
                    } else {
                        this.outputChannel.appendLine('Tentative d\'envoi d\'un message vide');
                    }
                    break;
            }
        });

        this.refreshCheckpoints();
    }

    private logDirectoryContents(dirPath: string, level: number = 0) {
        const indent = '  '.repeat(level);
        const items = fsExtra.readdirSync(dirPath);
        
        items.forEach(item => {
            const fullPath = path.join(dirPath, item);
            const stats = fsExtra.statSync(fullPath);
            
            if (stats.isDirectory()) {
                this.outputChannel.appendLine(`${indent}📁 ${item}/`);
                if (!item.startsWith('.') && level < 2) { // Limiter la profondeur de récursion
                    this.logDirectoryContents(fullPath, level + 1);
                }
            } else {
                // Ajouter la taille du fichier
                const size = (stats.size / 1024).toFixed(2);
                this.outputChannel.appendLine(`${indent}📄 ${item} (${size} KB)`);
            }
        });
    }

    private async restoreCheckpoint(checkpointId: string) {
        const checkpoint = await this.checkpointManager.getCheckpointDetails(checkpointId);
        if (!checkpoint) return;

        try {
            // Restaurer chaque fichier du checkpoint
            for (const [filePath, fileData] of Object.entries(checkpoint.files)) {
                await this.checkpointManager.revertToState(filePath, checkpoint.timestamp);
            }
            vscode.window.showInformationMessage(`Restored to checkpoint: ${checkpoint.metadata.description}`);
        } catch (error) {
            vscode.window.showErrorMessage(`Error restoring checkpoint: ${error}`);
        }
    }

    private async deleteCheckpoint(checkpointId: string) {
        const checkpoint = await this.checkpointManager.getCheckpointDetails(checkpointId);
        if (!checkpoint) return;

        try {
            // Supprimer le dossier du checkpoint
            const checkpointDir = path.join(this._extensionUri.fsPath, '..', '.mscode', 'changes', checkpointId);
            if (fsExtra.existsSync(checkpointDir)) {
                fsExtra.removeSync(checkpointDir);
            }

            // Mettre à jour l'historique en retirant le checkpoint
            let history = await this.checkpointManager.getAllCheckpoints();
            history = history.filter((cp: CheckpointHistory) => cp.id !== checkpointId);
            const historyFile = path.join(this._extensionUri.fsPath, '..', '.mscode', 'history.json');
            fsExtra.writeJSONSync(historyFile, history, { spaces: 2 });

            vscode.window.showInformationMessage(`Checkpoint deleted: ${checkpoint.metadata.description}`);
        } catch (error) {
            vscode.window.showErrorMessage(`Error deleting checkpoint: ${error}`);
        }
    }

    private _getWebviewContent(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'mscode-webview.js')
        );

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>MSCode Checkpoints</title>
            <style>
                body {
                    padding: 0;
                    margin: 0;
                    font-family: var(--vscode-font-family);
                    color: var(--vscode-foreground);
                }
                
                .checkpoint-graph {
                    position: relative;
                    padding: 20px;
                }

                .checkpoint-node {
                    position: relative;
                    display: flex;
                    align-items: flex-start;
                    margin: 10px 0;
                    padding: 8px;
                    border-radius: 4px;
                    background: var(--vscode-editor-background);
                    border: 1px solid var(--vscode-widget-border);
                    transition: all 0.3s ease;
                }

                .node-header {
                    padding: 8px;
                    border-radius: 4px;
                    transition: background-color 0.2s;
                }

                .node-header:hover {
                    background: var(--vscode-list-hoverBackground);
                }

                .node-details {
                    max-height: 1000px;
                    opacity: 1;
                    overflow: hidden;
                    transition: all 0.3s ease;
                }

                .checkpoint-node.collapsed .node-details {
                    max-height: 0;
                    opacity: 0;
                    margin: 0;
                    padding: 0;
                }

                .checkpoint-node.collapsed .node-time {
                    margin-bottom: 0;
                }

                .node-header::after {
                    content: '▼';
                    float: right;
                    transition: transform 0.3s ease;
                }

                .checkpoint-node.collapsed .node-header::after {
                    transform: rotate(-90deg);
                }

                .checkpoint-node::before {
                    content: '';
                    position: absolute;
                    width: 2px;
                    height: calc(100% + 20px);
                    background: var(--vscode-errorForeground);
                    left: 15px;
                    top: -10px;
                    z-index: 0;
                }

                .checkpoint-node .node-dot {
                    width: 12px;
                    height: 12px;
                    border-radius: 50%;
                    background: var(--vscode-errorForeground);
                    margin-right: 12px;
                    position: relative;
                    z-index: 1;
                }

                .checkpoint-node.initial-state .node-dot {
                    background: var(--vscode-textLink-foreground);
                }

                .checkpoint-node.initial-state::before {
                    background: var(--vscode-textLink-foreground);
                }

                .checkpoint-node.initial-state .latest-badge {
                    background: var(--vscode-textLink-foreground);
                    color: white;
                }

                .checkpoint-node.standard .node-dot,
                .checkpoint-node.standard::before {
                    background: var(--vscode-errorForeground);
                }

                .checkpoint-node.current .node-dot,
                .checkpoint-node.current::before {
                    background: var(--vscode-warningBackground);
                }

                .checkpoint-node.latest .node-dot,
                .checkpoint-node.latest::before {
                    background: var(--vscode-testing-iconPassed);
                }

                .confirmation-dialog {
                    position: relative;
                    background: var(--vscode-notifications-background);
                    border: 1px solid var(--vscode-notifications-border);
                    margin: 10px;
                    padding: 12px;
                    border-radius: 4px;
                    animation: slideDown 0.3s ease-out;
                }

                @keyframes slideDown {
                    from {
                        opacity: 0;
                        transform: translateY(-10px);
                    }
                    to {
                        opacity: 1;
                        transform: translateY(0);
                    }
                }

                .confirmation-dialog .title {
                    font-weight: bold;
                    margin-bottom: 8px;
                    color: var(--vscode-notificationsErrorIcon-foreground);
                }

                .confirmation-dialog .message {
                    margin-bottom: 12px;
                    font-size: 0.9em;
                }

                .confirmation-dialog .buttons {
                    display: flex;
                    justify-content: flex-end;
                    gap: 8px;
                }

                .confirmation-dialog button {
                    padding: 4px 12px;
                    border: none;
                    border-radius: 2px;
                    cursor: pointer;
                    font-size: 12px;
                }

                .confirmation-dialog .confirm {
                    background: var(--vscode-notificationsErrorIcon-foreground);
                    color: white;
                }

                .confirmation-dialog .cancel {
                    background: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                }

                .node-content {
                    flex: 1;
                    z-index: 1;
                }

                .node-time {
                    font-size: 0.9em;
                    color: var(--vscode-descriptionForeground);
                }

                .node-description {
                    margin-top: 4px;
                }

                .file-changes {
                    margin-top: 8px;
                    padding-left: 24px;
                    font-size: 0.9em;
                }

                .file-item {
                    display: flex;
                    align-items: center;
                    margin: 2px 0;
                }

                .restore-btn {
                    background: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 4px 8px;
                    border-radius: 2px;
                    cursor: pointer;
                    margin-top: 8px;
                }

                .restore-btn:hover {
                    background: var(--vscode-button-hoverBackground);
                }

                .latest-badge {
                    background: var(--vscode-statusBarItem-warningBackground);
                    color: var(--vscode-statusBarItem-warningForeground);
                    padding: 2px 6px;
                    border-radius: 10px;
                    font-size: 0.8em;
                    margin-left: 8px;
                }

                .delete-btn {
                    position: absolute;
                    right: 8px;
                    top: 8px;
                    background: transparent;
                    color: var(--vscode-errorForeground);
                    border: none;
                    width: 24px;
                    height: 24px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    font-size: 16px;
                    opacity: 0;
                    transition: opacity 0.2s;
                    z-index: 2;
                }

                .checkpoint-node .node-details .delete-btn {
                    position: static;
                    margin-left: auto;
                    opacity: 1;
                }

                .delete-btn:hover {
                    opacity: 1;
                    filter: brightness(1.2);
                }

                .view-diff-icon {
                    background: transparent;
                    color: var(--vscode-textLink-foreground);
                    border: none;
                    padding: 2px 6px;
                    border-radius: 2px;
                    cursor: pointer;
                    font-size: 1em;
                    margin-left: 8px;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                }
                .view-diff-icon:hover {
                    color: var(--vscode-textLink-activeForeground);
                }
                #diffView {
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    width: 80%;
                    height: 80%;
                    background: var(--vscode-editor-background);
                    border: 1px solid var(--vscode-widget-border);
                    border-radius: 4px;
                    z-index: 10;
                    padding: 20px;
                    overflow: auto;
                    display: flex;
                    flex-direction: column;
                }
                #diffTitle {
                    font-weight: bold;
                    margin-bottom: 10px;
                    display: flex;
                    justify-content: space-between;
                }
                #closeDiffBtn {
                    background: transparent;
                    border: none;
                    color: var(--vscode-foreground);
                    cursor: pointer;
                }
                .diff-container {
                    display: flex;
                    height: 100%;
                }
                .diff-column {
                    flex: 1;
                    padding: 10px;
                    overflow: auto;
                    border: 1px solid var(--vscode-widget-border);
                    margin: 0 5px;
                }
                .diff-header {
                    font-weight: bold;
                    margin-bottom: 5px;
                    padding: 5px;
                    background: var(--vscode-editor-background);
                    border-bottom: 1px solid var(--vscode-widget-border);
                }
                .added-line {
                    background-color: rgba(0, 255, 0, 0.1);
                }
                .removed-line {
                    background-color: rgba(255, 0, 0, 0.1);
                    text-decoration: line-through;
                }
                .unchanged-line {
                    color: var(--vscode-foreground);
                }
                #overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0, 0, 0, 0.5);
                    z-index: 5;
                }

                .checkpoint-node .node-header {
                    width: 100%;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 8px;
                    user-select: none;
                }

                .checkpoint-node .node-time {
                    flex: 1;
                }

                .checkpoint-node .node-header:hover {
                    background-color: var(--vscode-list-hoverBackground);
                    border-radius: 4px;
                }

                .checkpoint-node.collapsed {
                    padding-bottom: 8px;
                }

                .checkpoint-node.collapsed .node-content {
                    margin-bottom: 0;
                }

                .checkpoint-node .latest-badge {
                    margin-right: 20px;
                }

                .node-header .expansion-indicator {
                    font-size: 0.8em;
                    color: var(--vscode-foreground);
                    opacity: 0.7;
                    margin-left: 8px;
                }

                .node-description {
                    margin-top: 12px;
                    margin-bottom: 8px;
                    padding: 0 8px;
                }

                .node-header-container {
                    padding: 8px;
                    background-color: var(--vscode-editor-background);
                    border-bottom: 1px solid var(--vscode-widget-border);
                    margin-bottom: 10px;
                }

                .node-header-container .delete-btn {
                    opacity: 1;
                    color: var(--vscode-errorForeground);
                    font-size: 18px;
                    padding: 4px 8px;
                    border-radius: 4px;
                    transition: background-color 0.2s;
                }

                .node-header-container .delete-btn:hover {
                    background-color: var(--vscode-list-hoverBackground);
                }

                .confirmation-dialog {
                    margin: 0;
                    border-radius: 0;
                    border-left: none;
                    border-right: none;
                    background-color: var(--vscode-notifications-background);
                }
            </style>
        </head>
        <body>
            <div class="checkpoint-graph" id="checkpointGraph"></div>
            <div id="diffView" style="display: none;">
                <div id="diffTitle">
                    <span id="diffFileName"></span>
                    <button id="closeDiffBtn">×</button>
                </div>
                <div class="diff-container">
                    <div class="diff-column">
                        <div class="diff-header">Original</div>
                        <div id="originalContent"></div>
                    </div>
                    <div class="diff-column">
                        <div class="diff-header">Modifié</div>
                        <div id="modifiedContent"></div>
                    </div>
                </div>
            </div>
            <div id="overlay" style="display: none;"></div>
            <script src="${scriptUri}"></script>
        </body>
        </html>`;
    }
}