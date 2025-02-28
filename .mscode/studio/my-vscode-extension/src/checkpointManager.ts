import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

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
    fileTimelines: any;
    activeMiniMaps: any;

    constructor(private workspaceRoot: string) {
        this.historyFile = path.join(workspaceRoot, '.mscode', 'history.json');
        this.checkpointsDir = path.join(workspaceRoot, '.mscode', 'changes');
        this.timelineDir = path.join(workspaceRoot, '.mscode', 'timelines');
        this.ensureDirectories();
    }

    private ensureDirectories() {
        const dirs = [
            path.join(this.workspaceRoot, '.mscode'),
            this.checkpointsDir,
            this.timelineDir
        ];
        
        for (const dir of dirs) {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        }
    }

    private loadExistingTimelines() {
        if (fs.existsSync(this.timelineDir)) {
            const files = fs.readdirSync(this.timelineDir);
            for (const file of files) {
                if (file.endsWith('.timeline.json')) {
                    const filePath = file.replace('.timeline.json', '');
                    const timelinePath = path.join(this.timelineDir, file);
                    try {
                        const timeline = JSON.parse(fs.readFileSync(timelinePath, 'utf-8'));
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
        fs.writeFileSync(timelineFile, JSON.stringify(timeline, null, 2));
        this.fileTimelines.set(filePath, timeline);
    }

    private async saveTimelineSnapshot(filePath: string, change: FileChangeLog) {
        const timestamp = change.timestamp;
        const sanitizedPath = filePath.replace(/[/\\]/g, '_');
        const snapshotDir = path.join(this.timelineDir, sanitizedPath);
        
        if (!fs.existsSync(snapshotDir)) {
            fs.mkdirSync(snapshotDir, { recursive: true });
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

        fs.writeFileSync(snapshotFile, JSON.stringify(snapshot, null, 2));
    }

    private async cleanupTimestampFiles(filePath: string) {
        const sanitizedPath = filePath.replace(/[/\\]/g, '_');
        const snapshotDir = path.join(this.timelineDir, sanitizedPath);
        
        if (!fs.existsSync(snapshotDir)) return;

        const ONE_HOUR = 3600000;
        const now = Date.now();
        
        // Organiser les snapshots par heure
        const files = fs.readdirSync(snapshotDir)
            .filter(file => file.endsWith('.json'))
            .map(file => ({
                name: file,
                timestamp: parseInt(file.replace('.json', '')),
                path: path.join(snapshotDir, file)
            }))
            .sort((a, b) => a.timestamp - b.timestamp);

        // Grouper les fichiers par heure
        const hourlyGroups = new Map<number, typeof files>();
        
        for (const file of files) {
            const hourTimestamp = Math.floor(file.timestamp / ONE_HOUR) * ONE_HOUR;
            if (!hourlyGroups.has(hourTimestamp)) {
                hourlyGroups.set(hourTimestamp, []);
            }
            hourlyGroups.get(hourTimestamp)!.push(file);
        }

        // Pour chaque groupe horaire (sauf l'heure en cours)
        for (const [hourTimestamp, hourFiles] of hourlyGroups) {
            if (now - hourTimestamp > ONE_HOUR) {
                // Garder le premier et dernier changement de l'heure
                const toKeep = new Set([hourFiles[0], hourFiles[hourFiles.length - 1]]);
                
                // Garder un snapshot toutes les 5 minutes
                const FIVE_MINUTES = 300000;
                for (let i = 1; i < hourFiles.length - 1; i++) {
                    const file = hourFiles[i];
                    if ((file.timestamp - hourTimestamp) % FIVE_MINUTES === 0) {
                        toKeep.add(file);
                    }
                }

                // Supprimer les fichiers non conservés
                for (const file of hourFiles) {
                    if (!toKeep.has(file)) {
                        try {
                            fs.unlinkSync(file.path);
                        } catch (error) {
                            console.error(`Erreur lors de la suppression du fichier ${file.path}:`, error);
                        }
                    }
                }
            }
        }
    }

    private async saveModificationBatch(filePath: string, force: boolean = false) {
        const activeModification = this.activeModifications.get(filePath);
        if (!activeModification) return;

        const now = Date.now();
        const timeSinceStart = now - activeModification.startTime;

        if (force || timeSinceStart > 5000) {
            const timelineFile = this.getTimelineFilePath(filePath);
            const timelineDir = path.dirname(timelineFile);
            
            if (!fs.existsSync(timelineDir)) {
                fs.mkdirSync(timelineDir, { recursive: true });
            }

            let timeline: FileTimeline;
            if (fs.existsSync(timelineFile)) {
                timeline = JSON.parse(fs.readFileSync(timelineFile, 'utf-8'));
            } else {
                timeline = {
                    filePath,
                    changes: [],
                    snapshots: []
                };
            }

            activeModification.changes.forEach(change => {
                timeline.changes.push(...change.lineHistory);
            });

            // Lire le contenu synchrone pour éviter les problèmes de Promise
            const content = fs.readFileSync(path.join(this.workspaceRoot, filePath), 'utf-8');
            timeline.snapshots.push({
                timestamp: now,
                content
            });

            fs.writeFileSync(timelineFile, JSON.stringify(timeline, null, 2));
            this.activeModifications.delete(filePath);
        }
    }

    async logChange(filePath: string, change: FileChangeLog) {
        if (!this.activeModifications.has(filePath)) {
            this.activeModifications.set(filePath, {
                startTime: Date.now(),
                changes: [],
                miniMap: {
                    points: [],
                    startTime: Date.now(),
                    endTime: 0,
                    filePath,
                    dimensions: { width: 100, height: 100 }
                }
            });
        }

        const modification = this.activeModifications.get(filePath)!;
        modification.changes.push(change);

        // Charger le contenu de manière synchrone
        const content = fs.readFileSync(path.join(this.workspaceRoot, filePath), 'utf-8');
        
        const miniMapPoint: MiniMapPoint = {
            ...this.calculateMiniMapPoint(change, content),
            type: this.convertChangeType(change.type)
        };
        
        modification.miniMap.points.push(miniMapPoint);
    }

    async createCheckpoint(
        fileChanges: Array<{ path: string; changes: FileChangeLog[] }>,
        isAutomatic: boolean,
        description?: string
    ) {
        const timestamp = Date.now();
        const checkpointId = `checkpoint_${timestamp}`;
        const checkpointDir = path.join(this.checkpointsDir, checkpointId);
        fs.mkdirSync(checkpointDir, { recursive: true });

        const checkpoint: CheckpointLog = {
            id: checkpointId,
            timestamp,
            files: {},
            metadata: {
                description: description || `Checkpoint ${isAutomatic ? 'automatique' : 'manuel'} - ${new Date(timestamp).toLocaleString()}`,
                isAutomatic
            }
        };

        // Traiter les fichiers actifs uniquement
        for (const [filePath, modification] of this.activeModifications.entries()) {
            if (modification.changes.length === 0) continue;

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

        // Sauvegarder le checkpoint dans un seul fichier
        fs.writeFileSync(
            path.join(checkpointDir, 'checkpoint.json'),
            JSON.stringify(checkpoint, null, 2)
        );

        // Réinitialiser les modifications actives
        this.activeModifications.clear();

        // Gérer l'historique
        await this.manageHistory(checkpoint);

        return checkpoint;
    }

    private async manageHistory(newCheckpoint: CheckpointLog) {
        const historyFile = path.join(this.workspaceRoot, '.mscode', 'history.json');
        let history: CheckpointLog[] = [];

        try {
            if (fs.existsSync(historyFile)) {
                history = JSON.parse(fs.readFileSync(historyFile, 'utf-8'));
            }

            // Garder seulement les 20 derniers checkpoints
            history.push(newCheckpoint);
            if (history.length > 20) {
                const removed = history.splice(0, history.length - 20);
                // Nettoyer les anciens checkpoints
                for (const checkpoint of removed) {
                    const dir = path.join(this.checkpointsDir, checkpoint.id);
                    if (fs.existsSync(dir)) {
                        fs.rmSync(dir, { recursive: true });
                    }
                }
            }

            fs.writeFileSync(historyFile, JSON.stringify(history, null, 2));
        } catch (error) {
            console.error('Erreur lors de la gestion de l\'historique:', error);
        }
    }

    async revertToState(filePath: string, timestamp: number): Promise<boolean> {
        const timeline = this.fileTimelines.get(filePath);
        if (!timeline) return false;

        // Trouver tous les fichiers timestamp jusqu'au moment demandé
        const sanitizedPath = filePath.replace(/[/\\]/g, '_');
        const snapshotDir = path.join(this.timelineDir, sanitizedPath);
        
        if (fs.existsSync(snapshotDir)) {
            const snapshots = fs.readdirSync(snapshotDir)
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
                const snapshotData = JSON.parse(fs.readFileSync(snapshot.path, 'utf-8'));
                content = snapshotData.fullContent;
            }

            if (content) {
                const fullPath = path.join(this.workspaceRoot, filePath);
                fs.writeFileSync(fullPath, content);
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
            return fs.readFileSync(fullPath, 'utf-8');
        } catch (error) {
            console.error(`Erreur lors de la lecture du fichier ${filePath}:`, error);
            return '';
        }
    }

    private loadHistory(): CheckpointLog[] {
        try {
            const content = fs.readFileSync(this.historyFile, 'utf-8');
            return JSON.parse(content);
        } catch (error) {
            console.error('Erreur lors du chargement de l\'historique:', error);
            return [];
        }
    }

    private saveHistory(history: CheckpointLog[]) {
        try {
            fs.writeFileSync(this.historyFile, JSON.stringify(history, null, 2));
        } catch (error) {
            console.error('Erreur lors de la sauvegarde de l\'historique:', error);
        }
    }

    async getCheckpointDetails(checkpointId: string): Promise<CheckpointLog | null> {
        const history = this.loadHistory();
        return history.find(cp => cp.id === checkpointId) || null;
    }

    async getAllCheckpoints(): Promise<CheckpointLog[]> {
        return this.loadHistory();
    }

    async getFileHistory(filePath: string): Promise<Array<{ checkpoint: CheckpointLog; changes: FileChangeLog[] }>> {
        const history = this.loadHistory();
        return history
            .filter(cp => cp.files[filePath])
            .map(cp => ({
                checkpoint: cp,
                changes: cp.files[filePath].changes
            }));
    }

    async reconstructHistory(filePath: string, fromTimestamp: number, toTimestamp: number) {
        const sanitizedPath = filePath.replace(/[/\\]/g, '_');
        const snapshotDir = path.join(this.timelineDir, sanitizedPath);
        
        if (!fs.existsSync(snapshotDir)) {
            return null;
        }

        const snapshots = fs.readdirSync(snapshotDir)
            .filter(file => file.endsWith('.json'))
            .map(file => {
                const timestamp = parseInt(file.replace('.json', ''));
                return {
                    timestamp,
                    path: path.join(snapshotDir, file),
                    data: JSON.parse(fs.readFileSync(path.join(snapshotDir, file), 'utf-8'))
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

        if (fs.existsSync(snapshotDir)) {
            const files = fs.readdirSync(snapshotDir)
                .filter(file => file.endsWith('.json'))
                .sort((a, b) => {
                    const timeA = parseInt(a.replace('.json', ''));
                    const timeB = parseInt(b.replace('.json', ''));
                    return timeA - timeB;
                });

            for (const file of files) {
                const timestamp = parseInt(file.replace('.json', ''));
                const data = JSON.parse(fs.readFileSync(path.join(snapshotDir, file), 'utf-8'));
                
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
                width: 100,  // Largeur de base de la mini-map
                height: 100  // Hauteur de base de la mini-map
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

    private calculateMiniMapPoint(change: FileChangeLog, fileContent: string): MiniMapPoint {
        const lines = fileContent.split('\n');
        const totalLines = lines.length;
        
        const y = Math.floor((change.lineNumber / totalLines) * 100);
        const line = lines[change.lineNumber] || '';
        const indentation = line.search(/\S/);
        const x = Math.floor((indentation / 50) * 100);

        return {
            x,
            y,
            type: this.convertChangeType(change.type),
            timestamp: change.timestamp,
            lineNumber: change.lineNumber
        };
    }

    async getCurrentMiniMap(filePath: string): Promise<MiniMapData | null> {
        return this.activeModifications.get(filePath)?.miniMap || null;
    }
}