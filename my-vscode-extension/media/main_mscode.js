(function () {
    const vscode = acquireVsCodeApi();
    let checkpointData = [];
    let diffViewOpen = false;
    let currentCheckpoint = null;

    vscode.postMessage({ command: 'ready' });

    setTimeout(() => {
        vscode.postMessage({ command: 'getCheckpoints' });
    }, 1000);

    function handleDiffClick(checkpointId, filePath) {
        console.log('Requesting diff:', { checkpointId, filePath });
        vscode.postMessage({
            command: 'showDiff',
            checkpointId,
            filePath
        });
    }

    function togglePanel(header) {
        header.classList.toggle('open');
        header.nextElementSibling.classList.toggle('open');
    }

    function handleDelete(checkpointId) {
        if (confirm('Are you sure you want to delete this checkpoint?')) {
            vscode.postMessage({
                command: 'deleteCheckpoint',
                checkpointId
            });
        }
    }

    function handleRestore(checkpointId) {
        vscode.postMessage({
            command: 'restoreCheckpoint',
            checkpointId
        });
    }

    function createCheckpointNode(checkpoint, checkpointFile, isLatest) {
        console.log('Creating node for checkpoint:', checkpoint.id);
        const node = document.createElement('div');
        node.className = 'checkpoint-node';
        node.setAttribute('data-checkpoint-id', checkpoint.id);

        const isCurrentCheckpoint = checkpoint.id === currentCheckpoint;

        const header = document.createElement('div');
        header.className = 'checkpoint-header';
        header.onclick = () => {
            header.classList.toggle('open');
            content.classList.toggle('open');
        };

        // Dot indicator (bleu) en premier
        const dot = document.createElement('div');
        dot.className = `node-dot ${isCurrentCheckpoint ? 'active' : ''}`;
        dot.onclick = (e) => {
            e.stopPropagation();
            handleCheckpointClick(checkpoint.id);
        };
        header.appendChild(dot);

        // Meta info container (pour la date et le badge Latest)
        const meta = document.createElement('div');
        meta.className = 'node-meta';

        // Timestamp d'abord
        const time = document.createElement('span');
        time.className = 'node-time';
        time.textContent = new Date(checkpoint.timestamp).toLocaleString();
        meta.appendChild(time);

        // Badge Latest après la date
        if (isLatest) {
            const badge = document.createElement('span');
            badge.className = 'latest-badge';
            badge.textContent = 'Latest';
            meta.appendChild(badge);
        }

        // Ajouter meta container après le dot indicator
        header.appendChild(meta);

        // Delete button
        if (!checkpoint.metadata.isOfficial && !checkpoint.metadata.isWorkingCopy) {
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-btn';
            deleteBtn.textContent = '×';
            deleteBtn.title = 'Delete checkpoint';
            deleteBtn.onclick = (e) => {
                e.stopPropagation();
                if (confirm('Are you sure you want to delete this checkpoint?')) {
                    console.log('Deleting checkpoint:', checkpoint.id);
                    vscode.postMessage({
                        command: 'deleteCheckpoint',
                        checkpointId: checkpoint.id
                    });
                }
            };
            header.appendChild(deleteBtn);
        }

        // Content container
        const content = document.createElement('div');
        content.className = 'checkpoint-content';

        // Description
        const description = document.createElement('div');
        description.className = 'checkpoint-description';
        description.textContent = checkpoint.metadata.description;
        content.appendChild(description);

        // Files list
        const filesList = document.createElement('div');
        filesList.className = 'files-list';

        Object.keys(checkpoint.files).forEach(filePath => {
            const fileItem = document.createElement('div');
            fileItem.className = 'file-item';

            fileItem.innerHTML = getFileIcon(filePath);

            const fileName = document.createElement('span');
            fileName.textContent = filePath;
            fileItem.appendChild(fileName);

            const viewDiffIcon = document.createElement('div');
            viewDiffIcon.className = 'view-diff-icon';
            viewDiffIcon.innerHTML = '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M15 4h-3V3l-1-1H9L8 3v1H5L4 5v3h1v4l1 1h3v1l1 1h2l1-1v-1h3l1-1V5l-1-1zM9 3h2v1H9V3zm2 11H9v-1h2v1zm4-3h-3v1L11 13H9l-1-1v-1H5V6h3V5l1-1h2l1 1v1h3v6z"/></svg>';
            viewDiffIcon.onclick = (e) => {
                e.stopPropagation();
                console.log('Requesting diff for:', { checkpointId: checkpoint.id, filePath });
                vscode.postMessage({
                    command: 'showDiff',
                    checkpointId: checkpoint.id,
                    filePath
                });
            };

            fileItem.appendChild(viewDiffIcon);
            filesList.appendChild(fileItem);
        });

        content.appendChild(filesList);
        node.appendChild(header);
        node.appendChild(content);

        return node;
    }

    function showDiffView(original, modified, fileName) {
        console.log('Showing diff view for:', fileName);
        if (diffViewOpen) {
            console.log('Diff view already open, skipping');
            return;
        }

        diffViewOpen = true;
        document.getElementById('diffTitle').textContent = 'Changes in ' + fileName;

        console.log('Original content length:', original.length);
        console.log('Modified content length:', modified.length);

        const originalLines = document.getElementById('originalContent');
        const modifiedLines = document.getElementById('modifiedContent');

        originalLines.innerHTML = '<h3>Original Version:</h3><pre>' +
            highlightDiff(original, modified) + '</pre>';
        modifiedLines.innerHTML = '<h3>Modified Version:</h3><pre>' +
            highlightDiff(modified, original) + '</pre>';

        document.getElementById('overlay').style.display = 'block';
        document.getElementById('diffView').style.display = 'block';

        console.log('Diff view opened');
    }

    function closeDiffView() {
        console.log('Closing diff view');
        diffViewOpen = false;
        document.getElementById('overlay').style.display = 'none';
        document.getElementById('diffView').style.display = 'none';
    }

    function highlightDiff(text1, text2) {
        // Pour l'instant, retourner le texte brut
        // TODO: Implémenter la coloration des différences
        return text1;
    }

    function showTab(tabName) {
        document.querySelectorAll('.tab').forEach(tab => {
            tab.classList.remove('active');
        });
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
        });

        document.querySelector(`.tab[onclick="showTab('${tabName}')"]`).classList.add('active');
        document.getElementById(tabName).classList.add('active');

        // Mettre à jour l'historique des changements si nécessaire
        if (tabName === 'changes') {
            vscode.postMessage({ command: 'refreshChangesHistory' });
        }
    }

    function getFileIcon(filePath) {
        if (filePath.startsWith('my-vscode-extension/')) {
            return '<svg class="file-icon folder-icon" viewBox="0 0 16 16"><path fill="currentColor" d="M14.5 3H7.71l-.85-.85L6.51 2h-5l-.5.5v11l.5.5h13l.5-.5v-10L14.5 3zm-.51 11h-12V3h4.29l.85.85L7.49 4h6.5v10z"/></svg>';
        }
        return '<svg class="file-icon" viewBox="0 0 16 16"><path fill="currentColor" d="M13.71 4.29l-3-3L10 1H4L3 2v12l1 1h9l1-1V5l-.29-.71zM13 14H4V2h5v4h4v8z"/></svg>';
    }

    function handleCheckpointClick(checkpointId) {
        console.log('Activating checkpoint:', checkpointId);
        // Restaurer le checkpoint
        vscode.postMessage({
            command: 'restoreCheckpoint',
            checkpointId: checkpointId
        });

        // Mettre à jour l'indicateur visuel
        document.querySelectorAll('.node-dot').forEach(dot => {
            dot.classList.remove('active');
        });
        document.querySelector(`[data-checkpoint-id="\${checkpointId}"] .node-dot`).classList.add('active');
        currentCheckpoint = checkpointId;
    }

    // Handler pour créer un sous-checkpoint
    function createSubCheckpoint(parentId) {
        console.log('Creating sub-checkpoint for:', parentId);
        const description = prompt('Description for the sub-checkpoint:');
        if (description) {
            vscode.postMessage({
                command: 'createSubCheckpoint',
                parentId,
                description
            });
        }
    }

    window.handleCheckpointClick = handleCheckpointClick;
    window.createSubCheckpoint = createSubCheckpoint;
    window.togglePanel = function (header) {
        header.classList.toggle('open');
        header.nextElementSibling.classList.toggle('open');
    };

    window.showTab = function (tabName) {
        document.querySelectorAll('.tab').forEach(tab => {
            tab.classList.remove('active');
        });
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
        });

        document.querySelector(`.tab[onclick="showTab('${tabName}')"]`).classList.add('active');
        document.getElementById(tabName).classList.add('active');

        if (tabName === 'changes') {
            vscode.postMessage({ command: 'refreshChangesHistory' });
        }
    };

    window.addEventListener('message', event => {
        const message = event.data;
        console.log('Message received:', message.command);

        switch (message.command) {
            case 'updateCheckpoints':
                console.log('Updating checkpoints:', message.checkpoints.length);
                const graph = document.getElementById('checkpointGraph');
                graph.innerHTML = '';

                if (message.checkpoints && message.checkpoints.length > 0) {
                    checkpointData = message.checkpoints;
                    const checkpoints = message.checkpoints.sort((a, b) => b.timestamp - a.timestamp);
                    const checkpointFiles = new Map(
                        message.checkpointFiles.map(cf => [cf.id, cf])
                    );

                    console.log('Creating checkpoint nodes...');
                    checkpoints.forEach((checkpoint, index) => {
                        const checkpointFile = checkpointFiles.get(checkpoint.id);
                        const node = createCheckpointNode(checkpoint, checkpointFile, index === 0);
                        graph.appendChild(node);
                    });
                    console.log('Checkpoint nodes created');
                } else {
                    console.log('No checkpoints to display');
                    graph.innerHTML = '<div style="padding: 20px;">No checkpoints available</div>';
                }
                break;

            case 'displayDiff':
                console.log('Received diff data:', {
                    filePath: message.filePath,
                    originalLength: message.diff.original.length,
                    modifiedLength: message.diff.modified.length
                });
                showDiffView(message.diff.original, message.diff.modified, message.filePath);
                break;

            case 'updateChangesHistory':
                console.log('Updating changes history:', message.changes.length);
                const changesHistory = document.getElementById('changesHistory');
                changesHistory.innerHTML = '';

                if (message.changes && message.changes.length > 0) {
                    // Grouper par fichier
                    const fileChanges = new Map();
                    message.changes.forEach(change => {
                        change.files.forEach(file => {
                            if (!fileChanges.has(file.path)) {
                                fileChanges.set(file.path, []);
                            }
                            fileChanges.get(file.path).push({
                                changeId: change.id,
                                timestamp: change.timestamp,
                                description: change.description,
                                changesCount: file.changesCount
                            });
                        });
                    });

                    // Créer les sections par fichier
                    fileChanges.forEach((changes, filePath) => {
                        const fileSection = document.createElement('div');
                        fileSection.className = 'file-history-section';

                        const fileHeader = document.createElement('div');
                        fileHeader.className = 'file-header';
                        fileHeader.innerHTML = `
                                            ${getFileIcon(filePath)}
                                            <span class="file-path">${filePath}</span>
                                            <span class="changes-count">${changes.length} versions</span>
                                        `;

                        const changesList = document.createElement('div');
                        changesList.className = 'changes-list';

                        changes.sort((a, b) => b.timestamp - a.timestamp)
                            .forEach(change => {
                                const changeEntry = document.createElement('div');
                                changeEntry.className = 'change-entry';
                                changeEntry.innerHTML = `
                                                    <div class="change-meta">
                                                        <span class="change-time">${new Date(change.timestamp).toLocaleString()}</span>
                                                        <span class="change-desc">${change.description}</span>
                                                    </div>
                                                    <div class="change-actions">
                                                        <span class="changes-count">${change.changesCount} modifications</span>
                                                        <div class="view-diff-icon" const const onclick="handleDiffClick('${change.changeId}', '${filePath}')">
                                                            <svg viewBox="0 0 16 16">
                                                                <path fill="currentColor" const const d="M15 4h-3V3l-1-1H9L8 3v1H5L4 5v3h1v4l1 1h3v1l1 1h2l1-1v-1h3l1-1V5l-1-1zM9 3h2v1H9V3zm2 11H9v-1h2v1zm4-3h-3v1L11 13H9l-1-1v-1H5V6h3V5l1-1h2l1 1v1h3v6z"/>
                                                            </svg>
                                                        </div>
                                                    </div>
                                                `;
                                changesList.appendChild(changeEntry);
                            });

                        fileSection.appendChild(fileHeader);
                        fileSection.appendChild(changesList);
                        changesHistory.appendChild(fileSection);
                    });
                } else {
                    changesHistory.innerHTML = '<div class="no-changes">Aucun historique de changements disponible</div>';
                }
                break;
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            console.log('Escape key pressed, closing diff view');
            closeDiffView();
        }
    });

    document.getElementById('overlay').addEventListener('click', () => {
        console.log('Overlay clicked, closing diff view');
        closeDiffView();
    });
})();