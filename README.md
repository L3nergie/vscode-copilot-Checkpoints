# MSCode VS Code Extension

MSCode est une extension VS Code puissante qui permet de suivre et gérer les modifications de code de manière intuitive, avec une intégration de l'IA DeepSeek pour l'assistance au développement.

## Fonctionnalités Principales

### 1. Gestion des Versions
- **Système de Checkpoints**: Création automatique et manuelle de points de sauvegarde
- **Visualisation des Différences**: Interface intuitive pour comparer les versions
- **Timeline Interactive**: Historique visuel des modifications avec mini-cartes
- **Restauration Facile**: Retour rapide à n'importe quel checkpoint

### 2. Organisation des Fichiers
- **Double Vue des Fichiers**: 
  - Fichiers du projet en cours
  - Fichiers originaux trackés
- **Arborescence Interactive**: Navigation facile dans la structure du projet
- **Gestion des Modifications**: Suivi en temps réel des changements

### 3. Intégration DeepSeek AI
- **Assistant IA Intégré**: Aide contextuelle pour le développement
- **Validation de Code**: Analyse automatique des changements
- **Suggestions Intelligentes**: Recommandations basées sur les modifications

## Installation

1. Ouvrir VS Code
2. Aller dans l'onglet Extensions (Ctrl+Shift+X)
3. Rechercher "MSCode"
4. Cliquer sur Install

## Configuration

### Configuration de DeepSeek
1. Obtenir une clé API sur [DeepSeek](https://deepseek.com)
2. Dans VS Code :
   - Cliquer sur l'icône ⚙️ dans le panneau MSCode
   - Entrer votre clé API
   - La clé est stockée de manière sécurisée

### Structure des Dossiers
L'extension crée une structure `.mscode` dans votre projet :
```
.mscode/
├── original/     # Fichiers de référence
├── studio/      # Versions de travail
├── changes/     # Checkpoints
└── timelines/   # Historique détaillé
```

## Utilisation

### Gestion des Fichiers
1. **Tracker un Fichier**
   - Cliquer sur le + à côté du fichier dans la vue "Fichiers du Projet"
   - Le fichier apparaît dans "Fichiers Originaux"

2. **Créer un Checkpoint**
   - Automatique : Toutes les 5 minutes si changements
   - Manuel : Cliquer sur "Créer Checkpoint"

3. **Visualiser les Changements**
   - Cliquer sur un fichier pour voir les différences
   - La vue diff montre les versions côte à côte
   - Les modifications sont surlignées par couleur

### Utilisation de l'IA
1. **Demander de l'Aide**
   - Ouvrir le panneau DeepSeek
   - Poser une question ou demander une analyse
   - L'IA utilise le contexte de vos fichiers

2. **Validation de Code**
   - Les changements sont automatiquement analysés
   - Suggestions et problèmes potentiels affichés

### Mini-cartes et Timeline
- Visualisation temporelle des modifications
- Points colorés indiquant les types de changements
- Traçage des séquences de modifications

## Fonctionnalités Avancées

### Restauration de Versions
```
1. Ouvrir la grille des checkpoints
2. Survoler pour prévisualiser les changements
3. Cliquer sur "Restaurer" pour revenir à cette version
```

### Analyse des Modifications
- Suivi détaillé par fichier
- Statistiques de modifications
- Historique complet des actions

## Dépannage

### Problèmes Courants
1. **Checkpoints non créés**
   - Vérifier les permissions du dossier .mscode
   - S'assurer que les fichiers sont trackés

2. **DeepSeek non fonctionnel**
   - Vérifier la clé API
   - Contrôler la connexion internet

### Logs et Débogage
- Les logs sont disponibles dans la console de développement
- Les erreurs sont affichées dans l'interface

## Contribution

Le projet est open source et les contributions sont bienvenues :
- Fork le projet
- Créer une branche (`git checkout -b feature/AmazingFeature`)
- Commit les changements (`git commit -m 'Add AmazingFeature'`)
- Push la branche (`git push origin feature/AmazingFeature`)
- Ouvrir une Pull Request

## License

Distribué sous la licence MIT. Voir `LICENSE` pour plus d'informations.

## Contact

Pour toute question ou suggestion :
- GitHub Issues
- Email: support@mscode-extension.com
