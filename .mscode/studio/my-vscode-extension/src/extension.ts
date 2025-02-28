import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { CheckpointManager, FileChangeLog, CheckpointLog, LineHistory } from './checkpointManager';
import { DeepSeekViewProvider } from './DeepSeekViewProvider';

interface WorkingDirectories {
    original: string;
    studio: string;
    changes: string;
    final: string;
}

interface FileNode {
    name: string;
    path: string;
    isDirectory: boolean;
    children: FileNode[];
    isTracked: boolean;
}

interface FileChange {
    type: 'add' | 'modify' | 'delete';
    lines: {
        lineNumber: number;
        content: string;
        type: 'added' | 'modified' | 'deleted';
    }[];
    timestamp: number;
}

interface CheckpointMetadata {
    id: string;
    timestamp: number;
    files: {
        [filePath: string]: FileChange[];
    };
    description: string;
}

class MSCodeViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'mscodePanel';
    private currentWorkspaceFiles: FileNode[] = [];
    private workingDirs: WorkingDirectories | null = null;
    private fileWatcher: vscode.FileSystemWatcher | null = null;
    private _view: vscode.WebviewView | undefined;
    private fileChangesLog: Map<string, FileChange[]> = new Map();
    private lastCheckpointTime: number = Date.now();
    private checkpointThreshold: number = 5 * 60 * 1000; // 5 minutes
    private documentChangeListener: vscode.Disposable | null = null;
    private checkpointManager: CheckpointManager | null = null;

    constructor(private readonly _extensionUri: vscode.Uri) {
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            this.checkpointManager = new CheckpointManager(vscode.workspace.workspaceFolders[0].uri.fsPath);
        }
        this.initializeWorkingDirectories();
        this.setupFileWatcher();
        this.updateCurrentWorkspaceFiles();
        this.setupDocumentChangeListener();
    }

    private async initializeWorkingDirectories() {
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            const rootPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
            this.workingDirs = {
                original: path.join(rootPath, '.mscode', 'original'),
                studio: path.join(rootPath, '.mscode', 'studio'),
                changes: path.join(rootPath, '.mscode', 'changes'),
                final: path.join(rootPath, '.mscode', 'final')
            };

            // Créer les dossiers
            for (const dir of Object.values(this.workingDirs)) {
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
            }
        }
    }

    private setupFileWatcher() {
        if (vscode.workspace.workspaceFolders) {
            this.fileWatcher = vscode.workspace.createFileSystemWatcher('**/*');
            
            // Détecter les modifications de fichiers
            this.fileWatcher.onDidChange(async uri => {
                await this.handleFileChange(uri.fsPath);
            });
        }
    }

    private async handleFileChange(filePath: string) {
        if (!this.workingDirs) return;

        // Vérifier si le fichier n'est pas dans nos dossiers de travail
        if (!filePath.includes('.mscode')) {
            const relativePath = vscode.workspace.asRelativePath(filePath);
            const studioPath = path.join(this.workingDirs.studio, relativePath);
            
            // Créer le dossier parent si nécessaire
            const studioDir = path.dirname(studioPath);
            if (!fs.existsSync(studioDir)) {
                fs.mkdirSync(studioDir, { recursive: true });
            }

            // Copier le fichier modifié dans le dossier studio et notifier le webview
            try {
                fs.copyFileSync(filePath, studioPath);
                // Notifier le webview des changements
                if (this._view) {
                    const originalContent = fs.existsSync(path.join(this.workingDirs.original, relativePath)) 
                        ? fs.readFileSync(path.join(this.workingDirs.original, relativePath), 'utf-8')
                        : '';
                    const modifiedContent = fs.readFileSync(studioPath, 'utf-8');
                    
                    this._view.webview.postMessage({
                        command: 'fileChanged',
                        path: relativePath,
                        diff: {
                            original: originalContent,
                            modified: modifiedContent
                        }
                    });
                }
            } catch (error) {
                console.error('Erreur lors de la copie vers studio:', error);
            }
        }
    }

    private buildFileTree(files: string[]): FileNode[] {
        const root: FileNode = {
            name: '',
            path: '',
            isDirectory: true,
            children: [],
            isTracked: false
        };

        files.forEach(filePath => {
            const parts = filePath.split('/');
            let current = root;

            parts.forEach((part, index) => {
                let child = current.children.find(c => c.name === part);
                
                if (!child) {
                    const isLast = index === parts.length - 1;
                    const fullPath = parts.slice(0, index + 1).join('/');
                    child = {
                        name: part,
                        path: fullPath,
                        isDirectory: !isLast,
                        children: [],
                        isTracked: false
                    };
                    current.children.push(child);
                }

                current = child;
            });
        });

        return root.children;
    }

    private async updateCurrentWorkspaceFiles() {
        if (vscode.workspace.workspaceFolders) {
            try {
                const files = await vscode.workspace.findFiles('**/*', '**/node_modules/**');
                const relativePaths = files.map(file => vscode.workspace.asRelativePath(file));
                this.currentWorkspaceFiles = this.buildFileTree(relativePaths);

                // Marquer les fichiers qui sont dans le dossier original comme trackés
                if (this.workingDirs) {
                    this.markTrackedFiles(this.currentWorkspaceFiles);
                }
            } catch (error) {
                console.error('Erreur lors de la récupération des fichiers:', error);
            }
        }
    }

    private markTrackedFiles(files: FileNode[]) {
        if (!this.workingDirs) return;

        files.forEach(file => {
            const originalPath = path.join(this.workingDirs!.original, file.path);
            file.isTracked = fs.existsSync(originalPath);

            if (file.children.length > 0) {
                this.markTrackedFiles(file.children);
            }
        });
    }

    private async addToOriginal(filePath: string) {
        if (!this.workingDirs) return;

        if (vscode.workspace.workspaceFolders) {
            const srcPath = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, filePath);
            const destPath = path.join(this.workingDirs.original, filePath);
            
            const destDir = path.dirname(destPath);
            if (!fs.existsSync(destDir)) {
                fs.mkdirSync(destDir, { recursive: true });
            }

            try {
                if (fs.statSync(srcPath).isDirectory()) {
                    // Copier récursivement le dossier
                    this.copyDirectory(srcPath, destPath);
                } else {
                    // Copier le fichier
                    fs.copyFileSync(srcPath, destPath);
                }
            } catch (error) {
                console.error('Erreur lors de la copie vers original:', error);
            }
        }
    }

    private copyDirectory(src: string, dest: string) {
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
        }

        const entries = fs.readdirSync(src, { withFileTypes: true });

        for (const entry of entries) {
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);

            if (entry.isDirectory()) {
                this.copyDirectory(srcPath, destPath);
            } else {
                fs.copyFileSync(srcPath, destPath);
            }
        }
    }

    private async removeFromOriginal(filePath: string) {
        if (!this.workingDirs) return;

        const originalPath = path.join(this.workingDirs.original, filePath);
        
        try {
            if (fs.existsSync(originalPath)) {
                if (fs.statSync(originalPath).isDirectory()) {
                    fs.rmdirSync(originalPath, { recursive: true });
                } else {
                    fs.unlinkSync(originalPath);
                }

                // Mettre à jour l'arborescence après la suppression
                await this.updateCurrentWorkspaceFiles();
                if (this._view) {
                    this._view.webview.postMessage({ 
                        command: 'filesUpdated', 
                        files: this.currentWorkspaceFiles 
                    });
                }
            }
        } catch (error) {
            console.error('Erreur lors de la suppression du fichier original:', error);
            vscode.window.showErrorMessage(`Erreur lors de la suppression de ${filePath}`);
        }
    }

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

        webviewView.webview.onDidReceiveMessage(async message => {
            switch (message.command) {
                case 'getCurrentFiles':
                    await this.updateCurrentWorkspaceFiles();
                    webviewView.webview.postMessage({ 
                        command: 'filesUpdated', 
                        files: this.currentWorkspaceFiles
                    });
                    break;

                case 'addToOriginal':
                    await this.addToOriginal(message.path);
                    // Mettre à jour l'arborescence après l'ajout
                    await this.updateCurrentWorkspaceFiles();
                    webviewView.webview.postMessage({ 
                        command: 'filesUpdated', 
                        files: this.currentWorkspaceFiles
                    });
                    break;

                case 'removeFromOriginal':
                    await this.removeFromOriginal(message.path);
                    // Mettre à jour l'arborescence après la suppression
                    await this.updateCurrentWorkspaceFiles();
                    webviewView.webview.postMessage({ 
                        command: 'filesUpdated', 
                        files: this.currentWorkspaceFiles
                    });
                    break;

                case 'createCheckpoint':
                    await this.createCheckpointWithDiff();
                    break;

                case 'openInNewTab':
                    const panel = vscode.window.createWebviewPanel(
                        'mscodeFullView',
                        message.title,
                        vscode.ViewColumn.One,
                        {
                            enableScripts: true,
                            retainContextWhenHidden: true
                        }
                    );
                    panel.webview.html = this._getFullViewContent(message.type);
                    break;
            }
        });

        webviewView.webview.html = this._getWebviewContent(webviewView.webview);
    }

    private async createCheckpointWithDiff() {
        if (!this.workingDirs || !this._view) return;

        try {
            const openTextDocuments = vscode.workspace.textDocuments;
            const changedFiles = new Map<string, {
                originalContent: string;
                currentContent: string;
                changes: {
                    type: 'added' | 'deleted' | 'modified';
                    line: number;
                    content: string;
                }[];
            }>();

            // Vérifier les fichiers modifiés
            for (const doc of openTextDocuments) {
                const relativePath = vscode.workspace.asRelativePath(doc.uri);
                const originalPath = path.join(this.workingDirs.original, relativePath);
                const studioPath = path.join(this.workingDirs.studio, relativePath);

                if (fs.existsSync(originalPath)) {
                    const originalContent = fs.readFileSync(originalPath, 'utf-8');
                    const currentContent = doc.getText();
                    
                    if (originalContent !== currentContent) {
                        // Analyser les différences ligne par ligne
                        const originalLines = originalContent.split('\n');
                        const currentLines = currentContent.split('\n');
                        const changes = [];

                        const diff = require('diff').diffLines(originalContent, currentContent);
                        let lineNumber = 0;

                        for (const part of diff) {
                            if (part.added) {
                                part.value.split('\n').forEach((line: string) => {
                                    if (line) {
                                        changes.push({
                                            type: 'added',
                                            line: lineNumber,
                                            content: line
                                        });
                                    }
                                    lineNumber++;
                                });
                            } else if (part.removed) {
                                part.value.split('\n').forEach((line: string) => {
                                    if (line) {
                                        changes.push({
                                            type: 'deleted',
                                            line: lineNumber,
                                            content: line
                                        });
                                    }
                                });
                            } else {
                                lineNumber += part.value.split('\n').length - 1;
                            }
                        }

                        changedFiles.set(relativePath, {
                            originalContent,
                            currentContent,
                            changes
                        });

                        // Sauvegarder dans le dossier studio
                        const studioDir = path.dirname(studioPath);
                        if (!fs.existsSync(studioDir)) {
                            fs.mkdirSync(studioDir, { recursive: true });
                        }
                        fs.writeFileSync(studioPath, currentContent);
                    }
                }
            }

            if (changedFiles.size > 0) {
                // Créer le checkpoint
                const timestamp = Date.now();
                const checkpointDir = path.join(this.workingDirs.changes, `checkpoint_${timestamp}`);
                fs.mkdirSync(checkpointDir, { recursive: true });

                // Copier les fichiers et créer un rapport de changements
                const diffs: { [key: string]: { original: string; modified: string; changes: any[] } } = {};
                
                changedFiles.forEach((fileData, filePath) => {
                    const destPath = path.join(checkpointDir, filePath);
                    const destDir = path.dirname(destPath);
                    
                    if (!fs.existsSync(destDir)) {
                        fs.mkdirSync(destDir, { recursive: true });
                    }

                    fs.writeFileSync(destPath, fileData.currentContent);
                    diffs[filePath] = {
                        original: fileData.originalContent,
                        modified: fileData.currentContent,
                        changes: fileData.changes
                    };
                });

                // Notifier le webview avec les détails des changements
                this._view.webview.postMessage({
                    command: 'checkpointCreated',
                    timestamp,
                    changedFiles: Array.from(changedFiles.keys()),
                    diffs
                });

                // Afficher un message de confirmation
                vscode.window.showInformationMessage(`Checkpoint créé avec ${changedFiles.size} fichier(s) modifié(s)`);
            } else {
                vscode.window.showInformationMessage('Aucun fichier modifié à sauvegarder');
            }
        } catch (error) {
            console.error('Erreur lors de la création du checkpoint:', error);
            vscode.window.showErrorMessage(`Erreur lors de la création du checkpoint: ${error}`);
        }
    }

    private setupDocumentChangeListener() {
        this.documentChangeListener = vscode.workspace.onDidChangeTextDocument(async (event) => {
            if (!this.workingDirs) return;

            const relativePath = vscode.workspace.asRelativePath(event.document.uri);
            const originalPath = path.join(this.workingDirs.original, relativePath);

            // Vérifier si le fichier est dans notre suivi
            if (fs.existsSync(originalPath)) {
                await this.handleDocumentChange(event);
            }
        });
    }

    private async handleDocumentChange(event: vscode.TextDocumentChangeEvent) {
        if (!this.checkpointManager) return;

        const relativePath = vscode.workspace.asRelativePath(event.document.uri);
        const editor = vscode.window.activeTextEditor;
        let cursorLine = 0;
        
        if (editor && editor.document.uri === event.document.uri) {
            cursorLine = editor.selection.active.line;
        }

        // Ne créer qu'un seul changement pour toutes les modifications
        const change: FileChangeLog = {
            lineNumber: event.document.positionAt(event.contentChanges[0].rangeOffset).line,
            content: event.contentChanges.map(c => c.text).join(''),
            type: event.contentChanges[0].text === '' ? 'deleted' : 
                  event.contentChanges[0].rangeLength === 0 ? 'added' : 'modified',
            timestamp: Date.now(),
            lineHistory: event.contentChanges.map(c => ({
                lineNumber: event.document.positionAt(c.rangeOffset).line,
                content: c.text,
                timestamp: Date.now(),
                action: c.text === '' ? 'deleted' : 
                       c.rangeLength === 0 ? 'added' : 'modified',
                previousContent: event.document.getText(c.range)
            }))
        };

        // Enregistrer le changement
        await this.checkpointManager.logChange(relativePath, change);

        // Mettre à jour la vue uniquement si nécessaire
        if (this._view) {
            const miniMap = await this.checkpointManager.getCurrentMiniMap(relativePath);
            if (miniMap) {
                this._view.webview.postMessage({
                    command: 'updateMiniMap',
                    filePath: relativePath,
                    miniMap
                });
            }
        }

        // Vérifier pour un checkpoint automatique
        const now = Date.now();
        if (now - this.lastCheckpointTime >= this.checkpointThreshold) {
            await this.createAutomaticCheckpoint();
        }
    }

    private async createAutomaticCheckpoint() {
        if (!this.checkpointManager || !this._view) return;

        const timestamp = Date.now();
        const checkpoint = await this.checkpointManager.createCheckpoint(
            [], // Les changements sont déjà enregistrés dans le CheckpointManager
            true,
            `Checkpoint automatique - ${new Date(timestamp).toLocaleString()}`
        );

        this._view.webview.postMessage({
            command: 'automaticCheckpointCreated',
            checkpoint
        });

        this.lastCheckpointTime = timestamp;
    }

    private _getFullViewContent(type: string): string {
        switch(type) {
            case 'original':
                return this._getEditorViewContent('Fichier Original', true);
            case 'modified':
                return this._getEditorViewContent('Fichier Modifié', true);
            case 'edit':
                return this._getEditorViewContent('Éditeur', true);
            case 'timeline':
                return this._getTimelineViewContent(true);
            default:
                return '';
        }
    }

    private _getEditorViewContent(title: string, fullView: boolean = false): string {
        return `
            <!DOCTYPE html>
            <html>
                <head>
                    <style>
                        body {
                            padding: 20px;
                            height: ${fullView ? '100vh' : 'auto'};
                        }
                        .editor-container {
                            height: ${fullView ? 'calc(100vh - 60px)' : '300px'};
                        }
                        textarea {
                            width: 100%;
                            height: 100%;
                            resize: none;
                        }
                    </style>
                </head>
                <body>
                    <h2>${title}</h2>
                    <div class="editor-container">
                        <textarea></textarea>
                    </div>
                </body>
            </html>
        `;
    }

    private _getTimelineViewContent(fullView: boolean = false): string {
        return `
            <!DOCTYPE html>
            <html>
                <head>
                    <style>
                        body {
                            padding: 20px;
                            height: ${fullView ? '100vh' : 'auto'};
                        }
                        .timeline-container {
                            height: ${fullView ? 'calc(100vh - 60px)' : '200px'};
                            background: var(--vscode-editor-background);
                            position: relative;
                        }
                    </style>
                </head>
                <body>
                    <h2>Timeline des modifications</h2>
                    <div class="timeline-container" id="fullTimeline"></div>
                </body>
            </html>
        `;
    }

    private _getWebviewContent(webview: vscode.Webview) {
        return `<!DOCTYPE html>
        <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>MSCode Panel</title>
                <style>
                    body {
                        padding: 10px;
                        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
                        color: var(--vscode-editor-foreground);
                    }
                    .container {
                        display: flex;
                        flex-direction: column;
                        gap: 10px;
                    }
                    .file-tree {
                        padding-left: 20px;
                    }
                    .file-tree-root {
                        padding-left: 0;
                    }
                    .file-item {
                        display: flex;
                        align-items: center;
                        padding: 4px 0;
                        cursor: pointer;
                        user-select: none;
                    }
                    .folder-icon {
                        width: 16px;
                        height: 16px;
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        margin-right: 5px;
                        font-size: 10px;
                        color: var(--vscode-foreground);
                    }
                    .file-icon {
                        width: 16px;
                        margin-right: 5px;
                        opacity: 0.7;
                    }
                    .file-name {
                        flex: 1;
                    }
                    .add-button {
                        visibility: hidden;
                        background: none;
                        border: none;
                        color: var(--vscode-button-foreground);
                        cursor: pointer;
                        padding: 2px 6px;
                        border-radius: 3px;
                        font-size: 12px;
                        margin-left: 8px;
                    }
                    .add-button:hover {
                        background: var(--vscode-button-background);
                    }
                    .remove-button {
                        visibility: hidden;
                        background: none;
                        border: none;
                        color: var(--vscode-button-foreground);
                        cursor: pointer;
                        padding: 2px 6px;
                        border-radius: 3px;
                        font-size: 12px;
                        margin-left: 8px;
                    }
                    .remove-button:hover {
                        background: var(--vscode-button-background);
                    }
                    .file-item:hover .add-button,
                    .file-item:hover .remove-button {
                        visibility: visible;
                    }
                    .tracked {
                        color: var(--vscode-gitDecoration-addedResourceForeground);
                    }
                    .being-edited {
                        font-style: italic;
                        color: var(--vscode-gitDecoration-modifiedResourceForeground);
                    }
                    .create-checkpoint {
                        position: fixed;
                        bottom: 20px;
                        right: 20px;
                        background: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        padding: 8px 16px;
                        border-radius: 4px;
                        cursor: pointer;
                        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
                    }
                    .create-checkpoint:hover {
                        background: var(--vscode-button-hoverBackground);
                    }
                    .file-sections {
                        display: flex;
                        flex-direction: column;
                        gap: 20px;
                    }
                    .section {
                        border: 1px solid var(--vscode-panel-border);
                        border-radius: 4px;
                    }
                    .section-header {
                        background: var(--vscode-panel-background);
                        padding: 8px;
                        font-weight: bold;
                        border-bottom: 1px solid var(--vscode-panel-border);
                    }
                    .diff-view {
                        position: fixed;
                        top: 50%;
                        left: 50%;
                        transform: translate(-50%, -50%);
                        width: 80%;
                        height: 80%;
                        background: var(--vscode-editor-background);
                        border: 1px solid var(--vscode-panel-border);
                        border-radius: 4px;
                        padding: 20px;
                        display: none;
                        z-index: 1000;
                    }
                    .diff-header {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        margin-bottom: 10px;
                    }
                    .diff-content {
                        display: flex;
                        gap: 20px;
                        height: calc(100% - 40px);
                    }
                    .diff-panel {
                        flex: 1;
                        height: 100%;
                        overflow: auto;
                    }
                    .diff-line {
                        padding: 2px 4px;
                        font-family: monospace;
                    }
                    .diff-added {
                        background-color: var(--vscode-diffEditor-insertedLineBackground);
                    }
                    .diff-removed {
                        background-color: var(--vscode-diffEditor-removedLineBackground);
                    }
                    #overlay {
                        position: fixed;
                        top: 0;
                        left: 0;
                        right: 0;
                        bottom: 0;
                        background: rgba(0, 0, 0, 0.5);
                        display: none;
                        z-index: 999;
                    }
                    .checkpoint-timeline {
                        margin-top: 20px;
                        padding: 10px;
                        background: var(--vscode-editor-background);
                        border: 1px solid var(--vscode-panel-border);
                        border-radius: 4px;
                    }
                    .checkpoint-item {
                        display: flex;
                        align-items: center;
                        padding: 8px;
                        border-bottom: 1px solid var(--vscode-panel-border);
                    }
                    .checkpoint-info {
                        flex: 1;
                    }
                    .checkpoint-time {
                        font-size: 0.9em;
                        color: var(--vscode-descriptionForeground);
                    }
                    .checkpoint-files {
                        margin-top: 4px;
                        font-size: 0.9em;
                    }
                    .checkpoint-details {
                        padding: 10px;
                        background: var(--vscode-editor-background);
                        border: 1px solid var(--vscode-panel-border);
                        margin-top: 10px;
                        display: none;
                    }
                    .change-log {
                        font-family: monospace;
                        padding: 2px 4px;
                        margin: 2px 0;
                    }
                    .change-added {
                        background-color: var(--vscode-diffEditor-insertedLineBackground);
                    }
                    .change-deleted {
                        background-color: var(--vscode-diffEditor-removedLineBackground);
                    }
                    .change-modified {
                        background-color: var(--vscode-diffEditor-modifiedLineBackground);
                    }
                    .minimap-container {
                        border: 1px solid var(--vscode-panel-border);
                        background: var(--vscode-editor-background);
                        position: relative;
                        width: 100px;
                        height: 100px;
                        margin: 10px;
                    }
                    .minimap-point {
                        position: absolute;
                        width: 4px;
                        height: 4px;
                        border-radius: 50%;
                    }
                    .minimap-point.add {
                        background-color: var(--vscode-gitDecoration-addedResourceForeground);
                    }
                    .minimap-point.delete {
                        background-color: var(--vscode-gitDecoration-deletedResourceForeground);
                    }
                    .minimap-point.modify {
                        background-color: var(--vscode-gitDecoration-modifiedResourceForeground);
                    }
                    .minimap-trace {
                        position: absolute;
                        background: none;
                        pointer-events: none;
                        border: 1px solid rgba(255, 255, 255, 0.2);
                    }
                    .checkpoint-minimap {
                        display: flex;
                        align-items: center;
                        margin-top: 10px;
                    }
                    .minimap-details {
                        margin-left: 10px;
                        font-size: 0.9em;
                    }
                    .checkpoint-grid {
                        display: grid;
                        grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
                        gap: 10px;
                        padding: 10px;
                        max-height: 300px;
                        overflow-y: auto;
                    }
                    .checkpoint-folder {
                        position: relative;
                        width: 90px;
                        height: 70px;
                        background: var(--vscode-editor-background);
                        border: 1px solid var(--vscode-panel-border);
                        border-radius: 4px;
                        cursor: pointer;
                        transition: transform 0.2s;
                        padding: 5px;
                    }
                    .checkpoint-folder:hover {
                        transform: scale(1.05);
                    }
                    .checkpoint-folder.active {
                        border-color: var(--vscode-button-background);
                        box-shadow: 0 0 5px var(--vscode-button-background);
                    }
                    .folder-icon {
                        width: 40px;
                        height: 30px;
                        margin: 5px auto;
                        background: var(--vscode-button-background);
                        clip-path: polygon(0% 20%, 40% 20%, 40% 0%, 100% 0%, 100% 100%, 0% 100%);
                    }
                    .folder-label {
                        font-size: 0.8em;
                        text-align: center;
                        overflow: hidden;
                        text-overflow: ellipsis;
                        white-space: nowrap;
                    }
                    .folder-time {
                        font-size: 0.7em;
                        color: var(--vscode-descriptionForeground);
                        text-align: center;
                    }
                    .last-modified {
                        position: absolute;
                        top: -5px;
                        right: -5px;
                        width: 10px;
                        height: 10px;
                        background: var(--vscode-gitDecoration-modifiedResourceForeground);
                        border-radius: 50%;
                        border: 2px solid var(--vscode-editor-background);
                    }
                    .preview-pane {
                        display: none;
                        position: absolute;
                        left: 100%;
                        top: 0;
                        width: 200px;
                        background: var(--vscode-editor-background);
                        border: 1px solid var(--vscode-panel-border);
                        border-radius: 4px;
                        padding: 10px;
                        z-index: 1000;
                    }
                    .checkpoint-folder:hover .preview-pane {
                        display: block;
                    }
                    .restore-button {
                        margin-top: 5px;
                        width: 100%;
                        background: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        padding: 4px 8px;
                        border-radius: 2px;
                        cursor: pointer;
                    }
                    .restore-button:hover {
                        background: var(--vscode-button-hoverBackground);
                    }
                    .add-button, .remove-button {
                        visibility: hidden;
                        background: none;
                        border: none;
                        cursor: pointer;
                        padding: 2px 6px;
                        border-radius: 3px;
                        font-size: 12px;
                        margin-left: 8px;
                    }
                    .add-button {
                        color: var(--vscode-gitDecoration-addedResourceForeground);
                    }
                    .remove-button {
                        color: var(--vscode-gitDecoration-deletedResourceForeground);
                    }
                    .add-button:hover {
                        background: var(--vscode-gitDecoration-addedResourceForeground);
                        color: var(--vscode-editor-background);
                    }
                    .remove-button:hover {
                        background: var(--vscode-gitDecoration-deletedResourceForeground);
                        color: var(--vscode-editor-background);
                    }
                    .file-item:hover .add-button,
                    .file-item:hover .remove-button {
                        visibility: visible;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="file-sections">
                        <div class="section">
                            <div class="section-header">Fichiers du Projet</div>
                            <div id="fileTree" class="file-tree-root"></div>
                        </div>
                        <div class="section">
                            <div class="section-header">Fichiers Originaux</div>
                            <div id="originalFiles" class="file-tree-root"></div>
                        </div>
                        <div class="section">
                            <div class="section-header">Checkpoints</div>
                            <div class="checkpoint-grid" id="checkpointGrid"></div>
                        </div>
                    </div>
                </div>

                <div id="overlay"></div>
                <div id="diffView" class="diff-view">
                    <div class="diff-header">
                        <h3 id="diffTitle">Différences</h3>
                        <button onclick="closeDiffView()">Fermer</button>
                    </div>
                    <div class="diff-content">
                        <div class="diff-panel">
                            <h4>Original</h4>
                            <pre id="originalContent"></pre>
                        </div>
                        <div class="diff-panel">
                            <h4>Modifié</h4>
                            <pre id="modifiedContent"></pre>
                        </div>
                    </div>
                </div>

                <button class="create-checkpoint" onclick="createCheckpoint()">
                    Créer Checkpoint
                </button>

                <script>
                    const vscode = acquireVsCodeApi();
                    let fileTreeData = [];
                    let originalFilesData = [];

                    function showDiffView(original, modified, fileName) {
                        document.getElementById('diffTitle').textContent = 'Différences - ' + fileName;
                        
                        const originalDiv = document.getElementById('originalContent');
                        const modifiedDiv = document.getElementById('modifiedContent');
                        
                        // Effacer le contenu précédent
                        originalDiv.innerHTML = '';
                        modifiedDiv.innerHTML = '';

                        const originalLines = original.split('\n');
                        const modifiedLines = modified.split('\n');
                        
                        // Créer une vue en parallèle des changements
                        let originalHtml = '';
                        let modifiedHtml = '';
                        
                        // Utiliser un algorithme de diff pour comparer les lignes
                        const diff = JsDiff.diffLines(original, modified);
                        let lineNumberOriginal = 1;
                        let lineNumberModified = 1;

                        diff.forEach(part => {
                            if (part.removed) {
                                // Ligne supprimée - afficher en rouge dans l'original
                                part.value.split('\n').forEach(line => {
                                    if (line) {
                                        originalHtml += `<div class="diff-line diff-removed" data-line="${lineNumberOriginal}">${escapeHtml(line)}</div>`;
                                        lineNumberOriginal++;
                                    }
                                });
                            } else if (part.added) {
                                // Ligne ajoutée - afficher en vert dans le modifié
                                part.value.split('\n').forEach(line => {
                                    if (line) {
                                        modifiedHtml += `<div class="diff-line diff-added" data-line="${lineNumberModified}">${escapeHtml(line)}</div>`;
                                        lineNumberModified++;
                                    }
                                });
                            } else {
                                // Lignes inchangées - afficher normalement des deux côtés
                                part.value.split('\n').forEach(line => {
                                    if (line) {
                                        originalHtml += `<div class="diff-line" data-line="${lineNumberOriginal}">${escapeHtml(line)}</div>`;
                                        modifiedHtml += `<div class="diff-line" data-line="${lineNumberModified}">${escapeHtml(line)}</div>`;
                                        lineNumberOriginal++;
                                        lineNumberModified++;
                                    }
                                });
                            }
                        });

                        // Mise à jour du contenu
                        originalDiv.innerHTML = `
                            <div class="diff-header-info">Version originale</div>
                            <div class="diff-content-container">${originalHtml}</div>
                        `;
                        
                        modifiedDiv.innerHTML = `
                            <div class="diff-header-info">Version modifiée</div>
                            <div class="diff-content-container">${modifiedHtml}</div>
                        `;

                        // Afficher la vue des différences
                        document.getElementById('overlay').style.display = 'block';
                        document.getElementById('diffView').style.display = 'block';
                    }

                    function closeDiffView() {
                        document.getElementById('overlay').style.display = 'none';
                        document.getElementById('diffView').style.display = 'none';
                    }

                    function highlightDiff(text1, text2) {
                        const lines1 = text1.split('\\n');
                        const lines2 = text2.split('\\n');
                        let html = '';

                        lines1.forEach((line, i) => {
                            const className = lines2[i] !== line ? 'diff-line diff-changed' :
                                !lines2[i] ? 'diff-line diff-added' : 'diff-line';
                            html += \`<div class="\${className}">\${escapeHtml(line)}</div>\`;
                        });

                        return html;
                    }

                    function escapeHtml(text) {
                        return text.replace(/[&<>"']/g, char => ({
                            '&': '&amp;',
                            '<': '&lt;',
                            '>': '&gt;',
                            '"': '&quot;',
                            "'": '&#39;'
                        }[char]));
                    }

                    function createFileTreeItem(node, isTracked = false) {
                        const item = document.createElement('div');
                        item.className = 'file-item';
                        
                        const icon = document.createElement('span');
                        icon.className = node.isDirectory ? 'folder-icon' : 'file-icon';
                        icon.textContent = node.isDirectory ? '▶' : '📄';
                        
                        const name = document.createElement('span');
                        name.className = 'file-name' + (node.isTracked ? ' tracked' : '');
                        name.textContent = node.name;
                        
                        const addButton = document.createElement('button');
                        addButton.className = 'add-button';
                        addButton.textContent = '+';
                        addButton.title = 'Ajouter aux fichiers originaux';
                        addButton.onclick = (e) => {
                            e.stopPropagation();
                            vscode.postMessage({
                                command: 'addToOriginal',
                                path: node.path
                            });
                        };

                        const removeButton = document.createElement('button');
                        removeButton.className = 'remove-button';
                        removeButton.textContent = '×';
                        removeButton.title = 'Retirer des fichiers originaux';
                        removeButton.onclick = (e) => {
                            e.stopPropagation();
                            vscode.postMessage({
                                command: 'removeFromOriginal',
                                path: node.path
                            });
                        };

                        item.appendChild(icon);
                        item.appendChild(name);
                        if (!node.isTracked) {
                            item.appendChild(addButton);
                        } else {
                            item.appendChild(removeButton);
                        }

                        if (node.isDirectory && node.children.length > 0) {
                            const children = document.createElement('div');
                            children.className = 'file-tree';
                            children.style.display = 'none';
                            
                            node.children.forEach(child => {
                                children.appendChild(createFileTreeItem(child, isTracked));
                            });

                            item.onclick = (e) => {
                                if (e.target === item || e.target === icon || e.target === name) {
                                    icon.textContent = children.style.display === 'none' ? '▼' : '▶';
                                    children.style.display = children.style.display === 'none' ? 'block' : 'none';
                                }
                            };

                            const container = document.createElement('div');
                            container.appendChild(item);
                            container.appendChild(children);
                            return container;
                        }

                        return item;
                    }

                    function createCheckpoint() {
                        vscode.postMessage({
                            command: 'createCheckpoint'
                        });
                    }

                    function updateCheckpointTimeline(checkpoint) {
                        const timeline = document.getElementById('checkpointTimeline');
                        const item = document.createElement('div');
                        item.className = 'checkpoint-item';
                        
                        const info = document.createElement('div');
                        info.className = 'checkpoint-info';
                        
                        const time = document.createElement('div');
                        time.className = 'checkpoint-time';
                        time.textContent = new Date(checkpoint.timestamp).toLocaleString();
                        
                        const description = document.createElement('div');
                        description.textContent = checkpoint.metadata.description;
                        
                        const files = document.createElement('div');
                        files.className = 'checkpoint-files';
                        
                        // Créer un résumé des changements
                        const filesList = Object.entries(checkpoint.files).map(([file, data]) => {
                            const changes = data.changes.length;
                            return \`\${file} (\${changes} changements)\`;
                        }).join(', ');
                        
                        files.textContent = filesList;
                        
                        // Ajouter un bouton pour voir les détails
                        const detailsBtn = document.createElement('button');
                        detailsBtn.textContent = 'Voir les détails';
                        detailsBtn.onclick = () => toggleDetails(checkpoint.id);
                        
                        // Créer la section des détails
                        const details = document.createElement('div');
                        details.className = 'checkpoint-details';
                        details.id = \`details-\${checkpoint.id}\`;
                        
                        // Ajouter les changements détaillés
                        Object.entries(checkpoint.files).forEach(([file, data]) => {
                            const fileHeader = document.createElement('h4');
                            fileHeader.textContent = file;
                            details.appendChild(fileHeader);
                            
                            data.changes.forEach(change => {
                                const changeElement = document.createElement('div');
                                changeElement.className = \`change-log change-\${change.type}\`;
                                changeElement.textContent = \`[\${change.type}] Ligne \${change.lineNumber}: \${change.content}\`;
                                details.appendChild(changeElement);
                            });
                        });
                        
                        info.appendChild(time);
                        info.appendChild(description);
                        info.appendChild(files);
                        info.appendChild(detailsBtn);
                        item.appendChild(info);
                        item.appendChild(details);
                        
                        // Ajouter les mini-maps pour chaque fichier
                        Object.entries(checkpoint.files).forEach(([filePath, data]) => {
                            if (data.miniMap) {
                                const miniMapContainer = createMiniMap(data.miniMap);
                                item.appendChild(miniMapContainer);
                            }
                        });

                        timeline.insertBefore(item, timeline.firstChild);
                    }
                    
                    function toggleDetails(checkpointId) {
                        const details = document.getElementById(\`details-\${checkpointId}\`);
                        if (details) {
                            details.style.display = details.style.display === 'none' ? 'block' : 'none';
                        }
                    }

                    function createMiniMap(miniMapData) {
                        const container = document.createElement('div');
                        container.className = 'checkpoint-minimap';

                        const minimap = document.createElement('div');
                        minimap.className = 'minimap-container';

                        // Créer les points sur la mini-map
                        miniMapData.points.forEach((point, index) => {
                            const dot = document.createElement('div');
                            dot.className = \`minimap-point \${point.type}\`;
                            dot.style.left = \`\${point.x}%\`;
                            dot.style.top = \`\${point.y}%\`;
                            
                            // Ajouter un titre avec les informations du point
                            dot.title = \`Ligne \${point.lineNumber + 1} - \${point.type}\\n\${new Date(point.timestamp).toLocaleTimeString()}\`;
                            
                            minimap.appendChild(dot);

                            // Tracer une ligne vers le point suivant
                            if (index < miniMapData.points.length - 1) {
                                const nextPoint = miniMapData.points[index + 1];
                                const line = document.createElement('div');
                                line.className = 'minimap-trace';
                                
                                const length = Math.sqrt(
                                    Math.pow(nextPoint.x - point.x, 2) + 
                                    Math.pow(nextPoint.y - point.y, 2)
                                );
                                
                                const angle = Math.atan2(
                                    nextPoint.y - point.y,
                                    nextPoint.x - point.x
                                ) * 180 / Math.PI;
                                
                                line.style.width = \`\${length}%\`;
                                line.style.left = \`\${point.x}%\`;
                                line.style.top = \`\${point.y}%\`;
                                line.style.transform = \`rotate(\${angle}deg)\`;
                                line.style.transformOrigin = 'left center';
                                
                                minimap.appendChild(line);
                            }
                        });

                        // Ajouter les détails de la mini-map
                        const details = document.createElement('div');
                        details.className = 'minimap-details';
                        details.innerHTML = \`
                            <div>Début: \${new Date(miniMapData.startTime).toLocaleTimeString()}</div>
                            <div>Fin: \${new Date(miniMapData.endTime).toLocaleTimeString()}</div>
                            <div>Points: \${miniMapData.points.length}</div>
                        \`;

                        container.appendChild(minimap);
                        container.appendChild(details);
                        return container;
                    }

                    function createCheckpointFolder(checkpoint) {
                        const folder = document.createElement('div');
                        folder.className = 'checkpoint-folder';
                        folder.setAttribute('data-checkpoint-id', checkpoint.id);

                        const icon = document.createElement('div');
                        icon.className = 'folder-icon';

                        const label = document.createElement('div');
                        label.className = 'folder-label';
                        const checkpointDate = new Date(checkpoint.timestamp);
                        label.textContent = checkpointDate.toLocaleTimeString();

                        const time = document.createElement('div');
                        time.className = 'folder-time';
                        time.textContent = checkpointDate.toLocaleDateString();

                        // Indicateur de dernière modification
                        if (checkpoint.isLatest) {
                            const indicator = document.createElement('div');
                            indicator.className = 'last-modified';
                            indicator.title = 'Dernière modification';
                            folder.appendChild(indicator);
                        }

                        // Panneau de prévisualisation
                        const preview = document.createElement('div');
                        preview.className = 'preview-pane';
                        
                        const filesList = document.createElement('div');
                        filesList.style.marginBottom = '10px';
                        filesList.innerHTML = Object.keys(checkpoint.files)
                            .map(file => \`<div>\${file}</div>\`)
                            .join('');
                        
                        const restoreBtn = document.createElement('button');
                        restoreBtn.className = 'restore-button';
                        restoreBtn.textContent = 'Restaurer';
                        restoreBtn.onclick = (e) => {
                            e.stopPropagation();
                            vscode.postMessage({
                                command: 'restoreCheckpoint',
                                checkpointId: checkpoint.id
                            });
                        };

                        preview.appendChild(filesList);
                        preview.appendChild(restoreBtn);

                        folder.appendChild(icon);
                        folder.appendChild(label);
                        folder.appendChild(time);
                        folder.appendChild(preview);

                        folder.onclick = () => {
                            document.querySelectorAll('.checkpoint-folder').forEach(f => 
                                f.classList.remove('active'));
                            folder.classList.add('active');
                            
                            vscode.postMessage({
                                command: 'showCheckpointDetails',
                                checkpointId: checkpoint.id
                            });
                        };

                        return folder;
                    }

                    function updateCheckpointGrid(checkpoints) {
                        const grid = document.getElementById('checkpointGrid');
                        grid.innerHTML = '';
                        
                        // Trier les checkpoints par date
                        const sortedCheckpoints = [...checkpoints].sort((a, b) => 
                            b.timestamp - a.timestamp);
                        
                        // Marquer le dernier checkpoint
                        if (sortedCheckpoints.length > 0) {
                            sortedCheckpoints[0].isLatest = true;
                        }

                        sortedCheckpoints.forEach(checkpoint => {
                            grid.appendChild(createCheckpointFolder(checkpoint));
                        });
                    }

                    window.addEventListener('message', event => {
                        const message = event.data;
                        switch (message.command) {
                            case 'filesUpdated':
                                fileTreeData = message.files.filter(f => !f.isTracked);
                                originalFilesData = message.files.filter(f => f.isTracked);
                                
                                const fileTree = document.getElementById('fileTree');
                                const originalFiles = document.getElementById('originalFiles');
                                
                                fileTree.innerHTML = '';
                                originalFiles.innerHTML = '';
                                
                                fileTreeData.forEach(node => {
                                    fileTree.appendChild(createFileTreeItem(node));
                                });
                                originalFilesData.forEach(node => {
                                    originalFiles.appendChild(createFileTreeItem(node, true));
                                });
                                break;

                            case 'fileChanged':
                                showDiffView(message.diff.original, message.diff.modified, message.path);
                                break;

                            case 'checkpointCreated':
                                if (message.changedFiles.length > 0) {
                                    message.changedFiles.forEach(file => {
                                        const diff = message.diffs[file];
                                        if (diff) {
                                            showDiffView(diff.original, diff.modified, file);
                                        }
                                    });
                                }
                                break;

                            case 'automaticCheckpointCreated':
                                updateCheckpointTimeline(message.checkpoint);
                                break;

                            case 'updateMiniMap':
                                const selector = '.checkpoint-minimap[data-file="' + message.filePath + '"]';
                                const miniMapContainer = document.querySelector(selector);
                                if (miniMapContainer) {
                                    miniMapContainer.replaceWith(createMiniMap(message.miniMap));
                                } else {
                                    const timelineItem = document.querySelector('.checkpoint-item:first-child');
                                    if (timelineItem) {
                                        timelineItem.appendChild(createMiniMap(message.miniMap));
                                    }
                                }
                                break;

                            case 'startMiniMap':
                                const newMiniMap = createMiniMap({
                                    points: [],
                                    startTime: Date.now(),
                                    endTime: 0,
                                    filePath: message.filePath,
                                    dimensions: { width: 100, height: 100 }
                                });
                                const currentTimeline = document.querySelector('.checkpoint-item:first-child');
                                if (currentTimeline) {
                                    currentTimeline.appendChild(newMiniMap);
                                }
                                break;

                            case 'checkpointsUpdated':
                                updateCheckpointGrid(message.checkpoints);
                                break;
                            case 'checkpointRestored':
                                // Mettre à jour l'interface après la restauration
                                document.querySelectorAll('.checkpoint-folder').forEach(folder => {
                                    if (folder.getAttribute('data-checkpoint-id') === message.checkpointId) {
                                        folder.classList.add('active');
                                    } else {
                                        folder.classList.remove('active');
                                    }
                                });
                                break;
                        }
                    });

                    // Initial file request
                    vscode.postMessage({
                        command: 'getCurrentFiles'
                    });
                </script>
                <script>
                // ...existing code...

                function showTimelineDetails(filePath, changes) {
                    const timeline = document.createElement('div');
                    timeline.className = 'timeline-details';
                    
                    changes.forEach(change => {
                        const changeEntry = document.createElement('div');
                        changeEntry.className = \`timeline-entry change-\${change.action}\`;
                        
                        const time = new Date(change.timestamp).toLocaleTimeString();
                        const action = change.action.charAt(0).toUpperCase() + change.action.slice(1);
                        const details = change.previousContent 
                            ? \`De: "\${change.previousContent}" à: "\${change.content}"\`
                            : \`Contenu: "\${change.content}"\`;
                        
                        changeEntry.innerHTML = \`
                            <div class="timeline-time">\${time}</div>
                            <div class="timeline-action">\${action}</div>
                            <div class="timeline-line">Ligne \${change.lineNumber}</div>
                            <div class="timeline-details">\${details}</div>
                        \`;
                        
                        timeline.appendChild(changeEntry);
                    });
                    
                    return timeline;
                }

                // ...existing code...
            </script>
            <style>
                // ...existing code...
                .timeline-details {
                    padding: 10px;
                    margin-top: 10px;
                    background: var(--vscode-editor-background);
                    border: 1px solid var(--vscode-panel-border);
                }
                .timeline-entry {
                    padding: 5px;
                    margin: 2px 0;
                    border-left: 3px solid transparent;
                }
                .timeline-entry.change-added {
                    border-left-color: var(--vscode-gitDecoration-addedResourceForeground);
                }
                .timeline-entry.change-deleted {
                    border-left-color: var(--vscode-gitDecoration-deletedResourceForeground);
                }
                .timeline-entry.change-modified {
                    border-left-color: var(--vscode-gitDecoration-modifiedResourceForeground);
                }
                .timeline-time {
                    font-size: 0.8em;
                    color: var(--vscode-descriptionForeground);
                }
                .timeline-action {
                    font-weight: bold;
                }
                .timeline-line {
                    font-family: monospace;
                }
                .timeline-details {
                    font-size: 0.9em;
                    margin-left: 20px;
                }
                .diff-content-container {
                    padding: 10px;
                    font-family: monospace;
                    white-space: pre;
                    counter-reset: line;
                }
                .diff-line {
                    position: relative;
                    padding: 0 4px;
                    min-height: 18px;
                    line-height: 18px;
                    margin: 0;
                }
                .diff-line::before {
                    counter-increment: line;
                    content: counter(line);
                    position: absolute;
                    left: -3em;
                    width: 2.5em;
                    text-align: right;
                    color: var(--vscode-editorLineNumber-foreground);
                    padding-right: 0.5em;
                }
                .diff-header-info {
                    padding: 5px;
                    background: var(--vscode-editorGroupHeader-tabsBackground);
                    border-bottom: 1px solid var(--vscode-panel-border);
                    font-weight: bold;
                }
                .diff-removed {
                    background-color: var(--vscode-diffEditor-removedLineBackground);
                    text-decoration: line-through;
                    opacity: 0.7;
                }
                .diff-added {
                    background-color: var(--vscode-diffEditor-insertedLineBackground);
                }
                .diff-panel {
                    position: relative;
                    padding-left: 3em;
                }
            </style>
            </body>
        </html>`;
    }

    private async restoreCheckpoint(checkpointId: string) {
        if (!this.checkpointManager || !this.workingDirs) return;

        const checkpoint = await this.checkpointManager.getCheckpointDetails(checkpointId);
        if (!checkpoint) return;

        // Restaurer chaque fichier du checkpoint
        for (const [filePath, fileData] of Object.entries(checkpoint.files)) {
            const workspaceFile = path.join(this.workingDirs.studio, filePath);
            const workspaceDir = path.dirname(workspaceFile);

            // Créer le dossier si nécessaire
            if (!fs.existsSync(workspaceDir)) {
                fs.mkdirSync(workspaceDir, { recursive: true });
            }

            // Restaurer le contenu du fichier
            fs.writeFileSync(workspaceFile, fileData.snapshot);

            // Ouvrir le fichier dans l'éditeur
            const fileUri = vscode.Uri.file(workspaceFile);
            await vscode.window.showTextDocument(fileUri);
        }

        // Notifier l'interface
        if (this._view) {
            this._view.webview.postMessage({
                command: 'checkpointRestored',
                checkpointId
            });
        }
    }

    // ...existing code...
}

export function activate(context: vscode.ExtensionContext) {
    const mscodeProvider = new MSCodeViewProvider(context.extensionUri);
    const deepseekProvider = new DeepSeekViewProvider(context.extensionUri);
    
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(MSCodeViewProvider.viewType, mscodeProvider),
        vscode.window.registerWebviewViewProvider(DeepSeekViewProvider.viewType, deepseekProvider),
        vscode.commands.registerCommand('mscode.configureDeepSeek', async () => {
            const apiKey = await vscode.window.showInputBox({
                prompt: "Entrez votre clé API DeepSeek",
                password: true
            });
            
            if (apiKey) {
                await vscode.workspace.getConfiguration('deepseek').update('apiKey', apiKey, true);
                vscode.window.showInformationMessage('Clé API DeepSeek enregistrée avec succès!');
            }
        })
    );
}

export function deactivate() {}

