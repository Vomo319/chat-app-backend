import { useEffect, useRef, useState, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'

interface Message {
  id: string
  message: string
  username: string
  timestamp: number
  isEdited?: boolean
  replyTo?: string
  seenBy: string[]
  duration: number | null
  reactions: { [key: string]: string[] }
}

interface User {
  id: string
  username: string
  isOnline: boolean
  isActive: boolean
}

interface PrivateMessage {
  id: string;
  senderId: string;
  receiverId: string;
  message: string;
  timestamp: number;
  duration: number | null;
  replyTo?: string;
}

interface UserProfile {
  username: string;
  followers: number;
  following: number;
  stars: number;
}

const FIXED_GROUP = 'main-group'
const RECONNECTION_ATTEMPTS = 5
const RECONNECTION_DELAY = 1000

export function useSocket(url: string) {
  const [isConnected, setIsConnected] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [users, setUsers] = useState<User[]>([])
  const socketRef = useRef<Socket | null>(null)
  const reconnectAttempts = useRef(0)
  const [currentUsername, setCurrentUsername] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('username')
    }
    return null
  })
  const [joinError, setJoinError] = useState<string | null>(null)
  const [typingUsers, setTypingUsers] = useState<string[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const isInitialized = useRef(false)
  const [privateMessages, setPrivateMessages] = useState<{ [key: string]: PrivateMessage[] }>({});
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);

  // Initialize socket connection
  const initializeSocket = useCallback(() => {
    if (typeof window === 'undefined') return null
    
    try {
      if (socketRef.current?.connected) {
        return socketRef.current
      }

      const socket = io(url, {
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: RECONNECTION_ATTEMPTS,
        reconnectionDelay: RECONNECTION_DELAY,
        timeout: 10000,
      })

      socketRef.current = socket
      return socket
    } catch (error) {
      console.error('Socket initialization error:', error)
      return null
    }
  }, [url])

  // Setup socket event listeners
  useEffect(() => {
    if (isInitialized.current || typeof window === 'undefined') return

    const socket = initializeSocket()
    if (!socket) return

    isInitialized.current = true

    const handleConnect = () => {
      console.log('Socket connected successfully')
      setIsConnected(true)
      reconnectAttempts.current = 0

      // Attempt to reconnect with stored credentials
      const storedUsername = localStorage.getItem('username')
      const storedPassword = localStorage.getItem('password')
      if (storedUsername && storedPassword) {
        console.log('Attempting to reconnect with stored credentials')
        socket.emit('join_room', {
          username: storedUsername,
          room: FIXED_GROUP,
          password: storedPassword
        })
      }
    }

    const handleDisconnect = (reason: string) => {
      console.log('Socket disconnected:', reason)
      setIsConnected(false)
    }

    const handleConnectError = (error: Error) => {
      console.error('Connection error:', error)
      setIsConnected(false)
      reconnectAttempts.current++

      if (reconnectAttempts.current >= RECONNECTION_ATTEMPTS) {
        console.log('Max reconnection attempts reached')
        socket.close()
      }
    }

    socket.on('connect', handleConnect)
    socket.on('disconnect', handleDisconnect)
    socket.on('connect_error', handleConnectError)

    // Set up ping interval
    const pingInterval = setInterval(() => {
      if (socket.connected) {
        const start = Date.now()
        socket.emit('ping', () => {
          const latency = Date.now() - start
          console.log(`Ping: ${latency}ms`)
        })
      }
    }, 30000) // Ping every 30 seconds

    // Handle pong from server
    socket.on('pong', () => {
      console.log('Received pong from server')
    })

    socket.on('receive_message', (data: Message) => {
      setMessages(prev => [...prev, data]);
      setUnreadCount(prev => prev + 1);
    })

    socket.on('message_history', (history: Message[]) => {
      setMessages(history);
    })

    socket.on('user_list', (userList: User[]) => {
      setUsers(userList)
    })

    socket.on('join_success', ({ username }) => {
      setCurrentUsername(username)
      setJoinError(null)
    })

    socket.on('join_error', (error: string) => {
      setJoinError(error)
      localStorage.removeItem('username')
      localStorage.removeItem('password')
    })

    socket.on('message_edited', ({ messageId, newText }) => {
      setMessages(prev => prev.map(msg => 
        msg.id === messageId ? { ...msg, message: newText, isEdited: true } : msg
      ))
    })

    socket.on('message_deleted', ({ messageId }) => {
      setMessages(prev => prev.filter(msg => msg.id !== messageId))
    })

    socket.on('typing_start', ({ username }) => {
      setTypingUsers(prev => Array.from(new Set([...prev, username])))
    })

    socket.on('typing_end', ({ username }) => {
      setTypingUsers(prev => prev.filter(user => user !== username))
    })

    socket.on('message_reaction', ({ messageId, emoji, username }) => {
      setMessages(prev => prev.map(msg => {
        if (msg.id === messageId) {
          const reactions = { ...msg.reactions }
          if (!reactions[emoji]) {
            reactions[emoji] = []
          }
          if (!reactions[emoji].includes(username)) {
            reactions[emoji].push(username)
          }
          return { ...msg, reactions }
        }
        return msg
      }))
    })

    socket.on('update_seen', ({ messageId, seenBy }) => {
      setMessages(prev => prev.map(msg => 
        msg.id === messageId ? { ...msg, seenBy } : msg
      ))
    })

    socket.on('receive_private_message', (message: PrivateMessage) => {
      setPrivateMessages(prev => ({
        ...prev,
        [message.senderId]: [...(prev[message.senderId] || []), message]
      }));
    });

    socket.on('private_message_sent', (message: PrivateMessage) => {
      setPrivateMessages(prev => ({
        ...prev,
        [message.receiverId]: [...(prev[message.receiverId] || []), message]
      }));
    });

    socket.on('follow_success', ({ followedUsername }) => {
      setUserProfile(prev => prev ? {
        ...prev,
        following: prev.following + 1
      } : null);
    });

    socket.on('new_follower', ({ followerUsername }) => {
      setUserProfile(prev => prev ? {
        ...prev,
        followers: prev.followers + 1
      } : null);
    });

    socket.on('star_earned', () => {
      setUserProfile(prev => prev ? {
        ...prev,
        stars: prev.stars + 1
      } : null);
    });

    return () => {
      isInitialized.current = false
      if (socket) {
        socket.off('connect', handleConnect)
        socket.off('disconnect', handleDisconnect)
        socket.off('connect_error', handleConnectError)
        socket.off('pong')
        socket.off('receive_message')
        socket.off('message_history')
        socket.off('user_list')
        socket.off('join_success')
        socket.off('join_error')
        socket.off('message_edited')
        socket.off('message_deleted')
        socket.off('typing_start')
        socket.off('typing_end')
        socket.off('message_reaction')
        socket.off('update_seen')
        socket.off('receive_private_message');
        socket.off('private_message_sent');
        socket.off('follow_success');
        socket.off('new_follower');
        socket.off('star_earned');
        socket.disconnect()
      }
      clearInterval(pingInterval)
    }
  }, [url, initializeSocket, setMessages])

  const registerUser = useCallback((username: string, password: string) => {
    return new Promise<void>((resolve, reject) => {
      const socket = socketRef.current || initializeSocket();
      
      if (!socket) {
        reject(new Error('Unable to initialize socket connection'));
        return;
      }

      socket.emit('register', { username, password });

      socket.on('register_success', () => {
        resolve();
      });

      socket.on('register_error', (error: string) => {
        reject(new Error(error));
      });
    });
  }, [initializeSocket]);

  const joinRoom = useCallback((username: string, password: string) => {
    return new Promise<void>((resolve, reject) => {
      const socket = socketRef.current || initializeSocket()
      
      if (!socket) {
        reject(new Error('Unable to initialize socket connection'))
        return
      }

      const joinSuccessHandler = ({ username: joinedUsername }: { username: string }) => {
        setCurrentUsername(joinedUsername)
        setJoinError(null)
        localStorage.setItem('username', username)
        localStorage.setItem('password', password)
        socket.off('join_success', joinSuccessHandler)
        socket.off('join_error', joinErrorHandler)
        resolve()
      }

      const joinErrorHandler = (error: string) => {
        setJoinError(error)
        localStorage.removeItem('username')
        localStorage.removeItem('password')
        socket.off('join_success', joinSuccessHandler)
        socket.off('join_error', joinErrorHandler)
        reject(new Error(error))
      }

      socket.on('join_success', joinSuccessHandler)
      socket.on('join_error', joinErrorHandler)

      socket.emit('join_room', { username, room: FIXED_GROUP, password })
    })
  }, [initializeSocket])

  const sendPrivateMessage = useCallback((receiverId: string, message: string, duration: number | null = null, replyTo?: string) => {
    const socket = socketRef.current;
    if (!socket?.connected || !currentUsername) return;

    socket.emit('send_private_message', {
      senderId: socket.id,
      receiverId,
      message,
      duration,
      replyTo
    });
  }, [currentUsername]);

  const followUser = useCallback((followedUsername: string) => {
    const socket = socketRef.current;
    if (!socket?.connected || !currentUsername) return;

    socket.emit('follow_user', {
      followerUsername: currentUsername,
      followedUsername
    });
  }, [currentUsername]);

  const uploadMedia = useCallback(async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch(`${url}/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('File upload failed');
      }

      const { filename } = await response.json();
      return `${url}/uploads/${filename}`;
    } catch (error) {
      console.error('Error uploading file:', error);
      throw error;
    }
  }, [url]);

  const sendMessage = useCallback((messageText: string, replyTo?: string, duration: number | null = null) => {
    const socket = socketRef.current
    if (!socket?.connected || !currentUsername) {
      console.log('Socket not connected or user not joined')
      return
    }

    const messageData = {
      id: Date.now().toString(),
      message: messageText,
      username: currentUsername,
      timestamp: Date.now(),
      replyTo,
      seenBy: [currentUsername],
      duration,
      reactions: {}
    }

    socket.emit('send_message', { ...messageData, room: FIXED_GROUP })
  }, [currentUsername])

  const editMessage = useCallback((messageId: string, newText: string) => {
    const socket = socketRef.current
    if (!socket?.connected) return
    socket.emit('edit_message', { messageId, newText, room: FIXED_GROUP })
  }, [])

  const deleteMessage = useCallback((messageId: string) => {
    const socket = socketRef.current
    if (!socket?.connected) return
    socket.emit('delete_message', { messageId, room: FIXED_GROUP })
  }, [])

  const addReaction = useCallback((messageId: string, emoji: string) => {
    const socket = socketRef.current
    if (!socket?.connected || !currentUsername) return
    socket.emit('add_reaction', { messageId, emoji, username: currentUsername, room: FIXED_GROUP })
  }, [currentUsername])

  const markMessageAsSeen = useCallback((messageId: string) => {
    const socket = socketRef.current
    if (!socket?.connected || !currentUsername) return
    socket.emit('message_seen', { messageId, username: currentUsername, room: FIXED_GROUP })
  }, [currentUsername])

  const logout = useCallback(() => {
    localStorage.removeItem('username')
    localStorage.removeItem('password')
    setCurrentUsername(null)
    setMessages([])
    setUsers([])
    setUnreadCount(0)
    setPrivateMessages({});
    setUserProfile(null);
    
    if (socketRef.current) {
      socketRef.current.disconnect()
      socketRef.current = null
    }
    
    isInitialized.current = false
  }, [])

  const startTyping = useCallback(() => {
    const socket = socketRef.current
    if (!socket?.connected || !currentUsername) return
    socket.emit('typing_start', { username: currentUsername, room: FIXED_GROUP })
  }, [currentUsername])

  const stopTyping = useCallback(() => {
    const socket = socketRef.current
    if (!socket?.connected || !currentUsername) return
    socket.emit('typing_end', { username: currentUsername, room: FIXED_GROUP })
  }, [currentUsername])

  return {
    isConnected,
    messages,
    setMessages,
    privateMessages,
    users,
    currentUsername,
    joinError,
    typingUsers,
    unreadCount,
    userProfile,
    joinRoom,
    sendMessage,
    sendPrivateMessage,
    editMessage,
    deleteMessage,
    addReaction,
    markMessageAsSeen,
    logout,
    startTyping,
    stopTyping,
    followUser,
    uploadMedia,
    registerUser,
  }
}

