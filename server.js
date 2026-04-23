const express = require('express');
const fs = require('fs');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

server.listen(port, '0.0.0.0', () => {
    console.log(`Servidor rodando na porta ${port}`);
});

app.use(cors());
app.use(express.json());
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

const server = http.createServer(app);
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

const bcrypt = require('bcrypt');
const SALT_ROUNDS = 10;

// == AUTENTICAÇÃO ==
app.post('/login-register', async (req, res) => {
    const { username, password } = req.body;
    const db = readDB();
    let user = db.users.find(u => u.username === username);

    if (user) {
       
        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) {
            return res.status(401).json({ message: "Senha incorreta para este usuário!" });
        }

        console.log(`🔑 Usuário logado: ${username}`);
    }

    else {
       
        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

        user = {
            id: Date.now().toString(),
            username,
            password: hashedPassword, // 👈 salva o hash, nunca o texto puro
            avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${username}`,
            coverImage: `https://picsum.photos/1200/300?random=${Date.now()}`,
            bio: "✨ Bem-vindo ao Tiwitter Social! Conecte-se com o mundo.",
            location: "🌍 Planeta Terra",
            website: "",
            joinDate: new Date().toISOString(),
            following: [],
            followers: [],
            likedPosts: []
        };
        db.users.push(user);
        writeDB(db);
        console.log(`📝 Novo usuário criado: ${username}`);
    }

    const { password: _, ...userWithoutPassword } = user;
    res.json({ user: userWithoutPassword });
});


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

app.patch('/users/:id', (req, res) => {
    const { id } = req.params;
    const { avatar, coverImage, bio, location, website } = req.body;
    const db = readDB();
    const userIndex = db.users.findIndex(u => u.id === id);

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
    const { userId, username, avatar, content, imageUrl } = req.body;
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