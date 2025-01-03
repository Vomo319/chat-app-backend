const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
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

  socket.on('join_room', ({ username, room }) => {
    socket.join(room);
    users.set(socket.id, { id: socket.id, username, room, isOnline: true });
    
    if (!rooms.has(room)) {
      rooms.set(room, new Set());
    }
    rooms.get(room).add(socket.id);

    io.to(room).emit('user_list', Array.from(rooms.get(room)).map(id => users.get(id)));
  });

  socket.on('send_message', (data) => {
    io.to(data.room).emit('receive_message', data);
  });

  socket.on('edit_message', ({ messageId, newText, room }) => {
    io.to(room).emit('message_edited', { messageId, newText });
  });

  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      const { room } = user;
      users.delete(socket.id);
      if (rooms.has(room)) {
        rooms.get(room).delete(socket.id);
        io.to(room).emit('user_list', Array.from(rooms.get(room)).map(id => users.get(id)));
      }
    }
    console.log('A user disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
