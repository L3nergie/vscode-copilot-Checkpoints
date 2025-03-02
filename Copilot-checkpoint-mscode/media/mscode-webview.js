// @ts-nocheck
(function() {
    let vscode;
    try {
        vscode = acquireVsCodeApi();
    } catch (error) {
        console.error('Erreur lors de l\'acquisition de vscode API:', error);
        document.getElementById('checkpointGraph').innerHTML = 'Erreur de chargement de l\'extension';
        return;
    }

    let checkpointData = [];
    let diffViewOpen = false;
    
    // Notifier que le webview est prêt
    try {
        vscode.postMessage({ command: 'ready' });
        console.log('Message ready envoyé');
    } catch (error) {
        console.error('Erreur lors de l\'envoi du message ready:', error);
        vscode.postMessage({ 
            command: 'error',
            error: `Erreur d'initialisation: ${error.message}`
        });
    }
    
    // Si pas de réponse après 1 seconde, demander les checkpoints
    setTimeout(() => {
        try {
            console.log('Demande de checkpoints...');
            vscode.postMessage({ command: 'getCheckpoints' });
        } catch (error) {
            console.error('Erreur lors de la demande de checkpoints:', error);
            vscode.postMessage({ 
                command: 'error',
                error: `Erreur de chargement: ${error.message}`
            });
        }
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

        // Créer la visualisation des différences
        const diffResult = calculateDiff(original, modified);
        
        // Ajouter les statistiques
        const stats = calculateDiffStats(diffResult);
        const statsHtml = `
            <div class="diff-stats">
                <span style="color: var(--vscode-gitDecoration-addedResourceForeground)">+${stats.additions} ajouts</span> |
                <span style="color: var(--vscode-gitDecoration-deletedResourceForeground)">-${stats.deletions} suppressions</span> |
                ${stats.changes} changements au total
            </div>
        `;
        
        document.getElementById('originalContent').innerHTML = statsHtml + diffResult.originalHtml;
        document.getElementById('modifiedContent').innerHTML = statsHtml + diffResult.modifiedHtml;
        
        document.getElementById('overlay').style.display = 'block';
        document.getElementById('diffView').style.display = 'block';
    }

    function calculateDiffStats(diffResult) {
        const additions = (diffResult.modifiedHtml.match(/class="added-line"/g) || []).length;
        const deletions = (diffResult.originalHtml.match(/class="removed-line"/g) || []).length;
        
        return {
            additions,
            deletions,
            changes: additions + deletions
        };
    }

    function calculateDiff(original, modified) {
        const originalLines = original.split('\n');
        const modifiedLines = modified.split('\n');
        
        let originalLineNum = 1;
        let modifiedLineNum = 1;
        
        const originalDiff = [];
        const modifiedDiff = [];
        
        // Calculer les différences ligne par ligne
        let i = 0;
        let j = 0;
        
        while (i < originalLines.length || j < modifiedLines.length) {
            if (i < originalLines.length && j < modifiedLines.length && 
                originalLines[i] === modifiedLines[j]) {
                // Ligne inchangée
                originalDiff.push({
                    type: 'unchanged',
                    line: originalLines[i],
                    lineNum: originalLineNum++
                });
                modifiedDiff.push({
                    type: 'unchanged',
                    line: modifiedLines[j],
                    lineNum: modifiedLineNum++
                });
                i++;
                j++;
            } else {
                // Chercher la prochaine correspondance
                let nextMatchOriginal = -1;
                let nextMatchModified = -1;
                
                for (let searchAhead = 1; searchAhead < 3; searchAhead++) {
                    if (i + searchAhead < originalLines.length && 
                        j < modifiedLines.length && 
                        originalLines[i + searchAhead] === modifiedLines[j]) {
                        nextMatchOriginal = i + searchAhead;
                        break;
                    }
                    if (i < originalLines.length && 
                        j + searchAhead < modifiedLines.length && 
                        originalLines[i] === modifiedLines[j + searchAhead]) {
                        nextMatchModified = j + searchAhead;
                        break;
                    }
                }
                
                if (nextMatchOriginal !== -1) {
                    // Lignes supprimées dans l'original
                    while (i < nextMatchOriginal) {
                        originalDiff.push({
                            type: 'removed',
                            line: originalLines[i],
                            lineNum: originalLineNum++
                        });
                        modifiedDiff.push({
                            type: 'spacer',
                            line: '',
                            lineNum: null
                        });
                        i++;
                    }
                } else if (nextMatchModified !== -1) {
                    // Lignes ajoutées dans le modifié
                    while (j < nextMatchModified) {
                        originalDiff.push({
                            type: 'spacer',
                            line: '',
                            lineNum: null
                        });
                        modifiedDiff.push({
                            type: 'added',
                            line: modifiedLines[j],
                            lineNum: modifiedLineNum++
                        });
                        j++;
                    }
                } else {
                    // Pas de correspondance trouvée, marquer comme modifié
                    if (i < originalLines.length) {
                        originalDiff.push({
                            type: 'removed',
                            line: originalLines[i],
                            lineNum: originalLineNum++
                        });
                        i++;
                    }
                    if (j < modifiedLines.length) {
                        modifiedDiff.push({
                            type: 'added',
                            line: modifiedLines[j],
                            lineNum: modifiedLineNum++
                        });
                        j++;
                    }
                }
            }
        }

        // Générer le HTML avec les numéros de ligne
        const originalHtml = originalDiff.map(diff => {
            const lineNum = diff.lineNum ? `<span class="line-number">${diff.lineNum}</span>` : '';
            const className = diff.type === 'removed' ? 'removed-line' : 
                            diff.type === 'spacer' ? 'spacer-line' : 'unchanged-line';
            return `<div class="diff-line ${className}">${lineNum}${escapeHtml(diff.line)}</div>`;
        }).join('');

        const modifiedHtml = modifiedDiff.map(diff => {
            const lineNum = diff.lineNum ? `<span class="line-number">${diff.lineNum}</span>` : '';
            const className = diff.type === 'added' ? 'added-line' : 
                            diff.type === 'spacer' ? 'spacer-line' : 'unchanged-line';
            return `<div class="diff-line ${className}">${lineNum}${escapeHtml(diff.line)}</div>`;
        }).join('');

        return {
            originalHtml,
            modifiedHtml
        };
    }
    
    function closeDiffView() {
        diffViewOpen = false;
        document.getElementById('overlay').style.display = 'none';
        document.getElementById('diffView').style.display = 'none';
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
        try {
            const message = event.data;
            console.log('Message reçu:', message.command);
            
            switch (message.command) {
                case 'updateCheckpoints':
                    console.log('Mise à jour des checkpoints...', message.checkpoints?.length);
                    checkpointData = message.checkpoints || [];
                    const checkpointGraph = document.getElementById('checkpointGraph');
                    
                    if (!checkpointGraph) {
                        throw new Error('Element checkpointGraph non trouvé');
                    }
                    
                    if (!checkpointData.length) {
                        checkpointGraph.innerHTML = '<div style="padding: 20px;">Aucun checkpoint trouvé</div>';
                        return;
                    }

                    checkpointGraph.innerHTML = '';
                    const total = checkpointData.length;
                    
                    [...checkpointData].reverse().forEach((checkpoint, index) => {
                        try {
                            const node = createCheckpointNode(checkpoint, null, total - index - 1, total);
                            checkpointGraph.appendChild(node);
                        } catch (error) {
                            console.error('Erreur lors de la création du nœud:', error);
                            vscode.postMessage({ 
                                command: 'error',
                                error: `Erreur de création du nœud: ${error.message}`
                            });
                        }
                    });
                    break;
                case 'displayDiff':
                    showDiffView(message.diff.original, message.diff.modified, message.filePath);
                    break;
            }
        } catch (error) {
            console.error('Erreur lors du traitement du message:', error);
            vscode.postMessage({ 
                command: 'error',
                error: `Erreur de traitement: ${error.message}`
            });
        }
    });
    
    document.getElementById('closeDiffBtn').addEventListener('click', closeDiffView);
    document.getElementById('overlay').addEventListener('click', closeDiffView);
}());