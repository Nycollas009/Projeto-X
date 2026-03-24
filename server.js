const express = require('express');
const fs = require('fs');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serve os arquivos da pasta public

const DB_FILE = './database.json';

// Função auxiliar para ler o "banco de dados" JSON
function readDB() {
    const data = fs.readFileSync(DB_FILE);
    return JSON.parse(data);
}

// Função auxiliar para salvar no "banco de dados" JSON
function writeDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// --- ROTAS DE USUÁRIO ---

// Cadastro e Login Simples
app.post('/api/login', (req, res) => {
    const { username } = req.body;
    const db = readDB();
    
    let user = db.users.find(u => u.username === username);
    
    if (!user) {
        // Se não existe, cadastra na hora
        user = { id: Date.now(), username: username };
        db.users.push(user);
        writeDB(db);
    }
    
    res.json(user);
});

// --- ROTAS DE POSTAGENS ---

// Listar todos os posts
app.get('/api/posts', (req, res) => {
    const db = readDB();
    // Retorna os posts do mais novo para o mais antigo
    const sortedPosts = [...db.posts].reverse();
    res.json(sortedPosts);
});

// Criar novo post
app.post('/api/posts', (req, res) => {
    const { content, userId, username } = req.body;
    const db = readDB();
    
    const newPost = {
        id: Date.now(),
        userId,
        username,
        content,
        likes: [] // Lista de IDs de usuários que curtiram
    };
    
    db.posts.push(newPost);
    writeDB(db);
    res.status(201).json(newPost);
});

// Deletar post
app.delete('/api/posts/:id', (req, res) => {
    const { id } = req.params;
    const db = readDB();
    
    db.posts = db.posts.filter(p => p.id != id);
    writeDB(db);
    res.send({ message: "Post deletado" });
});

// Curtir/Descurtir post
app.post('/api/like/:id', (req, res) => {
    const { id } = req.params;
    const { userId } = req.body;
    const db = readDB();
    
    const post = db.posts.find(p => p.id == id);
    if (post) {
        const index = post.likes.indexOf(userId);
        if (index === -1) {
            post.likes.push(userId); // Curte
        } else {
            post.likes.splice(index, 1); // Descurte
        }
        writeDB(db);
    }
    res.json(post);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});