// @ts-nocheck
(function() {
    const vscode = acquireVsCodeApi();
    let checkpointData = [];
    let diffViewOpen = false;
    
    // Notifier que le webview est prêt
    vscode.postMessage({ command: 'ready' });
    
    // Si pas de réponse après 1 seconde, demander les checkpoints
    setTimeout(() => {
        vscode.postMessage({ command: 'getCheckpoints' });
    }, 1000);
    
    function createCheckpointNode(checkpoint, checkpointFile, index, total) {
        console.log('Creating node for checkpoint:', checkpoint.id);
        const node = document.createElement('div');
        node.className = 'checkpoint-node collapsed';
        
        // Ajouter la classe appropriée selon le statut
        if (checkpoint.metadata.isInitialState) {
            node.classList.add('initial-state'); // État initial (bleu)
        } else if (index === total - 1) {
            node.classList.add('latest'); // Dernier checkpoint (vert)
        } else if (checkpoint.metadata.isAutomatic && checkpoint.metadata.description.includes('Current')) {
            node.classList.add('current'); // Checkpoint courant (jaune)
        } else {
            node.classList.add('standard'); // Checkpoints standards (rouge)
        }

        const dot = document.createElement('div');
        dot.className = 'node-dot';
        
        const content = document.createElement('div');
        content.className = 'node-content';
        
        // Créer l'en-tête cliquable
        const header = document.createElement('div');
        header.className = 'node-header';
        header.style.display = 'flex';
        header.style.alignItems = 'center';
        header.style.cursor = 'pointer';
        
        const time = document.createElement('span');
        time.className = 'node-time';
        time.textContent = new Date(checkpoint.timestamp).toLocaleString();
        header.appendChild(time);
        
        if (index === total - 1) {
            const badge = document.createElement('span');
            badge.className = 'latest-badge';
            badge.textContent = 'Latest';
            header.appendChild(badge);
        }
        
        // Ajouter un écouteur d'événements pour le clic sur l'en-tête
        header.addEventListener('click', () => {
            node.classList.toggle('collapsed');
        });
        
        // Créer le conteneur pour le contenu détaillé
        const detailsContent = document.createElement('div');
        detailsContent.className = 'node-details';
        
        const description = document.createElement('div');
        description.className = 'node-description';
        description.textContent = checkpoint.metadata.description;
        
        const files = document.createElement('div');
        files.className = 'file-changes';
        const fileCount = Object.keys(checkpoint.files).length;
        const filesList = document.createElement('div');
        filesList.style.marginTop = '4px';
        
        Object.keys(checkpoint.files).forEach(filePath => {
            const fileItem = document.createElement('div');
            fileItem.className = 'file-item';
            fileItem.textContent = filePath;
            
            const viewDiffIcon = document.createElement('span');
            viewDiffIcon.className = 'view-diff-icon';
            viewDiffIcon.innerHTML = '&#128269;';
            viewDiffIcon.title = 'Voir les différences';
            viewDiffIcon.onclick = (e) => {
                e.stopPropagation();
                vscode.postMessage({
                    command: 'showDiff',
                    checkpointId: checkpoint.id,
                    filePath: filePath
                });
            };
            
            fileItem.appendChild(viewDiffIcon);
            filesList.appendChild(fileItem);
        });
        
        files.textContent = `${fileCount} fichier${fileCount !== 1 ? 's' : ''} modifié${fileCount !== 1 ? 's' : ''}`;
        files.appendChild(filesList);
        
        if (checkpointFile) {
            const pathInfo = document.createElement('div');
            pathInfo.style.fontSize = '0.8em';
            pathInfo.style.color = 'var(--vscode-descriptionForeground)';
            pathInfo.textContent = `Path: .mscode/changes/${checkpointFile.id}`;
            files.appendChild(pathInfo);
        }
        
        // N'ajouter le bouton restore que si ce n'est pas le dernier checkpoint
        if (index !== total - 1) {
            const restoreBtn = document.createElement('button');
            restoreBtn.className = 'restore-btn';
            restoreBtn.textContent = 'Restore this version';
            restoreBtn.onclick = (e) => {
                e.stopPropagation();
                vscode.postMessage({
                    command: 'restoreCheckpoint',
                    checkpointId: checkpoint.id
                });
            };
            detailsContent.appendChild(restoreBtn);
        }
        
        // Créer l'en-tête avec le bouton de suppression
        const headerContainer = document.createElement('div');
        headerContainer.className = 'node-header-container';
        headerContainer.style.display = 'flex';
        headerContainer.style.justifyContent = 'space-between';
        headerContainer.style.alignItems = 'center';
        headerContainer.style.width = '100%';
        
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-btn';
        deleteBtn.textContent = '×';
        deleteBtn.title = 'Delete this checkpoint';
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            showNodeConfirmationDialog(node, checkpoint.id);
        };
        
        // Ajouter le bouton de suppression à l'en-tête des détails
        headerContainer.appendChild(description);
        headerContainer.appendChild(deleteBtn);
        detailsContent.appendChild(headerContainer);
        
        detailsContent.appendChild(description);
        detailsContent.appendChild(files);
        
        content.appendChild(header);
        content.appendChild(detailsContent);
        
        node.appendChild(dot);
        node.appendChild(content);
        
        return node;
    }
    
    function showNodeConfirmationDialog(node, checkpointId) {
        // Supprimer toute boîte de dialogue existante dans ce nœud
        const existingDialog = node.querySelector('.confirmation-dialog');
        if (existingDialog) {
            existingDialog.remove();
            return;
        }
        
        const dialog = document.createElement('div');
        dialog.className = 'confirmation-dialog';
        
        const title = document.createElement('div');
        title.className = 'title';
        title.textContent = 'Supprimer le checkpoint';
        
        const message = document.createElement('div');
        message.className = 'message';
        message.textContent = 'Êtes-vous sûr de vouloir supprimer ce checkpoint ? Cette action est irréversible.';
        
        const buttons = document.createElement('div');
        buttons.className = 'buttons';
        
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'cancel';
        cancelBtn.textContent = 'Annuler';
        cancelBtn.onclick = () => {
            dialog.remove();
        };
        
        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'confirm';
        confirmBtn.textContent = 'Supprimer';
        confirmBtn.onclick = () => {
            vscode.postMessage({
                command: 'deleteCheckpoint',
                checkpointId: checkpointId
            });
            dialog.remove();
        };
        
        buttons.appendChild(cancelBtn);
        buttons.appendChild(confirmBtn);
        
        dialog.appendChild(title);
        dialog.appendChild(message);
        dialog.appendChild(buttons);
        
        // Insérer la boîte de dialogue après l'en-tête dans les détails
        const detailsContent = node.querySelector('.node-details');
        if (detailsContent) {
            detailsContent.insertBefore(dialog, detailsContent.firstChild);
        }
    }
    
    function showDiffView(original, modified, fileName) {
        if (diffViewOpen) return;
        
        diffViewOpen = true;
        document.getElementById('diffFileName').textContent = fileName;
        document.getElementById('originalContent').innerHTML = highlightDiff(original, modified, true);
        document.getElementById('modifiedContent').innerHTML = highlightDiff(modified, original, false);
        document.getElementById('overlay').style.display = 'block';
        document.getElementById('diffView').style.display = 'block';
    }
    
    function closeDiffView() {
        diffViewOpen = false;
        document.getElementById('overlay').style.display = 'none';
        document.getElementById('diffView').style.display = 'none';
    }

    function highlightDiff(text1, text2, isOriginal = true) {
        const lines1 = text1.split('\n');
        const lines2 = text2.split('\n');
        let result = '';
        
        const longerLength = Math.max(lines1.length, lines2.length);
        
        for (let i = 0; i < longerLength; i++) {
            const line1 = i < lines1.length ? lines1[i] : '';
            const line2 = i < lines2.length ? lines2[i] : '';
            
            if (line1 === line2) {
                result += `<div class="unchanged-line">${escapeHtml(line1)}</div>`;
            } else if (isOriginal) {
                result += `<div class="removed-line">${escapeHtml(line1)}</div>`;
            } else {
                result += `<div class="added-line">${escapeHtml(line1)}</div>`;
            }
        }
        
        return result;
    }
    
    function escapeHtml(unsafe) {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
    
    window.addEventListener('message', event => {
        const message = event.data;
        switch (message.command) {
            case 'updateCheckpoints':
                checkpointData = message.checkpoints;
                const checkpointGraph = document.getElementById('checkpointGraph');
                checkpointGraph.innerHTML = '';
                const total = message.checkpoints.length;
                message.checkpoints.forEach((checkpoint, index) => {
                    const checkpointFile = message.checkpointFiles.find(file => file.id === checkpoint.id);
                    const node = createCheckpointNode(checkpoint, checkpointFile, index, total);
                    checkpointGraph.appendChild(node);
                });
                break;
            case 'displayDiff':
                showDiffView(message.diff.original, message.diff.modified, message.filePath);
                break;
        }
    });
    
    document.getElementById('closeDiffBtn').addEventListener('click', closeDiffView);
    document.getElementById('overlay').addEventListener('click', closeDiffView);
}());