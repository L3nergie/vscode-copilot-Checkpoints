import * as vscode from 'vscode';
import * as path from 'path';
import * as fsExtra from 'fs-extra';
import { minimatch } from 'minimatch';
import { Logger } from './utils/logger';

export interface LineHistory {
    lineNumber: number;
    content: string;
    timestamp: number;
    action: 'added' | 'modified' | 'deleted' | 'restored';
    previousContent?: string;
    previousLineNumber?: number;
}

export interface FileChangeLog {
    lineNumber: number;
    content: string;
    type: 'added' | 'modified' | 'deleted';
    timestamp: number;
    author?: string;
    lineHistory: LineHistory[];
}

export interface FileTimeline {
    filePath: string;
    changes: LineHistory[];
    snapshots: Array<{
        timestamp: number;
        content: string;
    }>;
}

interface MiniMapPoint {
    x: number;
    y: number;
    type: 'add' | 'delete' | 'modify';
    timestamp: number;
    lineNumber: number;
}

interface MiniMapData {
    points: MiniMapPoint[];
    startTime: number;
    endTime: number;
    filePath: string;
    dimensions: {
        width: number;
        height: number;
    };
}

export interface CheckpointLog {
    id: string;
    timestamp: number;
    checkpoint: {
        id: string;
        files: Record<string, any>;
    };
    files: {
        [filePath: string]: {
            changes: FileChangeLog[];
            snapshot: string;
            timeline: FileTimeline;
            miniMap: MiniMapData;
        };
    };
    metadata: {
        description: string;
        isAutomatic: boolean;
        isInitialState?: boolean;
        vscodeLogs?: any[];
        status?: 'initial' | 'current' | 'intermediate';  // Status rendu optionnel
    };
}

export class CheckpointManager {
    private historyFile: string;
    private checkpointsDir: string;
    private timelineDir: string;
    private activeModifications: Map<string, { 
        startTime: number, 
        changes: FileChangeLog[],
        miniMap: MiniMapData
    }> = new Map();
    private fileTimelines: Map<string, FileTimeline> = new Map();
    private activeMiniMaps: Map<string, MiniMapData> = new Map();
    private modificationCount: number = 0;
    private readonly AUTO_CHECKPOINT_THRESHOLD = 10;
    private lastCheckpointTime: number = Date.now();
    private readonly MIN_CHECKPOINT_INTERVAL = 5 * 60 * 1000; // 5 minutes
    private readonly CHECKPOINT_INTERVAL = 60 * 1000; // 1 minute
    private currentCheckpointStartTime: number = Date.now();
    private pendingChanges: Map<string, FileChangeLog[]> = new Map();
    private activeChanges: Map<string, FileChangeLog[]> = new Map();
    private fileProcessingQueue: Map<string, Promise<void>> = new Map();
    private readonly config = {
        maxSnapshotsPerFile: 100,
        maxRecursionDepth: 5,
        chunkSize: 1024 * 1024, // 1MB
        ignoredPaths: ['.git', 'node_modules', '.mscode', 'out', 'dist', '.DS_Store']
    };

    constructor(
        private workspaceRoot: string,
        private readonly outputChannel: vscode.OutputChannel
    ) {
        this.outputChannel.appendLine(`=== Initialisation du CheckpointManager ===`);
        this.outputChannel.appendLine(`Workspace: ${workspaceRoot}`);
        
        this.historyFile = path.join(workspaceRoot, '.mscode', 'history.json');
        this.checkpointsDir = path.join(workspaceRoot, '.mscode', 'changes');
        this.timelineDir = path.join(workspaceRoot, '.mscode', 'timelines');
        
        this.outputChannel.appendLine(`Fichier historique: ${this.historyFile}`);
        this.outputChannel.appendLine(`Dossier checkpoints: ${this.checkpointsDir}`);
        this.outputChannel.appendLine(`Dossier timelines: ${this.timelineDir}`);
        
        this.ensureDirectories();
        this.loadExistingTimelines();
        this.ensureInitialState();
        
        // Charger l'historique au démarrage
        const history = this.loadHistory();
        this.outputChannel.appendLine(`${history.length} checkpoints chargés\n`);
        
        this.setupFileWatchers();
        this.outputChannel.appendLine('FileWatchers configurés');
    }

    private ensureDirectories() {
        const dirs = [
            path.join(this.workspaceRoot, '.mscode'),
            this.checkpointsDir,
            this.timelineDir
        ];
        
        for (const dir of dirs) {
            if (!fsExtra.existsSync(dir)) {
                this.outputChannel.appendLine(`Création du dossier: ${dir}`);
                fsExtra.mkdirpSync(dir);
            } else {
                this.outputChannel.appendLine(`Dossier existant: ${dir}`);
            }
        }
    }

    private loadExistingTimelines() {
        if (fsExtra.existsSync(this.timelineDir)) {
            const files = fsExtra.readdirSync(this.timelineDir);
            for (const file of files) {
                if (file.endsWith('.timeline.json')) {
                    const filePath = file.replace('.timeline.json', '');
                    const timelinePath = path.join(this.timelineDir, file);
                    try {
                        const timeline = JSON.parse(fsExtra.readFileSync(timelinePath, 'utf-8'));
                        this.fileTimelines.set(filePath, timeline);
                    } catch (error) {
                        console.error(`Erreur lors du chargement de la timeline ${file}:`, error);
                    }
                }
            }
        }
    }

    private getTimelineFilePath(filePath: string): string {
        const sanitizedPath = filePath.replace(/[/\\]/g, '_');
        return path.join(this.timelineDir, sanitizedPath, 'timeline.json');
    }

    private async saveTimeline(filePath: string, timeline: FileTimeline) {
        const timelineFile = this.getTimelineFilePath(filePath);
        fsExtra.writeFileSync(timelineFile, JSON.stringify(timeline, null, 2));
        this.fileTimelines.set(filePath, timeline);
    }

    private async saveTimelineSnapshot(filePath: string, change: FileChangeLog) {
        const timestamp = change.timestamp;
        const sanitizedPath = filePath.replace(/[/\\]/g, '_');
        const snapshotDir = path.join(this.timelineDir, sanitizedPath);
        
        if (!fsExtra.existsSync(snapshotDir)) {
            fsExtra.mkdirpSync(snapshotDir);
        }

        // Inclure la mini-map dans le snapshot
        const miniMap = this.activeMiniMaps.get(filePath);
        const snapshotFile = path.join(snapshotDir, `${timestamp}.json`);
        const snapshot = {
            timestamp,
            change,
            lineHistory: change.lineHistory,
            fullContent: await this.getCurrentFileContent(filePath),
            miniMap: miniMap ? {...miniMap, endTime: timestamp} : null
        };

        fsExtra.writeFileSync(snapshotFile, JSON.stringify(snapshot, null, 2));
    }

    private async cleanupTimestampFiles(filePath: string) {
        const userConfig = vscode.workspace.getConfiguration('mscode');
        const maxSnapshots = userConfig.get<number>('maxSnapshotsPerFile') || this.config.maxSnapshotsPerFile;
        
        const sanitizedPath = filePath.replace(/[/\\]/g, '_');
        const snapshotDir = path.join(this.timelineDir, sanitizedPath);
        
        if (!fsExtra.existsSync(snapshotDir)) return;

        const ONE_HOUR = 3600000;
        const now = Date.now();
        
        try {
            const files = fsExtra.readdirSync(snapshotDir)
                .filter(file => file.endsWith('.json'))
                .map(file => ({
                    name: file,
                    timestamp: parseInt(file.replace('.json', '')),
                    path: path.join(snapshotDir, file)
                }))
                .sort((a, b) => a.timestamp - b.timestamp);

            // Ne garder que les 100 derniers fichiers si on en a plus
            if (files.length > maxSnapshots) {
                const filesToRemove = files.slice(0, files.length - maxSnapshots);
                filesToRemove.forEach(file => {
                    try {
                        fsExtra.unlinkSync(file.path);
                        this.outputChannel.appendLine(`Nettoyage: suppression de ${file.path}`);
                    } catch (error) {
                        this.outputChannel.appendLine(`Erreur lors de la suppression de ${file.path}: ${error}`);
                    }
                });
            }
        } catch (error) {
            this.outputChannel.appendLine(`Erreur lors du nettoyage des fichiers timeline: ${error}`);
        }
    }

    private async saveModificationBatch(filePath: string, force: boolean = false): Promise<void> {
        const modification = this.activeModifications.get(filePath);
        if (!modification) return;

        const now = Date.now();
        if (force || now - modification.startTime >= this.CHECKPOINT_INTERVAL) {
            // Créer le dossier de checkpoint si nécessaire
            const checkpointId = `checkpoint_${now}`;
            const checkpointDir = path.join(this.checkpointsDir, checkpointId);
            await fsExtra.ensureDir(checkpointDir);

            // Sauvegarder les modifications
            const fileDir = path.join(checkpointDir, this.sanitizeFileName(filePath));
            await fsExtra.ensureDir(fileDir);

            // Sauvegarder le contenu et les changements
            const currentContent = await this.getCurrentFileContent(filePath);
            await fsExtra.writeFile(path.join(fileDir, 'content.txt'), currentContent);
            await fsExtra.writeJson(path.join(fileDir, 'changes.json'), modification.changes, { spaces: 2 });

            this.outputChannel.appendLine(`Modifications sauvegardées pour ${filePath} dans ${checkpointDir}`);
        }
    }

    private async handlePendingChanges() {
        const now = Date.now();
        if (now - this.currentCheckpointStartTime >= this.CHECKPOINT_INTERVAL) {
            if (this.pendingChanges.size > 0) {
                this.outputChannel.appendLine('\n=== Création d\'un checkpoint temporel ===');
                const description = `Checkpoint automatique - ${new Date().toLocaleTimeString()}`;
                await this.createCheckpoint(true, description);
                this.pendingChanges.clear();
            }
            this.currentCheckpointStartTime = now;
        }
    }

    private async checkAndCreateCheckpoint() {
        const now = Date.now();
        if (now - this.lastCheckpointTime >= this.CHECKPOINT_INTERVAL) {
            if (this.activeChanges.size > 0) {
                this.outputChannel.appendLine('\nCréation d\'un checkpoint temporel');
                await this.createCheckpoint(true, `Checkpoint automatique - ${new Date().toLocaleTimeString()}`);
                // Forcer un rafraîchissement de la vue
                vscode.commands.executeCommand('mscode.refreshView');
            }
            this.lastCheckpointTime = now;
        }
    }

    async logChange(filePath: string, change: FileChangeLog): Promise<void> {
        this.outputChannel.appendLine(`\n=== Changement détecté dans ${filePath} ===`);
        this.outputChannel.appendLine(`Type: ${change.type}`);
        this.outputChannel.appendLine(`Ligne: ${change.lineNumber}`);
        this.outputChannel.appendLine(`Contenu: ${change.content.substring(0, 50)}${change.content.length > 50 ? '...' : ''}`);

        // Initialiser les modifications actives si nécessaire
        if (!this.activeModifications.has(filePath)) {
            this.activeModifications.set(filePath, {
                startTime: Date.now(),
                changes: [],
                miniMap: this.initializeMiniMap(filePath)
            });
        }

        // Ajouter le changement aux modifications actives
        const modification = this.activeModifications.get(filePath)!;
        modification.changes.push(change);

        // Forcer la création d'un checkpoint si nécessaire
        const now = Date.now();
        if (now - this.lastCheckpointTime >= this.CHECKPOINT_INTERVAL) {
            this.outputChannel.appendLine('\nCréation forcée d\'un checkpoint après intervalle...');
            await this.createCheckpoint(true, `Checkpoint automatique - ${new Date(now).toLocaleTimeString()}`);
            this.lastCheckpointTime = now;
        }

        // Sauvegarder immédiatement les modifications
        await this.saveModificationBatch(filePath, true);

        // Ajouter le changement aux modifications en attente
        const changes = this.pendingChanges.get(filePath) || [];
        changes.push(change);
        this.pendingChanges.set(filePath, changes);

        await this.saveModificationBatch(filePath, false);
        await this.handlePendingChanges();

        // Ajouter le changement aux modifications actives
        const activeChanges = this.activeChanges.get(filePath) || [];
        activeChanges.push(change);
        this.activeChanges.set(filePath, activeChanges);

        // Vérifier si nous devons créer un nouveau checkpoint
        await this.checkAndCreateCheckpoint();
    }

    async createCheckpoint(
        isAutomatic: boolean,
        description?: string
    ): Promise<CheckpointLog> {
        this.outputChannel.appendLine('\n=== Création d\'un nouveau checkpoint ===');
        
        const timestamp = Date.now();
        const checkpointId = `checkpoint_${timestamp}`;
        
        // Créer le dossier du checkpoint
        const checkpointDir = path.join(this.checkpointsDir, checkpointId);
        await fsExtra.ensureDir(checkpointDir); // Utiliser ensureDir au lieu de mkdirp
        this.outputChannel.appendLine(`Dossier créé: ${checkpointDir}`);

        // Préparer les données du checkpoint
        const files: Record<string, any> = {};
        
        // Parcourir les fichiers modifiés
        for (const [filePath, modification] of this.activeModifications.entries()) {
            if (modification.changes.length === 0) continue;

            const currentContent = await this.getCurrentFileContent(filePath);
            if (!currentContent) continue;

            // Créer un dossier spécifique au fichier dans le checkpoint
            const fileDir = path.join(checkpointDir, this.sanitizeFileName(filePath));
            await fsExtra.ensureDir(fileDir);

            // Sauvegarder le contenu actuel
            await fsExtra.writeFile(
                path.join(fileDir, 'content.txt'),
                currentContent
            );

            // Sauvegarder les modifications
            await fsExtra.writeJson(
                path.join(fileDir, 'changes.json'),
                modification.changes,
                { spaces: 2 }
            );

            files[filePath] = {
                changes: modification.changes,
                snapshot: currentContent,
                timeline: {
                    filePath,
                    changes: modification.changes.flatMap(c => c.lineHistory),
                    snapshots: [{ timestamp, content: currentContent }]
                },
                miniMap: modification.miniMap
            };
        }

        const checkpoint: CheckpointLog = {
            id: checkpointId,
            timestamp,
            checkpoint: {
                id: checkpointId,
                files: files
            },
            files,
            metadata: {
                description: description || `Checkpoint ${isAutomatic ? 'automatique' : 'manuel'} - ${new Date(timestamp).toLocaleString()}`,
                isAutomatic,
                isInitialState: false,
                status: 'intermediate'
            }
        };

        // Sauvegarder le checkpoint.json
        const checkpointPath = path.join(checkpointDir, 'checkpoint.json');
        await fsExtra.writeJson(checkpointPath, checkpoint, { spaces: 2 });
        
        // Mettre à jour l'historique
        await this.manageHistory(checkpoint);
        
        // Réinitialiser les modifications actives
        this.activeModifications.clear();
        
        return checkpoint;
    }

    private sanitizeFileName(filePath: string): string {
        return filePath.replace(/[^a-zA-Z0-9]/g, '_');
    }

    private async manageHistory(newCheckpoint: CheckpointLog) {
        const history = this.loadHistory();
        history.push(newCheckpoint);

        // Garder seulement les 20 derniers checkpoints
        if (history.length > 20) {
            const removed = history.splice(0, history.length - 20);
            // Nettoyer les anciens checkpoints
            for (const checkpoint of removed) {
                const dir = path.join(this.checkpointsDir, checkpoint.id);
                if (fsExtra.existsSync(dir)) {
                    fsExtra.removeSync(dir);
                }
            }
        }

        this.saveHistory(history);
    }

    async revertToState(filePath: string, timestamp: number): Promise<boolean> {
        const timeline = this.fileTimelines.get(filePath);
        if (!timeline) return false;

        // Trouver tous les fichiers timestamp jusqu'au moment demandé
        const sanitizedPath = filePath.replace(/[/\\]/g, '_');
        const snapshotDir = path.join(this.timelineDir, sanitizedPath);
        
        if (fsExtra.existsSync(snapshotDir)) {
            const snapshots = fsExtra.readdirSync(snapshotDir)
                .filter(file => file.endsWith('.json'))
                .map(file => ({
                    timestamp: parseInt(file.replace('.json', '')),
                    path: path.join(snapshotDir, file)
                }))
                .filter(snapshot => snapshot.timestamp <= timestamp)
                .sort((a, b) => a.timestamp - b.timestamp);

            // Appliquer les changements dans l'ordre chronologique
            let content = '';
            for (const snapshot of snapshots) {
                const snapshotData = JSON.parse(fsExtra.readFileSync(snapshot.path, 'utf-8'));
                content = snapshotData.fullContent;
            }

            if (content) {
                const fullPath = path.join(this.workspaceRoot, filePath);
                fsExtra.writeFileSync(fullPath, content);
                return true;
            }
        }

        return false;
    }

    private applyChange(content: string, change: LineHistory): string {
        const lines = content.split('\n');
        
        switch (change.action) {
            case 'added':
                lines.splice(change.lineNumber, 0, change.content);
                break;
            case 'modified':
                lines[change.lineNumber] = change.content;
                break;
            case 'deleted':
                lines.splice(change.lineNumber, 1);
                break;
            case 'restored':
                if (change.previousLineNumber !== undefined) {
                    lines[change.lineNumber] = change.previousContent || '';
                }
                break;
        }

        return lines.join('\n');
    }

    private async getCurrentFileContent(filePath: string): Promise<string> {
        try {
            const fullPath = path.join(this.workspaceRoot, filePath);
            const stats = await fsExtra.stat(fullPath);
            
            if (stats.size > this.config.chunkSize) {
                return await this.readLargeFile(fullPath);
            }
            
            const content = await fsExtra.readFile(fullPath, { encoding: 'utf-8' });
            return content;
        } catch (error) {
            Logger.error(`Erreur lors de la lecture du fichier ${filePath}: ${error}`);
            return '';
        }
    }

    private async readLargeFile(filePath: string): Promise<string> {
        const chunks: (string | Buffer)[] = [];
        const stream = fsExtra.createReadStream(filePath, {
            encoding: 'utf-8',
            highWaterMark: this.config.chunkSize
        });

        return new Promise((resolve, reject) => {
            stream.on('data', (chunk: string | Buffer) => {
                chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf-8'));
            });
            stream.on('end', () => resolve(chunks.join('')));
            stream.on('error', reject);
        });
    }

    // Cache pour loadHistory
    private historyCache: CheckpointLog[] | null = null;
    private lastHistoryLoad: number = 0;
    private readonly HISTORY_CACHE_TTL = 5000; // 5 secondes

    private loadHistory(): CheckpointLog[] {
        const checkpoints: CheckpointLog[] = [];

        try {
            if (fsExtra.existsSync(this.checkpointsDir)) {
                const dirs = fsExtra.readdirSync(this.checkpointsDir)
                    .filter(dir => {
                        const fullPath = path.join(this.checkpointsDir, dir);
                        return fsExtra.statSync(fullPath).isDirectory() && dir.startsWith('checkpoint_');
                    });

                for (const dir of dirs) {
                    try {
                        const dirPath = path.join(this.checkpointsDir, dir);
                        const timestamp = parseInt(dir.split('_')[1]) || Date.now();
                        const checkpoint = {
                            id: dir,
                            timestamp,
                            checkpoint: { id: dir, files: {} },
                            files: {},
                            metadata: {
                                description: `Checkpoint ${dir}`,
                                isAutomatic: true
                            }
                        };
                        
                        const files = fsExtra.readdirSync(dirPath);
                        files.forEach(file => this.loadFileIntoCheckpoint(dirPath, file, checkpoint, timestamp));
                        checkpoints.push(checkpoint);
                    } catch (error) {
                        this.outputChannel.appendLine(`Erreur: ${error}`);
                    }
                }
            }
        } catch (error) {
            this.outputChannel.appendLine(`Erreur: ${error}`);
        }

        return checkpoints;
    }

    private saveHistory(history: CheckpointLog[]): void {
        try {
            fsExtra.writeFileSync(this.historyFile, JSON.stringify(history, null, 2));
        } catch (error) {
            this.outputChannel.appendLine(`Erreur lors de la sauvegarde de l'historique: ${error}`);
        }
    }

    async getCheckpointDetails(checkpointId: string): Promise<CheckpointLog | null> {
        const history = this.loadHistory();
        return history.find((cp: CheckpointLog) => cp.id === checkpointId) || null;
    }

    async getAllCheckpoints(): Promise<CheckpointLog[]> {
        this.outputChannel.appendLine('getAllCheckpoints() appele...');
        const checkpoints = this.loadHistory();
        this.outputChannel.appendLine(`getAllCheckpoints() retourne ${checkpoints.length} checkpoints`);
        
        if (checkpoints.length === 0) {
            const changesDir = path.join(this.workspaceRoot, '.mscode', 'changes');
            if (fsExtra.existsSync(changesDir)) {
                const dirs = fsExtra.readdirSync(changesDir);
                this.outputChannel.appendLine(`Dossier changes contient ${dirs.length} entrees`);
                dirs.forEach(dir => {
                    this.outputChannel.appendLine(`- ${dir}`);
                });
            } else {
                this.outputChannel.appendLine('Dossier changes non trouve');
            }
        }
        
        return checkpoints;
    }

    async getFileHistory(filePath: string): Promise<Array<{ checkpoint: CheckpointLog; changes: FileChangeLog[] }>> {
        const history = this.loadHistory();
        return history
            .filter((cp: CheckpointLog) => cp.files[filePath])
            .map((cp: CheckpointLog) => ({
                checkpoint: cp,
                changes: cp.files[filePath].changes
            }));
    }

    async reconstructHistory(filePath: string, fromTimestamp: number, toTimestamp: number) {
        const sanitizedPath = filePath.replace(/[/\\]/g, '_');
        const snapshotDir = path.join(this.timelineDir, sanitizedPath);
        
        if (!fsExtra.existsSync(snapshotDir)) {
            return null;
        }

        const snapshots = fsExtra.readdirSync(snapshotDir)
            .filter(file => file.endsWith('.json'))
            .map(file => {
                const timestamp = parseInt(file.replace('.json', ''));
                return {
                    timestamp,
                    path: path.join(snapshotDir, file),
                    data: JSON.parse(fsExtra.readFileSync(path.join(snapshotDir, file), 'utf-8'))
                };
            })
            .filter(snapshot => snapshot.timestamp >= fromTimestamp && snapshot.timestamp <= toTimestamp)
            .sort((a, b) => a.timestamp - b.timestamp);

        return {
            filePath,
            steps: snapshots.map(snapshot => ({
                timestamp: snapshot.timestamp,
                change: snapshot.data.change,
                lineHistory: snapshot.data.lineHistory
            })),
            initialContent: snapshots[0]?.data.fullContent || '',
            finalContent: snapshots[snapshots.length - 1]?.data.fullContent || ''
        };
    }

    async getDetailedTimeline(filePath: string): Promise<{
        timestamps: number[];
        changes: Map<number, LineHistory[]>;
        snapshots: Map<number, string>;
    }> { 
            const sanitizedPath = filePath.replace(/[/\\]/g, '_');
            const snapshotDir = path.join(this.timelineDir, sanitizedPath);
            
            const timestamps: number[] = [];
            const changes = new Map<number, LineHistory[]>();
            const snapshots = new Map<number, string>();

            if (fsExtra.existsSync(snapshotDir)) {
                const files = fsExtra.readdirSync(snapshotDir)
                    .filter(() => endsWith('.json'))
                    .sort((a, b) => {
                        const timeA = parseInt(a.replace('.json', ''));
                        const timeB = parseInt(b.replace('.json', ''));
                        return timeA - timeB;
                    });

                for (const file of files) {
                    const timestamp = parseInt(file.replace('.json', ''));
                    const data = JSON.parse(fsExtra.readFileSync(path.join(snapshotDir, file), 'utf-8'));
                    
                    timestamps.push(timestamp);
                    changes.set(timestamp, data.lineHistory);
                    snapshots.set(timestamp, data.fullContent);
                }
            }

            return { timestamps, changes, snapshots };
        }

    private initializeMiniMap(filePath: string): MiniMapData {
        return {
            points: [],
            startTime: Date.now(),
            endTime: 0,
            filePath,
            dimensions: {
                width: 100,
                height: 100
            }
        };
    }

    private convertChangeType(type: 'added' | 'modified' | 'deleted'): 'add' | 'delete' | 'modify' {
        switch (type) {
            case 'added': return 'add';
            case 'deleted': return 'delete';
            case 'modified': return 'modify';
        }
    }

    private calculateMiniMapPoint(change: FileChangeLog, fileContent: string): Omit<MiniMapPoint, 'type'> {
        const lines = fileContent.split('\n');
        const totalLines = lines.length;
        
        const y = Math.floor((change.lineNumber / totalLines) * 100);
        const line = lines[change.lineNumber] || '';
        const indentation = line.search(/\S/);
        const x = Math.floor((indentation / 50) * 100);

        return {
            x,
            y,
            timestamp: change.timestamp,
            lineNumber: change.lineNumber
        };
    }

    async getCurrentMiniMap(filePath: string): Promise<MiniMapData | null> {
        return this.activeModifications.get(filePath)?.miniMap || null;
    }

    async getMiniMapData(filePath: string): Promise<MiniMapData | null> {
        const miniMap = await this.getCurrentMiniMap(filePath);
        if (!miniMap) {
            vscode.window.showInformationMessage(`No mini map data available for: ${filePath}`);
            return null;
        }
        return miniMap;
    }

    private async ensureInitialState() {
        const initialStateDir = path.join(this.workspaceRoot, '.mscode', 'initial-state');
        if (!fsExtra.existsSync(initialStateDir)) {
            this.outputChannel.appendLine('Création de l\'état initial du projet...');
            await fsExtra.mkdirp(initialStateDir);
            
            const timestamp = Date.now();
            const checkpointId = 'initial_state';
            const files: Record<string, any> = {};
            
            const allFiles = await this.getAllProjectFiles();
            for (const filePath of allFiles) {
                try {
                    const content = await fsExtra.readFile(path.join(this.workspaceRoot, filePath), 'utf-8');
                    files[filePath] = {
                        snapshot: content,
                        changes: [], // Initialize as empty array
                        timeline: {
                            filePath,
                            changes: [],
                            snapshots: [{
                                timestamp,
                                content
                            }]
                        },
                        miniMap: { // Add the required miniMap property
                            points: [],
                            startTime: timestamp,
                            endTime: timestamp,
                            filePath,
                            dimensions: {
                                width: 100,
                                height: 100
                            }
                        }
                    };
                } catch (error) {
                    this.outputChannel.appendLine(`Erreur lors de la sauvegarde de ${filePath}: ${error}`);
                }
            }

            // Créer un checkpoint initial
            const initialCheckpoint: CheckpointLog = {
                id: checkpointId,
                timestamp,
                checkpoint: {
                    id: checkpointId,
                    files: files
                },
                files,
                metadata: {
                    description: 'État initial du projet',
                    isAutomatic: true,
                    isInitialState: true
                }
            };
            
            // Sauvegarder le checkpoint initial
            const checkpointPath = path.join(initialStateDir, 'checkpoint.json');
            await fsExtra.writeJson(checkpointPath, initialCheckpoint, { spaces: 2 });
            
            // Ajouter à l'historique
            const history = this.loadHistory();
            history.unshift(initialCheckpoint);
            this.saveHistory(history);
            
            this.outputChannel.appendLine('État initial du projet sauvegardé');
        }
    }

    private async getAllProjectFiles(): Promise<string[]> {
        const ignorePatterns = [
            '**/node_modules/**',
            '**/.git/**',
            '**/.mscode/**',
            '**/out/**',
            '**/dist/**'
        ];
        
        const files: string[] = [];
        const walk = async (dir: string) => {
            const entries = await fsExtra.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                const relativePath = path.relative(this.workspaceRoot, fullPath);
                
                // Vérifier si le chemin doit être ignoré
                if (ignorePatterns.some(pattern => minimatch(relativePath, pattern))) {
                    continue;
                }
                
                if (entry.isDirectory()) {
                    await walk(fullPath);
                } else {
                    files.push(relativePath);
                }
            }
        };
        
        await walk(this.workspaceRoot);
        return files;
    }

    private setupFileWatchers() {
        const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*.*');
        
        // Ajouter une file d'attente pour les événements
        const eventQueue: Set<string> = new Set();
        let debounceTimer: NodeJS.Timeout;

        const processEventQueue = async () => {
            const paths = Array.from(eventQueue);
            eventQueue.clear();

            for (const filePath of paths) {
                if (this.shouldIgnorePath(filePath)) {
                    continue;
                }

                try {
                    const relativePath = path.relative(this.workspaceRoot, filePath);
                    // Ignorer les fichiers history.json et changes.json pour éviter les boucles
                    if (filePath.endsWith('history.json') || filePath.endsWith('changes.json')) {
                        continue;
                    }

                    const content = await fsExtra.readFile(filePath, 'utf-8');
                    await this.logChange(relativePath, {
                        lineNumber: 0,
                        content,
                        type: 'modified',
                        timestamp: Date.now(),
                        lineHistory: []
                    });
                } catch (error) {
                    // Ignorer les erreurs de lecture de fichier
                }
            }
        };

        fileWatcher.onDidChange(uri => {
            eventQueue.add(uri.fsPath);
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(processEventQueue, 1000); // Debounce 1s
        });

        // Simplifier les autres gestionnaires d'événements
        fileWatcher.onDidCreate(uri => {
            const relativePath = path.relative(this.workspaceRoot, uri.fsPath);
            if (!this.shouldIgnorePath(relativePath)) {
                this.outputChannel.appendLine(`\nNouveau fichier: ${relativePath}`);
            }
        });

        fileWatcher.onDidDelete(uri => {
            const relativePath = path.relative(this.workspaceRoot, uri.fsPath);
            if (!this.shouldIgnorePath(relativePath)) {
                this.outputChannel.appendLine(`\nFichier supprimé: ${relativePath}`);
            }
        });
    }

    private shouldIgnorePath(relativePath: string): boolean {
        const userConfig = vscode.workspace.getConfiguration('mscode');
        const ignoredPaths = userConfig.get<string[]>('ignoredPaths') || this.config.ignoredPaths;
        
        // Ajouter des patterns supplémentaires pour ignorer les fichiers de l'extension
        const additionalPatterns = [
            'history.json',
            'changes.json',
            '.git',
            '.mscode/changes',
            '.mscode/timelines'
        ];
        
        return [...ignoredPaths, ...additionalPatterns].some(pattern => 
            relativePath.includes(pattern) || minimatch(relativePath, pattern)
        );
    }

    async handleDocumentChange(
        document: vscode.TextDocument,
        changes: readonly vscode.TextDocumentContentChangeEvent[]
    ): Promise<void> {
        const relativePath = path.relative(this.workspaceRoot, document.uri.fsPath);
        
        if (this.shouldIgnorePath(relativePath)) {
            return;
        }

        // Utiliser une queue pour éviter les modifications simultanées
        const processingPromise = this.fileProcessingQueue.get(relativePath);
        if (processingPromise) {
            await processingPromise;
        }

        const newPromise = (async () => {
            try {
                await this.processDocumentChanges(document, changes);
            } catch (error) {
                Logger.error(`Erreur lors du traitement des changements: ${error}`);
            } finally {
                this.fileProcessingQueue.delete(relativePath);
            }
        })();

        this.fileProcessingQueue.set(relativePath, newPromise);
        await newPromise;
    }

    private async processDocumentChanges(
        document: vscode.TextDocument,
        changes: readonly vscode.TextDocumentContentChangeEvent[]
    ): Promise<void> {
        const relativePath = path.relative(this.workspaceRoot, document.uri.fsPath);
        
        if (this.shouldIgnorePath(relativePath)) {
            return;
        }

        this.outputChannel.appendLine(`\n=== Changements détectés dans ${relativePath} ===`);
        
        let hasSignificantChanges = false;
        
        for (const change of changes) {
            // Ignorer les changements mineurs (espaces, retours à la ligne seuls)
            if (change.text.trim() !== '' || change.rangeLength > 0) {
                hasSignificantChanges = true;
                const lines = document.getText(change.range).split('\n');
                const startLine = document.positionAt(change.rangeOffset).line;
                
                const fileChange: FileChangeLog = {
                    lineNumber: startLine,
                    content: change.text,
                    type: change.text === '' ? 'deleted' : (change.rangeLength === 0 ? 'added' : 'modified'),
                    timestamp: Date.now(),
                    lineHistory: [{
                        lineNumber: startLine,
                        content: change.text,
                        timestamp: Date.now(),
                        action: change.text === '' ? 'deleted' : (change.rangeLength === 0 ? 'added' : 'modified')
                    }]
                };

                await this.logChange(relativePath, fileChange);
            }
        }

        if (hasSignificantChanges) {
            this.modificationCount++;
            this.outputChannel.appendLine(`Modifications totales: ${this.modificationCount}/${this.AUTO_CHECKPOINT_THRESHOLD}`);
        }
    }

    private loadFileIntoCheckpoint(dirPath: string, file: string, checkpoint: CheckpointLog, timestamp: number): void {
        if (fsExtra.statSync(path.join(dirPath, file)).isDirectory()) {
            const contentPath = path.join(dirPath, file, 'content.txt');
            if (fsExtra.existsSync(contentPath)) {
                const content = fsExtra.readFileSync(contentPath, 'utf-8');
                let changes: FileChangeLog[] = [];

                const changesPath = path.join(dirPath, file, 'changes.json');
                if (fsExtra.existsSync(changesPath)) {
                    try {
                        changes = JSON.parse(fsExtra.readFileSync(changesPath, 'utf-8'));
                    } catch (error) {
                        this.outputChannel.appendLine(`Error loading changes for ${file}: ${error}`);
                    }
                }

                checkpoint.files[file] = {
                    snapshot: content,
                    changes: changes,
                    timeline: {
                        filePath: file,
                        changes: changes.flatMap(c => c.lineHistory || []),
                        snapshots: [{
                            timestamp,
                            content
                        }]
                    },
                    miniMap: {
                        points: changes.map(change => ({
                            x: 0,
                            y: 0,
                            type: this.convertChangeType(change.type),
                            timestamp: change.timestamp,
                            lineNumber: change.lineNumber
                        })),
                        startTime: timestamp,
                        endTime: timestamp,
                        filePath: file,
                        dimensions: {
                            width: 100,
                            height: 100
                        }
                    }
                };
            }
        }
    }
}

function endsWith(_arg0: string): unknown {
    throw new Error('Function not implemented.');
}
