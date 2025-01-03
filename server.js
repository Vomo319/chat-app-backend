import { useEffect, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'

interface Message {
  message: string
  username: string
  room: string
  timestamp: string
}

interface User {
  username: string
  isTyping?: boolean
}

export function useSocket(url: string, username: string, room: string) {
  const [isConnected, setIsConnected] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [typingUsers, setTypingUsers] = useState<string[]>([])
  const socketRef = useRef<Socket | null>(null)
  const typingTimeoutRef = useRef<NodeJS.Timeout>()

  useEffect(() => {
    const socket = io(url, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    })
    socketRef.current = socket

    socket.on('connect', () => {
      console.log('Connected to server')
      setIsConnected(true)
      socket.emit('join_room', { username, room })
    })

    socket.on('disconnect', () => {
      console.log('Disconnected from server')
      setIsConnected(false)
    })

    socket.on('receive_message', (message: Message) => {
      setMessages(prev => [...prev, message])
    })

    socket.on('user_joined', ({ users: roomUsers }) => {
      setUsers(roomUsers.map((username: string) => ({ username })))
    })

    socket.on('user_left', ({ users: roomUsers }) => {
      setUsers(roomUsers.map((username: string) => ({ username })))
    })

    socket.on('user_typing', ({ username: typingUser, isTyping }) => {
      setTypingUsers(prev => 
        isTyping 
          ? [...new Set([...prev, typingUser])]
          : prev.filter(u => u !== typingUser)
      )
    })

    socket.on('ping', () => {
      socket.emit('pong')
    })

    return () => {
      if (socket) {
        socket.emit('leave_room', { username, room })
        socket.disconnect()
      }
    }
  }, [url, username, room])

  const sendMessage = (messageText: string) => {
    if (socketRef.current) {
      socketRef.current.emit('send_message', {
        message: messageText,
        username,
        room
      })
    }
  }

  const sendTypingStatus = (isTyping: boolean) => {
    if (socketRef.current) {
      socketRef.current.emit('typing', { username, room, isTyping })
    }
  }

  const handleTyping = () => {
    sendTypingStatus(true)
    
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current)
    }
    
    typingTimeoutRef.current = setTimeout(() => {
      sendTypingStatus(false)
    }, 1000)
  }

  return { 
    isConnected, 
    messages, 
    users, 
    typingUsers, 
    sendMessage,
    handleTyping
  }
}
