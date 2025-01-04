const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const crypto = require('crypto');
const mongoose = require('mongoose');

mongoose.connect('mongodb://localhost:27017/chatapp', { useNewUrlParser: true, useUnifiedTopology: true });
const db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB connection error:'));

const UserSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  email: { type: String, unique: true, required: true },
  verificationBadge: { type: Boolean, default: false },
  stars: { type: Number, default: 0 },
  followers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  following: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  purchasedBadges: [{ type: String }],
  publicKey: { type: String },
  createdAt: { type: Date, default: Date.now }
});

const PrivateMessageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  message: { type: String, required: true },
  encryptedMessage: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  reactions: { type: Map, of: [String] },
  mediaUrl: { type: String }
});

const StreakSchema = new mongoose.Schema({
  users: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  count: { type: Number, default: 1 },
  lastInteraction: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const PrivateMessage = mongoose.model('PrivateMessage', PrivateMessageSchema);
const Streak = mongoose.model('Streak', StreakSchema);

function generateKeyPair() {
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
}

function encryptMessage(publicKey, message) {
  return crypto.publicEncrypt(publicKey, Buffer.from(message)).toString('base64');
}

function decryptMessage(privateKey, encryptedMessage) {
  return crypto.privateDecrypt(privateKey, Buffer.from(encryptedMessage, 'base64')).toString();
}

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

const CORRECT_PASSWORD = '1010';
const FIXED_GROUP = 'main-group';

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
}, 1000); // Check every second

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);
  let userKeyPair;

  socket.on('join', async ({ username, room }) => {
    console.log('Join room attempt:', { username, room });

    if (password !== CORRECT_PASSWORD) {
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

    const roomUsers = Array.from(rooms.get(room)).map(id => users.get(id)).filter(Boolean);
    io.to(room).emit('user_list', roomUsers);

    console.log('User joined successfully:', { username, room });
    socket.emit('join_success', { username });

    userKeyPair = generateKeyPair();
    socket.emit('public_key', userKeyPair.publicKey);

    // Send follower count and verification badge status
    const user = await User.findOne({ username });
    if (user) {
      socket.emit('user_info', {
        followersCount: user.followers.length,
        verificationBadge: user.verificationBadge
      });
    }
  });

  socket.on('send_private_message', async (data) => {
    const { recipientUsername, message } = data;
    const sender = await User.findOne({ username: users.get(socket.id).username });
    const recipient = await User.findOne({ username: recipientUsername });

    if (sender && recipient) {
      const encryptedMessage = encryptMessage(recipient.publicKey, message);
      const newPrivateMessage = new PrivateMessage({
        sender: sender._id,
        recipient: recipient._id,
        message,
        encryptedMessage
      });
      await newPrivateMessage.save();

      const recipientSocket = Array.from(io.sockets.sockets.values()).find(
        (s) => users.get(s.id).username === recipientUsername
      );

      if (recipientSocket) {
        recipientSocket.emit('receive_private_message', {
          senderId: sender._id,
          senderUsername: sender.username,
          encryptedMessage
        });
      }
    }
  });

  socket.on('follow_user', async ({ usernameToFollow }) => {
    const follower = await User.findOne({ username: users.get(socket.id).username });
    const userToFollow = await User.findOne({ username: usernameToFollow });

    if (follower && userToFollow) {
      follower.following.push(userToFollow._id);
      userToFollow.followers.push(follower._id);
      await follower.save();
      await userToFollow.save();

      socket.emit('follow_success', { followingCount: follower.following.length });
      const userToFollowSocket = Array.from(io.sockets.sockets.values()).find(
        (s) => users.get(s.id).username === usernameToFollow
      );
      if (userToFollowSocket) {
        userToFollowSocket.emit('new_follower', {
          followerUsername: follower.username,
          followersCount: userToFollow.followers.length
        });
      }
    }
  });

  socket.on('send_message', async (data) => {
    const { room, id, message, username, timestamp, duration, recipientId } = data;
    console.log('Received message:', data);

    const newMessage = { id, message, username, timestamp, duration, seenBy: [username], reactions: {} };
    const roomMessages = messages.get(room) || [];
    roomMessages.push(newMessage);
    messages.set(room, roomMessages);

    const user = users.get(socket.id);
    if (user) {
      const sender = await User.findOne({ username: user.username });
      if (sender) {
        const streakCount = await updateStreak(sender._id, recipientId);
        io.to(user.room).emit('receive_message', {
          ...data,
          timestamp: Date.now(),
          streakCount
        });
      }
    }

    console.log('Broadcasting message to room:', room);
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
      const { room } = user;
      user.isOnline = false;
      user.isActive = false;
      const roomData = rooms.get(room);
      if (roomData) {
        roomData.delete(socket.id);
        const roomUsers = Array.from(roomData).map(id => users.get(id)).filter(Boolean);
        console.log('User disconnected, updating user list for room:', room);
        io.to(room).emit('user_list', roomUsers);
      }
    }
    console.log('A user disconnected:', socket.id);
  });
});

app.post('/api/purchase-badge', async (req, res) => {
  const { username, badgeId } = req.body;
  const user = await User.findOne({ username });
  if (user) {
    user.purchasedBadges.push(badgeId);
    await user.save();
    res.json({ success: true, purchasedBadges: user.purchasedBadges });
  } else {
    res.status(404).json({ success: false, message: 'User not found' });
  }
});

app.post('/api/request-verification', async (req, res) => {
  const { username } = req.body;
  const user = await User.findOne({ username });
  if (user) {
    // In a real-world scenario, this would trigger an admin review process
    user.verificationBadge = true;
    await user.save();
    res.json({ success: true, verificationBadge: user.verificationBadge });
  } else {
    res.status(404).json({ success: false, message: 'User not found' });
  }
});

async function updateStreak(user1Id, user2Id) {
  let streak = await Streak.findOne({ users: { $all: [user1Id, user2Id] } });
  if (streak) {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    if (streak.lastInteraction < oneDayAgo) {
      streak.count += 1;
    }
    streak.lastInteraction = new Date();
    await streak.save();
  } else {
    streak = new Streak({ users: [user1Id, user2Id] });
    await streak.save();
  }
  return streak.count;
}

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

