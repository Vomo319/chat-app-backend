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

// Add this new function to send push notifications
async function sendPushNotification(subscription, payload) {
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
  } catch (error) {
    console.error('Error sending push notification:', error);
  }
}

io.on('connection', (socket) => {
  // ... (keep existing connection code)

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

    // Send push notification for new message
    subscriptions.forEach(subscription => {
      sendPushNotification(subscription, {
        title: 'New Message',
        body: `${data.username}: ${data.message.substring(0, 50)}...`
      });
    });
  });

  // ... (keep the rest of the existing code)
});

// ... (keep the rest of the server code)

