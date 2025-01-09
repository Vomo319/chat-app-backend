const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const webpush = require('web-push');

const app = express();
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Initialize storage for users and their profiles
const users = new Map();
const userProfiles = new Map();
const rooms = new Map();
const messages = new Map();
const subscriptions = new Map();

// Add a REST endpoint for registration
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  
  try {
    if (userProfiles.has(username)) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');
    
    // Create user profile
    userProfiles.set(username, {
      password: hashedPassword,
      followers: [],
      following: [],
      verified: false,
      streakCount: 0,
      stars: 0
    });

    console.log(`User registered successfully: ${username}`);
    res.status(201).json({ message: 'Registration successful' });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Add a REST endpoint for login verification
app.post('/api/verify', async (req, res) => {
  const { username, password } = req.body;
  
  try {
    const userProfile = userProfiles.get(username);
    if (!userProfile) {
      return res.status(401).json({ error: 'User not found' });
    }

    const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');
    if (hashedPassword !== userProfile.password) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    res.status(200).json({ message: 'Verification successful' });
  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// Add this new function to send push notifications
async function sendPushNotification(username, payload) {
  const userSubscriptions = subscriptions.get(username) || [];
  for (const subscription of userSubscriptions) {
    try {
      await webpush.sendNotification(subscription, JSON.stringify(payload));
    } catch (error) {
      console.error('Error sending push notification:', error);
      // Remove invalid subscriptions
      const index = userSubscriptions.indexOf(subscription);
      if (index > -1) {
        userSubscriptions.splice(index, 1);
      }
    }
  }
}

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('register', async ({ username, password }) => {
    try {
      if (userProfiles.has(username)) {
        socket.emit('register_error', 'Username already exists');
        return;
      }

      const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');
      
      userProfiles.set(username, {
        password: hashedPassword,
        followers: [],
        following: [],
        verified: false,
        streakCount: 0,
        stars: 0
      });

      socket.emit('register_success');
      console.log(`User registered successfully via socket: ${username}`);
    } catch (error) {
      console.error('Registration error:', error);
      socket.emit('register_error', error.message || 'Registration failed');
    }
  });

  socket.on('subscribe', ({ username, subscription }) => {
    if (!subscriptions.has(username)) {
      subscriptions.set(username, []);
    }
    subscriptions.get(username).push(subscription);
    console.log(`User ${username} subscribed to push notifications`);
  });

  socket.on('join_room', ({ username, room, password }) => {
    // ... (keep existing join_room code)

    console.log('User joined successfully:', { username, room });
    socket.emit('join_success', { username });

    // Emit user online event
    io.to(room).emit('user_online', username);

    // After successful join, send notification to all other users
    socket.to(room).emit('user_joined', { username });

    // Send push notification to all subscribed users except the one who joined
    users.forEach(user => {
      if (user.username !== username) {
        sendPushNotification(user.username, {
          title: 'New User Joined',
          body: `${username} has joined the chat.`
        });
      }
    });

    // ... (keep the rest of the join_room code)
  });

  socket.on('send_message', (data) => {
    const { room, id, message, username, timestamp, duration, replyTo } = data;
    console.log('Received message:', data);

    const newMessage = { 
      id, 
      message, 
      username, 
      timestamp, 
      duration, 
      replyTo, 
      seenBy: [username], 
      reactions: {},
      firstSeenTimestamp: null  
    };
    const roomMessages = messages.get(room) || [];
    roomMessages.push(newMessage);
    messages.set(room, roomMessages);

    console.log('Broadcasting message to room:', room);
    io.to(room).emit('receive_message', newMessage);

    // Send push notification for new message to all users in the room except the sender
    users.forEach(user => {
      if (user.room === room && user.username !== username) {
        sendPushNotification(user.username, {
          title: 'New Message',
          body: `${username}: ${message.substring(0, 50)}...`
        });
      }
    });
  });

  // ... (keep the rest of the server code)
});

// ... (keep the rest of the server code)

const PORT = process.env.PORT || 10000;

// Explicitly bind to 0.0.0.0 to accept connections on all network interfaces
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});

