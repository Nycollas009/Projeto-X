require('dotenv').config();

const express = require('express');
const fs = require('fs');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const jwt = require('jsonwebtoken'); //jsonwebtoken
const bcrypt = require('bcrypt');
const helmet = require('helmet'); //helmet

const app    = express();
const server = http.createServer(app);
const port   = process.env.PORT || 3000;


const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error('❌ JWT_SECRET não definido no .env — o servidor não vai iniciar sem isso.');
    process.exit(1);
}

// Helmet adiciona vários cabeçalhos de segurança de uma vez (evita clickjacking,
// esconde que é Express, evita sniffing de MIME type, etc).
// contentSecurityPolicy fica desligado porque o front usa fontes/ícones de CDNs
// externos (Google Fonts, cdnjs, Cloudflare Turnstile) e uma CSP restrita
// quebraria esses recursos sem configuração adicional — mas todos os outros
// cabeçalhos do helmet continuam ativos.
app.use(helmet({ contentSecurityPolicy: false }));

// Só os domínios abaixo podem chamar essa API diretamente pelo navegador.
// Antes, cors() sem opções liberava geral para qualquer site.
const origensPermitidas = [
    'https://meu-twitter-projeto-x.onrender.com', 
    'http://localhost:3000',                       
];
app.use(cors({
    origin: (origin, callback) => {
        // requisições sem "origin" (ex: apps mobile, curl, Postman) continuam liberadas;
        // isso é comum e não é o que queremos bloquear aqui.
        if (!origin || origensPermitidas.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Origem não permitida pelo CORS'));
        }
    }
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static('public'));

const DB_FILE = './database.json';

if (!fs.existsSync(DB_FILE)) {
    const initialDB = { users: [], posts: [], messages: [], notifications: [] };
    fs.writeFileSync(DB_FILE, JSON.stringify(initialDB, null, 2));
}

const readDB = () => JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
const writeDB = (data) => fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));


//  JWT — geração e verificação


function gerarToken(user) {
    // O token guarda só o id — é a "identidade" que o servidor vai confiar,
    // nunca mais o userId que vem solto no body/params.
    return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
}

// Middleware: exige um token válido em qualquer rota protegida.
// Uso: app.patch('/users/:id', autenticar, (req, res) => { ... req.usuarioLogado.id ... })
function autenticar(req, res, next) {
    const authHeader = req.headers.authorization; // formato: "Bearer <token>"
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Token de autenticação ausente.' });
    }

    jwt.verify(token, JWT_SECRET, (err, payload) => {
        if (err) return res.status(403).json({ error: 'Token inválido ou expirado.' });
        req.usuarioLogado = payload; // { id, username }
        next();
    });
}

// Middleware: além de autenticar, garante que o dono do recurso é quem
// está pedindo. Compara req.usuarioLogado.id com o :id da URL ou userId do body.
function exigirDono(campoId = 'id') {
    return (req, res, next) => {
        const idAlvo = req.params[campoId] || req.body.userId;
        if (String(req.usuarioLogado.id) !== String(idAlvo)) {
            return res.status(403).json({ error: 'Você não tem permissão para essa ação.' });
        }
        next();
    };
}

const wss = new WebSocket.Server({ server });
let connectedClients = []; // agora guardamos { ws, userId }

wss.on('connection', (ws) => {
    console.log('🔌 Novo cliente conectado');
    // O cliente deve mandar { type: 'identify', userId } assim que conectar,
    // pra sabermos pra quem pertence esse socket (necessário pra Fase 3 — mensagens privadas).
    ws.userId = null;
    connectedClients.push(ws);

    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw);
            if (msg.type === 'identify' && msg.userId) {
                ws.userId = String(msg.userId);
            }
        } catch { /* ignora mensagens que não são JSON de controle */ }
    });

    ws.on('close', () => {
        console.log('🔌 Cliente desconectado');
        connectedClients = connectedClients.filter(client => client !== ws);
    });
});

// Broadcast "público" (posts, likes, retweets, comentários) — continua igual.
function broadcastUpdate(type, data) {
    connectedClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type, data }));
        }
    });
}

// Envia só para os sockets de um usuário específico (usado nas Fase 3, mensagens/notificações privadas)
function sendToUser(userId, type, data) {
    connectedClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.userId === String(userId)) {
            client.send(JSON.stringify({ type, data }));
        }
    });
}

// Controle de spam
const spamControl = new Map();
function verificarSpam(userId, tipo, intervaloMs = 3000) {
    const chave = `${userId}-${tipo}`;
    const agora = Date.now();
    const ultimo = spamControl.get(chave) || 0;
    if (agora - ultimo < intervaloMs) return true;
    spamControl.set(chave, agora);
    return false;
}

// Rate limit simples de tentativas de login por username (Fase 5, incluído aqui por ser barato)
const loginAttempts = new Map(); // username -> { count, blockedUntil }
function loginBloqueado(username) {
    const entry = loginAttempts.get(username);
    if (!entry) return false;
    if (entry.blockedUntil && Date.now() < entry.blockedUntil) return true;
    return false;
}
function registrarTentativaFalha(username) {
    const entry = loginAttempts.get(username) || { count: 0, blockedUntil: null };
    entry.count++;
    if (entry.count >= 5) {
        entry.blockedUntil = Date.now() + 5 * 60 * 1000; // 5 min de bloqueio após 5 erros
        entry.count = 0;
    }
    loginAttempts.set(username, entry);
}
function limparTentativas(username) {
    loginAttempts.delete(username);
}

function validarSenha(password) {
    if (password.length < 6) return 'A senha deve ter no mínimo 6 caracteres!';
    if (password.length > 20) return 'A senha deve ter no máximo 20 caracteres!';
    if (!/[A-Z]/.test(password)) return 'A senha deve ter pelo menos uma letra maiúscula!';
    if (!/[0-9]/.test(password)) return 'A senha deve ter pelo menos um número!';
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password))
        return 'A senha deve ter pelo menos um caractere especial (!@#$%...)!';
    return null;
}

function validarCadastro(dados) {
    const { username, password, email, nomeCompleto, telefone, dataNascimento } = dados;
    if (!username || username.length < 3) return 'Nome de usuário deve ter no mínimo 3 caracteres!';
    if (!nomeCompleto || nomeCompleto.trim().split(' ').length < 2) return 'Digite seu nome completo!';
    if (!email || !email.includes('@')) return 'Email inválido!';
    if (!telefone || telefone.replace(/\D/g, '').length < 10) return 'Telefone inválido!';
    if (!dataNascimento) return 'Data de nascimento obrigatória!';

    const nascimento = new Date(dataNascimento);
    const hoje = new Date();
    let idade = hoje.getFullYear() - nascimento.getFullYear();
    const aniversarioPassou = (
        hoje.getMonth() > nascimento.getMonth() ||
        (hoje.getMonth() === nascimento.getMonth() && hoje.getDate() >= nascimento.getDate())
    );
    if (!aniversarioPassou) idade--;
    if (idade < 18) return 'Você precisa ter 18 anos ou mais para se cadastrar!';

    const erroSenha = validarSenha(password);
    if (erroSenha) return erroSenha;
    return null;
}

async function verificarTurnstile(token) {
    if (!token) return { ok: false, status: 400, error: 'Confirme que você não é um robô!' };
    try {
        const fetch = (await import('node-fetch')).default;
        const verify = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY, response: token })
        });
        const data = await verify.json();
        if (!data.success) return { ok: false, status: 403, error: 'Captcha inválido!' };
        return { ok: true };
    } catch (err) {
        console.error('Erro ao validar captcha:', err);
        return { ok: false, status: 500, error: 'Erro ao validar captcha. Tente novamente.' };
    }
}

// ========== CADASTRO ==========
app.post('/register', async (req, res) => {
    const { username, password, email, nomeCompleto, telefone, dataNascimento, termoAceito, 'cf-turnstile-response': token } = req.body;

    const captcha = await verificarTurnstile(token);
    if (!captcha.ok) return res.status(captcha.status).json({ error: captcha.error });

    if (!termoAceito) return res.status(400).json({ error: 'Você precisa aceitar os Termos de Uso!' });
    if (contemPalavrasProibidas(nomeCompleto)) return res.status(400).json({ error: 'Nome completo contém conteúdo inapropriado!' });
    if (contemPalavrasProibidas(username)) return res.status(400).json({ error: 'Nome de usuário contém conteúdo inapropriado!' });

    const erro = validarCadastro({ username, password, email, nomeCompleto, telefone, dataNascimento });
    if (erro) return res.status(400).json({ error: erro });

    const db = readDB();
    if (db.users.find(u => u.username.toLowerCase() === username.toLowerCase()))
        return res.status(409).json({ error: 'Nome de usuário já existe!' });
    if (db.users.find(u => u.email === email.toLowerCase()))
        return res.status(409).json({ error: 'Email já cadastrado!' });

    const newUser = {
        id: Date.now().toString() + Math.random().toString(36).slice(2, 8), // menos previsível
        username,
        password: bcrypt.hashSync(password, 10),
        email: email.toLowerCase(),
        nomeCompleto: nomeCompleto.trim(),
        telefone: telefone.replace(/\D/g, ''),
        dataNascimento,
        termoAceito: true,
        termoAceitoEm: new Date().toISOString(),
        avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${username}`,
        coverImage: '',
        bio: '✨ Novo no Tiwitter!',
        location: '',
        website: '',
        joinDate: new Date().toISOString(),
        following: [],
        followers: [],
    };

    db.users.push(newUser);
    writeDB(db);

    const token_jwt = gerarToken(newUser);
    const { password: _, telefone: __, email: ___, dataNascimento: ____, ...userPublico } = newUser;
    res.json({ user: userPublico, token: token_jwt });
});

// ========== LOGIN ==========
app.post('/login', async (req, res) => {
    const { username, password, 'cf-turnstile-response': token } = req.body;

    if (loginBloqueado(username)) {
        return res.status(429).json({ error: 'Muitas tentativas erradas. Tente novamente em alguns minutos.' });
    }

    const captcha = await verificarTurnstile(token);
    if (!captcha.ok) return res.status(captcha.status).json({ error: captcha.error });

    const db = readDB();
    const user = db.users.find(u => u.username === username);

    if (!user) {
        registrarTentativaFalha(username);
        return res.status(404).json({ error: 'Usuário não encontrado!' });
    }

    const senhaCorreta = bcrypt.compareSync(password, user.password);
    if (!senhaCorreta) {
        registrarTentativaFalha(username);
        return res.status(401).json({ error: 'Senha incorreta!' });
    }

    limparTentativas(username);
    const token_jwt = gerarToken(user);
    const { password: _, telefone: __, email: ___, dataNascimento: ____, ...userPublico } = user;
    res.json({ user: userPublico, token: token_jwt });
});

// Bloquear sites impróprios (lista mantida igual à original)
const dominiosBloqueados = [
    'pornhub', 'xvideos', 'xnxx', 'xhamster', 'redtube', 'youporn', 'brazzers', 'onlyfans',
    'chaturbate', 'cam4', 'livejasmin', 'bongacams', 'stripchat', 'myfreecams', 'spankbang',
    'eporner', 'tube8', 'drtuber', 'tnaflix', 'porntrex', 'anyporn', 'beeg', 'txxx', 'hclips',
    'porn', 'sex', 'xxx', 'adult', 'erotic', 'nudes', 'lewd', 'hentai', 'rule34', 'gelbooru',
    'danbooru', 'e621', 'nhentai', 'hanime', 'xgroovy', 'xmasters', 'fuq', 'porndig', 'javhd',
    'jav', 'javmost', 'javbus', 'asiansex', 'asianporn', 'asianhd', 'sex8', 'sexvid', 'sexix',
    'sextu', 'sexyoutube', 'camwhores', 'camvideos', 'camcrush', 'camdolls', 'camsoda', 'fansly',
    'manyvids', 'clips4sale', 'naughtyamerica', 'realitykings', 'mofos', 'bangbros',
    'digitalplayground', 'elegantangel', 'wicked', 'vivid', 'hustler', 'penthouse', 'playboy',
    'met-art', 'liveleak', 'bestgore', 'goregrish', 'rotten', 'ogrish', 'watchpeoplediee',
    'nowthisisfuckedup', 'theync', 'kaotic', 'deadhouse', 'documenting', 'crazyshit',
    'shockgore', 'gorezone', 'uncoverreality', 'morbidreality', 'sickipedia', 'stileproject',
    'efukt', 'thechainsawresistance', 'silkroad', 'darkweb', 'deepweb', 'drugs', 'buycocaine',
    'buyweed', 'onlinecocaine', 'drugsforum', 'shroomery', 'bluelight', 'drugbuyersguide',
    'heroin', 'methamphetamine', 'gunbroker', 'buyguns', 'ghostgunner', 'weaponsmarket',
    'illegalweapons', 'buyammo', 'darknetguns', 'thepiratebay', 'kickass', 'rarbg', '1337x',
    'nyaa', 'fmovies', 'gomovies', 'putlocker', '123movies', 'solarmovie', 'yesmovies',
    'lookmovie', 'soap2day', 'movies123', 'azmovies', 'cmovies', 'bmovies', 'hdmovie',
    'torrentz', 'torrent', 'piratebay', 'limetorrents', 'zooqle', 'magnetdl', 'torrentseed',
    'skidrowreloaded', 'fitgirl', 'oceanofgames', 'steamunlocked', 'igg-games', 'crackwatch',
    'repacklab', 'bet365', 'sportingbet', 'pixbet', 'betano', 'betfair', 'williamhill',
    'ladbrokes', 'paddy', 'unibet', 'bwin', '888sport', 'betway', 'draftkings', 'fanduel',
    'bovada', 'betonline', 'mybookie', 'xbet', 'betus', 'jazzsports', 'stormfront',
    'dailystormer', 'therightstuff', 'vanguardnews', 'occidentaldissent', 'amren',
    'radixjournal', 'counter-currents', 'unz', 'infostormer', 'neonrevolt', 'kiwifarms',
    'gab', 'voat', 'poal', 'wimkin', 'mewe', 'clickbait', 'earnmoney', 'makemoneyfast',
    'getrichquick', 'freebitcoin', 'cryptoscam', 'nftscam', 'ponzi', 'pyramidscheme',
];

function urlBloqueada(url) {
    if (!url) return false;
    const urlLower = url.toLowerCase();
    return dominiosBloqueados.some(dominio => urlLower.includes(dominio));
}

// Bloquear esquemas perigosos em links de perfil (corrige XSS via javascript:)
function esquemaSeguro(url) {
    if (!url) return true;
    const limpa = url.trim().toLowerCase();
    return !limpa.startsWith('javascript:') && !limpa.startsWith('data:') && !limpa.startsWith('vbscript:');
}

// ════════════════════════════════════════
//  GIPHY / WEATHER — chaves agora vêm do .env
//  Adicione no .env:
//    GIPHY_API_KEY=...
//    OPENWEATHER_API_KEY=...
// ════════════════════════════════════════
app.get('/giphy', async (req, res) => {
    const { q } = req.query;
    try {
        const fetch = (await import('node-fetch')).default;
        const response = await fetch(
            `https://api.giphy.com/v1/gifs/search?api_key=${process.env.GIPHY_API_KEY}&q=${encodeURIComponent(q)}&limit=12&lang=pt&rating=pg`
        );
        const data = await response.json();
        res.json(data);
    } catch {
        res.status(500).json({ error: 'Erro ao buscar GIFs' });
    }
});

app.get('/weather', async (req, res) => {
    const { lat, lon } = req.query;
    try {
        const fetch = (await import('node-fetch')).default;
        const response = await fetch(
            `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${process.env.OPENWEATHER_API_KEY}&units=metric&lang=pt_br`
        );
        const data = await response.json();
        res.json(data);
    } catch {
        res.status(500).json({ error: 'Erro ao buscar clima' });
    }
});

function contemLink(texto) {
    const urlRegex = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|([^\s]+\.(com|net|org|br|io|co|gg|tv|me|app|dev)[^\s]*)/gi;
    return urlRegex.test(texto);
}

// ========== USUÁRIOS ==========
// PII removida: telefone, email e dataNascimento nunca mais saem em listagens públicas.
function paraPublico(user) {
    const { password, telefone, email, dataNascimento, ...publico } = user;
    return publico;
}

app.get('/users', (req, res) => {
    const db = readDB();
    res.json(db.users.map(paraPublico));
});

app.get('/users/:id', (req, res) => {
    const db = readDB();
    const user = db.users.find(u => u.id === req.params.id);
    if (user) res.json(paraPublico(user));
    else res.status(404).json({ error: "Usuário não encontrado" });
});

app.get('/trending', async (req, res) => {
    try {
        const fetch = (await import('node-fetch')).default;
        const response = await fetch(`https://gnews.io/api/v4/top-headlines?lang=pt&country=br&max=5&token=${process.env.GNEWS_API_KEY}`);
        const data = await response.json();
        res.json(data);
    } catch {
        res.status(500).json({ error: 'Erro ao buscar notícias' });
    }
});

app.get('/posts/search', (req, res) => {
    const { q } = req.query;
    const db = readDB();
    if (!q) return res.json([]);
    const termo = q.toLowerCase();
    const posts = db.posts.filter(p => p.content && p.content.toLowerCase().includes(termo));
    res.json(posts.sort((a, b) => b.timestamp - a.timestamp));
});

// 🔒 Agora exige token + ser o dono do perfil (antes: qualquer um podia editar qualquer perfil)
app.patch('/users/:id', autenticar, exigirDono('id'), (req, res) => {
    const { id } = req.params;
    const { avatar, coverImage, bio, location, website } = req.body;
    const db = readDB();
    const userIndex = db.users.findIndex(u => u.id === id);

    if (website && !esquemaSeguro(website)) {
        return res.status(400).json({ error: 'Link inválido no site do perfil!' });
    }
    if (website && urlBloqueada(website)) {
        return res.status(400).json({ error: 'Este site não é permitido no perfil!' });
    }
    if (location && contemPalavrasProibidas(location)) {
        return res.status(400).json({ error: 'Localização contém conteúdo inapropriado!' });
    }
    if (location && contemLink(location)) {
        return res.status(400).json({ error: 'Localização não pode conter links!' });
    }

    if (userIndex !== -1) {
        if (avatar !== undefined) db.users[userIndex].avatar = avatar;
        if (coverImage !== undefined) db.users[userIndex].coverImage = coverImage;
        if (bio !== undefined) db.users[userIndex].bio = bio;
        if (location !== undefined) db.users[userIndex].location = location;
        if (website !== undefined) db.users[userIndex].website = website;
        writeDB(db);

        const updatedUser = paraPublico(db.users[userIndex]);
        broadcastUpdate('user_updated', updatedUser);
        res.json(updatedUser);
    } else {
        res.status(404).json({ error: "Usuário não encontrado" });
    }
});

// 🔒 Seguir/deixar de seguir agora exige token — o followerId tem que ser o dono do token
app.post('/users/follow', autenticar, (req, res) => {
    const { followingId } = req.body;
    const followerId = req.usuarioLogado.id;
    const db = readDB();

    const follower = db.users.find(u => u.id === followerId);
    const following = db.users.find(u => u.id === followingId);

    if (follower && following) {
        if (!follower.following.includes(followingId)) {
            follower.following.push(followingId);
            following.followers.push(followerId);
            writeDB(db);

            const notification = {
                id: Date.now().toString(),
                userId: followingId,
                type: 'follow',
                fromUser: { id: followerId, username: follower.username, avatar: follower.avatar },
                content: `${follower.username} começou a seguir você`,
                read: false,
                timestamp: Date.now()
            };
            db.notifications.push(notification);
            writeDB(db);

            broadcastUpdate('follow_update', { followerId, followingId, action: 'follow' });
            sendToUser(followingId, 'new_notification', notification);
            res.json({ success: true, message: 'Agora você está seguindo!' });
        } else {
            res.json({ success: false, message: 'Já está seguindo' });
        }
    } else {
        res.status(404).json({ error: "Usuário não encontrado" });
    }
});

app.post('/users/unfollow', autenticar, (req, res) => {
    const { followingId } = req.body;
    const followerId = req.usuarioLogado.id;
    const db = readDB();

    const follower = db.users.find(u => u.id === followerId);
    const following = db.users.find(u => u.id === followingId);

    if (follower && following) {
        follower.following = follower.following.filter(id => id !== followingId);
        following.followers = following.followers.filter(id => id !== followerId);
        writeDB(db);
        broadcastUpdate('follow_update', { followerId, followingId, action: 'unfollow' });
        res.json({ success: true, message: 'Você deixou de seguir' });
    } else {
        res.status(404).json({ error: "Usuário não encontrado" });
    }
});

// CENSURA (lista mantida igual à original, sem alterações de conteúdo)
const palavrasProibidas = [
    'porra', 'porr4', 'p0rra', 'porras', 'merda', 'merd4', 'm3rda', 'merdas',
    'caralho', 'c4ralho', 'car4lho', 'caralh0', 'foda', 'f0da', 'fodas', 'fode',
    'fodendo', 'fodido', 'fodida', 'buceta', 'buc3ta', 'buc4ta', 'bucetas', 'cu',
    'cú', 'cuzao', 'cuzão', 'puta', 'put4', 'putas', 'putaria', 'vagabunda',
    'vagabundo', 'vag4bunda', 'safado', 'safada', 'saf4do', 'piranha', 'pir4nha',
    'prostituta', 'prostituto', 'punheta', 'punh3ta', 'arrombado', 'arrombada',
    'cacete', 'cac3te', 'pau', 'rola', 'xoxota', 'fdp', 'filhadaputa',
    'filho da puta', 'filho de puta', 'vsf', 'vai se foder', 'vai se fuder', 'tnc',
    'toma no cu', 'pqp', 'krl', 'krlh', 'babaca', 'bab4ca', 'retardado', 'retardada',
    'ret4rdado', 'imbecil', 'idiota', 'idi0ta', 'canalha', 'desgraça', 'desgraçado',
    'penis', 'pênis', 'feminazi', 'histérica', 'histérico', 'mulher no volante',
    'lugar de mulher', 'mulher não presta', 'vai lavar louça', 'vai cozinhar',
    'vai ter filho', 'mulher burra', 'mulher idiota', 'sua vez de calar',
    'cala boca mulher', 'fresca', 'pirua', 'vaca', 'galinha', 'rapariga',
    'mulher é objeto', 'mulher é propriedade', 'vadia', 'putinha', 'putiane',
    'sua puta', 'macaco', 'macacada', 'nego', 'nega', 'neguinho', 'crioulo',
    'crioula', 'preto safado', 'preta safada', 'volta pra africa',
    'volta para a africa', 'escravidão deveria voltar', 'raça inferior',
    'raça ruim', 'cabelo ruim', 'nariz de macaco', 'nordestino burro',
    'baiano burro', 'paraíba', 'pau de arara', 'amarelado', 'olho puxado',
    'japonês de merda', 'chinês de merda', 'viado', 'vi4do', 'viad0', 'viadinho',
    'sapatão', 'sapat4o', 'traveco', 'trav3co', 'bicha', 'bich4', 'gay de merda',
    'lésbica de merda', 'cura gay', 'gay tem cura', 'abominação',
    'doença mental gay', 'família normal', 'família de verdade', 'isso é pecado',
    'vai pro inferno gay', 'homossexualismo', 'judeu safado', 'judeu de merda',
    'muçulmano terrorista', 'islâmico terrorista', 'evangélico hipócrita',
    'crente de merda', 'ateu sem moral', 'gordo inútil', 'gordo nojento',
    'gorda nojenta', 'aleijado', 'aleijada', 'mongolóide', 'mongol',
    'louco de hospício', 'maluco de hospício', 'pobre vagabundo', 'pobre inútil',
    'favelado', 'favelada', 'mendigo inútil', 'mendigo de merda',
    'deficiente inútil', 'deficiente mental', 'esquizofrênico', 'autista',
];

function contemPalavrasProibidas(texto) {
    if (!texto) return false;
    const textoLower = texto.toLowerCase();
    return palavrasProibidas.some(palavra => textoLower.includes(palavra));
}

// ========== POSTS ==========
app.get('/posts', (req, res) => {
    const db = readDB();
    res.json(db.posts.sort((a, b) => b.timestamp - a.timestamp));
});

app.get('/posts/user/:userId', (req, res) => {
    const db = readDB();
    const userPosts = db.posts.filter(p => p.userId === req.params.userId);
    res.json(userPosts.sort((a, b) => b.timestamp - a.timestamp));
});

// 🔒 Exige token; o userId do post passa a vir do token, não do body
app.post('/posts', autenticar, (req, res) => {
    const userId = req.usuarioLogado.id;
    const { username, avatar, content, imageUrl } = req.body;

    if (verificarSpam(userId, 'post', 10000)) {
        return res.status(429).json({ error: 'Aguarde antes de postar novamente!' });
    }
    if (contemPalavrasProibidas(content)) {
        return res.status(400).json({ error: 'Post contém conteúdo inapropriado!' });
    }
    if (contemLink(content)) {
        return res.status(403).json({ error: 'Posts com links não são permitidos!' });
    }

    const db = readDB();
    const newPost = {
        id: Date.now().toString() + Math.random().toString(36).slice(2, 8),
        userId, username, avatar, content,
        imageUrl: imageUrl || null,
        likes: [], comments: [], retweets: [],
        timestamp: Date.now()
    };
    db.posts.push(newPost);
    writeDB(db);

    broadcastUpdate('new_post', newPost);
    res.json(newPost);
});

// 🔒 Só o dono do post consegue excluir (validado pelo token, não pelo body)
app.delete('/posts/:postId', autenticar, exigirDono(), (req, res) => {
    const { postId } = req.params;
    const userId = req.usuarioLogado.id;
    const db = readDB();

    const postIndex = db.posts.findIndex(p => p.id === postId);
    if (postIndex !== -1 && db.posts[postIndex].userId === userId) {
        db.posts.splice(postIndex, 1);
        writeDB(db);
        broadcastUpdate('post_deleted', { postId, userId });
        res.json({ success: true, message: 'Post excluído com sucesso!' });
    } else {
        res.status(403).json({ error: "Você não tem permissão para excluir este post" });
    }
});

app.post('/posts/like', autenticar, (req, res) => {
    const { postId } = req.body;
    const userId = req.usuarioLogado.id;
    const db = readDB();
    const post = db.posts.find(p => String(p.id) === String(postId));
    if (!post) return res.status(404).json({ error: "Post não encontrado" });

    if (!post.likes) post.likes = [];
    const likeIndex = post.likes.findIndex(id => String(id) === String(userId));

    if (likeIndex === -1) {
        post.likes.push(String(userId));
        if (String(post.userId) !== String(userId)) {
            const liker = db.users.find(u => String(u.id) === String(userId));
            if (liker) {
                const notification = {
                    id: Date.now().toString(),
                    userId: post.userId,
                    type: 'like',
                    fromUser: { id: liker.id, username: liker.username, avatar: liker.avatar || '' },
                    content: `${liker.username} curtiu seu post`,
                    postId: String(postId),
                    read: false,
                    timestamp: Date.now()
                };
                db.notifications.push(notification);
                sendToUser(post.userId, 'new_notification', notification);
            }
        }
    } else {
        post.likes.splice(likeIndex, 1);
    }

    writeDB(db);
    broadcastUpdate('like_update', { postId: String(postId), likes: post.likes });
    res.json({ likes: post.likes });
});

// (rota /posts/retweet duplicada foi removida — só existe uma versão agora)
app.post('/posts/retweet', autenticar, (req, res) => {
    const { postId } = req.body;
    const userId = req.usuarioLogado.id;
    const db = readDB();
    const post = db.posts.find(p => String(p.id) === String(postId));
    if (!post) return res.status(404).json({ error: "Post não encontrado" });

    if (!post.retweets) post.retweets = [];
    const retweetIndex = post.retweets.findIndex(id => String(id) === String(userId));
    let isRetweeting = false;

    if (retweetIndex === -1) {
        post.retweets.push(String(userId));
        isRetweeting = true;
    } else {
        post.retweets.splice(retweetIndex, 1);
    }
    writeDB(db);

    if (isRetweeting && String(post.userId) !== String(userId)) {
        const retweeter = db.users.find(u => String(u.id) === String(userId));
        if (retweeter) {
            const notification = {
                id: Date.now().toString(),
                userId: post.userId,
                type: 'retweet',
                fromUser: { id: retweeter.id, username: retweeter.username, avatar: retweeter.avatar },
                content: `${retweeter.username} retweetou seu post`,
                postId: String(postId),
                read: false,
                timestamp: Date.now()
            };
            db.notifications.push(notification);
            sendToUser(post.userId, 'new_notification', notification);
        }
    }

    broadcastUpdate('retweet_update', { postId: String(postId), retweets: post.retweets });
    res.json({ retweets: post.retweets });
});

app.post('/posts/comment', autenticar, (req, res) => {
    const userId = req.usuarioLogado.id;
    const { postId, username, avatar, content } = req.body;

    if (verificarSpam(userId, 'comment', 5000)) {
        return res.status(429).json({ error: 'Aguarde antes de comentar novamente!' });
    }
    if (contemPalavrasProibidas(content)) {
        return res.status(400).json({ error: 'Comentário contém conteúdo inapropriado!' });
    }
    if (contemLink(content)) {
        return res.status(403).json({ error: 'Comentários com links não são permitidos!' });
    }

    const db = readDB();
    const post = db.posts.find(p => p.id === postId);
    if (!post) return res.status(404).json({ error: "Post não encontrado" });

    const comment = { id: Date.now().toString(), userId, username, avatar, content, timestamp: Date.now() };
    post.comments.push(comment);
    writeDB(db);

    const postOwner = db.users.find(u => u.id === post.userId);
    if (postOwner && postOwner.id !== userId) {
        const notification = {
            id: Date.now().toString(),
            userId: post.userId,
            type: 'comment',
            fromUser: { id: userId, username, avatar },
            content: `${username} comentou no seu post: "${content.substring(0, 50)}..."`,
            postId,
            read: false,
            timestamp: Date.now()
        };
        db.notifications.push(notification);
        writeDB(db);
        sendToUser(post.userId, 'new_notification', notification);
    }

    broadcastUpdate('new_comment', { postId, comment });
    res.json({ success: true, comment });
});

app.delete('/posts/:postId/comments/:commentId', autenticar, (req, res) => {
    const { postId, commentId } = req.params;
    const userId = req.usuarioLogado.id;
    const db = readDB();

    const post = db.posts.find(p => String(p.id) === String(postId));
    if (!post) return res.status(404).json({ error: 'Post não encontrado' });

    const commentIndex = post.comments.findIndex(c =>
        String(c.id) === String(commentId) && String(c.userId) === String(userId)
    );
    if (commentIndex === -1) return res.status(403).json({ error: 'Sem permissão' });

    post.comments.splice(commentIndex, 1);
    writeDB(db);
    broadcastUpdate('comment_deleted', { postId, commentId });
    res.json({ success: true });
});

// ========== MENSAGENS ==========
app.get('/messages/:userId/:otherUserId', autenticar, (req, res) => {
    const db = readDB();
    const { userId, otherUserId } = req.params;

    // Só os dois participantes da conversa podem ler
    if (![userId, otherUserId].includes(req.usuarioLogado.id)) {
        return res.status(403).json({ error: 'Sem permissão para ver essa conversa' });
    }

    const messages = db.messages.filter(m =>
        (m.from === userId && m.to === otherUserId) ||
        (m.from === otherUserId && m.to === userId)
    ).sort((a, b) => a.timestamp - b.timestamp);
    res.json(messages);
});

app.post('/messages', autenticar, (req, res) => {
    const from = req.usuarioLogado.id;
    const { to, content } = req.body;

    if (verificarSpam(from, 'message', 2000)) {
        return res.status(429).json({ error: 'Aguarde antes de enviar outra mensagem!' });
    }
    if (contemPalavrasProibidas(content)) {
        return res.status(400).json({ error: 'Mensagem contém conteúdo inapropriado!' });
    }
    if (contemLink(content)) {
        return res.status(403).json({ error: 'Mensagens com links não são permitidas!' });
    }

    const db = readDB();
    const message = { id: Date.now().toString(), from, to, content, timestamp: Date.now(), read: false };
    db.messages.push(message);
    writeDB(db);

    // Agora só vai para os dois envolvidos, não para todo mundo conectado
    sendToUser(from, 'new_message', message);
    sendToUser(to, 'new_message', message);
    res.json(message);
});

app.delete('/messages/:messageId', autenticar, (req, res) => {
    const { messageId } = req.params;
    const userId = req.usuarioLogado.id;
    const db = readDB();

    const messageIndex = db.messages.findIndex(m => m.id === messageId);
    if (messageIndex !== -1) {
        const message = db.messages[messageIndex];
        if (message.from === userId) {
            db.messages.splice(messageIndex, 1);
            writeDB(db);
            sendToUser(message.from, 'message_deleted', { messageId });
            sendToUser(message.to, 'message_deleted', { messageId });
            res.json({ success: true, message: 'Mensagem excluída com sucesso!' });
        } else {
            res.status(403).json({ error: "Você não tem permissão para excluir esta mensagem" });
        }
    } else {
        res.status(404).json({ error: "Mensagem não encontrada" });
    }
});

app.post('/messages/:messageId/like', autenticar, (req, res) => {
    const { messageId } = req.params;
    const userId = req.usuarioLogado.id;
    const db = readDB();

    const message = db.messages.find(m => m.id === messageId);
    if (message) {
        if (!message.likedBy) message.likedBy = [];
        const likeIndex = message.likedBy.indexOf(userId);
        let isLiked = false;
        if (likeIndex === -1) { message.likedBy.push(userId); isLiked = true; }
        else message.likedBy.splice(likeIndex, 1);

        writeDB(db);
        sendToUser(message.from, 'message_like_update', { messageId, likedBy: message.likedBy });
        sendToUser(message.to, 'message_like_update', { messageId, likedBy: message.likedBy });
        res.json({ liked: isLiked, likedBy: message.likedBy });
    } else {
        res.status(404).json({ error: "Mensagem não encontrada" });
    }
});

// ========== NOTIFICAÇÕES ==========
app.get('/notifications/:userId', autenticar, exigirDono('userId'), (req, res) => {
    const db = readDB();
    const notifications = db.notifications.filter(n => n.userId === req.params.userId);
    res.json(notifications.sort((a, b) => b.timestamp - a.timestamp));
});

app.post('/notifications/:notificationId/read', autenticar, (req, res) => {
    const { notificationId } = req.params;
    const db = readDB();
    const notification = db.notifications.find(n => n.id === notificationId);
    if (notification) {
        if (notification.userId !== req.usuarioLogado.id) {
            return res.status(403).json({ error: 'Sem permissão' });
        }
        notification.read = true;
        writeDB(db);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: "Notificação não encontrada" });
    }
});

server.listen(port, '0.0.0.0', () => {
    console.log(`\n🚀 Tiwitter Social rodando em http://localhost:${port}`);
    console.log(`📡 WebSocket ativo para atualizações em tempo real`);
    console.log(`✨ Layout pronto para apresentação!\n`);
});
