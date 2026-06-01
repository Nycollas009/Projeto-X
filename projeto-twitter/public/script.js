
//  Tiwitter SOCIAL — script.js (v2 — fixed)

console.log('🚀 Tiwitter Social v2 — Carregando...');

const API_URL = 'https://meu-twitter-projeto-x.onrender.com';

let currentUser        = null;
let ws                 = null;
let currentView        = 'home';
let currentConversation= null;
let viewingUserId      = null;
let savedPosts         = JSON.parse(localStorage.getItem('savedPosts') || '[]');
let currentImageFile   = null;
let currentFeedTab     = 'for-you';
let allPosts           = [];
let unreadNotificationsCount = 0;
let sidebarExpanded    = false;

// ════════════════════════════════════════
//  DOM READY
// ════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
    console.log('📱 DOM Carregado');

    const saved = localStorage.getItem('user');
    if (saved) {
        try {
            currentUser = JSON.parse(saved);
            showApp();
        } catch (e) {
            localStorage.removeItem('user');
        }
    }

    setupEventListeners();
    setupCharCounter();
    setupImageUpload();
});

// ════════════════════════════════════════
//  EVENT LISTENERS
// ════════════════════════════════════════
function setupEventListeners() {
    // Login
    document.getElementById('login-btn')?.addEventListener('click', login);
    document.getElementById('username')?.addEventListener('keypress', e => { if (e.key === 'Enter') login(); });
    document.getElementById('password')?.addEventListener('keypress', e => { if (e.key === 'Enter') login(); });

    // Show/hide password toggle
    document.getElementById('toggle-password')?.addEventListener('click', togglePassword);

    // Nav
    document.querySelectorAll('.nav-item[data-page]').forEach(item => {
        item.addEventListener('click', () => navigateTo(item.dataset.page));
    });

    document.getElementById('settings-btn')?.addEventListener('click', openSettingsModal);
    document.getElementById('logout-btn')?.addEventListener('click', logout);
    document.getElementById('sidebar-user-info')?.addEventListener('click', () => navigateTo('profile'));

    // macOS dock toggle
    document.getElementById('dock-toggle')?.addEventListener('click', toggleSidebar);

    // Post
    document.getElementById('create-post-btn')?.addEventListener('click', createPost);

    // Search
    document.getElementById('main-search')?.addEventListener('input', debounce(searchUsers, 300));

    // Modal
    document.querySelector('.close-modal')?.addEventListener('click', () => {
        document.getElementById('image-modal')?.classList.remove('active');
    });
    document.getElementById('image-modal')?.addEventListener('click', e => {
        if (e.target === document.getElementById('image-modal'))
            document.getElementById('image-modal').classList.remove('active');
    });

    // Feed tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFeedTab = btn.dataset.tab;
            filterAndDisplayPosts();
        });
    });
}

// ════════════════════════════════════════
//  AVATAR PADRÃO COM INICIAIS (UI Avatars)
// ════════════════════════════════════════

// Função para gerar URL do avatar com as iniciais do usuário
function gerarAvatarComIniciais(nome) {
    if (!nome || nome.trim() === '') {
        nome = 'Usuario';
    }
    // Pega as primeiras letras de cada parte do nome (máx 2 letras)
    const iniciais = nome.split(' ')
        .map(palavra => palavra[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
    
    // Se não conseguiu iniciais, usa 'U'
    const letras = iniciais || 'U';
    
    // Retorna URL da API com iniciais e fundo aleatório
    return `https://ui-avatars.com/api/?name=${letras}&background=1da1f2&color=fff&bold=true&size=128&rounded=true&length=2`;
}

// Avatar padrão fixo (fallback caso a API falhe)
const AVATAR_PADRAO_FIXO = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 24 24" fill="%23999"%3E%3Cpath d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/%3E%3C/svg%3E';

// Função principal para obter a URL do avatar
function getAvatarUrl(avatarUrl, username = '') {
    // Se o usuário já tem uma foto personalizada, usa ela
    if (avatarUrl && avatarUrl.trim() !== '' && avatarUrl !== 'null' && avatarUrl !== 'undefined') {
        return avatarUrl;
    }
    
    // Se não tem foto, gera avatar com as iniciais do nome
    if (username) {
        return gerarAvatarComIniciais(username);
    }
    
    // Fallback: avatar SVG puro
    return AVATAR_PADRAO_FIXO;
}

// Função para tratar erro de carregamento da imagem
function handleImageError(imgElement, username = '') {
    if (imgElement.src !== AVATAR_PADRAO_FIXO) {
        // Tenta gerar avatar com iniciais
        if (username) {
            imgElement.src = gerarAvatarComIniciais(username);
        } else {
            imgElement.src = AVATAR_PADRAO_FIXO;
        }
        imgElement.onerror = null;
    }
}
// WHEATER API

async function loadWeather() {
    const container = document.getElementById('weather-info');
    if (!container) return;

    if (!navigator.geolocation) {
        container.innerHTML = '<p style="color:var(--text-muted);font-size:0.82rem;">Geolocalização não suportada</p>';
        return;
    }

    navigator.geolocation.getCurrentPosition(async (pos) => {
        try {
            const { latitude, longitude } = pos.coords;
            const res  = await fetch(`${API_URL}/weather?lat=${latitude}&lon=${longitude}`);
            const data = await res.json();

            const icone     = `https://openweathermap.org/img/wn/${data.weather[0].icon}@2x.png`;
            const temp      = Math.round(data.main.temp);
            const sensacao  = Math.round(data.main.feels_like);
            const descricao = data.weather[0].description;
            const cidade    = data.name;
            const umidade   = data.main.humidity;
            const vento     = Math.round(data.wind.speed * 3.6); // m/s para km/h

            container.innerHTML = `
                <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
                    <img src="${icone}" style="width:56px;height:56px;" alt="clima">
                    <div>
                        <div style="font-size:1.8rem;font-weight:800;font-family:var(--font-mono);">${temp}°C</div>
                        <div style="font-size:0.8rem;color:var(--text-secondary);text-transform:capitalize;">${descricao}</div>
                    </div>
                </div>
                <div style="font-size:0.85rem;font-weight:600;margin-bottom:10px;">
                    <i class="fas fa-map-marker-alt" style="color:var(--primary);"></i> ${cidade}
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                    <div class="stat-card">
                        <span class="stat-value" style="font-size:1rem;">${sensacao}°</span>
                        <span class="stat-label">Sensação</span>
                    </div>
                    <div class="stat-card">
                        <span class="stat-value" style="font-size:1rem;">${umidade}%</span>
                        <span class="stat-label">Umidade</span>
                    </div>
                    <div class="stat-card" style="grid-column:span 2;">
                        <span class="stat-value" style="font-size:1rem;">${vento} km/h</span>
                        <span class="stat-label">Vento</span>
                    </div>
                </div>
            `;
        } catch {
            container.innerHTML = '<p style="color:var(--text-muted);font-size:0.82rem;">Erro ao carregar clima</p>';
        }
    }, () => {
        container.innerHTML = '<p style="color:var(--text-muted);font-size:0.82rem;">Permita acesso à localização</p>';
    });
}


// ════════════════════════════════════════
//  macOS DOCK TOGGLE
// ════════════════════════════════════════
function toggleSidebar() {
    sidebarExpanded = !sidebarExpanded;
    const nav  = document.getElementById('sidebar-nav');
    const main = document.getElementById('main-content');
    nav.classList.toggle('expanded', sidebarExpanded);
    main.classList.toggle('sidebar-expanded', sidebarExpanded);

    const icon = document.querySelector('#dock-toggle i');
    if (icon) {
        icon.style.transform = sidebarExpanded ? 'rotate(180deg)' : 'rotate(0deg)';
    }
}

// ════════════════════════════════════════
//  CHAR COUNTER
// ════════════════════════════════════════
function setupCharCounter() {
    const input = document.getElementById('post-input');
    const counter = document.getElementById('char-count');
    if (!input || !counter) return;

    input.addEventListener('input', () => {
        const n = input.value.length;
        counter.textContent = n;
        const wrap = counter.parentElement;
        wrap.className = 'char-counter';
        if (n > 480) wrap.classList.add('danger');
        else if (n > 400) wrap.classList.add('warning');
    });
}

// ════════════════════════════════════════
//  IMAGE UPLOAD
// ════════════════════════════════════════
function setupImageUpload() {
    const addBtn   = document.getElementById('add-image-btn');
    const upload   = document.getElementById('image-upload');
    const removeBtn= document.getElementById('remove-image');
    const preview  = document.getElementById('image-preview');
    const prevImg  = document.getElementById('preview-img');

    if (addBtn && upload) {
        addBtn.addEventListener('click', () => upload.click());
        upload.addEventListener('change', e => {
            const file = e.target.files[0];
            if (!file) return;
            const valid = ['image/png','image/jpeg','image/jpg','image/webp','image/gif'];
            if (!valid.includes(file.type)) { showToast('Formato inválido. Use PNG, JPG, WEBP ou GIF.', 'error'); return; }
            if (file.size > 5 * 1024 * 1024) { showToast('Imagem muito grande. Máximo 5MB.', 'error'); return; } // 5MB limit

            currentImageFile = file;
            const reader = new FileReader();
            reader.onload = ev => {
                prevImg.src = ev.target.result;
                preview.style.display = 'block';
            };
            reader.readAsDataURL(file);
        });
    }

    removeBtn?.addEventListener('click', () => {
        currentImageFile = null;
        if (preview) preview.style.display = 'none';
        if (prevImg) prevImg.src = '';
        if (upload) upload.value = '';
    });
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload  = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(file);
    });
}

// ════════════════════════════════════════
//  EMOJI PICKER Arrumar
// ════════════════════════════════════════
let currentEmojiTarget = null;

function setupEmojiPicker() {
    const btn   = document.getElementById('add-emoji-btn');
    const input = document.getElementById('post-input');
    if (!btn || !input) return;

    // Create picker once
    let picker = btn.parentElement.querySelector('emoji-picker');
    if (!picker) {
        picker = document.createElement('emoji-picker');
        picker.style.cssText = 'position:absolute;bottom:50px;left:0;z-index:1000;display:none;border-radius:16px;border:1px solid var(--border);box-shadow:var(--shadow);width:340px;height:380px;';
        btn.parentElement.style.position = 'relative';
        btn.parentElement.appendChild(picker);

        picker.addEventListener('emoji-click', ev => {
            const emoji = ev.detail.unicode;
            if (currentEmojiTarget) insertAtCursor(currentEmojiTarget, emoji);
            picker.style.display = 'none';
        });

        document.addEventListener('click', ev => {
            if (!btn.contains(ev.target) && !picker.contains(ev.target))
                picker.style.display = 'none';
        });
    }

    btn.addEventListener('click', e => {
        e.stopPropagation();
        currentEmojiTarget = input;
        picker.style.display = picker.style.display === 'none' ? 'block' : 'none';
    });
}

function setupChatEmojiPicker() {
    const btn   = document.getElementById('chat-emoji-btn');
    const input = document.getElementById('message-input');
    if (!btn || !input) return;

    let picker = btn.parentElement.querySelector('emoji-picker.chat-picker');
    if (!picker) {
        picker = document.createElement('emoji-picker');
        picker.classList.add('chat-picker');
        picker.style.cssText = 'position:absolute;bottom:60px;left:0;z-index:1000;display:none;border-radius:16px;border:1px solid var(--border);box-shadow:var(--shadow);width:320px;height:360px;';
        const wrap = btn.parentElement;
        wrap.style.position = 'relative';
        wrap.appendChild(picker);

        picker.addEventListener('emoji-click', ev => {
            insertAtCursor(input, ev.detail.unicode);
            picker.style.display = 'none';
        });

        document.addEventListener('click', ev => {
            if (!btn.contains(ev.target) && !picker.contains(ev.target))
                picker.style.display = 'none';
        });
    }

    btn.addEventListener('click', e => {
        e.stopPropagation();
        picker.style.display = picker.style.display === 'none' ? 'block' : 'none';
    });
}

function insertAtCursor(el, text) {
    const start = el.selectionStart;
    const end   = el.selectionEnd;
    el.value = el.value.slice(0, start) + text + el.value.slice(end);
    el.focus();
    el.setSelectionRange(start + text.length, start + text.length);
    // Update char counter if post input
    if (el.id === 'post-input') {
        const cc = document.getElementById('char-count');
        if (cc) cc.textContent = el.value.length;
    }
}

// ════════════════════════════════════════
//  AUTH
// ════════════════════════════════════════
async function login() {
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    if (!username || !password) { showToast('Preencha usuário e senha', 'warning'); return; }

    try {
        const res = await fetch(`${API_URL}/login-register`, {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ username, password })
        });
        if (res.ok) {
            const data = await res.json();
            currentUser = data.user;
            localStorage.setItem('user', JSON.stringify(currentUser));
            showToast(`Bem-vindo, ${currentUser.username}! 👋`, 'success');
            showApp();
        } else if (res.status === 400) {
            const data = await res.json();
            showToast(data.error, 'error');
        } else {
            showToast('Erro ao fazer login', 'error');
}
    } catch (err) {
        showToast('Servidor offline. Verifique se o servidor está rodando.', 'error');
    }
}

function logout() {
    localStorage.removeItem('user');
    localStorage.removeItem('savedPosts');
    location.reload();
}

// ════════════════════════════════════════
//  SHOW APP
// ════════════════════════════════════════
function showApp() {
    document.getElementById('login-container').style.display = 'none';
    document.getElementById('app-container').style.display  = 'block';
    updateUI();
    navigateTo('home');
    connectWebSocket();
    loadTrendingTopics();
    loadSuggestions();
    updateUserStats();
    setupEmojiPicker();
    startPolling(); 
    aplicarTemaSalvo();  
    aplicarAcessibilidadeSalva(); // ← adiciona
    aplicarTemaSalvo();
    loadWeather();
    setupGifPicker();
}


function updateUI() {
    // Sidebar avatar - agora com iniciais se não tiver foto
    const sidebarAvatar = document.getElementById('sidebar-avatar');
    if (sidebarAvatar && currentUser) {
        sidebarAvatar.src = getAvatarUrl(currentUser.avatar, currentUser.username);
        sidebarAvatar.onerror = function() { 
            handleImageError(this, currentUser.username);
        };
    }
    
    // Post avatar (área de criar post)
    const postAvatar = document.getElementById('post-avatar');
    if (postAvatar && currentUser) {
        postAvatar.src = getAvatarUrl(currentUser.avatar, currentUser.username);
        postAvatar.onerror = function() { 
            handleImageError(this, currentUser.username);
        };
    }
    
    // Username e handle
    const su = document.getElementById('sidebar-username');
    const sh = document.getElementById('sidebar-handle');
    if (su) su.textContent = currentUser.username;
    if (sh) sh.textContent = `@${currentUser.username}`;
}
// ════════════════════════════════════════
//  NAVIGATION
// ════════════════════════════════════════
function navigateTo(page, username = null) {
    currentView = page;

    document.querySelectorAll('.view-section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));

    const activeNav = document.querySelector(`.nav-item[data-page="${page}"]`);
    if (activeNav) activeNav.classList.add('active');

    if (page === 'profile' && username) {
        loadProfileByUsername(username);
        document.getElementById('view-profile')?.classList.add('active');
    } else {
        const target = document.getElementById(`view-${page}`);
        if (target) target.classList.add('active');
    }

    switch (page) {
        case 'home':         loadPosts();            break;
        case 'explore':      loadExplore();          break;
        case 'messages':     loadConversations();    break;
        case 'notifications':loadNotifications();    break;
        case 'bookmarks':    loadBookmarks();        break;
        case 'profile':
            if (!username) loadProfileData(currentUser.id);
            break;
    }
}

async function viewUserProfile(userId) {
    try {
        const res  = await fetch(`${API_URL}/users/${userId}`);
        const user = await res.json();
        if (user?.username) navigateTo('profile', user.username);
    } catch (e) { showToast('Erro ao carregar perfil', 'error'); }
}

async function loadProfileByUsername(username) {
    try {
        const res   = await fetch(`${API_URL}/users`);
        const users = await res.json();
        const user  = users.find(u => u.username === username);
        if (!user) { showToast('Usuário não encontrado', 'error'); navigateTo('home'); return; }
        viewingUserId = user.id;
        await loadProfileData(user.id);
        document.getElementById('view-profile')?.classList.add('active');
    } catch (e) { showToast('Erro ao carregar perfil', 'error'); }
}

//GIPHY API

function setupGifPicker() {
    const btn = document.getElementById('add-gif-btn');
    if (!btn) return;

    btn.addEventListener('click', () => {
        const existing = document.getElementById('gif-picker-modal');
        if (existing) { existing.remove(); return; }
        openGifPicker();
    });
}

function openGifPicker() {
    const modal = document.createElement('div');
    modal.id = 'gif-picker-modal';
    modal.style.cssText = `
        position:fixed; inset:0; background:rgba(0,0,0,0.8);
        z-index:9999; display:flex; align-items:center; justify-content:center;
        backdrop-filter:blur(8px);
    `;

    modal.innerHTML = `
        <div style="background:var(--bg-card);border-radius:var(--radius-xl);padding:24px;width:480px;max-height:80vh;display:flex;flex-direction:column;gap:16px;border:1px solid var(--border);">
            <div style="display:flex;justify-content:space-between;align-items:center;">
                <h3 style="font-weight:800;">Escolher GIF</h3>
                <span onclick="document.getElementById('gif-picker-modal').remove()" style="cursor:pointer;font-size:1.5rem;color:var(--text-secondary);">&times;</span>
            </div>
            <div style="display:flex;gap:10px;">
                <input type="text" id="gif-search-input" placeholder="Buscar GIFs..." 
                    style="flex:1;background:var(--bg-elevated);border:1px solid var(--border);color:var(--text);padding:10px 14px;border-radius:24px;font-family:var(--font-display);font-size:0.9rem;outline:none;">
                <button onclick="searchGifs()" class="btn-primary-sm">Buscar</button>
            </div>
            <div id="gif-results" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;overflow-y:auto;max-height:400px;">
                <p style="color:var(--text-muted);font-size:0.85rem;grid-column:span 3;text-align:center;padding:20px;">Digite algo para buscar GIFs</p>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

    document.getElementById('gif-search-input').addEventListener('keypress', e => {
        if (e.key === 'Enter') searchGifs();
    });
}

async function searchGifs() {
    const input = document.getElementById('gif-search-input');
    const term  = input?.value.trim();
    if (!term) return;

    const results = document.getElementById('gif-results');
    results.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;grid-column:span 3;text-align:center;padding:20px;">Buscando...</p>';

    try {
        const res  = await fetch(`${API_URL}/giphy?q=${encodeURIComponent(term)}`);
        const data = await res.json();

        if (!data.data || data.data.length === 0) {
            results.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;grid-column:span 3;text-align:center;padding:20px;">Nenhum GIF encontrado</p>';
            return;
        }

        results.innerHTML = data.data.map(gif => `
            <img src="${gif.images.fixed_height_small.url}" 
                 style="width:100%;border-radius:var(--radius);cursor:pointer;transition:transform 0.2s;object-fit:cover;aspect-ratio:1;"
                 onmouseover="this.style.transform='scale(1.05)'"
                 onmouseout="this.style.transform='scale(1)'"
                 onclick="selectGif('${gif.images.original.url}')"
                 alt="gif">
        `).join('');
    } catch {
        results.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;grid-column:span 3;text-align:center;padding:20px;">Erro ao buscar GIFs</p>';
    }
}

function selectGif(url) {
    const preview = document.getElementById('image-preview');
    const prevImg = document.getElementById('preview-img');

    if (preview && prevImg) {
        prevImg.src = url;
        preview.style.display = 'block';
    }

    // Salva a URL do GIF para ser usada no post
    document.getElementById('image-url-input').value = url;
    currentImageFile = null;

    document.getElementById('gif-picker-modal')?.remove();
    showToast('GIF selecionado! 🎬', 'success');
}

// ════════════════════════════════════════
//  POSTS
// ════════════════════════════════════════
async function createPost() {
    const content = document.getElementById('post-input').value.trim();
    let imageUrl  = document.getElementById('image-url-input')?.value.trim() || '';

    if (!content && !imageUrl && !currentImageFile) {
        showToast('Digite algo ou adicione uma imagem!', 'warning');
        return;
    }

   if (currentImageFile) {
    try { imageUrl = await comprimirImagem(currentImageFile, 1200, 0.7); }
    catch { showToast('Erro ao processar imagem', 'error'); return; }
}

    try {
        const res = await fetch(`${API_URL}/posts`, {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({
                userId:   currentUser.id,
                username: currentUser.username,
                avatar:   currentUser.avatar,
                content,
                imageUrl
            })
        });

        if (res.ok) {
            document.getElementById('post-input').value = '';
            document.getElementById('image-url-input').value = '';
            document.getElementById('char-count').textContent = '0';
            const prev = document.getElementById('image-preview');
            if (prev) prev.style.display = 'none';
            currentImageFile = null;
            showToast('Post publicado! 🎉', 'success');
            loadPosts();
        } else if (res.status === 400) {
            showToast('Post contém conteúdo inapropriado! ⚠️', 'error');
        } else if (res.status === 403) {
            showToast('Links não são permitidos nos posts! 🔗', 'error');
        } else if (res.status === 429) {
            showToast('Aguarde antes de postar novamente! ⏳', 'warning');
        } else {
            showToast('Erro ao publicar post', 'error');
        }
    } catch { showToast('Erro ao publicar post', 'error'); }
}

async function loadPosts() {
    try {
        const res = await fetch(`${API_URL}/posts`);
        allPosts  = await res.json();
        filterAndDisplayPosts();
    } catch { showToast('Erro ao carregar posts', 'error'); }
}

function filterAndDisplayPosts() {
    let posts = [...allPosts];

    if (currentFeedTab === 'following') {
        const following = currentUser.following || [];
        if (following.length === 0) {
            displayPosts([]);
            return;
        }
        posts = posts.filter(p => following.includes(p.userId));
    }

    posts.sort((a, b) => b.timestamp - a.timestamp);
    displayPosts(posts);
}

function displayPosts(posts) {
    const timeline = document.getElementById('timeline');
    if (!timeline) return;

    if (posts.length === 0) {
        const msg = currentFeedTab === 'following'
            ? 'Siga mais pessoas para ver posts aqui!'
            : 'Seja o primeiro a postar algo!';
        timeline.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-newspaper"></i>
                <p>Nenhum post para mostrar</p>
                <span>${msg}</span>
            </div>`;
        return;
    }

    timeline.innerHTML = posts.map(createPostElement).join('');
    updatePostsCount();
}

function createPostElement(post) {
    const isLiked    = post.likes?.includes(currentUser.id);
    const isRetweet  = post.retweets?.includes(currentUser.id);
    const isSaved    = savedPosts.includes(post.id);
    const isOwnPost  = post.userId === currentUser.id;

    const rtIndicator = post.retweetedBy
        ? `<div class="retweet-indicator"><i class="fas fa-retweet"></i><span>${escapeHtml(post.retweetedBy)} retweetou</span></div>`
        : '';

    // 🔧 AVATAR PADRÃO - URL calculada aqui
    const avatarUrl = getAvatarUrl(post.avatar, post.username);

    return `
    <div class="post" data-post-id="${post.id}">
        ${rtIndicator}
        <div class="post-header">
            <img src="${avatarUrl}" class="post-avatar" onclick="viewUserProfile('${post.userId}')" alt="avatar" onerror="this.onerror=null;this.src='${AVATAR_PADRAO_FIXO}'">
            <div class="post-info">
                <div class="post-user">
                    <span class="post-username" onclick="viewUserProfile('${post.userId}')">${escapeHtml(post.username)}</span>
                    <span class="post-handle">@${escapeHtml(post.username)}</span>
                    <span class="post-time">· ${formatTime(post.timestamp)}</span>
                    ${isOwnPost ? `<span class="post-menu" onclick="deletePost('${post.id}')" title="Excluir"><i class="fas fa-trash"></i></span>` : ''}
                </div>
                <div class="post-content">${escapeHtml(post.content)}</div>
                ${post.imageUrl ? `<img src="${post.imageUrl}" class="post-image" onclick="openImageModal('${escapeHtml(post.imageUrl)}')" alt="imagem do post">` : ''}
                <div class="post-actions">
                   <div class="post-action like-action ${isLiked ? 'liked' : ''}" onclick="likePost('${post.id}')">
                        <i class="fas fa-heart"></i>
                        <span class="like-count">${post.likes?.length || 0}</span>
                    </div>
                   <div class="post-action" onclick="toggleComments(&quot;${post.id}&quot;)">
                        <i class="fas fa-comment"></i>
                        <span>${post.comments?.length || 0}</span>
                    </div>
                   <div class="post-action retweet-action ${isRetweet ? 'retweeted' : ''}" onclick="retweet(&quot;${post.id}&quot;)">
                        <i class="fas fa-retweet"></i>
                        <span class="retweet-count">${post.retweets?.length || 0}</span>
                    </div>
                   <div class="post-action ${isSaved ? 'saved' : ''}" onclick="savePost(&quot;${post.id}&quot;)">
                        <i class="fas fa-bookmark"></i>
                        <span>${isSaved ? 'Salvo' : 'Salvar'}</span>
                    </div>
                </div>
                <div class="comments-section" id="comments-${post.id}" style="display:none;">
                    <div id="comments-list-${post.id}">
                       ${(post.comments || []).map(c => {
    const commentAvatarUrl = getAvatarUrl(c.avatar, c.username);
    return `
    <div class="comment">
        <img src="${commentAvatarUrl}" class="comment-avatar" onclick="viewUserProfile('${c.userId}')" alt="" onerror="this.onerror=null;this.src='${AVATAR_PADRAO_FIXO}'">
        <div class="comment-content">
            <div class="comment-user">
                <span class="comment-username" onclick="viewUserProfile('${c.userId}')">${escapeHtml(c.username)}</span>
                <span class="comment-handle">@${escapeHtml(c.username)}</span>
                ${String(c.userId) === String(currentUser.id) ? `
                    <span style="margin-left:auto;cursor:pointer;color:var(--text-muted);" 
                          onclick="deleteComment('${post.id}','${c.id}')">
                        <i class="fas fa-trash" style="font-size:0.75rem;"></i>
                    </span>` : ''}
            </div>
            <div class="comment-text">${escapeHtml(c.content)}</div>
        </div>
    </div>`;
}).join('') || '<p style="color:var(--text-muted);font-size:0.82rem;padding:8px 0;">Nenhum comentário ainda</p>'}
                    </div>
                    <div class="comment-form">
                        <input type="text" id="comment-input-${post.id}" class="comment-input" placeholder="Adicione um comentário...">
                        <button class="btn-secondary-sm" onclick="addComment('${post.id}')">Responder</button>
                    </div>
                </div>
            </div>
        </div>
    </div>`;
}

async function likePost(postId) {
    try {
         const res = await fetch(`${API_URL}/posts/like`, { 
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ postId, userId: currentUser.id })
        });
        if (res.ok) {
            const data = await res.json();
            updatePostLikes(postId, data.likes);
        }
    } catch { /* silent */ }
}

function updatePostLikes(postId, likes) {
    console.log('🔄 Updating likes for post:', postId, 'Likes:', likes);
    
    // Busca o post pelo ID
    const postDiv = document.querySelector(`.post[data-post-id="${postId}"]`);
    if (!postDiv) {
        console.log('❌ Post not found in DOM:', postId);
        return;
    }
    
    // Busca o botão de like (primeiro .post-action com ícone de coração)
    const likeBtn = postDiv.querySelector('.post-action .fa-heart')?.closest('.post-action');
    if (!likeBtn) {
        console.log('❌ Like button not found');
        return;
    }
    
    // Atualiza contador
    const countSpan = likeBtn.querySelector('.like-count');
    if (countSpan) {
        countSpan.textContent = likes.length;
        console.log('✅ Like count updated to:', likes.length);
    }
    
    // Atualiza estilo visual
    if (likes.includes(currentUser.id)) {
        likeBtn.classList.add('liked');
        console.log('❤️ Like button marked as liked');
    } else {
        likeBtn.classList.remove('liked');
        console.log('💔 Like button marked as not liked');
    }
}  
async function retweet(postId) {
    try {
        const res = await fetch(`${API_URL}/posts/retweet`, { 
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ postId, userId: currentUser.id })
        });
        if (res.ok) {
            const data    = await res.json();
            const isNow   = data.retweets.includes(currentUser.id);
            showToast(isNow ? 'Retweetado! 🔁' : 'Retweet removido', isNow ? 'success' : 'info');
            loadPosts();
        }
    } catch { showToast('Erro ao retweet', 'error'); }
}

async function savePost(postId) {
    if (savedPosts.includes(postId)) {
        savedPosts = savedPosts.filter(id => id !== postId);
        showToast('Removido dos salvos', 'info');
    } else {
        savedPosts.push(postId);
        showToast('Post salvo! 🔖', 'success');
    }
    localStorage.setItem('savedPosts', JSON.stringify(savedPosts));
    loadPosts();
    if (currentView === 'bookmarks') loadBookmarks();
}

async function deletePost(postId) {
    if (!confirm('Excluir este post?')) return;
    try {
        const res = await fetch(`${API_URL}/posts/${postId}`, {
            method: 'DELETE',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ userId: currentUser.id })
        });
        if (res.ok) { showToast('Post excluído', 'success'); loadPosts(); }
        else showToast('Sem permissão para excluir', 'error');
    } catch { showToast('Erro ao excluir', 'error'); }
}

async function addComment(postId) {
    const input   = document.getElementById(`comment-input-${postId}`);
    const content = input?.value.trim();
    if (!content) return;
    try {
        const res = await fetch(`${API_URL}/posts/comment`, {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({
                postId,
                userId:   currentUser.id,
                username: currentUser.username,
                avatar:   currentUser.avatar,
                content
            })
        });
         if (res.ok) { 
            input.value = ''; 
            showToast('Comentário adicionado!', 'success'); 
            loadPosts(); 
        } else if (res.status === 400) {
            showToast('Comentário contém conteúdo inapropriado! ⚠️', 'error');
        } else if (res.status === 403) {
    showToast('Links não são permitidos nos comentários! 🔗', 'error');
} else if (res.status === 429) {
    showToast('Aguarde antes de comentar novamente! ⏳', 'warning');
}
    } catch { /* silent */ }
}

function toggleComments(postId) {
    const sec = document.getElementById(`comments-${postId}`);
    if (sec) sec.style.display = sec.style.display === 'none' ? 'block' : 'none';
}

function openImageModal(url) {
    const modal = document.getElementById('image-modal');
    const img   = document.getElementById('modal-image');
    if (modal && img) { img.src = url; modal.classList.add('active'); }
}

// ════════════════════════════════════════
//  BOOKMARKS
// ════════════════════════════════════════
async function loadBookmarks() {
    const list = document.getElementById('bookmarks-list');
    if (!list) return;

    if (savedPosts.length === 0) {
        list.innerHTML = `<div class="empty-state"><i class="fas fa-bookmark"></i><p>Nenhum post salvo</p><span>Salve posts para vê-los aqui</span></div>`;
        return;
    }

    try {
        const res   = await fetch(`${API_URL}/posts`);
        const posts = await res.json();
        const saved = posts.filter(p => savedPosts.includes(p.id));
        list.innerHTML = saved.length
            ? saved.map(createPostElement).join('')
            : `<div class="empty-state"><i class="fas fa-bookmark"></i><p>Posts salvos não encontrados</p></div>`;
    } catch { list.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-circle"></i><p>Erro ao carregar salvos</p></div>`; }
}

// ════════════════════════════════════════
//  FOLLOW
// ════════════════════════════════════════
async function toggleFollow(userId) {
    const isFollowing       = currentUser.following?.includes(userId);
    const endpoint          = isFollowing ? '/users/unfollow' : '/users/follow';
    const prevState         = [...(currentUser.following || [])];

    // Optimistic update
    if (isFollowing) currentUser.following = currentUser.following.filter(id => id !== userId);
    else currentUser.following = [...(currentUser.following || []), userId];
    localStorage.setItem('user', JSON.stringify(currentUser));

    // Update all buttons for this user
    updateFollowButtons(userId, !isFollowing);

    try {
        const res  = await fetch(`${API_URL}${endpoint}`, {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ followerId: currentUser.id, followingId: userId })
        });
        if (res.ok) {
            const data = await res.json();
            showToast(data.message, 'success');
            updateUserStats();
            if (currentFeedTab === 'following') loadPosts();
        } else {
            // Rollback
            currentUser.following = prevState;
            localStorage.setItem('user', JSON.stringify(currentUser));
            updateFollowButtons(userId, isFollowing);
            showToast('Erro ao atualizar', 'error');
        }
    } catch {
        currentUser.following = prevState;
        localStorage.setItem('user', JSON.stringify(currentUser));
        updateFollowButtons(userId, isFollowing);
        showToast('Erro de conexão', 'error');
    }
}

function updateFollowButtons(userId, nowFollowing) {
    document.querySelectorAll(`[onclick*="toggleFollow('${userId}')"]`).forEach(btn => {
        if (nowFollowing) {
            btn.textContent = 'Seguindo';
            btn.classList.add('following');
        } else {
            btn.textContent = 'Seguir';
            btn.classList.remove('following');
        }
    });
}
// PROFILE new

function toggleAvatarInput(tipo) {
    const urlInput  = document.getElementById('edit-avatar-url');
    const fileInput = document.getElementById('edit-avatar-file');
    if (tipo === 'url') {
        urlInput.style.display  = 'block';
        fileInput.style.display = 'none';
    } else {
        urlInput.style.display  = 'none';
        fileInput.style.display = 'block';
        fileInput.click();
    }
}

function toggleCoverInput(tipo) {
    const urlInput  = document.getElementById('edit-cover-url');
    const fileInput = document.getElementById('edit-cover-file');
    if (tipo === 'url') {
        urlInput.style.display  = 'block';
        fileInput.style.display = 'none';
    } else {
        urlInput.style.display  = 'none';
        fileInput.style.display = 'block';
        fileInput.click();
    }
}

// ════════════════════════════════════════
//  PROFILE
// ════════════════════════════════════════
async function loadProfileData(userId) {
    try {
        const [userRes, postsRes] = await Promise.all([
            fetch(`${API_URL}/users/${userId}`),
            fetch(`${API_URL}/posts/user/${userId}`)
        ]);
        const user      = await userRes.json();
        const userPosts = await postsRes.json();

        const isOwn       = userId === currentUser.id;
        const isFollowing = currentUser.following?.includes(userId);
        const joinDate    = formatDate(user.joinDate);

        const container = document.getElementById('profile-container');
        if (!container) return;

        container.innerHTML = `
        <div class="profile-container">
            <div class="profile-cover">
                ${user.coverImage ? `<img src="${escapeHtml(user.coverImage)}" class="profile-cover-img" alt="capa">` : ''}
            </div>
            <div class="profile-avatar-wrapper">
    <img src="${getAvatarUrl(user.avatar, user.username)}" class="profile-avatar-large" alt="Avatar de ${escapeHtml(user.username)}" onerror="this.onerror=null;this.src='${AVATAR_PADRAO_FIXO}'">
</div>
            <div class="profile-info">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;">
                    <div>
                        <div class="profile-name">${escapeHtml(user.username)}</div>
                        <div class="profile-handle">@${escapeHtml(user.username)}</div>
                    </div>
                    ${!isOwn ? `
                        <button class="follow-button ${isFollowing ? 'following' : ''}" onclick="toggleFollow('${userId}')">
                            ${isFollowing ? '<i class="fas fa-check"></i> Seguindo' : '<i class="fas fa-plus"></i> Seguir'}
                        </button>` : ''}
                </div>
                <div class="profile-bio">${escapeHtml(user.bio || 'Sem bio')}</div>
                <div class="profile-details">
                    ${user.location ? `<span><i class="fas fa-map-marker-alt"></i> ${escapeHtml(user.location)}</span>` : ''}
                    ${user.website  ? `<span><i class="fas fa-link"></i> <a href="${escapeHtml(user.website)}" target="_blank" rel="noopener">${escapeHtml(user.website)}</a></span>` : ''}
                    <span><i class="fas fa-calendar-alt"></i> Entrou em ${joinDate}</span>
                </div>
                <div class="profile-stats">
                    <div class="stat-item">
                        <span class="stat-number">${user.followers?.length || 0}</span>
                        <span class="stat-label">Seguidores</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-number">${user.following?.length || 0}</span>
                        <span class="stat-label">Seguindo</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-number">${userPosts.length}</span>
                        <span class="stat-label">Posts</span>
                    </div>
                </div>
            </div>
           ${isOwn ? `
<div class="edit-profile-section">
    <h3><i class="fas fa-pen"></i> Editar Perfil</h3>
    
    <!-- Avatar -->
    <label style="font-size:0.82rem;color:var(--text-secondary);font-weight:600;display:block;margin-bottom:6px;">Foto de perfil</label>
    <div style="display:flex;gap:8px;margin-bottom:10px;">
        <button class="btn-secondary-sm" onclick="toggleAvatarInput('url')" id="btn-avatar-url">🔗 URL</button>
        <button class="btn-secondary-sm" onclick="toggleAvatarInput('file')" id="btn-avatar-file">📁 Dispositivo</button>
    </div>
    <input type="text" id="edit-avatar-url" placeholder="URL da foto de perfil" value="${escapeHtml(user.avatar || '')}">
    <input type="file" id="edit-avatar-file" accept="image/*" style="display:none;margin-bottom:10px;">

    <!-- Capa -->
    <label style="font-size:0.82rem;color:var(--text-secondary);font-weight:600;display:block;margin-bottom:6px;">Imagem de capa</label>
    <div style="display:flex;gap:8px;margin-bottom:10px;">
        <button class="btn-secondary-sm" onclick="toggleCoverInput('url')" id="btn-cover-url">🔗 URL</button>
        <button class="btn-secondary-sm" onclick="toggleCoverInput('file')" id="btn-cover-file">📁 Dispositivo</button>
    </div>
    <input type="text" id="edit-cover-url" placeholder="URL da imagem de capa" value="${escapeHtml(user.coverImage || '')}">
    <input type="file" id="edit-cover-file" accept="image/*" style="display:none;margin-bottom:10px;">

    <textarea id="edit-bio" placeholder="Biografia" rows="3">${escapeHtml(user.bio || '')}</textarea>
    <input type="text" id="edit-location" placeholder="Localização" value="${escapeHtml(user.location || '')}">
    <input type="text" id="edit-website" placeholder="Website" value="${escapeHtml(user.website || '')}">
    <button class="btn-primary-sm" onclick="updateProfile()"><i class="fas fa-save"></i> Salvar Alterações</button>
</div>` : ''}
            <div style="padding:20px 24px;">
                <h3 style="font-size:1rem;font-weight:700;margin-bottom:16px;display:flex;align-items:center;gap:8px;">
                    <i class="fas fa-newspaper" style="color:var(--primary);"></i> Posts
                </h3>
                <div id="user-posts-list">
                    ${userPosts.length
                        ? userPosts.map(createPostElement).join('')
                        : `<div class="empty-state" style="padding:32px 0;"><i class="fas fa-ghost"></i><p>Nenhum post ainda</p></div>`}
                </div>
            </div>
        </div>`;

        document.title = `${user.username} | Tiwitter Social`;
    } catch (err) {
        console.error(err);
        showToast('Erro ao carregar perfil', 'error');
    }
}

async function updateProfile() {
    const bio      = document.getElementById('edit-bio')?.value;
    const location = document.getElementById('edit-location')?.value;
    const website  = document.getElementById('edit-website')?.value;

    // Avatar
    let avatar = document.getElementById('edit-avatar-url')?.value;
    const avatarFile = document.getElementById('edit-avatar-file');
    if (avatarFile?.files[0]) {
        avatar = await comprimirImagem(avatarFile.files[0], 400, 0.8);
    }

    // Capa
    let coverImage = document.getElementById('edit-cover-url')?.value;
    const coverFile = document.getElementById('edit-cover-file');
    if (coverFile?.files[0]) {
        coverImage = await comprimirImagem(coverFile.files[0], 1200, 0.7);
    }

    try {
        const res = await fetch(`${API_URL}/users/${currentUser.id}`, {
            method: 'PATCH',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ avatar, coverImage, bio, location, website })
        });
       if (res.ok) {
    currentUser = await res.json();
    localStorage.setItem('user', JSON.stringify(currentUser));
    showToast('Perfil atualizado! ✅', 'success');
    updateUI();

    // Muda o botão para verde
    const btn = document.querySelector('.edit-profile-section .btn-primary-sm');
    if (btn) {
        btn.style.background = '#10b981';
        btn.style.boxShadow  = '0 4px 20px rgba(16,185,129,0.4)';
        btn.innerHTML = '<i class="fas fa-check"></i> Salvo!';
        
        setTimeout(() => {
            btn.style.background = '';
            btn.style.boxShadow  = '';
            btn.innerHTML = '<i class="fas fa-save"></i> Salvar Alterações';
        }, 3000);
    }

loadProfileData(currentUser.id);
} else if (res.status === 400) {
    const data = await res.json();
    showToast(data.error, 'error');
} else {
    showToast('Erro ao atualizar perfil', 'error');
}
    } catch { showToast('Erro ao atualizar perfil', 'error'); }
}
async function comprimirImagem(file, maxWidth = 1200, qualidade = 0.7) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width  = img.width;
                let height = img.height;

                if (width > maxWidth) {
                    height = (height * maxWidth) / width;
                    width  = maxWidth;
                }

                canvas.width  = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                resolve(canvas.toDataURL('image/jpeg', qualidade));
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

async function comprimirImagem(file, maxWidth = 1200, qualidade = 0.7) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width  = img.width;
                let height = img.height;

                if (width > maxWidth) {
                    height = (height * maxWidth) / width;
                    width  = maxWidth;
                }

                canvas.width  = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                resolve(canvas.toDataURL('image/jpeg', qualidade));
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}
// ════════════════════════════════════════
//  SEARCH & EXPLORE
// ════════════════════════════════════════
async function searchUsers() {
    const term    = document.getElementById('main-search')?.value.toLowerCase().trim();
    const results = document.getElementById('search-results');
    if (!results) return;
    if (!term) { results.innerHTML = ''; return; }

    try {
        const isHashtag = term.startsWith('#');

        if (isHashtag) {
            // Busca posts por hashtag
            const res   = await fetch(`${API_URL}/posts/search?q=${encodeURIComponent(term)}`);
            const posts = await res.json();

            results.innerHTML = posts.length
                ? `
                    <div style="margin-bottom:12px;font-size:0.85rem;color:var(--text-secondary);font-weight:600;">
                        ${posts.length} post(s) com "${term}"
                    </div>
                    ${posts.map(createPostElement).join('')}`
                : `<div class="empty-state" style="padding:32px 0;">
                        <i class="fas fa-hashtag"></i>
                        <p>Nenhum post com "${term}"</p>
                   </div>`;
        } else {
            // Busca usuários por nome
            const res   = await fetch(`${API_URL}/users`);
            const users = await res.json();
            const termLimpo = term.startsWith('@') ? term.slice(1) : term;
            const found = users.filter(u => 
    u.username.toLowerCase().includes(termLimpo) && u.id !== currentUser.id
);

            results.innerHTML = found.length
                ? found.map(u => `
                    <div class="user-card" onclick="viewUserProfile('${u.id}')">
                        <img src="${escapeHtml(u.avatar || '')}" class="user-avatar" alt="">
                        <div class="user-info">
                            <div class="user-name">${escapeHtml(u.username)}</div>
                            <div class="user-handle">@${escapeHtml(u.username)}</div>
                            <div class="user-bio">${escapeHtml(u.bio || 'Sem bio')}</div>
                        </div>
                        <button class="btn-secondary-sm ${currentUser.following?.includes(u.id) ? 'following' : ''}"
                            onclick="event.stopPropagation();toggleFollow('${u.id}')">
                            ${currentUser.following?.includes(u.id) ? 'Seguindo' : 'Seguir'}
                        </button>
                    </div>`).join('')
                : `<div class="empty-state" style="padding:32px 0;">
                        <i class="fas fa-search"></i>
                        <p>Nenhum usuário encontrado</p>
                   </div>`;
        }
    } catch { /* silent */ }
}


async function loadExplore() {
    await loadTrendingTopics();
    await loadSuggestions();
}

async function loadTrendingTopics() {
    const container = document.getElementById('trending-topics');
    if (!container) return;

    try {
    
        const res = await fetch(`${API_URL}/trending`);
        const data = await res.json();

        if (!data.articles || data.articles.length === 0) {
            container.innerHTML = '<p style="color:var(--text-muted);font-size:0.82rem;padding:8px;">Sem notícias no momento</p>';
            return;
        }

        container.innerHTML = data.articles.map(article => `
            <a href="${article.url}" target="_blank" rel="noopener" style="text-decoration:none;">
                <div class="trend-item">
                    <div>
                        <strong style="font-size:0.82rem;line-height:1.3;">${article.title.substring(0, 60)}...</strong>
                        <small>${article.source.name} · ${formatTime(new Date(article.publishedAt).getTime())}</small>
                    </div>
                    <i class="fas fa-arrow-up-right-from-square" style="color:var(--primary);font-size:0.75rem;flex-shrink:0;"></i>
                </div>
            </a>
        `).join('');

    } catch {
        // fallback se a API falhar
        container.innerHTML = `
            <div class="trend-item"><div><strong>#TiwittersSocial</strong><small>15.2k posts</small></div></div>
            <div class="trend-item"><div><strong>#Tecnologia</strong><small>12.3k posts</small></div></div>
            <div class="trend-item"><div><strong>#Brasil</strong><small>9.1k posts</small></div></div>
        `;
    }
}

async function loadSuggestions() {
    const list = document.getElementById('suggestions-list');
    if (!list) return;

    try {
        const res  = await fetch(`${API_URL}/users`);
        const users= await res.json();
        const sugg = users.filter(u => u.id !== currentUser.id && !currentUser.following?.includes(u.id)).slice(0, 4);

        list.innerHTML = sugg.length
            ? sugg.map(u => `
                <div class="user-card" onclick="viewUserProfile('${u.id}')">
                    <img src="${escapeHtml(u.avatar || '')}" class="user-avatar" style="width:40px;height:40px;" alt="">
                    <div class="user-info">
                        <div class="user-name">${escapeHtml(u.username)}</div>
                        <div class="user-handle">@${escapeHtml(u.username)}</div>
                    </div>
                    <button class="btn-secondary-sm" style="padding:5px 12px;font-size:0.78rem;"
                        onclick="event.stopPropagation();toggleFollow('${u.id}')">Seguir</button>
                </div>`).join('')
            : `<p style="color:var(--text-muted);font-size:0.85rem;text-align:center;padding:12px;">Nenhuma sugestão</p>`;
    } catch { /* silent */ }
}

// ════════════════════════════════════════
//  STATS
// ════════════════════════════════════════
async function updateUserStats() {
    try {
        const [uRes, pRes] = await Promise.all([
            fetch(`${API_URL}/users/${currentUser.id}`),
            fetch(`${API_URL}/posts/user/${currentUser.id}`)
        ]);
        const user  = await uRes.json();
        const posts = await pRes.json();

        const fc = document.getElementById('followers-count');
        const fg = document.getElementById('following-count');
        const pc = document.getElementById('posts-count');
        if (fc) fc.textContent = user.followers?.length || 0;
        if (fg) fg.textContent = user.following?.length || 0;
        if (pc) pc.textContent = posts.length;
    } catch { /* silent */ }
}

function updatePostsCount() {
    const count = document.querySelectorAll('#timeline .post').length;
    const el    = document.getElementById('posts-count');
    if (el) el.textContent = count;
}

// ════════════════════════════════════════
//  MESSAGES
// ════════════════════════════════════════
async function loadConversations() {
    try {
        const res   = await fetch(`${API_URL}/users`);
        const users = await res.json();
        const others= users.filter(u => u.id !== currentUser.id);
        const list  = document.getElementById('conversations-list');
        if (!list) return;

        list.innerHTML = others.map(u => `
            <div class="conversation-item ${currentConversation === u.id ? 'active' : ''}"
                 onclick="openConversation('${u.id}')">
                <img src="${escapeHtml(u.avatar || '')}" class="conversation-avatar" alt="">
                <div class="conversation-info">
                    <h4>${escapeHtml(u.username)}</h4>
                    <div class="conversation-last-message">Clique para conversar</div>
                </div>
            </div>`).join('') || `<div class="empty-state" style="padding:40px 0;"><i class="fas fa-users"></i><p>Nenhum usuário</p></div>`;
    } catch { /* silent */ }
}

async function openConversation(userId) {
    currentConversation = userId;

    try {
        const uRes  = await fetch(`${API_URL}/users/${userId}`);
        const other = await uRes.json();

        const area  = document.getElementById('messages-area');
        if (!area) return;

        area.innerHTML = `
            <div class="messages-header">
                <img src="${escapeHtml(other.avatar || '')}" alt="">
                <div>
                    <h4>${escapeHtml(other.username)}</h4>
                    <span style="font-size:0.78rem;color:var(--text-secondary);">@${escapeHtml(other.username)}</span>
                </div>
            </div>
            <div class="messages-list" id="messages-list"></div>
            <div class="message-input-area">
                <button id="chat-emoji-btn" class="action-btn" title="Emoji">
                    <i class="fas fa-face-smile"></i>
                </button>
                <input type="text" id="message-input" class="message-input" placeholder="Digite uma mensagem...">
                <button class="btn-primary-sm" id="send-message-btn">
                    <i class="fas fa-paper-plane"></i>
                </button>
            </div>`;

        document.getElementById('send-message-btn')?.addEventListener('click', sendMessage);
        document.getElementById('message-input')?.addEventListener('keypress', e => { if (e.key === 'Enter') sendMessage(); });
        setupChatEmojiPicker();

        const mRes  = await fetch(`${API_URL}/messages/${currentUser.id}/${userId}`);
        const msgs  = await mRes.json();

        const msgList = document.getElementById('messages-list');
        if (msgList) {
            msgList.innerHTML = msgs.map(renderMessage).join('') || `<div class="empty-state" style="padding:40px 0;"><i class="fas fa-comment-dots"></i><p>Nenhuma mensagem</p><span>Diga olá! 👋</span></div>`;
            msgList.scrollTop = msgList.scrollHeight;
        }

        // Highlight active conversation
        document.querySelectorAll('.conversation-item').forEach(el => el.classList.remove('active'));
        document.querySelectorAll(`.conversation-item`).forEach(el => {
            if (el.getAttribute('onclick')?.includes(userId)) el.classList.add('active');
        });
    } catch (err) { console.error(err); }
}

function renderMessage(msg) {
    const isOwn   = msg.from === currentUser.id;
    const isLiked = msg.likedBy?.includes(currentUser.id);
    return `
    <div class="message ${isOwn ? 'sent' : 'received'}" data-message-id="${msg.id}">
        <div class="message-content-wrapper">
            <div class="message-content">${escapeHtml(msg.content)}</div>
            <div class="message-time">${new Date(msg.timestamp).toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'})}</div>
        </div>
        <div class="message-actions">
            <button class="message-action-btn message-like-btn ${isLiked ? 'liked' : ''}" onclick="likeMessage('${msg.id}')">
                <i class="fas fa-heart"></i>
            </button>
            ${isOwn ? `<button class="message-action-btn message-delete-btn" onclick="deleteMessage('${msg.id}')"><i class="fas fa-trash"></i></button>` : ''}
        </div>
    </div>`;
}

// DELETAR COMMENT

async function deleteComment(postId, commentId) {
    if (!confirm('Excluir comentário?')) return;
    try {
        const res = await fetch(`${API_URL}/posts/${postId}/comments/${commentId}`, {
            method: 'DELETE',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ userId: currentUser.id })
        });
        if (res.ok) { showToast('Comentário excluído', 'success'); loadPosts(); }
        else showToast('Sem permissão', 'error');
    } catch { /* silent */ }
}

async function sendMessage() {
    const input   = document.getElementById('message-input');
    const content = input?.value.trim();
    if (!content || !currentConversation) return;
    try {
        const res = await fetch(`${API_URL}/messages`, {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ from: currentUser.id, to: currentConversation, content })
          });
        if (res.ok) { 
            input.value = ''; 
            openConversation(currentConversation); 
        } else if (res.status === 400) {
            showToast('Mensagem contém conteúdo inapropriado! ⚠️', 'error');
        } else if (res.status === 403) {
    showToast('Links não são permitidos nas mensagens! 🔗', 'error');
} else if (res.status === 429) {
    showToast('Aguarde antes de enviar outra mensagem! ⏳', 'warning');
}
    } catch { /* silent */ }
}


async function deleteMessage(msgId) {
    if (!confirm('Excluir mensagem?')) return;
    try {
        const res = await fetch(`${API_URL}/messages/${msgId}`, {
            method: 'DELETE',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ userId: currentUser.id })
        });
        if (res.ok) { showToast('Mensagem excluída', 'success'); openConversation(currentConversation); }
    } catch { /* silent */ }
}

async function likeMessage(msgId) {
    try {
        const res  = await fetch(`${API_URL}/messages/${msgId}/like`, {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ userId: currentUser.id })
        });
        if (res.ok) openConversation(currentConversation);
    } catch { /* silent */ }
}


// ════════════════════════════════════════
//  NOTIFICATIONS  
// ════════════════════════════════════════
async function loadNotifications() {
    try {
        const res   = await fetch(`${API_URL}/notifications/${currentUser.id}`);
        const notifs= await res.json();
        const list  = document.getElementById('notifications-list');
        if (!list) return;

        unreadNotificationsCount = notifs.filter(n => !n.read).length;
        updateNotificationBadge();

        if (!notifs.length) {
            list.innerHTML = `<div class="empty-state"><i class="fas fa-bell-slash"></i><p>Nenhuma notificação</p></div>`;
            return;
        }

        list.innerHTML = notifs.map(n => `
            <div class="post ${!n.read ? 'unread-notification' : ''}" data-notif-id="${n.id}"
                 onclick="markNotificationRead('${n.id}')${n.fromUser?.id ? `;viewUserProfile('${n.fromUser.id}')` : ''}"
                 style="cursor:pointer;position:relative;">
                <div class="post-header">
                    <img src="${escapeHtml(n.fromUser?.avatar || '')}" class="post-avatar" alt="">
                    <div class="post-info">
                        <div class="post-username">${escapeHtml(n.fromUser?.username || 'Alguém')}</div>
                        <div class="post-content" style="font-size:0.88rem;margin:4px 0;">${escapeHtml(n.content)}</div>
                        <div class="post-time">${formatTime(n.timestamp)}</div>
                    </div>
                </div>
                ${!n.read ? '<span class="unread-dot"></span>' : ''}
            </div>`).join('');
    } catch { /* silent */ }
}

async function markNotificationRead(id) {
    try {
        const res = await fetch(`${API_URL}/notifications/${id}/read`, {
            method: 'POST', headers: {'Content-Type':'application/json'}
        });
        if (res.ok) {
            if (unreadNotificationsCount > 0) unreadNotificationsCount--;
            updateNotificationBadge();
            const el = document.querySelector(`.post[data-notif-id="${id}"]`);
            if (el) { el.classList.remove('unread-notification'); el.querySelector('.unread-dot')?.remove(); }
        }
    } catch { /* silent */ }
}

function updateNotificationBadge() {
    const badge = document.getElementById('notification-badge');
    if (!badge) return;
    if (unreadNotificationsCount > 0) {
        badge.textContent = unreadNotificationsCount;
        badge.style.display = 'inline-block';
    } else {
        badge.style.display = 'none';
    }
}




//FUNÇÕES DE ACESSIBILIDADE

function toggleHighContrast() {
    document.body.classList.toggle('high-contrast');
    localStorage.setItem('high-contrast', document.body.classList.contains('high-contrast'));
    showToast('Alto contraste ' + (document.body.classList.contains('high-contrast') ? 'ativado' : 'desativado'), 'info');
}

function toggleLargeText() {
    document.body.classList.toggle('large-text');
    localStorage.setItem('large-text', document.body.classList.contains('large-text'));
    showToast('Texto grande ' + (document.body.classList.contains('large-text') ? 'ativado' : 'desativado'), 'info');
}

function resetAccessibility() {
    document.body.classList.remove('high-contrast', 'large-text');
    localStorage.removeItem('high-contrast');
    localStorage.removeItem('large-text');
    showToast('Acessibilidade resetada', 'info');
}

function aplicarAcessibilidadeSalva() {
    if (localStorage.getItem('high-contrast') === 'true') document.body.classList.add('high-contrast');
    if (localStorage.getItem('large-text') === 'true') document.body.classList.add('large-text');
}


// ════════════════════════════════════════
//  SETTINGS
// ════════════════════════════════════════
function openSettingsModal() {
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.innerHTML = `
        <div class="modal-content" style="max-width:480px;background:var(--bg-card);padding:36px;border-radius:var(--radius-xl);border:1px solid var(--border);">
            <span class="close-modal" id="close-settings">&times;</span>
            <h2 style="margin-bottom:24px;font-size:1.3rem;font-weight:800;letter-spacing:-0.03em;">
                <i class="fas fa-cog" style="color:var(--primary);margin-right:10px;"></i>Configurações
            </h2>
            <div class="settings-section">
                <h3>Tema</h3>
                <button class="btn-secondary-sm" onclick="confirmarBotao(this, () => mudarTema('padrao'))">🟣 Padrão</button>
                <button class="btn-secondary-sm" onclick="confirmarBotao(this, () => mudarTema('escuro'))">⚫ Escuro</button>
                <button class="btn-secondary-sm" onclick="confirmarBotao(this, () => mudarTema('claro'))">⚪ Claro</button>
            </div>
            <div class="settings-section">
                <h3>Acessibilidade</h3>
                <button class="btn-secondary-sm" onclick="confirmarBotao(this, toggleHighContrast)">Alto Contraste</button>
                <button class="btn-secondary-sm" onclick="confirmarBotao(this, toggleLargeText)">Texto Grande</button>
                <button class="btn-secondary-sm" onclick="confirmarBotao(this, resetAccessibility)">Resetar</button>
            </div>
            <div class="settings-section">
                <h3>Sidebar</h3>
                <button class="btn-secondary-sm" onclick="confirmarBotao(this, toggleSidebar)">Expandir/Recolher</button>
            </div>
            <div class="settings-section">
                <h3>Sobre</h3>
                <p style="font-size:0.88rem;color:var(--text-secondary);line-height:1.6;">
                    <strong style="color:var(--text);">Tiwitter Social v2.0</strong><br>
                    Conecte-se com o mundo de forma inovadora.
                </p>
            </div>
        </div>`;

    document.body.appendChild(modal);
    modal.querySelector('#close-settings').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

function confirmarBotao(btn, callback) {
    callback(); // executa a ação

    const textoOriginal = btn.innerHTML;
    const bgOriginal    = btn.style.background;

    btn.style.background   = '#10b981';
    btn.style.color        = '#fff';
    btn.style.boxShadow    = '0 4px 20px rgba(16,185,129,0.4)';
    btn.style.borderColor  = '#10b981';
    btn.innerHTML          = '<i class="fas fa-check"></i> Aplicado!';

    setTimeout(() => {
        btn.style.background  = bgOriginal;
        btn.style.color       = '';
        btn.style.boxShadow   = '';
        btn.style.borderColor = '';
        btn.innerHTML         = textoOriginal;
    }, 2000);
}
// ========== mudar tema =============

function mudarTema(tema) {
    document.body.classList.remove('tema-escuro', 'tema-claro');
    
    if (tema === 'escuro') {
        document.body.classList.add('tema-escuro');
    } else if (tema === 'claro') {
        document.body.classList.add('tema-claro');
    }
    
    localStorage.setItem('tema', tema);
    showToast(`Tema ${tema} aplicado!`, 'success');
}

function aplicarTemaSalvo() {
    const tema = localStorage.getItem('tema') || 'padrao';
    mudarTema(tema);
}


// ════════════════════════════════════════
//  WEBSOCKET
// ════════════════════════════════════════


function connectWebSocket() {
    try {
     const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${protocol}://${window.location.host}`;
        ws = new WebSocket('wss:https://meu-twitter-projeto-x.onrender.com');
        ws.onopen  = () => console.log('✅ WebSocket conectado');
        ws.onmessage = (event) => {
            try {
                console.log('RAW:', event.data);
                const data = JSON.parse(event.data);
                console.log('PARSED:', data);
                handleRealtime(data);
            } catch (e) {
                console.error('Parse error:', e);
            }
        };
         ws.onerror = (e) => console.error('WS error:', e);
ws.onclose = (e) => {
    console.log('WS fechado, código:', e.code, 'motivo:', e.reason);
    setTimeout(connectWebSocket, 4000);
};
    } catch { /* silent */ }
}

// ════════════════════════════════════════
//  WEBSOCKET 
// ════════════════════════════════════════

function handleWebSocketMessage(event) {
    try {
        // 🔧 CORREÇÃO: Verifica se event já é o objeto ou se precisa fazer parse
        let data;
        
        if (typeof event === 'string') {
            data = JSON.parse(event);
        } else if (event.data && typeof event.data === 'string') {
            data = JSON.parse(event.data);
        } else if (event.data && typeof event.data === 'object') {
            data = event.data;
        } else if (typeof event === 'object') {
            data = event;
        } else {
            console.error('❌ Cannot parse WebSocket data:', event);
            return;
        }
        
        console.log('📨 WebSocket message:', data);
        
        switch (data.type) {
            case 'new_post':
                if (currentView === 'home') loadPosts();
                break;
            case 'like_update':
                if (data.data && data.data.postId) {
                    updatePostLikes(data.data.postId, data.data.likes);
                }
                break;
            case 'new_comment':
                if (currentView === 'home') loadPosts();
                break;
            case 'new_message':
                if (currentView === 'messages' && currentConversation &&
                    (data.data?.from === currentConversation || data.data?.to === currentConversation)) {
                    openConversation(currentConversation);
                }
                if (data.data?.to === currentUser?.id) showToast('💬 Nova mensagem!', 'info');
                break;
            case 'follow_update':
                updateUserStats();
                if (currentView === 'profile') loadProfileData(viewingUserId || currentUser?.id);
                break;
            case 'user_updated':
                if (data.data?.id === currentUser?.id) {
                    currentUser = data.data;
                    localStorage.setItem('user', JSON.stringify(currentUser));
                    updateUI();
                }
                break;
            case 'new_notification':
                if (currentView === 'notifications') loadNotifications();
                unreadNotificationsCount++;
                updateNotificationBadge();
                showToast('🔔 Nova notificação!', 'info');
                break;
            case 'retweet_update':
                loadPosts();
                break;
            case 'post_deleted':
                if (currentView === 'home') loadPosts();
                break;
            default:
                console.log('Unknown message type:', data.type);
        }
    } catch (error) {
        console.error('❌ Error handling WebSocket message:', error);
    }
}
function handleRealtime(data) {
    switch (data.type) {
        case 'new_post':
            if (currentView === 'home') loadPosts();
            break;
        case 'like_update':
            updatePostLikes(data.data.postId, data.data.likes);
            break;
        case 'new_comment':
            if (currentView === 'home') loadPosts();
            break;
        case 'new_message':
            if (currentView === 'messages' && currentConversation &&
                (data.data.from === currentConversation || data.data.to === currentConversation)) {
                openConversation(currentConversation);
            }
            if (data.data.to === currentUser.id) showToast('💬 Nova mensagem!', 'info');
            break;
        case 'follow_update':
            updateUserStats();
            if (currentView === 'profile') loadProfileData(viewingUserId || currentUser.id);
            break;
        case 'user_updated':
            if (data.data.id === currentUser.id) {
                currentUser = data.data;
                localStorage.setItem('user', JSON.stringify(currentUser));
                updateUI();
            }
            break;
        case 'new_notification':
            if (currentView === 'notifications') loadNotifications();
            unreadNotificationsCount++;
            updateNotificationBadge();
            showToast('🔔 Nova notificação!', 'info');
            break;
        case 'retweet_update':
            loadPosts();
            break;
    }
}

// ════════════════════════════════════════
//  UTILS
// ════════════════════════════════════════
function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function escapeHtml(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

function formatTime(ts) {
    if (!ts) return '';
    const diff = (Date.now() - ts) / 1000;
    if (diff < 60)    return 'agora';
    if (diff < 3600)  return `${Math.floor(diff/60)}m`;
    if (diff < 86400) return `${Math.floor(diff/3600)}h`;
    if (diff < 604800)return `${Math.floor(diff/86400)}d`;
    return new Date(ts).toLocaleDateString('pt-BR');
}

function formatDate(ts) {
    if (!ts) return 'Data desconhecida';
    const d = new Date(ts);
    if (isNaN(d)) return 'Data inválida';
    return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

function showToast(msg, type = 'info') {
    const c     = document.getElementById('toast-container');
    if (!c) return;
    const icons = { success:'fa-circle-check', error:'fa-circle-exclamation', warning:'fa-triangle-exclamation', info:'fa-circle-info' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<div style="display:flex;align-items:center;gap:10px;"><i class="fas ${icons[type] || icons.info}"></i><span>${msg}</span></div>`;
    c.appendChild(toast);
    setTimeout(() => { toast.style.transition = 'opacity 0.3s'; toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3000);
}

function togglePassword() {
    const passwordInput = document.getElementById('password');
    const toggleIcon = document.getElementById('toggle-password');

    if (passwordInput.type === 'password') {
        passwordInput.type = 'text';
        toggleIcon.classList.remove('fa-eye');
        toggleIcon.classList.add('fa-eye-slash');
    } else {
        passwordInput.type = 'password';
        toggleIcon.classList.remove('fa-eye-slash');
        toggleIcon.classList.add('fa-eye');
    }
}

let lastPostsSnapshot = '';
let pollingInterval   = null;


//updates em geral (likes, comentários, retweets) para manter a interface atualizada mesmo sem websocket
async function pollUpdates() {
    try {
        const res   = await fetch(`${API_URL}/posts`);
        const posts = await res.json();

        // Compara o estado atual com o anterior
        const snapshot = JSON.stringify(posts.map(p => ({
            id:       p.id,
            likes:    p.likes?.length,
            retweets: p.retweets?.length,
            comments: p.comments?.length
        })));

        if (snapshot !== lastPostsSnapshot) {
            lastPostsSnapshot = snapshot;
            allPosts = posts;
            filterAndDisplayPosts(); // usa sua função existente
        }
    } catch {
        // servidor offline — polling tenta de novo no próximo ciclo
    }
}

function startPolling(intervalMs = 5000) {
    if (pollingInterval) return; // evita duplicar
    pollUpdates(); // roda imediatamente
    pollingInterval = setInterval(pollUpdates, intervalMs);
}

function stopPolling() {
    clearInterval(pollingInterval);
    pollingInterval = null;
}

