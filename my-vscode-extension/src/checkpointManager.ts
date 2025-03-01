import * as vscode from 'vscode';
import * as path from 'path';
import * as fsExtra from 'fs-extra';
import { minimatch } from 'minimatch';

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
            if (files.length > 100) {
                const filesToRemove = files.slice(0, files.length - 100);
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
        const activeModification = this.activeModifications.get(filePath);
        if (!activeModification) return;

        const now = Date.now();
        const timeSinceStart = now - activeModification.startTime;

        if (force || timeSinceStart > 5000) {
            const timelineFile = this.getTimelineFilePath(filePath);
            const timelineDir = path.dirname(timelineFile);
            
            try {
                if (!fsExtra.existsSync(timelineDir)) {
                    fsExtra.mkdirpSync(timelineDir);
                }

                let timeline: FileTimeline;
                if (fsExtra.existsSync(timelineFile)) {
                    timeline = JSON.parse(fsExtra.readFileSync(timelineFile, 'utf-8'));
                    // Éviter la duplication des changements
                    const lastSnapshot = timeline.snapshots[timeline.snapshots.length - 1];
                    if (lastSnapshot && lastSnapshot.timestamp === now) {
                        this.outputChannel.appendLine(`Ignorer la sauvegarde en double pour ${filePath}`);
                        return;
                    }
                } else {
                    timeline = {
                        filePath,
                        changes: [],
                        snapshots: []
                    };
                }

                // Limiter le nombre de snapshots à 100 maximum
                if (timeline.snapshots.length >= 100) {
                    timeline.snapshots = timeline.snapshots.slice(-99);
                }

                const content = fsExtra.readFileSync(path.join(this.workspaceRoot, filePath), 'utf-8');
                
                // Ne sauvegarder que si le contenu a changé
                const lastContent = timeline.snapshots[timeline.snapshots.length - 1]?.content;
                if (content !== lastContent) {
                    timeline.snapshots.push({
                        timestamp: now,
                        content
                    });

                    fsExtra.writeFileSync(timelineFile, JSON.stringify(timeline, null, 2));
                    this.outputChannel.appendLine(`Timeline sauvegardée pour ${filePath} (${timeline.snapshots.length} snapshots)`);
                } else {
                    this.outputChannel.appendLine(`Pas de changement de contenu pour ${filePath}`);
                }
            } catch (error) {
                this.outputChannel.appendLine(`Erreur lors de la sauvegarde: ${error}`);
            } finally {
                this.activeModifications.delete(filePath);
            }
        }
    }

    async logChange(filePath: string, change: FileChangeLog): Promise<void> {
        this.outputChannel.appendLine(`\n=== Changement détecté dans ${filePath} ===`);
        this.outputChannel.appendLine(`Type: ${change.type}`);
        this.outputChannel.appendLine(`Ligne: ${change.lineNumber}`);
        this.outputChannel.appendLine(`Contenu: ${change.content.substring(0, 50)}${change.content.length > 50 ? '...' : ''}`);
        
        if (!this.activeModifications.has(filePath)) {
            this.outputChannel.appendLine('Première modification pour ce fichier, initialisation...');
            this.activeModifications.set(filePath, {
                startTime: Date.now(),
                changes: [],
                miniMap: this.initializeMiniMap(filePath)
            });
        }

        const modification = this.activeModifications.get(filePath)!;
        modification.changes.push(change);

        this.outputChannel.appendLine(`Nombre total de changements: ${modification.changes.length}`);
        
        const content = fsExtra.readFileSync(path.join(this.workspaceRoot, filePath), 'utf-8');
        
        const miniMapPoint: MiniMapPoint = {
            ...this.calculateMiniMapPoint(change, content),
            type: this.convertChangeType(change.type)
        };
        
        modification.miniMap.points.push(miniMapPoint);
        this.outputChannel.appendLine(`Point ajouté à la minimap: (${miniMapPoint.x}, ${miniMapPoint.y})`);

        await this.saveModificationBatch(filePath, false);
    }

    async createCheckpoint(
        fileChanges: Array<{ path: string; changes: FileChangeLog[] }>,
        isAutomatic: boolean,
        description?: string
    ): Promise<CheckpointLog> {
        this.outputChannel.appendLine('\n=== Création d\'un nouveau checkpoint ===');
        this.outputChannel.appendLine(`Type: ${isAutomatic ? 'Automatique' : 'Manuel'}`);
        if (description) {
            this.outputChannel.appendLine(`Description: ${description}`);
        }

        const timestamp = Date.now();
        const checkpointId = `checkpoint_${timestamp}`;
        this.outputChannel.appendLine(`ID: ${checkpointId}`);
        
        const checkpointDir = path.join(this.checkpointsDir, checkpointId);
        await fsExtra.mkdirp(checkpointDir);
        this.outputChannel.appendLine(`Dossier créé: ${checkpointDir}`);

        const checkpoint: CheckpointLog = {
            id: checkpointId,
            timestamp,
            files: {},
            metadata: {
                description: description || `Checkpoint ${isAutomatic ? 'automatique' : 'manuel'} - ${new Date(timestamp).toLocaleString()}`,
                isAutomatic
            }
        };

        this.outputChannel.appendLine('\nFichiers modifiés:');
        for (const [filePath, modification] of this.activeModifications.entries()) {
            if (modification.changes.length === 0) continue;

            this.outputChannel.appendLine(`- ${filePath} (${modification.changes.length} changements)`);
            const currentContent = await this.getCurrentFileContent(filePath);
            modification.miniMap.endTime = timestamp;

            checkpoint.files[filePath] = {
                changes: modification.changes,
                snapshot: currentContent,
                timeline: {
                    filePath,
                    changes: modification.changes.flatMap(c => c.lineHistory),
                    snapshots: [{
                        timestamp,
                        content: currentContent
                    }]
                },
                miniMap: modification.miniMap
            };
        }

        const checkpointPath = path.join(checkpointDir, 'checkpoint.json');
        await fsExtra.writeFile(
            checkpointPath,
            JSON.stringify(checkpoint, null, 2)
        );
        this.outputChannel.appendLine(`\nCheckpoint sauvegardé: ${checkpointPath}`);

        this.outputChannel.appendLine('Réinitialisation des modifications actives');
        this.activeModifications.clear();

        await this.manageHistory(checkpoint);
        this.outputChannel.appendLine('Historique mis à jour\n');

        return checkpoint;
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
            return fsExtra.readFileSync(fullPath, 'utf-8');
        } catch (error) {
            this.outputChannel.appendLine(`Erreur lors de la lecture du fichier ${filePath}: ${error}`);
            return '';
        }
    }

    private loadHistory(): CheckpointLog[] {
        this.outputChannel.appendLine('Chargement de l\'historique...');
        try {
            // Si le fichier history n'existe pas encore, chercher directement dans le dossier changes
            if (!fsExtra.existsSync(this.historyFile)) {
                this.outputChannel.appendLine('Fichier history.json non trouvé, lecture directe des checkpoints...');
                const checkpoints: CheckpointLog[] = [];
                if (fsExtra.existsSync(this.checkpointsDir)) {
                    const dirs = fsExtra.readdirSync(this.checkpointsDir)
                        .filter(dir => fsExtra.statSync(path.join(this.checkpointsDir, dir)).isDirectory());
                    
                    this.outputChannel.appendLine(`${dirs.length} dossiers de checkpoints trouvés`);
                    
                    for (const dir of dirs) {
                        const checkpointPath = path.join(this.checkpointsDir, dir, 'checkpoint.json');
                        this.outputChannel.appendLine(`Lecture du checkpoint: ${checkpointPath}`);
                        if (fsExtra.existsSync(checkpointPath)) {
                            try {
                                const checkpoint = JSON.parse(fsExtra.readFileSync(checkpointPath, 'utf-8'));
                                checkpoints.push(checkpoint);
                                this.outputChannel.appendLine(`Checkpoint ${dir} chargé avec succès`);
                            } catch (error) {
                                this.outputChannel.appendLine(`ERREUR lors de la lecture du checkpoint ${dir}: ${error}`);
                            }
                        }
                    }
                    // Sauvegarder l'historique pour la prochaine fois
                    this.saveHistory(checkpoints);
                    this.outputChannel.appendLine(`${checkpoints.length} checkpoints sauvegardés dans history.json`);
                }
                return checkpoints;
            }
            
            // Lecture normale du fichier history.json
            this.outputChannel.appendLine('Lecture du fichier history.json');
            const content = fsExtra.readFileSync(this.historyFile, 'utf-8');
            const history = JSON.parse(content);
            this.outputChannel.appendLine(`${history.length} checkpoints chargés depuis history.json`);
            return history;
        } catch (error) {
            this.outputChannel.appendLine(`ERREUR lors du chargement de l'historique: ${error}`);
            return [];
        }
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
                    .filter(file => file.endsWith('.json'))
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
            
            // Créer un checkpoint initial
            const timestamp = Date.now();
            const checkpointId = 'initial_state';
            const files: Record<string, any> = {};
            
            // Sauvegarder l'état de tous les fichiers du projet
            const allFiles = await this.getAllProjectFiles();
            for (const filePath of allFiles) {
                try {
                    const content = await fsExtra.readFile(path.join(this.workspaceRoot, filePath), 'utf-8');
                    files[filePath] = {
                        snapshot: content,
                        timeline: {
                            filePath,
                            changes: [],
                            snapshots: [{
                                timestamp,
                                content
                            }]
                        }
                    };
                } catch (error) {
                    this.outputChannel.appendLine(`Erreur lors de la sauvegarde de ${filePath}: ${error}`);
                }
            }
            
            // Créer le checkpoint initial
            const initialCheckpoint: CheckpointLog = {
                id: checkpointId,
                timestamp,
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
}