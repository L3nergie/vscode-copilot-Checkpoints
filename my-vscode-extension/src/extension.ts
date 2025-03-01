import * as vscode from 'vscode';
import * as path from 'path';
import * as fsExtra from 'fs-extra';
import { CheckpointManager } from './checkpointManager';
import { MSCodeViewProvider } from './MSCodeViewProvider';
import { DeepSeekViewProvider } from './providers/DeepSeekViewProvider';
import { MistralViewProvider } from './providers/MistralViewProvider';
import { GeminiViewProvider } from './providers/GeminiViewProvider';
import { GroqViewProvider } from './providers/GroqViewProvider';
import { ClaudeViewProvider } from './providers/ClaudeViewProvider';
import { OpenAIViewProvider } from './providers/OpenAIViewProvider';

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

        // Initialisation des providers
        mainOutputChannel.appendLine('Initialisation des providers...');
        
        // MSCode Provider
        const mscodeProvider = new MSCodeViewProvider(context.extensionUri, checkpointManager, mainOutputChannel);
        
        // AI Providers
        const deepseekProvider = new DeepSeekViewProvider(context.extensionUri);
        const mistralProvider = new MistralViewProvider(context.extensionUri, mainOutputChannel);
        const geminiProvider = new GeminiViewProvider(context.extensionUri, mainOutputChannel);
        const groqProvider = new GroqViewProvider(context.extensionUri, mainOutputChannel);
        const claudeProvider = new ClaudeViewProvider(context.extensionUri, mainOutputChannel);
        const openaiProvider = new OpenAIViewProvider(context.extensionUri, mainOutputChannel);
        
        mainOutputChannel.appendLine('Enregistrement des providers...');
        try {
            // Enregistrement du MSCode Provider
            context.subscriptions.push(
                vscode.window.registerWebviewViewProvider(MSCodeViewProvider.viewType, mscodeProvider)
            );
            mainOutputChannel.appendLine('MSCodeViewProvider enregistre');
            
            // Enregistrement des AI Providers
            context.subscriptions.push(
                vscode.window.registerWebviewViewProvider('deepseekView', deepseekProvider),
                vscode.window.registerWebviewViewProvider(MistralViewProvider.viewType, mistralProvider),
                vscode.window.registerWebviewViewProvider(GeminiViewProvider.viewType, geminiProvider),
                vscode.window.registerWebviewViewProvider(GroqViewProvider.viewType, groqProvider),
                vscode.window.registerWebviewViewProvider(ClaudeViewProvider.viewType, claudeProvider),
                vscode.window.registerWebviewViewProvider(OpenAIViewProvider.viewType, openaiProvider)
            );
            mainOutputChannel.appendLine('AI Providers enregistres');
        } catch (error) {
            mainOutputChannel.appendLine(`ERREUR lors de l'enregistrement des providers: ${error}`);
            throw error;
        }

        // Enregistrement de la commande de rechargement
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

