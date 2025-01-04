const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const users = new Map();
const rooms = new Map();
const messages = new Map();

app.get('/', (req, res) => {
  res.send('Chat App Backend is running!');
});

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('join', ({ username, room }) => {
    socket.join(room);
    users.set(socket.id, { id: socket.id, username, room });
    
    if (!rooms.has(room)) {
      rooms.set(room, new Set());
    }
    rooms.get(room).add(socket.id);

    if (!messages.has(room)) {
      messages.set(room, []);
    }

    const roomMessages = messages.get(room) || [];
    socket.emit('message_history', roomMessages);

    const roomUsers = Array.from(rooms.get(room)).map(id => users.get(id)).filter(Boolean);
    io.to(room).emit('user_list', roomUsers);
    
    console.log('User joined successfully:', { username, room });
    io.to(room).emit('user_joined', { username });
  });

  socket.on('send_message', (data) => {
    const { room, message, username } = data;
    console.log('Received message:', data);

    const newMessage = {
      id: Date.now().toString(),
      message,
      username,
      timestamp: Date.now()
    };

    const roomMessages = messages.get(room) || [];
    roomMessages.push(newMessage);
    messages.set(room, roomMessages);

    io.to(room).emit('receive_message', newMessage);
  });

  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      const { username, room } = user;
      users.delete(socket.id);
      const roomData = rooms.get(room);
      if (roomData) {
        roomData.delete(socket.id);
        const roomUsers = Array.from(roomData).map(id => users.get(id)).filter(Boolean);
        console.log('User disconnected, updating user list for room:', room);
        io.to(room).emit('user_list', roomUsers);
        io.to(room).emit('user_left', { username });
      }
    }
    console.log('A user disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

