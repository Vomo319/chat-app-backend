const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

// Middleware
app.use(cors());

const users = {};

// Socket.IO connections
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('set_username', ({ username }) => {
        users[socket.id] = { username, status: 'online' };
        io.emit('update_user_status', users);
    });

    socket.on('send_message', (data) => {
        const timestamp = new Date().toLocaleTimeString();
        io.emit('receive_message', { ...data, timestamp });
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        delete users[socket.id];
        io.emit('update_user_status', users);
    });
});

// Server running
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
