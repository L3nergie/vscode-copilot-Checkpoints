import * as vscode from 'vscode';
import * as path from 'path';
import * as fsExtra from 'fs-extra';
import * as os from 'os';
import { CheckpointManager } from './checkpointManager';
import { MSCodeViewProvider } from './MSCodeViewProvider';
import { DeepSeekViewProvider } from './providers/DeepSeekViewProvider';
import { MistralViewProvider } from './providers/MistralViewProvider';
import { GeminiViewProvider } from './providers/GeminiViewProvider';
import { GroqViewProvider } from './providers/GroqViewProvider';
import { ClaudeViewProvider } from './providers/ClaudeViewProvider';
import { OpenAIViewProvider } from './providers/OpenAIViewProvider';
import { WorkspaceError } from './errors/WorkspaceError';
import { french } from './localization/fr';
import { Logger } from './utils/logger';
import { BaseAIViewProvider } from './providers/BaseAIViewProvider';
import { CheckpointConformity } from './responsibilities/CheckpointResponsibilities';
import { CorrectionResponsibility } from './responsibilities/CorrectionResponsibility';
import AdmZip from 'adm-zip';

let mainOutputChannel: vscode.OutputChannel | undefined;
let isInitialBackupCreated: boolean = false;

// Replace the dummy output channel with a proper implementation
class DummyOutputChannel implements vscode.OutputChannel {
    constructor(public readonly name: string) {}
    
    append(value: string): void { console.log(value); }
    appendLine(value: string): void { console.log(value); }
    clear(): void {}
    show(preserveFocus?: boolean): void;
    show(column?: vscode.ViewColumn, preserveFocus?: boolean): void;
    show(columnOrPreserveFocus?: vscode.ViewColumn | boolean, preserveFocus?: boolean): void {
        // Implementation that uses the parameters
        if (typeof columnOrPreserveFocus === 'boolean') {
            console.log(`Show called with preserveFocus: ${columnOrPreserveFocus}`);
        } else {
            console.log(`Show called with column: ${columnOrPreserveFocus}, preserveFocus: ${preserveFocus}`);
        }
    }
    hide(): void {}
    dispose(): void {}
    replace(value: string): void { console.log(value); }
}

function getOutputChannel(): vscode.OutputChannel {
    if (!mainOutputChannel) {
        try {
            mainOutputChannel = vscode.window.createOutputChannel('MSCode');
            Logger.init(mainOutputChannel);
        } catch (error) {
            console.error('Failed to create output channel:', error);
            // Create a proper dummy output channel that implements all required methods
            mainOutputChannel = new DummyOutputChannel('MSCode');
        }
    }
    return mainOutputChannel;
}

export async function activate(context: vscode.ExtensionContext) {
    // Replace direct output channel usage with the getter function
    const outputChannel = getOutputChannel();

    // Une seule vérification du workspace
    if (!vscode.workspace.workspaceFolders?.length) {
        throw new WorkspaceError(french.errors.workspaceRequired);
    }

    outputChannel.clear();
    outputChannel.show(true);
    outputChannel.appendLine('=== Activation de l\'extension MSCode ===');
    
    try {
        const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
        outputChannel.appendLine(`Dossier de travail: ${workspaceRoot}`);
        
        // Attendre que la structure soit prête
        await ensureWorkspaceStructure(workspaceRoot);

        // Déplacer la création du CheckpointManager ici, après la création du backup initial
        let checkpointManager: CheckpointManager;
        let mscodeProvider: MSCodeViewProvider | undefined;

        if (isInitialBackupCreated) {
            checkpointManager = new CheckpointManager(workspaceRoot, outputChannel);
            mscodeProvider = new MSCodeViewProvider(context.extensionUri, checkpointManager, outputChannel);
        } else {
            outputChannel.appendLine('Backup initial non créé, CheckpointManager non initialisé.');
            // Initialize mscodeProvider even when backup not created, to avoid errors
            checkpointManager = new CheckpointManager(workspaceRoot, outputChannel);
            mscodeProvider = new MSCodeViewProvider(context.extensionUri, checkpointManager, outputChannel);
            outputChannel.appendLine('Provider MSCode créé en mode limité.');
        }
        
        // Utiliser un événement pour l'initialisation de la vue
        let viewRegistration: vscode.Disposable | undefined;
        if (mscodeProvider) {
            viewRegistration = vscode.window.registerWebviewViewProvider(
                MSCodeViewProvider.viewType,
                mscodeProvider,
                {
                    webviewOptions: { retainContextWhenHidden: true }
                }
            );
        }

        // Gérer les changements de texte avec debounce
        let changeTimeout: NodeJS.Timeout | undefined;
        const documentChangeHandler = vscode.workspace.onDidChangeTextDocument(event => {
            if (changeTimeout) {
                clearTimeout(changeTimeout);
            }
            changeTimeout = setTimeout(() => {
                if (event.document.uri.scheme === 'file' && isInitialBackupCreated && checkpointManager) {
                    checkpointManager.handleDocumentChange(event.document, event.contentChanges);
                }
            }, 500); // Debounce de 500ms
        });

        // Cleanup handler
        context.subscriptions.push({
            dispose: () => {
                if (changeTimeout) {
                    clearTimeout(changeTimeout);
                }
                documentChangeHandler.dispose();
                viewRegistration?.dispose();
            }
        });

        // Enregistrer la vue MSCode
        if (viewRegistration) {
            context.subscriptions.push(viewRegistration);
            outputChannel.appendLine('MSCodeViewProvider enregistré');
        }

        // Attendre que VS Code soit prêt avant d'ouvrir la vue
        setTimeout(async () => {
            try {
                outputChannel.appendLine('Tentative d\'ouverture de la vue MSCode...');
                await vscode.commands.executeCommand('workbench.view.extension.mscode-sidebar');
                outputChannel.appendLine('Commande d\'ouverture de la vue exécutée');
                
                // Forcer un rafraîchissement initial
                outputChannel.appendLine('Rafraîchissement initial...');
                
                if (mscodeProvider) {
                    if (isInitialBackupCreated) {
                        await mscodeProvider.refreshCheckpoints();
                    } else {
                        outputChannel.appendLine('Backup zip non créé, rafraîchissement ignoré.');
                    }
                } else {
                    outputChannel.appendLine('ERREUR: mscodeProvider n\'est pas initialisé.');
                    vscode.window.showErrorMessage('MSCode provider not initialized. Extension may not function correctly.');
                }
             
            } catch (error) {
                outputChannel.appendLine(`Erreur lors de l'ouverture de la vue: ${error}`);
            }
        }, 1500);

        // Ajouter un écouteur d'événements pour le focus
        context.subscriptions.push(
            vscode.window.onDidChangeActiveTextEditor(() => {
                vscode.commands.executeCommand('workbench.view.extension.mscode-sidebar');
            })
        );

        // Enregistrer les providers AI
        const aiProviders = [
            { type: 'deepseekView', provider: new DeepSeekViewProvider(context.extensionUri) },
            { type: MistralViewProvider.viewType, provider: new MistralViewProvider(context.extensionUri, outputChannel) },
            { type: GeminiViewProvider.viewType, provider: new GeminiViewProvider(context.extensionUri, outputChannel) },
            { type: GroqViewProvider.viewType, provider: new GroqViewProvider(context.extensionUri, outputChannel) },
            { type: ClaudeViewProvider.viewType, provider: new ClaudeViewProvider(context.extensionUri, outputChannel) },
            { type: OpenAIViewProvider.viewType, provider: new OpenAIViewProvider(context.extensionUri, outputChannel) }
        ];

        aiProviders.forEach(({ type, provider }) => {
            const registration = vscode.window.registerWebviewViewProvider(type, provider);
            context.subscriptions.push(registration);
            outputChannel.appendLine(`Provider ${type} enregistré`);
        });

        // Ajouter un écouteur pour les changements de texte
        context.subscriptions.push(documentChangeHandler);

        // Commande de rechargement
        context.subscriptions.push(
            vscode.commands.registerCommand('mscode.reload', () => {
                outputChannel.appendLine('Rechargement de l\'extension...');
                if (mscodeProvider) {
                    if (isInitialBackupCreated) {
                        mscodeProvider.refreshCheckpoints();
                    } else {
                        outputChannel.appendLine('Backup zip non créé, rafraîchissement du provider ignoré lors du rechargement.');
                    }
                } else {
                    outputChannel.appendLine('ERREUR: mscodeProvider n\'est pas initialisé lors du rechargement.');
                }
                vscode.window.showInformationMessage('MSCode Extension rechargée');
            })
        );

        // Add type guard function
        function isBaseAIViewProvider(provider: any): provider is BaseAIViewProvider {
            return provider instanceof BaseAIViewProvider;
        }

        // Register responsibility management commands
        context.subscriptions.push(
            vscode.commands.registerCommand('mscode.manageResponsibilities', async () => {
                const provider = aiProviders.find(p => isBaseAIViewProvider(p.provider))?.provider;
                if (!provider || !isBaseAIViewProvider(provider)) {
                    Logger.error('No compatible AI provider found for managing responsibilities');
                    vscode.window.showErrorMessage('No compatible AI provider found for managing responsibilities');
                    return;
                }

                const responsibilities = [
                    new CheckpointConformity(outputChannel, workspaceRoot),
                    new CorrectionResponsibility(outputChannel, workspaceRoot),
                    // Add other responsibilities here
                ];

                const selected = await vscode.window.showQuickPick(
                    responsibilities.map(r => ({
                        label: r.getName(),
                        description: r.getDescription(),
                        responsibility: r
                    })),
                    { canPickMany: true }
                );

                if (selected) {
                    for (const item of selected) {
                        await provider.assignResponsibility(item.responsibility);
                    }
                    vscode.window.showInformationMessage('Responsibilities assigned successfully');
                }
            })
        );

        outputChannel.appendLine('Extension MSCode activée avec succès');
        vscode.window.showInformationMessage('MSCode Extension activée');
        
    } catch (error) {
        const errorMessage = `ERREUR lors de l'activation: ${error}`;
        outputChannel.appendLine(errorMessage);
        vscode.window.showErrorMessage(errorMessage);
        throw error;
    }
}

async function ensureWorkspaceStructure(workspaceRoot: string): Promise<void> {
    const dirs = [
        path.join(workspaceRoot, '.mscode'),
        path.join(workspaceRoot, '.mscode', 'changes'),
        path.join(workspaceRoot, '.mscode', 'timelines')
    ];
    
    for (const dir of dirs) {
        try {
            await fsExtra.ensureDir(dir);
            const outputChannel = getOutputChannel();
            outputChannel.appendLine(`Dossier vérifié/créé: ${dir}`);
        } catch (error) {
            const outputChannel = getOutputChannel();
            outputChannel.appendLine(`ERREUR lors de la création du dossier ${dir}: ${error}`);
            throw error;
        }
    }

    const checkpointsPath = path.join(workspaceRoot, '.mscode', 'checkpoints');
    const changesPath = path.join(workspaceRoot, '.mscode', 'changes');
    const initialBackupPath = path.join(workspaceRoot, '.mscode', 'initial-backup');
    const backupZipPath = path.join(initialBackupPath, 'initial-backup.zip');

    const checkpoints = await fsExtra.readdir(checkpointsPath).catch(() => []);
    const changes = await fsExtra.readdir(changesPath).catch(() => []);

    if (checkpoints.length === 0 && changes.length === 0) {
        if (!fsExtra.existsSync(backupZipPath)) {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "MSCode: Création du backup initial...",
                cancellable: false
            }, async (progress) => {
                progress.report({ message: "Préparation du backup..." });
                await fsExtra.ensureDir(initialBackupPath);
                try {
                    progress.report({ message: "Compression des fichiers..." });
                    await createZipArchive(workspaceRoot, backupZipPath);
                    const outputChannel = getOutputChannel();
                    outputChannel.appendLine('Initial backup created as a zip archive.');
                    progress.report({ message: "Backup créé avec succès!" });
                } catch (error) {
                    const outputChannel = getOutputChannel();
                    outputChannel.appendLine(`Erreur lors de la création du backup initial: ${error}`);
                    vscode.window.showErrorMessage(`Erreur lors de la création du backup initial: ${error}`);
                }
            });
        }
        isInitialBackupCreated = fsExtra.existsSync(backupZipPath);
    } else {
        isInitialBackupCreated = fsExtra.existsSync(backupZipPath);
    }
}

async function createZipArchive(sourceDir: string, zipFilePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        try {
            const zip = new AdmZip();
            zip.addLocalFolder(sourceDir, '', (entryPath: string) => !entryPath.includes('.mscode'));
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

export function deactivate() {
    try {
        const outputChannel = getOutputChannel();
        outputChannel.appendLine('Désactivation de l\'extension MSCode...');
        
        // Nettoyage des ressources temporaires
        const tempDir = path.join(os.tmpdir(), 'mscode');
        if (fsExtra.existsSync(tempDir)) {
            fsExtra.removeSync(tempDir);
        }
        
        outputChannel.appendLine('Extension MSCode désactivée avec succès');
    } catch (error) {
        const outputChannel = getOutputChannel();
        outputChannel.appendLine(`ERREUR lors de la désactivation: ${error}`);
        console.error('Erreur lors de la désactivation:', error);
    } finally {
        const outputChannel = getOutputChannel();
        outputChannel.dispose();
    }
}

