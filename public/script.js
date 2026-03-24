let currentUser = JSON.parse(localStorage.getItem('user')) || null;

// Ao carregar a página, verifica se já está logado
window.onload = () => {
    if (currentUser) {
        showApp();
    }
};

async function login() {
    const username = document.getElementById('username-input').value;
    if (!username) return alert("Digite um nome!");

    const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username })
    });

    currentUser = await response.json();
    localStorage.setItem('user', JSON.stringify(currentUser));
    showApp();
}

function showApp() {
    document.getElementById('login-container').style.display = 'none';
    document.getElementById('app-container').style.display = 'block';
    document.getElementById('user-display').innerText = `@${currentUser.username}`;
    loadPosts();
    // Atualiza o feed a cada 5 segundos automaticamente
    setInterval(loadPosts, 5000);
}

function logout() {
    localStorage.removeItem('user');
    location.reload();
}

async function loadPosts() {
    const response = await fetch('/api/posts');
    const posts = await response.json();
    const timeline = document.getElementById('timeline');
    
    timeline.innerHTML = posts.map(post => `
        <div class="post">
            <b>@${post.username}</b>
            <p>${post.content}</p>
            <div class="post-actions">
                <button class="btn-like ${post.likes.includes(currentUser.id) ? 'liked' : ''}" 
                        onclick="likePost(${post.id})">
                    ❤️ ${post.likes.length}
                </button>
                ${post.userId === currentUser.id ? 
                    `<button class="btn-delete" onclick="deletePost(${post.id})">Excluir</button>` : ''}
            </div>
        </div>
    `).join('');
}

async function createPost() {
    const content = document.getElementById('post-input').value;
    if (!content) return;

    await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            content,
            userId: currentUser.id,
            username: currentUser.username
        })
    });

    document.getElementById('post-input').value = '';
    loadPosts();
}

async function deletePost(id) {
    await fetch(`/api/posts/${id}`, { method: 'DELETE' });
    loadPosts();
}

async function likePost(id) {
    await fetch(`/api/like/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser.id })
    });
    loadPosts();
}