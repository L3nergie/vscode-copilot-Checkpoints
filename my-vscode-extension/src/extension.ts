import * as vscode from 'vscode';
import * as path from 'path';
import * as fsExtra from 'fs-extra';
import { CheckpointManager } from './checkpointManager';
import { MSCodeViewProvider } from './MSCodeViewProvider';
import { DeepSeekViewProvider } from './DeepSeekViewProvider';

// Création d'un canal de sortie unique pour les logs
export const mainOutputChannel = vscode.window.createOutputChannel('MSCode');

export function activate(context: vscode.ExtensionContext) {
    try {
        mainOutputChannel.appendLine('=== Activation de l\'extension MSCode ===');
        mainOutputChannel.show(true);
        
        let checkpointManager: CheckpointManager | null = null;
        
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
            mainOutputChannel.appendLine(`Dossier de travail: ${workspaceRoot}`);
            
            try {
                const mscodeDir = path.join(workspaceRoot, '.mscode');
                if (!fsExtra.existsSync(mscodeDir)) {
                    mainOutputChannel.appendLine('Creation du dossier .mscode');
                    fsExtra.mkdirpSync(mscodeDir);
                }
                checkpointManager = new CheckpointManager(workspaceRoot, mainOutputChannel);
                mainOutputChannel.appendLine('CheckpointManager initialise');
            } catch (error) {
                mainOutputChannel.appendLine(`ERREUR lors de l'initialisation du CheckpointManager: ${error}`);
                throw error;
            }
        }

        mainOutputChannel.appendLine('Creation du MSCodeViewProvider...');
        const mscodeProvider = new MSCodeViewProvider(context.extensionUri, checkpointManager, mainOutputChannel);
        mainOutputChannel.appendLine('MSCodeViewProvider cree');
        
        mainOutputChannel.appendLine('Creation du DeepSeekViewProvider...');
        const deepseekProvider = new DeepSeekViewProvider(context.extensionUri);
        mainOutputChannel.appendLine('DeepSeekViewProvider cree');
        
        mainOutputChannel.appendLine('Enregistrement des providers...');
        try {
            context.subscriptions.push(
                vscode.window.registerWebviewViewProvider(MSCodeViewProvider.viewType, mscodeProvider)
            );
            mainOutputChannel.appendLine('MSCodeViewProvider enregistre');
            
            context.subscriptions.push(
                vscode.window.registerWebviewViewProvider('deepseekView', deepseekProvider)
            );
            mainOutputChannel.appendLine('DeepSeekViewProvider enregistre');
        } catch (error) {
            mainOutputChannel.appendLine(`ERREUR lors de l'enregistrement des providers: ${error}`);
            throw error;
        }

        // Enregistrer la commande de rechargement
        context.subscriptions.push(
            vscode.commands.registerCommand('mscode.reload', () => {
                mainOutputChannel.appendLine('Rechargement de l\'extension...');
                if (checkpointManager) {
                    mainOutputChannel.appendLine('Rafraichissement des checkpoints...');
                    mscodeProvider.refreshCheckpoints();
                }
                mainOutputChannel.appendLine('Extension rechargee');
            })
        );

        mainOutputChannel.appendLine('Extension MSCode activee avec succes.');
        mainOutputChannel.show();
    } catch (error) {
        mainOutputChannel.appendLine(`ERREUR FATALE lors de l'activation de l'extension: ${error}`);
        mainOutputChannel.show();
        throw error;
    }
}

export function deactivate() {
    try {
        mainOutputChannel.appendLine('Extension MSCode desactivee.');
    } catch (error) {
        console.error('Erreur lors de la désactivation:', error);
    }
}

