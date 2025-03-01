import * as vscode from 'vscode';

export interface AIConfig {
    id: string;
    name: string;
    apiUrl: string;
    configKey: string;
    defaultUrl: string;
    icon: string;
}

export const aiProviders: AIConfig[] = [
    {
        id: 'deepseek',
        name: 'DeepSeek',
        apiUrl: 'https://api.deepseek.com/v1/chat/completions',
        configKey: 'deepseek.apiKey',
        defaultUrl: 'https://api.deepseek.com/v1/chat/completions',
        icon: '🧠'
    },
    {
        id: 'mistral',
        name: 'Mistral',
        apiUrl: 'https://api.mistral.ai/v1/chat/completions',
        configKey: 'mistral.apiKey',
        defaultUrl: 'https://api.mistral.ai/v1/chat/completions',
        icon: '🌪️'
    },
    {
        id: 'gemini',
        name: 'Gemini',
        apiUrl: 'https://generativelanguage.googleapis.com/v1/models/gemini-pro:generateContent',
        configKey: 'gemini.apiKey',
        defaultUrl: 'https://generativelanguage.googleapis.com/v1/models/gemini-pro:generateContent',
        icon: '💎'
    },
    {
        id: 'groq',
        name: 'Groq',
        apiUrl: 'https://api.groq.ai/v1/completions',
        configKey: 'groq.apiKey',
        defaultUrl: 'https://api.groq.ai/v1/completions',
        icon: '⚡'
    },
    {
        id: 'claude',
        name: 'Claude',
        apiUrl: 'https://api.anthropic.com/v1/complete',
        configKey: 'claude.apiKey',
        defaultUrl: 'https://api.anthropic.com/v1/complete',
        icon: '🎭'
    },
    {
        id: 'openai',
        name: 'OpenAI',
        apiUrl: 'https://api.openai.com/v1/chat/completions',
        configKey: 'openai.apiKey',
        defaultUrl: 'https://api.openai.com/v1/chat/completions',
        icon: '🤖'
    }
];

export function getApiConfig(id: string): AIConfig | undefined {
    return aiProviders.find(provider => provider.id === id);
}

export async function getApiKey(provider: AIConfig): Promise<string> {
    const config = vscode.workspace.getConfiguration();
    const apiKey = config.get<string>(provider.configKey);
    
    if (!apiKey || apiKey.trim() === '') {
        throw new Error(`API key not configured for ${provider.name}`);
    }
    
    return apiKey;
}