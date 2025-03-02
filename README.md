# MSCode - Extension VS Code pour la gestion de checkpoints et l'assistance IA

Une extension puissante pour les développeurs, combinant gestion intelligente des versions de code et assistance IA multi-providers.

## 🚀 Fonctionnalités principales

### Gestion avancée des checkpoints
- **Système de versioning visuel** avec code couleur :
  - 🔵 État initial
  - 🔴 Checkpoints standards
  - 🟡 Version en cours
  - 🟢 Dernière version validée
- **Comparaison visuelle** des modifications
- **Timeline interactive** des versions
- **Sauvegarde automatique** des modifications importantes
- Limite de 20 checkpoints conservés

### Assistance IA intégrée
Support natif pour les principaux providers d'IA :
- 🦊 DeepSeek - IA générative avancée
- 🇫🇷 Mistral AI - Solution française performante
- 🌐 Google Gemini - IA multimodale
- ⚡ Groq - IA ultra-rapide
- 🤖 Claude (Anthropic) - Spécialiste en analyse
- 🧠 OpenAI - GPT-4 et variantes

## 🛠 Installation

1. Ouvrir VS Code
2. Accéder aux Extensions (Ctrl+Shift+X)
3. Rechercher "MSCode"
4. Cliquer sur Installer

## ⚙ Configuration

### Configuration des providers IA
Ajoutez vos clés API dans les paramètres VS Code :
```json
{
  "deepseek.apiKey": "votre_clé",
  "mistral.apiKey": "votre_clé", 
  "gemini.apiKey": "votre_clé",
  "groq.apiKey": "votre_clé",
  "claude.apiKey": "votre_clé",
  "openai.apiKey": "votre_clé"
}
```

### Gestion des checkpoints
- Les versions sont stockées dans `.mscode/`
- Sauvegarde automatique des modifications importantes
- Interface intuitive avec panels repliables

## 📂 Structure du projet

```
my-vscode-extension/
├── src/                      # Code source principal
│   ├── config/              # Configuration des providers IA
│   ├── providers/           # Implémentations des providers
│   ├── checkpointManager/   # Gestion des versions
│   └── webviews/            # Interfaces utilisateur
├── fileicons/               # Icônes et thèmes
├── media/                   # Ressources graphiques
└── docs/                    # Documentation technique
```

## 🤝 Contribution

Les contributions sont les bienvenues ! Consultez notre [guide de contribution](CONTRIBUTING.md).

## 📄 Licence

Ce projet est sous licence MIT. Voir le fichier [LICENSE](LICENSE) pour plus de détails.
