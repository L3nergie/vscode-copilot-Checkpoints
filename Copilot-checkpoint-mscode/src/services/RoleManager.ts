import * as vscode from 'vscode';
import { Logger } from '../utils/logger';

export interface AssistantRole {
    name: string;
    description: string;
    permissions: Array<'read' | 'write' | 'execute' | 'manage'>;
}

export class RoleManager {
    private static instance: RoleManager;
    private roles: Map<string, AssistantRole> = new Map();
    private assistantRoles: Map<string, Set<string>> = new Map();

    private constructor() {
        this.loadRoles();
    }

    public static getInstance(): RoleManager {
        if (!RoleManager.instance) {
            RoleManager.instance = new RoleManager();
        }
        return RoleManager.instance;
    }

    private loadRoles() {
        try {
            Logger.info('Loading roles configuration...');
            const config = vscode.workspace.getConfiguration('mscode.assistants');
            const roles = config.get<AssistantRole[]>('roles') || [];
            
            if (roles.length === 0) {
                Logger.warn('No roles found in configuration, loading defaults...');
                this.loadDefaultRoles();
            } else {
                roles.forEach(role => {
                    this.roles.set(role.name, role);
                    Logger.info(`Loaded role: ${role.name} with permissions: ${role.permissions.join(', ')}`);
                });
            }
        } catch (error) {
            Logger.error(`Error loading roles: ${error}`);
            this.loadDefaultRoles();
        }
        
        Logger.info(`Total roles loaded: ${this.roles.size}`);
    }

    private loadDefaultRoles() {
        const defaultRoles: AssistantRole[] = [
            {
                name: "Correcteur",
                description: "Corrige et améliore le code",
                permissions: ["read", "write"]
            },
            {
                name: "Traducteur",
                description: "Traduit les commentaires et la documentation",
                permissions: ["read", "write"]
            },
            {
                name: "Administrateur",
                description: "Gère tous les aspects des checkpoints",
                permissions: ["read", "write", "execute", "manage"]
            }
        ];

        defaultRoles.forEach(role => {
            this.roles.set(role.name, role);
            Logger.info(`Loaded default role: ${role.name}`);
        });
    }

    public assignRole(assistantId: string, roleName: string): boolean {
        if (!this.roles.has(roleName)) {
            Logger.error(`Role ${roleName} does not exist`);
            return false;
        }

        if (!this.assistantRoles.has(assistantId)) {
            this.assistantRoles.set(assistantId, new Set());
        }

        this.assistantRoles.get(assistantId)?.add(roleName);
        Logger.info(`Assigned role ${roleName} to assistant ${assistantId}`);
        return true;
    }

    public getAssistantRoles(assistantId: string): AssistantRole[] {
        const roleNames = this.assistantRoles.get(assistantId) || new Set();
        return Array.from(roleNames)
            .map(name => this.roles.get(name))
            .filter((role): role is AssistantRole => role !== undefined);
    }

    public hasPermission(assistantId: string, permission: string): boolean {
        const roles = this.getAssistantRoles(assistantId);
        return roles.some(role => role.permissions.includes(permission as any));
    }
}
