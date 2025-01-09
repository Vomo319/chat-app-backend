const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "funchat1.vercel.app", // In production, replace with your frontend URL
    methods: ["GET", "POST"]
  }
});

const users = new Map();
const rooms = new Map();

app.get('/', (req, res) => {
  res.send('Chat App Backend is running!');
});

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('join', ({ username, room }) => {
    socket.join(room);
    users.set(socket.id, { id: socket.id, username, room });
    
    // Add user to room
    if (!rooms.has(room)) {
      rooms.set(room, new Set());
    }
    rooms.get(room).add(socket.id);

    // Send system message
    io.to(room).emit('receive_message', {
      id: Date.now().toString(),
      type: 'system',
      message: `${username} has joined the room`,
      username: 'System',
      room,
      timestamp: Date.now()
    });

    // Send updated user list
    const roomUsers = Array.from(rooms.get(room))
      .map(id => users.get(id))
      .filter(Boolean);
    io.to(room).emit('user_list', roomUsers);
  });

  socket.on('send_message', (data) => {
    const user = users.get(socket.id);
    if (user) {
      io.to(user.room).emit('receive_message', {
        ...data,
        timestamp: Date.now()
      });
    }
  });

  socket.on('typing_start', () => {
    const user = users.get(socket.id);
    if (user) {
      socket.to(user.room).emit('typing_start', { username: user.username });
    }
  });

  socket.on('typing_end', () => {
    const user = users.get(socket.id);
    if (user) {
      socket.to(user.room).emit('typing_end', { username: user.username });
    }
  });

  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      const { username, room } = user;
      users.delete(socket.id);
      
      if (rooms.has(room)) {
        rooms.get(room).delete(socket.id);
        if (rooms.get(room).size === 0) {
          rooms.delete(room);
        } else {
          // Send system message
          io.to(room).emit('receive_message', {
            id: Date.now().toString(),
            type: 'system',
            message: `${username} has left the room`,
            username: 'System',
            room,
            timestamp: Date.now()
          });

          // Send updated user list
          const roomUsers = Array.from(rooms.get(room))
            .map(id => users.get(id))
            .filter(Boolean);
          io.to(room).emit('user_list', roomUsers);
        }
      }
    }
    console.log('A user disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

