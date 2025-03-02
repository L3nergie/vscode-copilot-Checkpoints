import * as vscode from 'vscode';

export interface Responsibility {
    execute(): Promise<void>;
    getName(): string;
    getDescription(): string;
    getPriority(): number;
}

export abstract class BaseResponsibility implements Responsibility {
    constructor(
        protected readonly outputChannel: vscode.OutputChannel,
        protected readonly workspaceRoot: string
    ) {}

    abstract execute(): Promise<void>;
    abstract getName(): string;
    abstract getDescription(): string;
    
    getPriority(): number {
        return 0;
    }
}
