const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const crypto = require('crypto');

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
const messages = new Map();

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

app.get('/', (req, res) => {
  res.send('Chat App Backend is running!');
});

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('create_room', ({ roomName, password }) => {
    const hashedPassword = hashPassword(password);
    rooms.set(roomName, { password: hashedPassword, users: new Set() });
    messages.set(roomName, []);
    socket.emit('room_created', { roomName });
  });

  socket.on('join_room', ({ username, room, password }) => {
    const roomData = rooms.get(room);
    if (!roomData || roomData.password !== hashPassword(password)) {
      socket.emit('join_error', 'Invalid room or password');
      return;
    }

    socket.join(room);
    users.set(socket.id, { id: socket.id, username, room, isOnline: true });
    roomData.users.add(socket.id);

    // Send existing messages to the user
    const roomMessages = messages.get(room) || [];
    socket.emit('message_history', roomMessages);

    io.to(room).emit('user_list', Array.from(roomData.users).map(id => users.get(id)));
  });

  socket.on('send_message', (data) => {
    const { room, id, message, username, timestamp, duration } = data;
    const newMessage = { id, message, username, timestamp, duration, seenBy: [username] };
    const roomMessages = messages.get(room) || [];
    roomMessages.push(newMessage);
    messages.set(room, roomMessages);

    io.to(room).emit('receive_message', newMessage);
  });

  socket.on('edit_message', ({ messageId, newText, room }) => {
    const roomMessages = messages.get(room) || [];
    const messageIndex = roomMessages.findIndex(msg => msg.id === messageId);
    if (messageIndex !== -1) {
      roomMessages[messageIndex].message = newText;
      roomMessages[messageIndex].isEdited = true;
      io.to(room).emit('message_edited', { messageId, newText });
    }
  });

  socket.on('message_seen', ({ messageId, username, room }) => {
    const roomMessages = messages.get(room) || [];
    const message = roomMessages.find(msg => msg.id === messageId);
    if (message && !message.seenBy.includes(username)) {
      message.seenBy.push(username);
      io.to(room).emit('update_seen', { messageId, seenBy: message.seenBy });
    }
  });

  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      const { room } = user;
      users.delete(socket.id);
      const roomData = rooms.get(room);
      if (roomData) {
        roomData.users.delete(socket.id);
        io.to(room).emit('user_list', Array.from(roomData.users).map(id => users.get(id)));
      }
    }
    console.log('A user disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

