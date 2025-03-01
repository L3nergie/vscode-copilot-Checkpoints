# Ressources Média MSCode

## Organisation

### Icônes
- `icon.svg` : Icône principale de l'extension
- `panel-icon.svg` : Icône pour les panneaux de vue
- `send.svg` : Icône pour le bouton d'envoi

### Fichiers HTML
- `index.html` : Template principal de webview
- `index_mscode.html` : Template spécifique au panneau MSCode

### Styles
- `style.css` : Styles de base partagés
- `style_mscode.css` : Styles spécifiques à MSCode

### JavaScript
- `main.js` : Scripts de base partagés
- `main_mscode.js` : Scripts spécifiques à MSCode

## Bonnes Pratiques

### Sécurité des Webviews
- Utilisez toujours `nonce` pour les scripts
- Limitez les ressources aux `localResourceRoots`
- Validez les messages entre webview et extension

### Performance
- Optimisez les images SVG
- Minimisez les fichiers CSS/JS en production
- Utilisez des classes CSS plutôt que des styles inline

### Thèmes VS Code
Vos styles doivent utiliser les variables de thème VS Code :
```css
:root {
    --vscode-editor-background
    --vscode-editor-foreground
    --vscode-button-background
    ...
}
```

### Mise à jour des Ressources
1. Ajoutez les nouveaux fichiers dans ce dossier
2. Référencez-les dans les webviews via `vscode.Uri`
3. Documentez leur utilisation ici
4. Assurez-vous qu'ils sont inclus dans `.vscodeignore`