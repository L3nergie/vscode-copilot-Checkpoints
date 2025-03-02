import * as vscode from 'vscode';
import { BaseResponsibility } from './types';
import { Logger } from '../utils/logger';

export class CorrectionResponsibility extends BaseResponsibility {
    async execute(): Promise<void> {
        try {
            Logger.info('Exécution de la correction/traduction...');
            const config = vscode.workspace.getConfiguration('mscode.correction');
            const targetLanguage = config.get<string>('targetLanguage') || 'fr';
            const autoCorrect = config.get<boolean>('autoCorrect') || false;
            const autoCorrectionDelay = config.get<number>('autoCorrectionDelay') || 1000;

            if (autoCorrect) {
                // Logique de correction automatique
                Logger.info(`Correction automatique activée (délai: ${autoCorrectionDelay}ms)`);
                await this.correctActiveDocument(targetLanguage);
            }
        } catch (error) {
            Logger.error(`Erreur lors de la correction: ${error}`);
            throw error;
        }
    }

    private async correctActiveDocument(targetLanguage: string): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const document = editor.document;
        const text = document.getText();
        
        // Extract comments and strings
        const commentRegex = /\/\/.*$|\/\*[\s\S]*?\*\//gm;
        const comments = Array.from(text.matchAll(commentRegex));
        
        // Process each comment
        for (const match of comments) {
            const comment = match[0];
            const startPos = document.positionAt(match.index!);
            const endPos = document.positionAt(match.index! + comment.length);
            const range = new vscode.Range(startPos, endPos);

            // Translate/correct the comment based on target language
            const correctedComment = await this.translateText(comment, targetLanguage);
            
            if (correctedComment && correctedComment !== comment) {
                // Apply the correction
                await editor.edit(editBuilder => {
                    editBuilder.replace(range, correctedComment);
                });
                Logger.info(`Corrected comment from "${comment}" to "${correctedComment}"`);
            }
        }

        // Apply custom correction rules
        const config = vscode.workspace.getConfiguration('mscode.correction');
        const rules = config.get<Array<{ pattern: string; replacement: string }>>('correctionRules') || [];
        
        for (const rule of rules) {
            const regex = new RegExp(rule.pattern, 'g');
            const matches = Array.from(text.matchAll(regex));
            
            for (const match of matches) {
                const startPos = document.positionAt(match.index!);
                const endPos = document.positionAt(match.index! + match[0].length);
                const range = new vscode.Range(startPos, endPos);
                
                await editor.edit(editBuilder => {
                    editBuilder.replace(range, rule.replacement);
                });
                Logger.info(`Applied correction rule: ${rule.pattern} -> ${rule.replacement}`);
            }
        }
    }

    private async translateText(text: string, targetLanguage: string): Promise<string> {
        // Remove comment symbols and trim
        const cleanText = text.replace(/\/\*|\*\/|\/\//g, '').trim();
        
        // Simple mapping for common code terms
        const translations: Record<string, Record<string, string>> = {
            'fr': {
                'function': 'fonction',
                'return': 'retourne',
                'if': 'si',
                'else': 'sinon',
                'for': 'pour',
                'while': 'tant que',
                'TODO': 'À FAIRE',
                'FIXME': 'À CORRIGER',
                'NOTE': 'NOTE',
            }
        };

        if (!translations[targetLanguage]) {
            return text;
        }

        let translatedText = cleanText;
        for (const [en, translated] of Object.entries(translations[targetLanguage])) {
            const regex = new RegExp(`\\b${en}\\b`, 'gi');
            translatedText = translatedText.replace(regex, translated);
        }

        // Preserve the original comment style
        if (text.startsWith('//')) {
            return `// ${translatedText}`;
        } else if (text.startsWith('/*')) {
            return `/* ${translatedText} */`;
        }

        return translatedText;
    }

    getName(): string {
        return "Correction et Traduction";
    }

    getDescription(): string {
        return "Corrige et traduit automatiquement le code et les commentaires";
    }

    getPriority(): number {
        return 2;
    }
}
