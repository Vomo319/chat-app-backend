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

// Ensure uploads directory exists
const uploadsDir = process.env.RENDER_INTERNAL_FOLDER_PATH 
  ? path.join(process.env.RENDER_INTERNAL_FOLDER_PATH, 'uploads')
  : path.join(__dirname, 'uploads');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const users = new Map();
const rooms = new Map();
const messages = new Map();
const privateMessages = new Map();
const userProfiles = new Map();
const posts = new Map();
const subscriptions = []; // Add subscriptions array
const games = new Map(); // Added games Map

const FIXED_GROUP = 'main-group';

// Simple hash function using SHA-256
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Set up multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
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

app.get('/api/posts', (req, res) => {
  const allPosts = Array.from(posts.values());
  res.json(allPosts);
});

app.post('/api/posts', upload.single('media'), (req, res) => {
  const { content, username } = req.body;
  const mediaFile = req.file;

  if (!content && !mediaFile) {
    return res.status(400).json({ error: 'Post must contain either content or media' });
  }

  const newPost = {
    id: uuidv4(),
    username,
    content,
    mediaUrl: mediaFile ? `/uploads/${mediaFile.filename}` : null,
    mediaType: mediaFile ? (mediaFile.mimetype.startsWith('image/') ? 'image' : 'video') : null,
    likes: 0,
    comments: 0,
    timestamp: Date.now()
  };

  posts.set(newPost.id, newPost);
  res.status(201).json(newPost);
});

app.post('/api/posts/:postId/like', (req, res) => {
  const { postId } = req.params;
  const post = posts.get(postId);

  if (!post) {
    return res.status(404).json({ error: 'Post not found' });
  }

  post.likes += 1;
  res.json({ likes: post.likes });
});

app.post('/api/posts/:postId/comment', (req, res) => {
  const { postId } = req.params;
  const { comment, username } = req.body;
  const post = posts.get(postId);

  if (!post) {
    return res.status(404).json({ error: 'Post not found' });
  }

  if (!post.comments) {
    post.comments = [];
  }

  const newComment = {
    id: uuidv4(),
    username,
    content: comment,
    timestamp: Date.now()
  };

  post.comments.push(newComment);
  res.status(201).json(newComment);
});

function deleteExpiredMessages(room) {
  const roomMessages = messages.get(room) || [];
  const now = Date.now();
  const updatedMessages = roomMessages.filter(msg => {
    if (msg.duration && msg.seenBy.length > 1 && now - msg.firstSeenTimestamp > msg.duration * 1000) {
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

// Add this new function to send push notifications
async function sendPushNotification(subscription, payload) {
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
  } catch (error) {
    console.error('Error sending push notification:', error);
  }
}

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('register', ({ username, password }) => {
    if (userProfiles.has(username)) {
      socket.emit('register_error', 'Username already exists');
    } else {
      try {
        const hashedPassword = hashPassword(password);
        userProfiles.set(username, {
          password: hashedPassword,
          followers: [],
          following: [],
          verified: false,
          streakCount: 0,
          stars: 0
        });
        socket.emit('register_success');
      } catch (error) {
        console.error('Error hashing password:', error);
        socket.emit('register_error', 'Registration failed');
      }
    }
  });

  socket.on('join_room', ({ username, room, password }) => {
    console.log('Join room attempt:', { username, room });

    const userProfile = userProfiles.get(username);
    if (!userProfile) {
      socket.emit('join_error', 'User not found');
      return;
    }

    try {
      const hashedPassword = hashPassword(password);
      if (hashedPassword !== userProfile.password) {
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

      // Emit user online event
      io.to(room).emit('user_online', username);

      // After successful join, send notification to all other users
      socket.to(room).emit('user_joined', { username });

      // Send push notification to all subscribed users
      subscriptions.forEach(subscription => {
        sendPushNotification(subscription, {
          title: 'New User Joined',
          body: `${username} has joined the chat.`
        });
      });

      // Increment streak count
      userProfile.streakCount++;
      if (userProfile.streakCount % 7 === 0) {
        userProfile.stars++;
        socket.emit('star_earned');
      }
    } catch (error) {
      console.error('Error during join room:', error);
      socket.emit('join_error', 'An error occurred while joining the room');
    }
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

    if (message.startsWith('Game Result:')) {
      newMessage.type = 'system';
      newMessage.username = 'Game Bot';
    }

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

  socket.on('send_private_message', ({ senderId, receiverId, message, duration, replyTo }) => {
    const sender = Array.from(users.values()).find(user => user.id === senderId);
    const receiver = Array.from(users.values()).find(user => user.id === receiverId);

    if (sender && receiver) {
      const privateMessage = {
        id: Date.now().toString(),
        senderId,
        receiverId,
        senderUsername: sender.username,
        message,
        timestamp: Date.now(),
        duration,
        replyTo
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
      if (message.seenBy.length === 2) {
        message.firstSeenTimestamp = Date.now();
      }
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

  socket.on('new_post', (postData) => {
    const newPost = {
      id: uuidv4(),
      ...postData,
      likes: 0,
      comments: 0,
      timestamp: Date.now()
    };

    posts.set(newPost.id, newPost);
    io.emit('new_post', newPost);
  });

  socket.on('game_result', ({ username, result, gameType }) => {
    const room = users.get(socket.id)?.room;
    if (room) {
      io.to(room).emit('receive_message', {
        id: Date.now().toString(),
        message: `🎮 ${gameType}: ${username} ${result}`,
        username: 'Game Bot',
        timestamp: Date.now(),
        type: 'system'
      });
    }
  });

  socket.on('send_game_invitation', ({ gameId, inviteeId }) => {
    const inviter = users.get(socket.id);
    if (inviter) {
      io.to(inviteeId).emit('game_invitation', { gameId, inviter: inviter.username });
    }
  });

  socket.on('accept_game_invitation', ({ gameId }) => {
    const accepter = users.get(socket.id);
    if (accepter) {
      const game = {
        id: gameId,
        players: [socket.id],
        board: Array(9).fill(null),
        currentTurn: socket.id
      };
      games.set(gameId, game);

      // Find the inviter's socket id
      const inviterSocket = Array.from(users.entries()).find(([_, user]) => user.username === game.inviter);
      if (inviterSocket) {
        game.players.push(inviterSocket[0]);
        io.to(inviterSocket[0]).emit('game_started', { gameId, opponent: accepter.username, isPlayerTurn: true });
        socket.emit('game_started', { gameId, opponent: game.inviter, isPlayerTurn: false });
      }
    }
  });

  socket.on('tic_tac_toe_move', ({ gameId, player, position }) => {
    const game = games.get(gameId);
    if (game && game.currentTurn === socket.id && game.board[position] === null) {
      game.board[position] = player;
      game.currentTurn = game.players.find(id => id !== socket.id);
      
      io.to(game.players).emit('tic_tac_toe_update', { gameId, player, position });

      // Check for winner or draw
      const winner = calculateWinner(game.board);
      if (winner || game.board.every(cell => cell !== null)) {
        io.to(game.players).emit('game_over', { gameId, winner });
        games.delete(gameId);
      }
    }
  });

  function calculateWinner(board) {
    const lines = [
      [0, 1, 2],
      [3, 4, 5],
      [6, 7, 8],
      [0, 3, 6],
      [1, 4, 7],
      [2, 5, 8],
      [0, 4, 8],
      [2, 4, 6],
    ];
    for (let i = 0; i < lines.length; i++) {
      const [a, b, c] = lines[i];
      if (board[a] && board[a] === board[b] && board[a] === board[c]) {
        return board[a];
      }
    }
    return null;
  }

  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      const { username, room } = user;
      users.delete(socket.id);
      
      // End any active games for this user
      for (const [gameId, game] of games.entries()) {
        if (game.players.includes(socket.id)) {
          const opponent = game.players.find(id => id !== socket.id);
          if (opponent) {
            io.to(opponent).emit('game_over', { gameId, winner: 'opponent_disconnected' });
          }
          games.delete(gameId);
        }
      }
      
      if (rooms.has(room)) {
        rooms.get(room).delete(socket.id);
        if (rooms.get(room).size === 0) {
          rooms.delete(room);
        } else {
          // Emit user offline event
          io.to(room).emit('user_offline', username);
          
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

