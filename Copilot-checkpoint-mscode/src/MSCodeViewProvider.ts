import * as vscode from 'vscode';
import * as fsExtra from 'fs-extra';
import * as path from 'path';
import { Logger } from './utils/logger';
import AdmZip from 'adm-zip';

let isInitialBackupCreated = false;

interface CheckpointHistory {
    id: string;
    timestamp: number;
    files: Record<string, any>;
    metadata: {
        description: string;
        isAutomatic: boolean;
    };
}

interface DiffLine {
    line: string;
    type: 'add' | 'delete' | 'change' | 'same';
}

interface DiffResult {
    additions: number;
    deletions: number;
    changes: number;
    diffLines: DiffLine[];
    tokens: {
        original: number;
        modified: number;
        diff: number;
    };
}

export class MSCodeViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'mscodePanel';
    private _view?: vscode.WebviewView;
    private readonly workspaceRoot: string;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly checkpointManager: any,
        private readonly outputChannel: vscode.OutputChannel
    ) {
        this.outputChannel.appendLine('MSCodeViewProvider construit');
        this.workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath || '';
    }

    private updateWebviewContent(checkpoints: CheckpointHistory[]) {
        if (!this._view) return;

        const webview = this._view.webview;
        const script = `
            const vscode = acquireVsCodeApi();
            const checkpoints = ${JSON.stringify(checkpoints)};
            const checkpointGraph = document.getElementById('checkpointGraph');
            checkpointGraph.innerHTML = '';

            // Trier les checkpoints par timestamp décroissant
            checkpoints.sort((a, b) => b.timestamp - a.timestamp);

            checkpoints.forEach((checkpoint, index) => {
                const nodeType = checkpoint.metadata.isInitialState ? 'initial-state' : 
                               index === 0 ? 'latest' : 'standard';
                
                const node = document.createElement('div');
                node.className = 'checkpoint-node ' + nodeType;
                
                const timestamp = new Date(checkpoint.timestamp).toLocaleString();
                const filesCount = Object.keys(checkpoint.files).length;
                
                node.innerHTML = \`
                    <div class="node-dot"></div>
                    <div class="node-content">
                        <div class="node-header">
                            <div>
                                <strong>\${checkpoint.metadata.description}</strong>
                                <div class="node-time">\${timestamp}</div>
                            </div>
                            \${nodeType === 'latest' ? '<span class="latest-badge">Latest</span>' : ''}
                        </div>
                        <div class="node-details">
                            <div class="file-changes">
                                \${filesCount} fichier\${filesCount > 1 ? 's' : ''} modifié\${filesCount > 1 ? 's' : ''}
                            </div>
                            <div class="node-actions">
                                <button class="restore-btn" onclick="vscode.postMessage({command: 'restoreCheckpoint', checkpointId: '\${checkpoint.id}'})">
                                    Restaurer
                                </button>
                                \${!checkpoint.metadata.isInitialState ? 
                                    \`<button class="delete-btn" onclick="vscode.postMessage({command: 'deleteCheckpoint', checkpointId: '\${checkpoint.id}'})">
                                        Supprimer
                                    </button>\` : ''}
                            </div>
                        </div>
                    </div>
                \`;
                
                checkpointGraph.appendChild(node);
            });
        `;

        const styles = `
            <style>
                // ...existing style code...

                .latest-badge {
                    font-size: 11px;
                    padding: 2px 6px;
                    border-radius: 3px;
                    background: var(--vscode-testing-iconPassed);
                    color: var(--vscode-editor-background);
                    font-weight: bold;
                }

                .node-actions {
                    display: flex;
                    gap: 8px;
                    margin-top: 8px;
                }

                .checkpoint-node {
                    opacity: 0;
                    animation: fadeIn 0.3s ease forwards;
                }

                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(10px); }
                    to { opacity: 1; transform: translateY(0); }
                }

                .checkpoint-node + .checkpoint-node {
                    margin-top: 16px;
                }

                .node-dot {
                    width: 12px;
                    height: 12px;
                    border-radius: 50%;
                    margin-top: 4px;
                    position: relative;
                    z-index: 1;
                    box-shadow: 0 0 0 2px var(--vscode-editor-background);
                }

                .checkpoint-node.latest .node-dot {
                    background: var(--vscode-testing-iconPassed);
                }

                .checkpoint-node.standard .node-dot {
                    background: var(--vscode-textLink-activeForeground);
                }
            </style>
        `;

        webview.postMessage({
            command: 'executeScript',
            script,
            styles
        });
    }
    public async initialCheckpoints() {
        this.outputChannel.appendLine('Tentative initialisation des checkpoints...');
        // const checkpoints = await this.checkpointManager.getAllCheckpoints();
        

        // if (checkpoints.length === 0) {
        //     this.outputChannel.appendLine(`0 checkpoints récupérés`);
        //     // Initialiser le backup initial ici
        //     // TODO: COPILOT
        //     // Vérifier si le dossier initial-backup existe
        //     // sinon créer le dossier initial-backup
        //     // verifier si le fichier initial-backup.zip existe
        //     // si oui, placer la variable isInitialBackupCreated à true
        //     // si non, créer le backup initial
        //     // afficher un progress bar en temps reel pour la création du backup
        //     // une fois le backup créé, afficher un message de succès
        //     // placer la variable isInitialBackupCreated à true
            
        //     const workspaceRoot = this.workspaceRoot;
        //     this.outputChannel.appendLine(workspaceRoot);
        //     const initialBackupPath = path.join(workspaceRoot, '.mscode', 'initial-backup');
        //     this.outputChannel.appendLine(`Initial backup path: ${initialBackupPath}`);
        //     const zipFilePath = path.join(initialBackupPath, 'initial-backup.zip');
        //     this.outputChannel.appendLine(`Initial backup zip path: ${zipFilePath}`);

        //     if (!fsExtra.existsSync(initialBackupPath)) {
        //         this.outputChannel.appendLine(`Création du dossier initial-backup...`);
        //         await fsExtra.ensureDir(initialBackupPath);
        //         await vscode.window.withProgress({
        //             location: vscode.ProgressLocation.Notification,
        //             title: "MSCode: Création du backup initial...",
        //             cancellable: false
        //         }, async (progress) => {
        //             this.outputChannel.appendLine(`Création du backup initial...`);
        //             //progress.report({ message: "Préparation du backup..." });
        //             await fsExtra.ensureDir(initialBackupPath);
        //             try {
        //                 this.outputChannel.appendLine(`Compression des fichiers...`);
        //                 //progress.report({ message: "Compression des fichiers..." });
        //                 await createZipArchive(workspaceRoot, zipFilePath, progress);
        //                 this.outputChannel.appendLine(`Backup initial créé sous forme d'archive zip.`);
        //                 //isInitialBackupCreated = true; // This should be handled in extension.ts
        //                 this.outputChannel.appendLine('Initial backup created as a zip archive.');
        //                 //progress.report({ message: "Backup créé avec succès!" });
        //                 this.outputChannel.appendLine("backup success");
        //                 isInitialBackupCreated=true;
        //             } catch (error) {
        //                 isInitialBackupCreated=false;
        //                 this.outputChannel.appendLine(`Erreur lors de la création du backup initial: ${error}`);
        //                 vscode.window.showErrorMessage(`Erreur lors de la création du backup initial: ${error}`);
        //             }
        //         });
        //     }
        // }else if (checkpoints.length > 0) {
        //     this.updateWebviewContent(checkpoints);
        //     this.outputChannel.appendLine(`checkpoints récupérés 0`);
        // }

        // if (this._view) {
        //     this._view.webview.postMessage({
        //         command: 'updateCheckpointGraph',
        //         checkpoints: checkpoints
        //     });
        // }

        
    }
    public async refreshCheckpoints() {
        this.outputChannel.appendLine('Tentative de rafraîchissement des checkpoints...');

        if (!this._view) {
            this.outputChannel.appendLine('ERREUR: Vue non initialisée lors du rafraîchissement');
            return;
        }

        try {
            const checkpoints = await this.checkpointManager.getAllCheckpoints();
            this.outputChannel.appendLine(`${checkpoints.length} checkpoints récupérés`);

            if (checkpoints.length > 0) {
                this.updateWebviewContent(checkpoints);
                this._view.webview.postMessage({
                    command: 'updateCheckpoints',
                    checkpoints: checkpoints
                });
                this.outputChannel.appendLine('Message updateCheckpoints envoyé au webview');
            } else {
                this.outputChannel.appendLine('Aucun checkpoint trouvé');
                this._view.webview.html = this._getWebviewContent(this._view.webview);
            }
        } catch (error) {
            this.outputChannel.appendLine(`ERREUR lors du rafraîchissement: ${error}`);
            vscode.window.showErrorMessage(`Erreur lors du rafraîchissement des checkpoints: ${error}`);
        }
    }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this.outputChannel.appendLine('=== Initialisation de la vue MSCode ===');
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        this.outputChannel.appendLine('Configuration des options du webview');

        webviewView.webview.html = this._getWebviewContent(webviewView.webview);
        this.outputChannel.appendLine('Contenu HTML chargé dans le webview');

        webviewView.webview.onDidReceiveMessage(async message => {
            this.outputChannel.appendLine(`Message reçu du webview: ${message.command}`);

            switch (message.command) {
                case 'ready':
                    this.outputChannel.appendLine('Webview prêt - démarrage du rafraîchissement');
                    //   await this.refreshCheckpoints();
                    break;
                case 'getCheckpoints':
                    this.outputChannel.appendLine('Demande de checkpoints reçue');
                    //    await this.refreshCheckpoints();
                    break;
                case 'error':
                    this.outputChannel.appendLine(`Erreur dans le webview: ${message.error}`);
                    vscode.window.showErrorMessage(`Erreur webview: ${message.error}`);
                    break;
                case 'showDiff':
                    this.outputChannel.appendLine(`Affichage du diff pour ${message.filePath}`);
                    const checkpoint = await this.checkpointManager.getCheckpointDetails(message.checkpointId);
                    if (checkpoint && checkpoint.files[message.filePath]) {
                        const fileData = checkpoint.files[message.filePath];
                        if (fileData) {
                            const currentContent = await fsExtra.readFile(
                                path.join(this.workspaceRoot, message.filePath),
                                'utf-8'
                            );
                            const originalContent = fileData.snapshot;

                            // Pour les fichiers JSON, faire une comparaison directe des objets
                            if (message.filePath.endsWith('.json')) {
                                try {
                                    const originalJson = JSON.parse(originalContent);
                                    const currentJson = JSON.parse(currentContent);

                                    const diff = {
                                        additions: 0,
                                        deletions: 0,
                                        changes: 0,
                                        tokens: {
                                            original: this.countTokens(originalContent),
                                            modified: this.countTokens(currentContent),
                                            diff: 0
                                        }
                                    };

                                    // Compter les changements réels
                                    for (const key in currentJson) {
                                        if (!(key in originalJson)) {
                                            diff.additions++;
                                        } else if (JSON.stringify(currentJson[key]) !== JSON.stringify(originalJson[key])) {
                                            diff.changes++;
                                        }
                                    }

                                    for (const key in originalJson) {
                                        if (!(key in currentJson)) {
                                            diff.deletions++;
                                        }
                                    }

                                    diff.tokens.diff = diff.tokens.modified - diff.tokens.original;

                                    // Formater pour l'affichage
                                    this.outputChannel.appendLine(`Diff JSON: +${diff.additions} -${diff.deletions} ~${diff.changes}`);
                                    webviewView.webview.postMessage({
                                        command: 'displayDiff',
                                        diff: {
                                            original: JSON.stringify(originalJson, null, 2),
                                            modified: JSON.stringify(currentJson, null, 2)
                                        },
                                        filePath: message.filePath,
                                        changes: diff
                                    });
                                } catch (error) {
                                    this.sendErrorToWebview(`Erreur de parsing JSON: ${error}`);
                                }
                                return;
                            }

                            // Garder la logique existante pour les fichiers non-JSON
                            if (originalContent.trim() === currentContent.trim()) {
                                this.sendErrorToWebview('Les fichiers sont identiques');
                                return;
                            }

                            // Calculer les vrais changements
                            const diff = {
                                additions: 0,
                                deletions: 0,
                                changes: 0,
                                tokens: {
                                    original: this.countTokens(originalContent),
                                    modified: this.countTokens(currentContent),
                                    diff: 0
                                }
                            };

                            // Comparer ligne par ligne
                            const originalLines = originalContent.split('\n');
                            const currentLines = currentContent.split('\n');

                            diff.additions = currentLines.length - originalLines.length;
                            diff.deletions = Math.max(0, originalLines.length - currentLines.length);
                            diff.changes = currentLines.filter((line, i) => i < originalLines.length && line !== originalLines[i]).length;
                            diff.tokens.diff = diff.tokens.modified - diff.tokens.original;

                            this.outputChannel.appendLine(`Différences: +${diff.additions} -${diff.deletions} ~${diff.changes} (Δtokens: ${diff.tokens.diff})`);

                            webviewView.webview.postMessage({
                                command: 'displayDiff',
                                diff: {
                                    original: originalContent,
                                    modified: currentContent
                                },
                                filePath: message.filePath,
                                changes: diff
                            });
                        }
                    }
                    break;

                case 'restoreCheckpoint':
                    this.outputChannel.appendLine(`Restauration du checkpoint: ${message.checkpointId}`);
                    await this.restoreCheckpoint(message.checkpointId);
                    break;

                case 'deleteCheckpoint':
                    this.outputChannel.appendLine(`Suppression du checkpoint: ${message.checkpointId}`);
                    await this.deleteCheckpoint(message.checkpointId);
                    await this.refreshCheckpoints();
                    break;
            }
        });

        this.outputChannel.appendLine('Écouteur de messages configuré');

        // Forcer un rafraîchissement initial
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
        try {
            const checkpoint = await this.checkpointManager.getCheckpointDetails(checkpointId);
            if (!checkpoint) {
                this.outputChannel.appendLine(`Checkpoint not found: ${checkpointId}`);
                return;
            }

            // Chemins corrects pour la suppression
            const checkpointDir = path.join(this.workspaceRoot, '.mscode', 'changes', checkpointId);
            const historyFile = path.join(this.workspaceRoot, '.mscode', 'history.json');

            this.outputChannel.appendLine(`Suppressing: ${checkpointDir}`);
            this.outputChannel.appendLine(`Updating: ${historyFile}`);

            if (await fsExtra.pathExists(checkpointDir)) {
                await fsExtra.remove(checkpointDir);
                this.outputChannel.appendLine('Checkpoint directory removed');
            }

            // Mettre à jour l'historique
            let history = await this.checkpointManager.getAllCheckpoints();
            history = history.filter((cp: any) => cp.id !== checkpointId);
            await fsExtra.writeJson(historyFile, history, { spaces: 2 });

            //await this.refreshCheckpoints();
            vscode.window.showInformationMessage('Checkpoint supprimé avec succès');
        } catch (error) {
            this.outputChannel.appendLine(`Erreur lors de la suppression: ${error}`);
            vscode.window.showErrorMessage(`Erreur lors de la suppression: ${error}`);
        }
    }

    private _getWebviewContent(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'mscode-webview.js')
        );

        const nonce = this.getNonce();

        let initialMessage = "Initialisation des checkpoints...";
        if (!fsExtra.existsSync(path.join(this.workspaceRoot, '.mscode', 'initial-backup', 'initial-backup.zip'))) {
            initialMessage = "Création du backup initial...";
        } else if (!fsExtra.existsSync(path.join(this.workspaceRoot, '.mscode', 'checkpoints')) || fsExtra.readdirSync(path.join(this.workspaceRoot, '.mscode', 'checkpoints')).length === 0) {
            initialMessage = "Aucun checkpoint trouvé. Le backup initial a été créé.";
        }

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
                <title>MSCode Checkpoints</title>
                <style>
                    body {
                        padding: 0;
                        color: var(--vscode-foreground);
                        font-size: 13px;
                        line-height: 1.4;
                    }

                    .checkpoint-graph {
                        display: flex;
                        flex-direction: column;
                        gap: 10px;
                        padding: 10px;
                    }

                    .checkpoint-node {
                        display: flex;
                        gap: 10px;
                        padding: 8px;
                        border: 1px solid var(--vscode-widget-border);
                        border-radius: 4px;
                        background: var(--vscode-editor-background);
                        position: relative;
                    }

                    .checkpoint-node::before {
                        content: '';
                        position: absolute;
                        width: 2px;
                        background: var(--vscode-textLink-activeForeground);
                        height: calc(100% + 10px);
                        left: 15px;
                        bottom: -10px;
                        z-index: 0;
                    }

                    .checkpoint-node:last-child::before {
                        display: none;
                    }

                    .node-dot {
                        width: 12px;
                        height: 12px;
                        border-radius: 50%;
                        margin-top: 4px;
                        position: relative;
                        z-index: 1;
                    }

                    .node-content {
                        flex: 1;
                    }

                    .node-header {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        cursor: pointer;
                        padding: 4px;
                    }

                    .node-header:hover {
                        background: var(--vscode-list-hoverBackground);
                        border-radius: 3px;
                    }

                    .node-details {
                        margin-top: 8px;
                        padding: 8px;
                        border-radius: 4px;
                        background: var(--vscode-editor-background);
                        transition: all 0.3s ease;
                    }

                    .checkpoint-node.collapsed .node-details {
                        display: none;
                    }

                    .latest-badge {
                        font-size: 11px;
                        padding: 2px 6px;
                        border-radius: 3px;
                        background: var(--vscode-testing-iconPassed);
                        color: var(--vscode-testing-runAction);
                    }

                    .node-time {
                        color: var(--vscode-descriptionForeground);
                        font-size: 12px;
                    }

                    .node-description {
                        margin-bottom: 8px;
                    }

                    .file-changes {
                        color: var(--vscode-descriptionForeground);
                        font-size: 12px;
                    }

                    .file-item {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        padding: 2px 4px;
                        border-radius: 3px;
                    }

                    .file-item:hover {
                        background: var(--vscode-list-hoverBackground);
                    }

                    .restore-btn {
                        background: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        padding: 4px 12px;
                        border-radius: 2px;
                        cursor: pointer;
                        margin-top: 8px;
                    }

                    .restore-btn:hover {
                        background: var(--vscode-button-hoverBackground);
                    }

                    .delete-btn {
                        padding: 4px 8px;
                        background: none;
                        border: none;
                        color: var(--vscode-errorForeground);
                        cursor: pointer;
                        opacity: 0.7;
                    }

                    .delete-btn:hover {
                        opacity: 1;
                    }

                    .confirmation-dialog {
                        padding: 8px;
                        margin: 8px 0;
                        border: 1px solid var(--vscode-inputValidation-warningBorder);
                        background: var(--vscode-inputValidation-warningBackground);
                        border-radius: 4px;
                    }

                    .confirmation-dialog .title {
                        font-weight: bold;
                        margin-bottom: 4px;
                    }

                    .confirmation-dialog .buttons {
                        display: flex;
                        gap: 8px;
                        margin-top: 8px;
                    }

                    .confirmation-dialog button {
                        padding: 4px 12px;
                        border: none;
                        border-radius: 2px;
                        cursor: pointer;
                    }

                    .confirmation-dialog .cancel {
                        background: var(--vscode-button-secondaryBackground);
                        color: var(--vscode-button-secondaryForeground);
                    }

                    .confirmation-dialog .confirm {
                        background: var(--vscode-errorForeground);
                        color: var(--vscode-button-foreground);
                    }

                    .checkpoint-node.initial-state .node-dot {
                        background: var(--vscode-textLink-foreground);
                    }

                    .checkpoint-node.standard .node-dot {
                        background: var(--vscode-errorForeground);
                    }

                    .checkpoint-node.current .node-dot {
                        background: var(--vscode-testing-iconUnset);
                    }

                    .checkpoint-node.latest .node-dot {
                        background: var(--vscode-testing-iconPassed);
                    }

                    #overlay {
                        position: fixed;
                        top: 0;
                        left: 0;
                        right: 0;
                        bottom: 0;
                        background: rgba(0, 0, 0, 0.5);
                        z-index: 1000;
                    }

                    #diffView {
                        position: fixed;
                        top: 50%;
                        left: 50%;
                        transform: translate(-50%, -50%);
                        background: var(--vscode-editor-background);
                        border: 1px solid var(--vscode-widget-border);
                        border-radius: 4px;
                        z-index: 1001;
                        width: 90%;
                        max-width: 1200px;
                        height: 80%;
                        padding: 16px;
                        display: flex;
                        flex-direction: column;
                    }

                    .diff-content {
                        display: flex;
                        flex: 1;
                        gap: 16px;
                    }

                    .diff-column {
                        flex: 1;
                        overflow: auto;
                    }
                </style>
            </head>
            <body>
                <div class="checkpoint-graph" id="checkpointGraph">
                    <div style="padding: 20px; text-align: center;">
                        ${initialMessage}
                    </div>
                </div>

                <div id="overlay" style="display: none;"></div>
                <div id="diffView" style="display: none;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                        <div id="diffFileName"></div>
                        <button id="closeDiffBtn" style="background: none; border: none; color: var(--vscode-foreground); cursor: pointer;">×</button>
                    </div>
                    <div class="diff-content">
                        <div class="diff-column">
                            <div style="margin-bottom: 8px;">Original</div>
                            <div id="originalContent"></div>
                        </div>
                        <div class="diff-column">
                            <div style="margin-bottom: 8px;">Modifié</div>
                            <div id="modifiedContent"></div>
                        </div>
                    </div>
                </div>

                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
    }

    private getNonce() {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    private computeChanges(original: string, modified: string): {
        additions: number;
        deletions: number;
        changes: number;
    } {
        // Normaliser les sauts de ligne
        const originalLines = original.trim().split('\n');
        const modifiedLines = modified.trim().split('\n');

        let additions = 0;
        let deletions = 0;
        let changes = 0;

        // Créer un JSON parsé pour une comparaison précise
        try {
            const originalJson = JSON.parse(original);
            const modifiedJson = JSON.parse(modified);

            // Comparer les objets JSON
            const originalKeys = Object.keys(originalJson);
            const modifiedKeys = Object.keys(modifiedJson);

            // Compter les ajouts
            additions = modifiedKeys.filter(key => !originalKeys.includes(key)).length;

            // Compter les suppressions
            deletions = originalKeys.filter(key => !modifiedKeys.includes(key)).length;

            // Compter les modifications
            changes = originalKeys.filter(key => {
                if (!modifiedKeys.includes(key)) return false;
                return JSON.stringify(originalJson[key]) !== JSON.stringify(modifiedJson[key]);
            }).length;

            return { additions, deletions, changes };
        } catch {
            // Fallback si ce n'est pas du JSON valide
            return {
                additions: modifiedLines.length - originalLines.length,
                deletions: originalLines.length - modifiedLines.length,
                changes: originalLines.filter((line, i) => modifiedLines[i] !== line).length
            };
        }
    }

    private computeJsonDiff(original: string, modified: string): DiffResult {
        try {
            const originalObj = JSON.parse(original);
            const modifiedObj = JSON.parse(modified);

            const diffLines: DiffLine[] = [];
            const originalLines = JSON.stringify(originalObj, null, 2).split('\n');
            const modifiedLines = JSON.stringify(modifiedObj, null, 2).split('\n');

            let additions = 0;
            let deletions = 0;
            let changes = 0;

            // Calcul des tokens
            const originalTokens = this.countTokens(original);
            const modifiedTokens = this.countTokens(modified);

            // Comparaison profonde des objets JSON
            const compareObjects = (obj1: any, obj2: any, path: string[] = []): void => {
                const keys1 = Object.keys(obj1);
                const keys2 = Object.keys(obj2);

                // Détecter les suppressions
                for (const key of keys1) {
                    if (!keys2.includes(key)) {
                        deletions++;
                        diffLines.push({
                            line: `- ${path.join('.')}.${key}: ${JSON.stringify(obj1[key])}`,
                            type: 'delete'
                        });
                    }
                }

                // Détecter les ajouts et modifications
                for (const key of keys2) {
                    const fullPath = [...path, key];
                    if (!keys1.includes(key)) {
                        additions++;
                        diffLines.push({
                            line: `+ ${fullPath.join('.')}: ${JSON.stringify(obj2[key])}`,
                            type: 'add'
                        });
                    } else if (JSON.stringify(obj1[key]) !== JSON.stringify(obj2[key])) {
                        changes++;
                        diffLines.push({
                            line: `~ ${fullPath.join('.')}: ${JSON.stringify(obj1[key])} → ${JSON.stringify(obj2[key])}`,
                            type: 'change'
                        });
                    }
                }
            };

            compareObjects(originalObj, modifiedObj);

            return {
                additions,
                deletions,
                changes,
                diffLines,
                tokens: {
                    original: originalTokens,
                    modified: modifiedTokens,
                    diff: modifiedTokens - originalTokens
                }
            };
        } catch (error) {
            Logger.error(`Error comparing JSON: ${error}`);
            return this.computeTextDiff(original, modified);
        }
    }

    private countTokens(text: string): number {
        // Estimation simple: ~4 caractères = 1 token
        return Math.ceil(text.length / 4);
    }

    private computeTextDiff(original: string, modified: string): DiffResult {
        const originalLines = original.split('\n');
        const modifiedLines = modified.split('\n');
        const diffLines: DiffLine[] = [];

        let additions = 0;
        let deletions = 0;
        let changes = 0;

        // Génération de diff ligne par ligne
        let i = 0, j = 0;
        while (i < originalLines.length || j < modifiedLines.length) {
            if (i >= originalLines.length) {
                additions++;
                diffLines.push({
                    line: `+ ${modifiedLines[j]}`,
                    type: 'add'
                });
                j++;
            } else if (j >= modifiedLines.length) {
                deletions++;
                diffLines.push({
                    line: `- ${originalLines[i]}`,
                    type: 'delete'
                });
                i++;
            } else if (originalLines[i] !== modifiedLines[j]) {
                changes++;
                diffLines.push({
                    line: `~ ${originalLines[i]} → ${modifiedLines[j]}`,
                    type: 'change'
                });
                i++;
                j++;
            } else {
                diffLines.push({
                    line: `  ${originalLines[i]}`,
                    type: 'same'
                });
                i++;
                j++;
            }
        }

        // Calcul des tokens
        const originalTokens = this.countTokens(original);
        const modifiedTokens = this.countTokens(modified);

        return {
            additions,
            deletions,
            changes,
            diffLines,
            tokens: {
                original: originalTokens,
                modified: modifiedTokens,
                diff: modifiedTokens - originalTokens
            }
        };
    }

    private compareJsonObjects(original: any, current: any): { additions: number, deletions: number, changes: number } {
        const additions = this.countJsonDifferences(current, original);
        const deletions = this.countJsonDifferences(original, current);
        const changes = this.countJsonChanges(original, current);

        return {
            additions,
            deletions,
            changes
        };
    }

    private countJsonDifferences(obj1: any, obj2: any): number {
        let count = 0;
        for (const key in obj1) {
            if (!obj2.hasOwnProperty(key)) {
                count++;
            } else if (typeof obj1[key] === 'object' && obj1[key] !== null) {
                count += this.countJsonDifferences(obj1[key], obj2[key]);
            }
        }
        return count;
    }

    private countJsonChanges(original: any, current: any): number {
        let count = 0;
        for (const key in original) {
            if (current.hasOwnProperty(key)) {
                if (typeof original[key] === 'object' && original[key] !== null) {
                    count += this.countJsonChanges(original[key], current[key]);
                } else if (JSON.stringify(original[key]) !== JSON.stringify(current[key])) {
                    count++;
                }
            }
        }
        return count;
    }

    protected sendErrorToWebview(errorMessage: string) {
        if (this._view?.webview) {
            this._view.webview.postMessage({
                command: 'error',
                text: errorMessage
            });
        }
    }
}

async function createZipArchive(sourceDir: string, zipFilePath: string, _progress: vscode.Progress<{ message?: string; increment?: number }>): Promise<void> {
    let currentProgress = 0;
    return new Promise((resolve, reject) => {
        try {
            const zip = new AdmZip();
            let fileCount = 0;

            const addFolderRecursive = (folderPath: string, relativePath: string) => {
                const entries = fsExtra.readdirSync(folderPath);
                fileCount += entries.length;

                entries.forEach(entry => {
                    const fullPath = path.join(folderPath, entry);
                    const relativeEntryPath = path.join(relativePath, entry);
                    const stats = fsExtra.statSync(fullPath);

                    if (stats.isDirectory()) {
                        if (!entry.startsWith('.')) {
                            addFolderRecursive(fullPath, relativeEntryPath);
                        }
                    } else {
                        zip.addLocalFile(fullPath, relativePath);
                    }
                });
            };

            addFolderRecursive(sourceDir, '');

            let completed = 0;
            zip.writeZip(zipFilePath, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        } catch (error) {
            reject(error);
        }
    });
}