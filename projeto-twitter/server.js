const express = require('express');
const fs = require('fs');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app    = express();
const server = http.createServer(app); 
const port   = process.env.PORT || 3000;


app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static('public'));

const DB_FILE = './database.json';

// Inicializar banco de dados se não existir
if (!fs.existsSync(DB_FILE)) {
    const initialDB = {
        users: [],
        posts: [],
        messages: [],
        notifications: []
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initialDB, null, 2));
}

const readDB = () => JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
const writeDB = (data) => fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));

const wss = new WebSocket.Server({ server });

let connectedClients = [];

wss.on('connection', (ws) => {
    console.log('🔌 Novo cliente conectado');
    connectedClients.push(ws);
    
    ws.on('close', () => {
        console.log('🔌 Cliente desconectado');
        connectedClients = connectedClients.filter(client => client !== ws);
    });
});

function broadcastUpdate(type, data) {
    connectedClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type, data }));
        }
    });
}

//Controle de spam
const spamControl = new Map(); 

function verificarSpam(userId, tipo, intervaloMs = 3000) {
    const chave = `${userId}-${tipo}`;
    const agora = Date.now();
    const ultimo = spamControl.get(chave) || 0;

    if (agora - ultimo < intervaloMs) {
        return true; // é spam
    }

    spamControl.set(chave, agora);
    return false; // não é spam
}


const bcrypt = require('bcrypt');

function validarSenha(password) {
    if (password.length < 6)
        return 'A senha deve ter no mínimo 6 caracteres!';
    if (password.length > 20)
        return 'A senha deve ter no máximo 20 caracteres!';
    if (!/[A-Z]/.test(password))
        return 'A senha deve ter pelo menos uma letra maiúscula!';
    if (!/[0-9]/.test(password))
        return 'A senha deve ter pelo menos um número!';
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password))
        return 'A senha deve ter pelo menos um caractere especial (!@#$%...)!';
    return null;
}

function validarCadastro(dados) {
    const { username, password, email, nomeCompleto, telefone, dataNascimento } = dados;

    if (!username || username.length < 3)
        return 'Nome de usuário deve ter no mínimo 3 caracteres!';
    if (!nomeCompleto || nomeCompleto.trim().split(' ').length < 2)
        return 'Digite seu nome completo!';
    if (!email || !email.includes('@'))
        return 'Email inválido!';
    if (!telefone || telefone.replace(/\D/g, '').length < 10)
        return 'Telefone inválido!';
    if (!dataNascimento)
        return 'Data de nascimento obrigatória!';

    const nascimento = new Date(dataNascimento);
    const hoje = new Date();
    let idade = hoje.getFullYear() - nascimento.getFullYear();
    const aniversarioPassou = (
        hoje.getMonth() > nascimento.getMonth() ||
        (hoje.getMonth() === nascimento.getMonth() && hoje.getDate() >= nascimento.getDate())
    );
    if (!aniversarioPassou) idade--;
    if (idade < 18)
        return 'Você precisa ter 18 anos ou mais para se cadastrar!';

    const erroSenha = validarSenha(password);
    if (erroSenha) return erroSenha;

    return null;
}

// CADASTRO
app.post('/register', async (req, res) => {
    const { username, password, email, nomeCompleto, telefone, dataNascimento, termoAceito } = req.body;

    if (!termoAceito)
        return res.status(400).json({ error: 'Você precisa aceitar os Termos de Uso!' });

    if (contemPalavrasProibidas(nomeCompleto))
        return res.status(400).json({ error: 'Nome completo contém conteúdo inapropriado!' });

    if (contemPalavrasProibidas(username))
        return res.status(400).json({ error: 'Nome de usuário contém conteúdo inapropriado!' });


    const erro = validarCadastro({ username, password, email, nomeCompleto, telefone, dataNascimento });
    if (erro) return res.status(400).json({ error: erro });

    const db = readDB();

    if (db.users.find(u => u.username === username))
        return res.status(409).json({ error: 'Nome de usuário já existe!' });

    if (db.users.find(u => u.email === email))
        return res.status(409).json({ error: 'Email já cadastrado!' });

    const newUser = {
        id:             Date.now().toString(),
        username,
        password:       bcrypt.hashSync(password, 10),
        email:          email.toLowerCase(),
        nomeCompleto:   nomeCompleto.trim(),
        telefone:       telefone.replace(/\D/g, ''),
        dataNascimento: dataNascimento,
        termoAceito:    true,
        termoAceitoEm:  new Date().toISOString(),
        avatar:         `https://api.dicebear.com/7.x/avataaars/svg?seed=${username}`,
        coverImage:     '',
        bio:            '✨ Novo no Tiwitter!',
        location:       '',
        website:        '',
        joinDate:       new Date().toISOString(),
        following:      [],
        followers:      [],
    };

    db.users.push(newUser);
    writeDB(db);

    const { password: _, telefone: __, ...userPublico } = newUser;
    res.json({ user: userPublico });
});

// LOGIN
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const db = readDB();

    const user = db.users.find(u =>
        u.username === username || u.email === username
    );

    if (!user)
        return res.status(404).json({ error: 'Usuário não encontrado!' });

    const senhaCorreta = bcrypt.compareSync(password, user.password);
    if (!senhaCorreta)
        return res.status(401).json({ error: 'Senha incorreta!' });

    const { password: _, telefone: __, ...userPublico } = user;
    res.json({ user: userPublico });
});


// Bloquear sites impróprios (pornografia, gore, pirataria, apostas ilegais, etc)
const dominiosBloqueados = [
    // Pornografia
    'pornhub', 'xvideos', 'xnxx', 'xhamster', 'redtube', 'youporn',
    'brazzers', 'onlyfans', 'chaturbate', 'cam4', 'livejasmin',
    'bongacams', 'stripchat', 'myfreecams', 'spankbang', 'eporner',
    'tube8', 'drtuber', 'tnaflix', 'porntrex', 'anyporn', 'beeg',
    'txxx', 'hclips', 'porn', 'sex', 'xxx', 'adult', 'erotic',
    'nudes', 'lewd', 'hentai', 'rule34', 'gelbooru', 'danbooru',
    'e621', 'nhentai', 'hanime', 'xgroovy', 'xmasters', 'fuq',
    'porndig', 'ok', 'javhd', 'jav', 'javmost', 'javbus',
    'asiansex', 'asianporn', 'asianhd', 'sex8', 'sexvid',
    'sexix', 'sextu', 'sexyoutube', 'camwhores', 'camvideos',
    'camcrush', 'camdolls', 'camsoda', 'fansly', 'manyvids',
    'clips4sale', 'naughtyamerica', 'realitykings', 'mofos',
    'bangbros', 'digitalplayground', 'elegantangel', 'wicked',
    'vivid', 'hustler', 'penthouse', 'playboy', 'met-art',

    // Gore e violência extrema
    'liveleak', 'bestgore', 'goregrish', 'rotten', 'ogrish',
    'watchpeoplediee', 'nowthisisfuckedup', 'theync', 'kaotic',
    'deadhouse', 'documenting', 'crazyshit', 'shockgore',
    'gorezone', 'uncoverreality', 'morbidreality', 'sickipedia',
    'stileproject', 'efukt', 'thechainsawresistance',

    // Drogas e substâncias ilegais
    'silkroad', 'darkweb', 'deepweb', 'drugs', 'buycocaine',
    'buyweed', 'onlinecocaine', 'drugsforum', 'shroomery',
    'bluelight', 'drugbuyersguide', 'heroin', 'methamphetamine',

    // Armas ilegais
    'gunbroker', 'buyguns', 'ghostgunner', 'weaponsmarket',
    'illegalweapons', 'buyammo', 'darknetguns',

    // Pirataria
    'thepiratebay', 'kickass', 'rarbg', '1337x', 'nyaa',
    'fmovies', 'gomovies', 'putlocker', '123movies', 'solarmovie',
    'yesmovies', 'lookmovie', 'soap2day', 'movies123', 'azmovies',
    'cmovies', 'bmovies', 'hdmovie', 'torrentz', 'torrent',
    'piratebay', 'limetorrents', 'zooqle', 'magnetdl',
    'torrentseed', 'skidrowreloaded', 'fitgirl', 'oceanofgames',
    'steamunlocked', 'igg-games', 'crackwatch', 'repacklab',

    // Apostas ilegais
    'bet365', 'sportingbet', 'pixbet', 'betano', 'betfair',
    'williamhill', 'ladbrokes', 'paddy', 'unibet', 'bwin',
    '888sport', 'betway', 'draftkings', 'fanduel', 'bovada',
    'betonline', 'mybookie', 'xbet', 'betus', 'jazzsports',

    // Sites de ódio e extremismo
    'stormfront', 'dailystormer', 'therightstuff', 'vanguardnews',
    'occidentaldissent', 'amren', 'radixjournal', 'counter-currents',
    'unz', 'infostormer', 'neonrevolt', 'kiwifarms',
    'gab', 'voat', 'poal', 'wimkin', 'mewe',

    // Scam e phishing comuns
    'bit.ly/free', 'tinyurl/win', 'clickbait', 'earnmoney',
    'makemoneyfast', 'getrichquick', 'freebitcoin', 'cryptoscam',
    'nftscam', 'ponzi', 'pyramidscheme',
];

function urlBloqueada(url) {
    if (!url) return false;
    const urlLower = url.toLowerCase();
    return dominiosBloqueados.some(dominio => urlLower.includes(dominio));
}



//=================================
// GIPHY API
//=================================

app.get('/giphy', async (req, res) => {
    const { q } = req.query;
    try {
        const fetch = (await import('node-fetch')).default;
        const response = await fetch(
            `https://api.giphy.com/v1/gifs/search?api_key=G3e7vvEVjkOOI2FEEvHR2M4xSPnQy0ye&q=${encodeURIComponent(q)}&limit=12&lang=pt&rating=pg`
        );
        const data = await response.json();
        res.json(data);
    } catch {
        res.status(500).json({ error: 'Erro ao buscar GIFs' });
    }
});
// =====================
// WEATHER API
// =====================
app.get('/weather', async (req, res) => {
    const { lat, lon } = req.query;
    try {
        const fetch = (await import('node-fetch')).default;
        const response = await fetch(
            `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=1249ecf88be9df5ae456788b26737302&units=metric&lang=pt_br`
        );
        const data = await response.json();
        res.json(data);
    } catch {
        res.status(500).json({ error: 'Erro ao buscar clima' });
    }
});


// =====================
// Função de links proibidos
// =====================

function contemLink(texto) {
    const urlRegex = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|([^\s]+\.(com|net|org|br|io|co|gg|tv|me|app|dev)[^\s]*)/gi;
    return urlRegex.test(texto);
}

// ========== USUÁRIOS ==========
app.get('/users', (req, res) => {
    const db = readDB();
    const publicUsers = db.users.map(({ password, ...u }) => u);
    res.json(publicUsers);
});

app.get('/users/:id', (req, res) => {
    const db = readDB();
    const user = db.users.find(u => u.id === req.params.id);
    if (user) {
        const { password, ...publicUser } = user;
        res.json(publicUser);
    } else {
        res.status(404).json({ error: "Usuário não encontrado" });
    }
});

app.get('/trending', async (req, res) => {
    try {
        const fetch = (await import('node-fetch')).default;
        const response = await fetch(`https://gnews.io/api/v4/top-headlines?lang=pt&country=br&max=5&token=01da66b6cd237b068a14ea339c7c0b14`);
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
    const posts = db.posts.filter(p => 
        p.content && p.content.toLowerCase().includes(termo)
    );
    
    res.json(posts.sort((a, b) => b.timestamp - a.timestamp));
});

app.patch('/users/:id', (req, res) => {
    const { id } = req.params;
    const { avatar, coverImage, bio, location, website } = req.body;
    const db = readDB();
    const userIndex = db.users.findIndex(u => u.id === id);

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
        
        const { password, ...updatedUser } = db.users[userIndex];
        broadcastUpdate('user_updated', updatedUser);
        res.json(updatedUser);
    } else {
        res.status(404).json({ error: "Usuário não encontrado" });
    }
});

app.post('/users/follow', (req, res) => {
    const { followerId, followingId } = req.body;
    const db = readDB();
    
    const follower = db.users.find(u => u.id === followerId);
    const following = db.users.find(u => u.id === followingId);
    
    if (follower && following) {
        if (!follower.following.includes(followingId)) {
            follower.following.push(followingId);
            following.followers.push(followerId);
            writeDB(db);
            
            // Criar notificação
            const notification = {
                id: Date.now().toString(),
                userId: followingId,
                type: 'follow',
                fromUser: {
                    id: followerId,
                    username: follower.username,
                    avatar: follower.avatar
                },
                content: `${follower.username} começou a seguir você`,
                read: false,
                timestamp: Date.now()
            };
            db.notifications.push(notification);
            writeDB(db);
            
            broadcastUpdate('follow_update', { followerId, followingId, action: 'follow' });
            broadcastUpdate('new_notification', notification);
            res.json({ success: true, message: 'Agora você está seguindo!' });
        } else {
            res.json({ success: false, message: 'Já está seguindo' });
        }
    } else {
        res.status(404).json({ error: "Usuário não encontrado" });
    }
});

app.post('/users/unfollow', (req, res) => {
    const { followerId, followingId } = req.body;
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


function contemPalavrasProibidasFrontend(texto) {
    if (!texto) return false;
    const textoLower = texto.toLowerCase();
    return palavrasProibidasFrontend.some(p => textoLower.includes(p));
}

// CENSURA ==

const palavrasProibidas = [// Palavrões gerais
    'porra', 'porr4', 'p0rra', 'porras',
    'merda', 'merd4', 'm3rda', 'merdas',
    'caralho', 'c4ralho', 'car4lho', 'caralh0',
    'foda', 'f0da', 'fodas', 'fode', 'fodendo', 'fodido', 'fodida',
    'buceta', 'buc3ta', 'buc4ta', 'bucetas',
    'cu', 'cú', 'cuzao', 'cuzão',
    'puta', 'put4', 'putas', 'putaria',
    'vagabunda', 'vagabundo', 'vag4bunda',
    'safado', 'safada', 'saf4do',
    'piranha', 'pir4nha',
    'prostituta', 'prostituto',
    'punheta', 'punh3ta',
    'arrombado', 'arrombada',
    'cacete', 'cac3te',
    'pau', 'rola', 'xoxota',
    'fdp', 'filhadaputa', 'filho da puta', 'filho de puta',
    'vsf', 'vai se foder', 'vai se fuder',
    'tnc', 'toma no cu',
    'pqp', 'krl', 'krlh',
    'babaca', 'bab4ca',
    'retardado', 'retardada', 'ret4rdado',
    'imbecil', 'idiota', 'idi0ta',
    'canalha', 'desgraça', 'desgraçado','penis', 'pau','pênis',

    // Machistas
    'feminazi', 'histérica', 'histérico',
    'mulher no volante', 'lugar de mulher',
    'mulher não presta', 'vai lavar louça',
    'vai cozinhar', 'vai ter filho',
    'mulher burra', 'mulher idiota',
    'sua vez de calar', 'cala boca mulher',
    'fresca', 'pirua', 'vaca',
    'galinha', 'rapariga',
    'mulher é objeto', 'mulher é propriedade', 'vadia', 'vagabunda', 'piranha', 'putinha', 'safada', 'safada', 'saf4da','putiane', ' sua puta',
    // Racistas
    'macaco', 'macacada',
    'nego', 'nega', 'neguinho',
    'crioulo', 'crioula',
    'preto safado', 'preta safada',
    'volta pra africa', 'volta para a africa',
    'escravidão deveria voltar',
    'raça inferior', 'raça ruim',
    'cabelo ruim', 'nariz de macaco',
    'nordestino burro', 'baiano burro',
    'paraíba', 'pau de arara',
    'amarelado', 'olho puxado',
    'japonês de merda', 'chinês de merda',

    // Homofóbicas
    'viado', 'vi4do', 'viad0', 'viadinho',
    'sapatão', 'sapat4o',
    'traveco', 'trav3co',
    'bicha', 'bich4',
    'gay de merda', 'lésbica de merda',
    'cura gay', 'gay tem cura',
    'abominação', 'doença mental gay',
    'família normal', 'família de verdade',
    'isso é pecado', 'vai pro inferno gay',
    'homossexualismo', // termo incorreto e pejorativo

    // Preconceituosas gerais
    'judeu safado', 'judeu de merda',
    'muçulmano terrorista', 'islâmico terrorista',
    'evangélico hipócrita', 'crente de merda',
    'ateu sem moral',
    'gordo inútil', 'gordo nojento', 'gorda nojenta',
    'aleijado', 'aleijada',
    'mongolóide', 'mongol',
    'louco de hospício', 'maluco de hospício',
    'pobre vagabundo', 'pobre inútil',
    'favelado', 'favelada',
    'mendigo inútil', 'mendigo de merda',
    'deficiente inútil', 'deficiente mental',
    'esquizofrênico', // usado como xingamento
    'autista', // usado como xingamento
];

function contemPalavrasProibidas(texto) {
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

app.post('/posts', (req, res) => {
    const { userId, username, avatar, content, imageUrl } = req.body; // ← só uma vez

      if (verificarSpam(userId, 'post', 10000)) { // 10 segundos entre posts
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
        id: Date.now().toString(),
        userId,
        username,
        avatar,
        content,
        imageUrl: imageUrl || null,
        likes: [],
        comments: [],
        timestamp: Date.now()
    };
    db.posts.push(newPost);
    writeDB(db);

    broadcastUpdate('new_post', newPost);
    res.json(newPost);
});

app.delete('/posts/:postId', (req, res) => {
    const { postId } = req.params;
    const { userId } = req.body;
    const db = readDB();
    
    const postIndex = db.posts.findIndex(p => p.id === postId);
    if (postIndex !== -1 && db.posts[postIndex].userId === userId) {
        const deletedPost = db.posts.splice(postIndex, 1)[0];
        writeDB(db);
        
        broadcastUpdate('post_deleted', { postId, userId });
        res.json({ success: true, message: 'Post excluído com sucesso!' });
    } else {
        res.status(403).json({ error: "Você não tem permissão para excluir este post" });
    }
});


app.post('/posts/like', (req, res) => {
    const { postId, userId } = req.body;
    
    console.log('🔍 Like request:', { postId, userId }); // DEBUG
    
    const db = readDB();
    
    // Encontra o post
    const post = db.posts.find(p => String(p.id) === String(postId));

    if (!post) {
        console.error('❌ Post not found:', postId);
        return res.status(404).json({ error: "Post não encontrado" });
    }

    // 🔧 GARANTIR que likes existe
    if (!post.likes) post.likes = [];
    
    const likeIndex = post.likes.findIndex(id => String(id) === String(userId));
    
    if (likeIndex === -1) {
        // CURTIR
        post.likes.push(String(userId));
        console.log('✅ Like adicionado. Likes agora:', post.likes);
        
        // 🔧 CRIA NOTIFICAÇÃO APENAS SE NÃO FOR O PRÓPRIO USUÁRIO
        if (String(post.userId) !== String(userId)) {
            try {
                const liker = db.users.find(u => String(u.id) === String(userId));
                if (liker) {
                    if (!db.notifications) db.notifications = [];
                    
                    const notification = {
                        id: Date.now().toString(),
                        userId: post.userId,
                        type: 'like',
                        fromUser: { 
                            id: liker.id, 
                            username: liker.username, 
                            avatar: liker.avatar || '' 
                        },
                        content: `${liker.username} curtiu seu post`,
                        postId: String(postId),
                        read: false,
                        timestamp: Date.now()
                    };
                    db.notifications.push(notification);
                    console.log('📢 Notificação de like criada');
                } else {
                    console.warn('⚠️ Liker não encontrado no banco:', userId);
                }
            } catch (notifError) {
                console.error('❌ Erro ao criar notificação:', notifError);
                // Continua mesmo se a notificação falhar
            }
        }
    } else {
        // DESCURTIR
        post.likes.splice(likeIndex, 1);
        console.log('💔 Like removido. Likes agora:', post.likes);
    }
    
    // Salva no banco
    writeDB(db);
    
    // 🔧 BROADCAST SEGURO
    try {
        broadcastUpdate('like_update', { postId: String(postId), likes: post.likes });
    } catch (broadcastError) {
        console.error('❌ Erro no broadcast:', broadcastError);
    }
    
    res.json({ likes: post.likes });
});


app.post('/posts/retweet', (req, res) => {
    const { postId, userId } = req.body;
    const db = readDB();
    
    // 🔧 FIX: Garantir strings
    const postIdStr = String(postId);
    const userIdStr = String(userId);
    
    const post = db.posts.find(p => String(p.id) === postIdStr);
    
    if (post) {
        if (!post.retweets) post.retweets = [];
        
        const retweetIndex = post.retweets.findIndex(id => String(id) === userIdStr);
        let isRetweeting = false;
        
        if (retweetIndex === -1) {
            post.retweets.push(userIdStr);
            isRetweeting = true;
        } else {
            post.retweets.splice(retweetIndex, 1);
            isRetweeting = false;
        }
        
        writeDB(db);
        
        if (isRetweeting && post.userId && String(post.userId) !== userIdStr) {
            const retweeter = db.users.find(u => String(u.id) === userIdStr);
            if (retweeter) {
                if (!db.notifications) db.notifications = [];
                const notification = {
                    id: Date.now().toString(),
                    userId: post.userId,
                    type: 'retweet',
                    fromUser: {
                        id: retweeter.id,
                        username: retweeter.username,
                        avatar: retweeter.avatar
                    },
                    content: `${retweeter.username} retweetou seu post`,
                    postId: postIdStr,
                    read: false,
                    timestamp: Date.now()
                };
                db.notifications.push(notification);
            }
        }
        
        writeDB(db);
        
        try {
            broadcastUpdate('retweet_update', { postId: postIdStr, retweets: post.retweets });
        } catch (err) {
            console.error('Broadcast error:', err);
        }
        
        res.json({ retweets: post.retweets });
    } else {
        res.status(404).json({ error: "Post não encontrado" });
    }
});

app.post('/posts/comment', (req, res) => {
    const { postId, userId, username, avatar, content } = req.body;

    if (verificarSpam(userId, 'comment', 5000)) { // 5 segundos entre comentários
    return res.status(429).json({ error: 'Aguarde antes de comentar novamente!' });
    }

    if (contemPalavrasProibidas(content)) {
        return res.status(400).json({ error: 'Comentário contém conteúdo inapropriado!' });
    }
    if (contemLink(content)) {
    return res.status(403).json({ error: 'Posts com links não são permitidos!' });
}
    const db = readDB();
    const post = db.posts.find(p => p.id === postId);
    
    if (post) {
        const comment = {
            id: Date.now().toString(),
            userId,
            username,
            avatar,
            content,
            timestamp: Date.now()
        };
        post.comments.push(comment);
        writeDB(db);
        
        // Criar notificação de comentário
        const postOwner = db.users.find(u => u.id === post.userId);
        if (postOwner && postOwner.id !== userId) {
            const notification = {
                id: Date.now().toString(),
                userId: post.userId,
                type: 'comment',
                fromUser: {
                    id: userId,
                    username: username,
                    avatar: avatar
                },
                content: `${username} comentou no seu post: "${content.substring(0, 50)}..."`,
                postId: postId,
                read: false,
                timestamp: Date.now()
            };
            db.notifications.push(notification);
            writeDB(db);
            broadcastUpdate('new_notification', notification);
        }
        
        broadcastUpdate('new_comment', { postId, comment });
        res.json({ success: true, comment });
    } else {
        res.status(404).json({ error: "Post não encontrado" });
    }
});

// =ENDPOINT RETWEET
app.post('/posts/retweet', (req, res) => {
    const { postId, userId } = req.body;
    const db = readDB();
    
    // Encontrar o post original
    const post = db.posts.find(p => p.id === postId);
    
    if (post) {
        // Inicializar array de retweets se não existir
        if (!post.retweets) post.retweets = [];
        
        const retweetIndex = post.retweets.indexOf(userId);
        let isRetweeting = false;
        
        if (retweetIndex === -1) {
            // Adicionar retweet
            post.retweets.push(userId);
            isRetweeting = true;
        } else {
            // Remover retweet
            post.retweets.splice(retweetIndex, 1);
            isRetweeting = false;
        }
        
        writeDB(db);
        
        // Criar notificação 
        if (isRetweeting && post.userId !== userId) {
            const retweeter = db.users.find(u => u.id === userId);
            if (retweeter) {
                const notification = {
                    id: Date.now().toString(),
                    userId: post.userId,
                    type: 'retweet',
                    fromUser: {
                        id: userId,
                        username: retweeter.username,
                        avatar: retweeter.avatar
                    },
                    content: `${retweeter.username} retweetou seu post: "${post.content.substring(0, 50)}..."`,
                    postId: postId,
                    read: false,
                    timestamp: Date.now()
                };
                db.notifications.push(notification);
                writeDB(db);
                broadcastUpdate('new_notification', notification);
            }
        }
        
        broadcastUpdate('retweet_update', { postId, retweets: post.retweets });
        res.json({ retweets: post.retweets });
    } else {
        res.status(404).json({ error: "Post não encontrado" });
    }
});

// DELETE COMMENT

app.delete('/posts/:postId/comments/:commentId', (req, res) => {
    const { postId, commentId } = req.params;
    const { userId } = req.body;
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

// ENDPOINT DELETE MESSAGE 
app.delete('/messages/:messageId', (req, res) => {
    const { messageId } = req.params;
    const { userId } = req.body;
    const db = readDB();
    
    const messageIndex = db.messages.findIndex(m => m.id === messageId);
    
    if (messageIndex !== -1) {
        const message = db.messages[messageIndex];
        // Verificar se o usuário é o remetente da mensagem
        if (message.from === userId) {
            db.messages.splice(messageIndex, 1);
            writeDB(db);
            
            broadcastUpdate('message_deleted', { messageId });
            res.json({ success: true, message: 'Mensagem excluída com sucesso!' });
        } else {
            res.status(403).json({ error: "Você não tem permissão para excluir esta mensagem" });
        }
    } else {
        res.status(404).json({ error: "Mensagem não encontrada" });
    }
});
// == ENDPOINT DELETE MESSAGE 

//  ENDPOINT LIKE MESSAGE 
app.post('/messages/:messageId/like', (req, res) => {
    const { messageId } = req.params;
    const { userId } = req.body;
    const db = readDB();
    
    const message = db.messages.find(m => m.id === messageId);
    
    if (message) {
        if (!message.likedBy) message.likedBy = [];
        
        const likeIndex = message.likedBy.indexOf(userId);
        let isLiked = false;
        
        if (likeIndex === -1) {
            message.likedBy.push(userId);
            isLiked = true;
        } else {
            message.likedBy.splice(likeIndex, 1);
            isLiked = false;
        }
        
        writeDB(db);
        
        broadcastUpdate('message_like_update', { messageId, likedBy: message.likedBy });
        res.json({ liked: isLiked, likedBy: message.likedBy });
    } else {
        res.status(404).json({ error: "Mensagem não encontrada" });
    }
});
// == ENDPOINT LIKE MESSAGE =

// ========== MENSAGENS ==========
app.get('/messages/:userId/:otherUserId', (req, res) => {
    const db = readDB();
    const { userId, otherUserId } = req.params;
    const messages = db.messages.filter(m => 
        (m.from === userId && m.to === otherUserId) ||
        (m.from === otherUserId && m.to === userId)
    ).sort((a, b) => a.timestamp - b.timestamp);
    res.json(messages);
});

app.post('/messages', (req, res) => {
    const { from, to, content } = req.body;

    if (verificarSpam(from, 'message', 2000)) { // 2 segundos entre mensagens
        return res.status(429).json({ error: 'Aguarde antes de enviar outra mensagem!' });
    }
    if (contemPalavrasProibidas(content)) {
        return res.status(400).json({ error: 'Mensagem contém conteúdo inapropriado!' });
    }
    if (contemLink(content)) {
    return res.status(403).json({ error: 'Posts com links não são permitidos!' });
}

    const db = readDB();
    const message = {
        id: Date.now().toString(),
        from,
        to,
        content,
        timestamp: Date.now(),
        read: false
    };
    db.messages.push(message);
    writeDB(db);
    
    broadcastUpdate('new_message', message);
    res.json(message);
});

// ========== NOTIFICAÇÕES ==========
app.get('/notifications/:userId', (req, res) => {
    const db = readDB();
    const notifications = db.notifications.filter(n => n.userId === req.params.userId);
    res.json(notifications.sort((a, b) => b.timestamp - a.timestamp));
});

app.post('/notifications/:notificationId/read', (req, res) => {
    const { notificationId } = req.params;
    const db = readDB();
    const notification = db.notifications.find(n => n.id === notificationId);
    if (notification) {
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
    console.log(`✨ Layout inovador pronto para apresentação!\n`);
});