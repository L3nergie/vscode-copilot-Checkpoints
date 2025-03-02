import * as vscode from 'vscode';

export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3
}

export class Logger {
    private static channel: vscode.OutputChannel;
    private static logLevel: LogLevel = LogLevel.INFO;

    static init(channel: vscode.OutputChannel) {
        this.channel = channel;
    }

    static setLevel(level: LogLevel) {
        this.logLevel = level;
    }

    private static log(level: LogLevel, message: string) {
        if (level >= this.logLevel) {
            const timestamp = new Date().toISOString();
            const prefix = LogLevel[level].padEnd(5);
            this.channel.appendLine(`[${timestamp}] ${prefix} - ${message}`);
        }
    }

    static debug(message: string) { this.log(LogLevel.DEBUG, message); }
    static info(message: string) { this.log(LogLevel.INFO, message); }
    static warn(message: string) { this.log(LogLevel.WARN, message); }
    static error(message: string) { this.log(LogLevel.ERROR, message); }

    static logError(error: any, context: string) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : new Error().stack;
        
        this.error(`[${context}] ${errorMessage}`);
        this.debug(`Stack trace: ${stack}`);
        
        // Log to VS Code's console for debugging
        console.error(`[MSCode ${context}]`, error);
    }

    static async logAuthError(error: any) {
        this.error('=== Authentication Error ===');
        this.error(`Time: ${new Date().toISOString()}`);
        this.error(`Message: ${error.message || error}`);
        
        if (error.response) {
            this.error(`Status: ${error.response.status}`);
            this.error(`Headers: ${JSON.stringify(error.response.headers, null, 2)}`);
            this.error(`Data: ${JSON.stringify(error.response.data, null, 2)}`);
        }
        
        if (error.config) {
            this.error('Request Configuration:');
            this.error(`URL: ${error.config.url}`);
            this.error(`Method: ${error.config.method}`);
            this.error(`Headers: ${JSON.stringify(error.config.headers, null, 2)}`);
        }
        
        if (error.stack) {
            this.debug(`Stack trace: ${error.stack}`);
        }
    }
}
