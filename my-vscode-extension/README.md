# MSCode Extension

Une extension VS Code puissante pour gérer l'historique de vos modifications de code avec des checkpoints intelligents et une assistance AI via plusieurs fournisseurs d'IA.

## Fonctionnalités

### 🔄 Gestion des Checkpoints
- État initial (bleu) : sauvegarde du projet au démarrage
- Checkpoints standards (rouge) : versions intermédiaires
- Checkpoint actuel (jaune) : modifications en cours
- Dernier checkpoint (vert) : version la plus récente
- Visualisation des différences entre versions
- Interface de gestion intuitive avec panels repliables

### 🤖 Assistants IA Intégrés
- DeepSeek : IA générative avancée
- Mistral AI : IA française performante
- Google Gemini : IA multimodale de Google
- Groq : IA ultra-rapide
- Claude (Anthropic) : IA spécialisée en analyse
- OpenAI : GPT-4 et ses variantes

### 📊 Interface Utilisateur
- Vue en arbre des checkpoints avec codes couleur
- Comparaison visuelle des modifications
- Timeline interactive
- Gestion intuitive des fichiers
- Panels repliables pour une meilleure organisation

## Installation

1. Ouvrez VS Code
2. Allez dans la vue Extensions (Ctrl+Shift+X)
3. Recherchez "MSCode"
4. Cliquez sur Installer

## Configuration

### Configuration des APIs IA

Configurez vos clés API dans les paramètres VS Code :
- DeepSeek : `deepseek.apiKey`
- Mistral : `mistral.apiKey`
- Gemini : `gemini.apiKey`
- Groq : `groq.apiKey`
- Claude : `claude.apiKey`
- OpenAI : `openai.apiKey`

### Configuration des Checkpoints

Les checkpoints sont sauvegardés dans le dossier `.mscode` avec :
- État initial du projet (bleu)
- Historique des modifications
- Maximum 20 checkpoints conservés
- Sauvegarde automatique des modifications importantes

## Utilisation

### Gestion des Checkpoints

- **État Initial (Bleu)** : Version de départ du projet
- **Checkpoints Standards (Rouge)** : Versions intermédiaires
- **Version Courante (Jaune)** : Modifications en cours
- **Dernière Version (Vert)** : État le plus récent

### Fonctionnalités

- Panels repliables pour une meilleure organisation
- Bouton de suppression intégré dans chaque panel
- Confirmation de suppression dans le panel
- Visualisation des différences entre versions
- Restauration vers une version précédente

## Structure du Projet

\`\`\`
my-vscode-extension/
├── src/                      # Code source
│   ├── config/              # Configuration des providers IA
│   ├── providers/           # Providers pour chaque IA
│   ├── checkpointManager/   # Gestion des checkpoints
│   └── webviews/           # Interfaces utilisateur
├── fileicons/               # Icônes et thèmes
├── media/                   # Ressources médias
└── docs/                    # Documentation détaillée
\`\`\`

## Contribution

Les contributions sont les bienvenues ! Consultez notre guide de contribution dans `CONTRIBUTING.md`.

## Licence

Ce projet est sous licence MIT. Voir le fichier `LICENSE` pour plus de détails.