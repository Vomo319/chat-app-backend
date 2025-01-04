const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');

const app = express();
app.use(cors());
app.use('/uploads', express.static('uploads'));

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
const privateMessages = new Map();
const userProfiles = new Map();

const CORRECT_PASSWORD = '1010';
const FIXED_GROUP = 'main-group';

// Set up multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

app.post('/upload', upload.single('file'), (req, res) => {
  if (req.file) {
    res.json({ filename: req.file.filename });
  } else {
    res.status(400).send('No file uploaded.');
  }
});

app.get('/', (req, res) => {
  res.send('Chat App Backend is running!');
});

function deleteExpiredMessages(room) {
  const roomMessages = messages.get(room) || [];
  const now = Date.now();
  const updatedMessages = roomMessages.filter(msg => {
    if (msg.duration && now - msg.timestamp > msg.duration * 1000) {
      io.to(room).emit('message_deleted', { messageId: msg.id });
      return false;
    }
    return true;
  });
  messages.set(room, updatedMessages);
}

setInterval(() => {
  for (const room of rooms.keys()) {
    deleteExpiredMessages(room);
  }
}, 1000);

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('register', async ({ username, password }) => {
    if (userProfiles.has(username)) {
      socket.emit('register_error', 'Username already exists');
    } else {
      const hashedPassword = await bcrypt.hash(password, 10);
      userProfiles.set(username, {
        password: hashedPassword,
        followers: [],
        following: [],
        verified: false,
        streakCount: 0,
        stars: 0
      });
      socket.emit('register_success');
    }
  });

  socket.on('join_room', async ({ username, room, password }) => {
    console.log('Join room attempt:', { username, room });

    const userProfile = userProfiles.get(username);
    if (!userProfile) {
      socket.emit('join_error', 'User not found');
      return;
    }

    const passwordMatch = await bcrypt.compare(password, userProfile.password);
    if (!passwordMatch) {
      console.log('Invalid password attempt');
      socket.emit('join_error', 'Invalid password');
      return;
    }

    socket.join(room);
    users.set(socket.id, { id: socket.id, username, room, isOnline: true, isActive: true });

    if (!rooms.has(room)) {
      rooms.set(room, new Set());
    }
    rooms.get(room).add(socket.id);

    if (!messages.has(room)) {
      messages.set(room, []);
    }

    // Send existing messages to the user
    const roomMessages = messages.get(room) || [];
    socket.emit('message_history', roomMessages);

    const roomUsers = Array.from(rooms.get(room)).map(id => {
      const user = users.get(id);
      return {
        ...user,
        followers: userProfiles.get(user.username).followers.length,
        verified: userProfiles.get(user.username).verified
      };
    }).filter(Boolean);
    io.to(room).emit('user_list', roomUsers);
    
    console.log('User joined successfully:', { username, room });
    socket.emit('join_success', { username });

    // Increment streak count
    userProfile.streakCount++;
    if (userProfile.streakCount % 7 === 0) {
      userProfile.stars++;
      socket.emit('star_earned');
    }
  });

  socket.on('send_message', (data) => {
    const { room, id, message, username, timestamp, duration } = data;
    console.log('Received message:', data);

    const newMessage = { id, message, username, timestamp, duration, seenBy: [username], reactions: {} };
    const roomMessages = messages.get(room) || [];
    roomMessages.push(newMessage);
    messages.set(room, roomMessages);

    console.log('Broadcasting message to room:', room);
    io.to(room).emit('receive_message', newMessage);
  });

  socket.on('send_private_message', ({ senderId, receiverId, message }) => {
    const sender = Array.from(users.values()).find(user => user.id === senderId);
    const receiver = Array.from(users.values()).find(user => user.id === receiverId);

    if (sender && receiver) {
      const privateMessage = {
        id: Date.now().toString(),
        senderId,
        receiverId,
        senderUsername: sender.username,
        message,
        timestamp: Date.now()
      };

      if (!privateMessages.has(senderId)) {
        privateMessages.set(senderId, []);
      }
      if (!privateMessages.has(receiverId)) {
        privateMessages.set(receiverId, []);
      }

      privateMessages.get(senderId).push(privateMessage);
      privateMessages.get(receiverId).push(privateMessage);

      io.to(receiverId).emit('receive_private_message', privateMessage);
      socket.emit('private_message_sent', privateMessage);
    }
  });

  socket.on('follow_user', ({ followerUsername, followedUsername }) => {
    const followerProfile = userProfiles.get(followerUsername);
    const followedProfile = userProfiles.get(followedUsername);

    if (followerProfile && followedProfile) {
      if (!followedProfile.followers.includes(followerUsername)) {
        followedProfile.followers.push(followerUsername);
        followerProfile.following.push(followedUsername);
        socket.emit('follow_success', { followedUsername });
        io.to(followedUsername).emit('new_follower', { followerUsername });
      }
    }
  });

  socket.on('edit_message', ({ messageId, newText, room }) => {
    console.log('Edit message request:', { messageId, newText, room });
    const roomMessages = messages.get(room) || [];
    const messageIndex = roomMessages.findIndex(msg => msg.id === messageId);
    if (messageIndex !== -1) {
      roomMessages[messageIndex].message = newText;
      roomMessages[messageIndex].isEdited = true;
      console.log('Message edited, broadcasting to room:', room);
      io.to(room).emit('message_edited', { messageId, newText });
    }
  });

  socket.on('message_seen', ({ messageId, username, room }) => {
    console.log('Message seen:', { messageId, username, room });
    const roomMessages = messages.get(room) || [];
    const message = roomMessages.find(msg => msg.id === messageId);
    if (message && !message.seenBy.includes(username)) {
      message.seenBy.push(username);
      console.log('Updating seen status for message:', messageId);
      io.to(room).emit('update_seen', { messageId, seenBy: message.seenBy });
    }
  });

  socket.on('delete_message', ({ messageId, room }) => {
    console.log('Delete message request:', { messageId, room });
    const roomMessages = messages.get(room) || [];
    const updatedMessages = roomMessages.filter(msg => msg.id !== messageId);
    messages.set(room, updatedMessages);
    console.log('Message deleted, broadcasting to room:', room);
    io.to(room).emit('message_deleted', { messageId });
  });

  socket.on('update_user_status', ({ isActive, room }) => {
    console.log('User status update:', socket.id, isActive);
    const user = users.get(socket.id);
    if (user) {
      user.isActive = isActive;
      const roomUsers = Array.from(rooms.get(room)).map(id => users.get(id)).filter(Boolean);
      io.to(room).emit('user_list', roomUsers);
      io.to(room).emit('user_status_update', { userId: socket.id, isActive });
    }
  });

  socket.on('typing_start', ({ username, room }) => {
    console.log('User started typing:', username);
    socket.to(room).emit('typing_start', { username });
  });

  socket.on('typing_end', ({ username, room }) => {
    console.log('User stopped typing:', username);
    socket.to(room).emit('typing_end', { username });
  });

  socket.on('add_reaction', ({ messageId, emoji, username, room }) => {
    console.log('Add reaction:', { messageId, emoji, username, room });
    const roomMessages = messages.get(room) || [];
    const message = roomMessages.find(msg => msg.id === messageId);
    if (message) {
      if (!message.reactions[emoji]) {
        message.reactions[emoji] = [];
      }
      if (!message.reactions[emoji].includes(username)) {
        message.reactions[emoji].push(username);
        io.to(room).emit('message_reaction', { messageId, emoji, username });
      }
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
          const roomUsers = Array.from(rooms.get(room))
            .map(id => {
              const user = users.get(id);
              return {
                ...user,
                followers: userProfiles.get(user.username).followers.length,
                verified: userProfiles.get(user.username).verified
              };
            })
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

