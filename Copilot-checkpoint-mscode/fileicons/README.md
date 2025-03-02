# Configuration des Icônes MSCode

## Aperçu
Ce dossier contient la configuration du thème d'icônes de l'extension MSCode.

## Fichiers
- `mscode-icon-theme.json` : Configuration principale du thème d'icônes
- `codicon.ttf` : Police d'icônes Codicon de VS Code

## Utilisation des Icônes

### Dans les Webviews
```html
<i class="codicon codicon-file"></i>
<i class="codicon codicon-folder"></i>
```

### Dans l'Interface
Les icônes sont automatiquement appliquées via le thème configuré dans `mscode-icon-theme.json`.

## Personnalisation

Pour ajouter de nouvelles icônes :
1. Ajouter la définition dans `mscode-icon-theme.json`
2. Utiliser les caractères Codicon appropriés
3. Configurer les associations de fichiers

## Caractères Codicon Courants

- File: \ea7b
- Folder: \ea83
- Git: \ea68
- Settings: \eb51
- Check: \eab2
- Warning: \ea6c

## Dépendances
- @vscode/codicons : Fournit la police d'icônes
- Mise à jour automatique via npm