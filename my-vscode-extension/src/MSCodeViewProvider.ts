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
    private _getWebviewContent(webview: vscode.Webview): string {
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
                    align-items: center;
                    margin: 10px 0;
                    padding: 8px;
                    border-radius: 4px;
                    background: var(--vscode-editor-background);
                    border: 1px solid var(--vscode-widget-border);
                }

                .checkpoint-node::before {
                    content: '';
                    position: absolute;
                    width: 2px;
                    height: calc(100% + 20px);
                    background: var(--vscode-textLink-foreground);
                    left: 15px;
                    top: -10px;
                    z-index: 0;
                }

                .checkpoint-node:last-child::before {
                    height: 50%;
                }

                .checkpoint-node:first-child::before {
                    top: 50%;
                }

                .node-dot {
                    width: 12px;
                    height: 12px;
                    border-radius: 50%;
                    background: var(--vscode-textLink-foreground);
                    margin-right: 12px;
                    position: relative;
                    z-index: 1;
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
                    background: var(--vscode-editorError-foreground);
                    color: white;
                    border: none;
                    width: 20px;
                    height: 20px;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    font-size: 12px;
                    opacity: 0;
                    transition: opacity 0.2s;
                }

                .checkpoint-node:hover .delete-btn {
                    opacity: 1;
                }

                .delete-btn:hover {
                    opacity: 1;
                    filter: brightness(1.2);
                }

                .view-diff-btn {
                    background: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                    border: none;
                    padding: 2px 6px;
                    border-radius: 2px;
                    cursor: pointer;
                    font-size: 0.9em;
                    margin-left: 8px;
                }

                .view-diff-btn:hover {
                    background: var(--vscode-button-secondaryHoverBackground);
                }
            </style>
        </head>
        <body>
            <div class="checkpoint-graph" id="checkpointGraph"></div>
            <div id="diffView" style="display: none;">
                <div id="diffTitle"></div>
                <div id="originalContent"></div>
                <div id="modifiedContent"></div>
            </div>
            <div id="overlay" style="display: none;"></div>
            <script>
                (function() {
                    const vscode = acquireVsCodeApi();
                    let checkpointData = [];
                    let diffViewOpen = false;
                    
                    // Notifier que le webview est prêt
                    vscode.postMessage({ command: 'ready' });
                    
                    // Si pas de réponse après 1 seconde, demander les checkpoints
                    setTimeout(() => {
                        vscode.postMessage({ command: 'getCheckpoints' });
                    }, 1000);

                    function createCheckpointNode(checkpoint, checkpointFile, isLatest) {
                        console.log('Creating node for checkpoint:', checkpoint.id);
                        const node = document.createElement('div');
                        node.className = 'checkpoint-node';
                        
                        const dot = document.createElement('div');
                        dot.className = 'node-dot';
                        
                        const content = document.createElement('div');
                        content.className = 'node-content';
                        
                        const header = document.createElement('div');
                        header.style.display = 'flex';
                        header.style.alignItems = 'center';
                        
                        const time = document.createElement('span');
                        time.className = 'node-time';
                        time.textContent = new Date(checkpoint.timestamp).toLocaleString();
                        header.appendChild(time);
                        
                        if (isLatest) {
                            const badge = document.createElement('span');
                            badge.className = 'latest-badge';
                            badge.textContent = 'Latest';
                            header.appendChild(badge);
                        }
                        
                        const deleteBtn = document.createElement('button');
                        deleteBtn.className = 'delete-btn';
                        deleteBtn.textContent = '×';
                        deleteBtn.title = 'Delete this checkpoint';
                        deleteBtn.onclick = (e) => {
                            e.stopPropagation();
                            if (confirm('Are you sure you want to delete this checkpoint?')) {
                                vscode.postMessage({
                                    command: 'deleteCheckpoint',
                                    checkpointId: checkpoint.id
                                });
                            }
                        };
                        node.appendChild(deleteBtn);
                        
                        const description = document.createElement('div');
                        description.className = 'node-description';
                        description.textContent = checkpoint.metadata.description;
                        
                        const files = document.createElement('div');
                        files.className = 'file-changes';
                        const fileCount = Object.keys(checkpoint.files).length;
                        const filesList = document.createElement('div');
                        filesList.style.marginTop = '4px';

                        Object.keys(checkpoint.files).forEach(filePath => {
                            const fileItem = document.createElement('div');
                            fileItem.className = 'file-item';
                            fileItem.textContent = filePath;
                            
                            const viewDiffBtn = document.createElement('button');
                            viewDiffBtn.className = 'view-diff-btn';
                            viewDiffBtn.textContent = 'Voir diff';
                            viewDiffBtn.onclick = (e) => {
                                e.stopPropagation();
                                vscode.postMessage({
                                    command: 'showDiff',
                                    checkpointId: checkpoint.id,
                                    filePath: filePath
                                });
                            };
                            
                            fileItem.appendChild(viewDiffBtn);
                            filesList.appendChild(fileItem);
                        });

                        files.textContent = \`\${fileCount} file\${fileCount !== 1 ? 's' : ''} modified\`;
                        files.appendChild(filesList);
                        
                        if (checkpointFile) {
                            const pathInfo = document.createElement('div');
                            pathInfo.style.fontSize = '0.8em';
                            pathInfo.style.color = 'var(--vscode-descriptionForeground)';
                            pathInfo.textContent = \`Path: .mscode/changes/\${checkpointFile.id}\`;
                            files.appendChild(pathInfo);
                        }
                        
                        const restoreBtn = document.createElement('button');
                        restoreBtn.className = 'restore-btn';
                        restoreBtn.textContent = 'Restore this version';
                        restoreBtn.onclick = () => {
                            vscode.postMessage({
                                command: 'restoreCheckpoint',
                                checkpointId: checkpoint.id
                            });
                        };
                        
                        content.appendChild(header);
                        content.appendChild(description);
                        content.appendChild(files);
                        content.appendChild(restoreBtn);
                        
                        node.appendChild(dot);
                        node.appendChild(content);
                        
                        return node;
                    }

                    function showDiffView(original, modified, fileName) {
                        if (diffViewOpen) return;
                        
                        if (confirm("Would you like to see changes for " + fileName + "?")) {
                            diffViewOpen = true;
                            document.getElementById('diffTitle').textContent = 'Differences - ' + fileName;
                            document.getElementById('originalContent').innerHTML = highlightDiff(original, modified);
                            document.getElementById('modifiedContent').innerHTML = highlightDiff(modified, original);
                            document.getElementById('overlay').style.display = 'block';
                            document.getElementById('diffView').style.display = 'block';
                        }
                    }

                    function closeDiffView() {
                        diffViewOpen = false;
                        document.getElementById('overlay').style.display = 'none';
                        document.getElementById('diffView').style.display = 'none';
                    }

                    function highlightDiff(text1, text2) {
                        // Simple implementation - can be enhanced later
                        return text1;
                    }

                    window.addEventListener('message', event => {
                        const message = event.data;
                        console.log('Message received:', message.command);
                        
                        switch (message.command) {
                            case 'updateCheckpoints':
                                console.log('Updating checkpoints:', message.checkpoints.length);
                                const graph = document.getElementById('checkpointGraph');
                                graph.innerHTML = '';
                                
                                if (message.checkpoints && message.checkpoints.length > 0) {
                                    checkpointData = message.checkpoints;
                                    const checkpoints = message.checkpoints.sort((a, b) => b.timestamp - a.timestamp);
                                    const checkpointFiles = new Map(
                                        message.checkpointFiles.map(cf => [cf.id, cf])
                                    );
                                    
                                    console.log('Creating checkpoint nodes...');
                                    checkpoints.forEach((checkpoint, index) => {
                                        const checkpointFile = checkpointFiles.get(checkpoint.id);
                                        const node = createCheckpointNode(checkpoint, checkpointFile, index === 0);
                                        graph.appendChild(node);
                                    });
                                    console.log('Checkpoint nodes created');
                                } else {
                                    console.log('No checkpoints to display');
                                    graph.innerHTML = '<div style="padding: 20px;">Aucun checkpoint disponible</div>';
                                }
                                break;

                            case 'displayDiff':
                                if (message.diff) {
                                    showDiffView(message.diff.original, message.diff.modified, message.filePath);
                                }
                                break;
                        }
                    });

                    // Add escape key handler
                    document.addEventListener('keydown', (e) => {
                        if (e.key === 'Escape') {
                            closeDiffView();
                        }
                    });

                    // Add overlay click handler
                    document.getElementById('overlay').addEventListener('click', closeDiffView);
                })();
            </script>
        </body>
        </html>`;
    }

    private async restoreCheckpoint(checkpointId: string) {
        const checkpoint = await this.checkpointManager.getCheckpointDetails(checkpointId);
        if (!checkpoint) return;

        // Restaurer chaque fichier du checkpoint
        for (const [filePath, fileData] of Object.entries(checkpoint.files)) {
            await this.checkpointManager.revertToState(filePath, checkpoint.timestamp);
        }

        vscode.window.showInformationMessage(`Restored to checkpoint: ${checkpoint.metadata.description}`);
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
}