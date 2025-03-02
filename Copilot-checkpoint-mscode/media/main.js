const vscode = acquireVsCodeApi();
let currentCheckpoint = null;

function handleCheckpointClick(checkpointId) {
    vscode.postMessage({
        command: 'restoreCheckpoint',
        checkpointId
    });
    
    document.querySelectorAll('.node-dot').forEach(dot => {
        dot.classList.remove('active');
    });
    document.querySelector(`[data-checkpoint-id="${checkpointId}"] .node-dot`).classList.add('active');
    currentCheckpoint = checkpointId;
}

function createCheckpointNode(checkpoint, isLatest) {
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

    const dot = document.createElement('div');
    dot.className = `node-dot ${isCurrentCheckpoint ? 'active' : ''}`;
    dot.onclick = (e) => {
        e.stopPropagation();
        handleCheckpointClick(checkpoint.id);
    };
    header.appendChild(dot);

    const meta = document.createElement('div');
    meta.className = 'node-meta';
    
    const time = document.createElement('span');
    time.className = 'node-time';
    time.textContent = new Date(checkpoint.timestamp).toLocaleString();
    meta.appendChild(time);

    if (isLatest) {
        const badge = document.createElement('span');
        badge.className = 'latest-badge';
        badge.textContent = 'Latest';
        meta.appendChild(badge);
    }

    header.appendChild(meta);
    node.appendChild(header);

    const content = document.createElement('div');
    content.className = 'checkpoint-content';
    content.innerHTML = `
        <div class="checkpoint-description">${checkpoint.metadata.description}</div>
        <div class="files-list">
            ${Object.keys(checkpoint.files).map(filePath => `
                <div class="file-item">
                    ${getFileIcon(filePath)}
                    <span>${filePath}</span>
                    <button class="view-diff-btn" onclick="showDiff('${checkpoint.id}', '${filePath}')">
                        View Changes
                    </button>
                </div>
            `).join('')}
        </div>
    `;
    
    node.appendChild(content);
    return node;
}

function getFileIcon(filePath) {
    if (filePath.startsWith('my-vscode-extension/')) {
        return '<svg class="file-icon folder-icon" viewBox="0 0 16 16"><path fill="currentColor" d="M14.5 3H7.71l-.85-.85L6.51 2h-5l-.5.5v11l.5.5h13l.5-.5v-10L14.5 3zm-.51 11h-12V3h4.29l.85.85L7.49 4h6.5v10z"/></svg>';
    }
    return '<svg class="file-icon" viewBox="0 0 16 16"><path fill="currentColor" d="M13.71 4.29l-3-3L10 1H4L3 2v12l1 1h9l1-1V5l-.29-.71zM13 14H4V2h5v4h4v8z"/></svg>';
}

window.showTab = function(tabName) {
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

window.showDiff = function(checkpointId, filePath) {
    vscode.postMessage({
        command: 'showDiff',
        checkpointId,
        filePath
    });
};

// Écouter les messages du serveur
window.addEventListener('message', event => {
    const message = event.data;
    
    switch (message.command) {
        case 'updateCheckpoints':
            const graph = document.getElementById('checkpointGraph');
            graph.innerHTML = '';
            
            if (message.checkpoints && message.checkpoints.length > 0) {
                message.checkpoints
                    .sort((a, b) => b.timestamp - a.timestamp)
                    .forEach((checkpoint, index) => {
                        graph.appendChild(createCheckpointNode(checkpoint, index === 0));
                    });
            } else {
                graph.innerHTML = '<div class="no-checkpoints">No checkpoints available</div>';
            }
            break;
            
        case 'updateChangesHistory':
            // TODO: Implémenter l'affichage de l'historique des changements
            break;
    }
});

// Initialiser au chargement
vscode.postMessage({ command: 'ready' });

(function() {
    const vscode = acquireVsCodeApi();
    const messagesContainer = document.getElementById('messages');
    const userInput = document.getElementById('userInput');
    const sendButton = document.getElementById('sendButton');
    let isProcessing = false;

    // Ajuster automatiquement la hauteur du textarea
    userInput.addEventListener('input', () => {
        userInput.style.height = 'auto';
        userInput.style.height = (userInput.scrollHeight) + 'px';
    });

    // Envoyer le message avec Enter (Shift+Enter pour nouvelle ligne)
    userInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    sendButton.addEventListener('click', () => sendMessage());

    function sendMessage() {
        const message = userInput.value.trim();
        if (!message || isProcessing) return;

        // Ajouter le message de l'utilisateur
        addMessage(message, 'user');
        
        // Réinitialiser l'input
        userInput.value = '';
        userInput.style.height = 'auto';
        
        // Montrer l'indicateur de frappe
        showTypingIndicator();
        
        // Désactiver l'input pendant le traitement
        isProcessing = true;
        userInput.disabled = true;
        sendButton.disabled = true;

        // Envoyer au backend
        vscode.postMessage({
            command: 'sendMessage',
            text: message
        });
    }

    function addMessage(content, role) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${role}`;
        
        const messageContent = document.createElement('div');
        messageContent.className = 'message-content';
        
        // Traitement du code dans le message
        const parts = content.split(/(```[\s\S]*?```)/g);
        parts.forEach(part => {
            if (part.startsWith('```') && part.endsWith('```')) {
                // C'est un bloc de code
                const code = part.slice(3, -3);
                const codeBlock = document.createElement('pre');
                codeBlock.className = 'code-block';
                codeBlock.textContent = code;
                messageContent.appendChild(codeBlock);
            } else {
                // C'est du texte normal
                const textNode = document.createElement('span');
                textNode.textContent = part;
                messageContent.appendChild(textNode);
            }
        });

        messageDiv.appendChild(messageContent);
        messagesContainer.appendChild(messageDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    function showTypingIndicator() {
        const typingDiv = document.createElement('div');
        typingDiv.className = 'typing-indicator';
        typingDiv.id = 'typingIndicator';
        
        for (let i = 0; i < 3; i++) {
            const dot = document.createElement('div');
            dot.className = 'typing-dot';
            typingDiv.appendChild(dot);
        }
        
        messagesContainer.appendChild(typingDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    function removeTypingIndicator() {
        const typingIndicator = document.getElementById('typingIndicator');
        if (typingIndicator) {
            typingIndicator.remove();
        }
    }

    // Gestionnaire de messages du backend
    window.addEventListener('message', event => {
        const message = event.data;

        switch (message.command) {
            case 'response':
                removeTypingIndicator();
                addMessage(message.text, 'assistant');
                isProcessing = false;
                userInput.disabled = false;
                sendButton.disabled = false;
                break;
                
            case 'error':
                removeTypingIndicator();
                addMessage(`Erreur: ${message.text}`, 'error');
                isProcessing = false;
                userInput.disabled = false;
                sendButton.disabled = false;
                break;
        }
    });
})();