const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcrypt');

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

// In-memory user storage (replace with a database in production)
const userCredentials = new Map();

app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (userCredentials.has(username)) {
    return res.status(400).json({ error: 'Username already exists' });
  }
  const hashedPassword = await bcrypt.hash(password, 10);
  userCredentials.set(username, hashedPassword);
  res.status(201).json({ message: 'User registered successfully' });
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const hashedPassword = userCredentials.get(username);
  if (!hashedPassword) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const isPasswordValid = await bcrypt.compare(password, hashedPassword);
  if (!isPasswordValid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  res.json({ message: 'Login successful' });
});

app.get('/', (req, res) => {
  res.send('Chat App Backend is running!');
});

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('join', ({ username, room }) => {
    try {
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
    } catch (error) {
      console.error('Error in join event:', error);
      socket.emit('join_error', 'Failed to join the room');
    }
  });

  socket.on('send_message', (data) => {
    try {
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
    } catch (error) {
      console.error('Error in send_message event:', error);
      socket.emit('message_error', 'Failed to send the message');
    }
  });

  socket.on('disconnect', () => {
    try {
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
    } catch (error) {
      console.error('Error in disconnect event:', error);
    }
  });
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

