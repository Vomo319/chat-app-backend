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
app.use('/uploads', express.static('uploads'));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// ... (keep existing code)

const subscriptions = new Map();

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

  // ... (keep existing connection code)

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

