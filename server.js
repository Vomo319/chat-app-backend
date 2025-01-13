'use client'

import React, { useState, useRef, useEffect, useMemo } from 'react'
import { Send, Menu, Trash2, Reply, ChevronDown, ChevronRight, Pencil, Clock, UserPlus, Star, ImageIcon, Video, Mic, MoreVertical, Users, Settings, PlusCircle, Moon, Sun, Paperclip, Download, RefreshCw } from 'lucide-react'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useSocket } from '@/utils/socket'
import { useTheme } from 'next-themes'
import { OnlineUsers } from '@/components/online-users'
import { EmojiPicker } from '@/components/emoji-picker'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer"
import { MessageItem } from '@/components/message-item'
import { VoiceRecorder } from '@/components/voice-recorder'
import { Separator } from "@/components/ui/separator"
import { Feed } from '@/components/feed'
import { toast } from "@/components/ui/use-toast"
import { TypingIndicator } from '@/components/typing-indicator'
import { Textarea } from "@/components/ui/textarea"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { AnimatedBackground } from '../components/animated-background'
import { subscribeToPushNotifications } from '@/utils/pushNotifications'
import { GuessTheNumber } from '@/components/guess-the-number'
import { TicTacToe } from '@/components/tic-tac-toe'
import { initializeOneSignal, getOneSignalPlayerId } from '@/utils/onesignal'

const ThemeToggle = () => {
  const { theme, setTheme } = useTheme()

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
    >
      <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      <span className="sr-only">Toggle theme</span>
    </Button>
  )
}

const ChatPage: React.FC = () => {
  const [backgroundTheme, setBackgroundTheme] = useState<'nature' | 'ocean' | 'sunset'>('ocean');
  const [inputMessage, setInputMessage] = useState('');
  const [messages, setMessages] = useState<Array<{ id: string; text: string; sender: string }>>([]);
  
  // Sample online users data
  const onlineUsers = [
    { id: '1', name: 'Alice', avatar: '/avatars/alice.jpg' },
    { id: '2', name: 'Bob', avatar: '/avatars/bob.jpg' },
    { id: '3', name: 'Charlie', avatar: '/avatars/charlie.jpg' },
  ];

  const sendMessage = () => {
    if (inputMessage.trim()) {
      const newMessage = {
        id: Date.now().toString(),
        text: inputMessage,
        sender: 'user',
      };
      setMessages([...messages, newMessage]);
      setInputMessage('');
    }
  };

  return (
    <div className="fixed inset-0 bg-white/90 dark:bg-gray-900/90 overflow-hidden flex flex-col">
      <AnimatedBackground theme={backgroundTheme} />
      <div className="relative z-10 flex flex-col h-full">
        {/* Header */}
        <header className="p-4 flex justify-between items-center bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm">
          <h1 className="text-2xl font-bold">Chat App</h1>
          <div className="flex items-center space-x-2">
            <Select
              value={backgroundTheme}
              onValueChange={(value: 'nature' | 'ocean' | 'sunset') => setBackgroundTheme(value)}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Background Theme" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="nature">Nature</SelectItem>
                <SelectItem value="ocean">Ocean</SelectItem>
                <SelectItem value="sunset">Sunset</SelectItem>
              </SelectContent>
            </Select>
            <ThemeToggle />
          </div>
        </header>

        {/* Main content */}
        <main className="flex-grow overflow-hidden flex">
          {/* Sidebar */}
          <aside className="w-64 bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm p-4 overflow-y-auto">
            <OnlineUsers users={onlineUsers} />
          </aside>

          {/* Chat area */}
          <div className="flex-grow flex flex-col">
            <ScrollArea className="flex-grow p-4">
              {messages.map((message) => (
                <div key={message.id} className={`mb-4 ${message.sender === 'user' ? 'text-right' : 'text-left'}`}>
                  <div className={`inline-block p-2 rounded-lg ${message.sender === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-200 dark:bg-gray-700'}`}>
                    {message.text}
                  </div>
                </div>
              ))}
            </ScrollArea>
            <div className="p-4 bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm">
              <div className="flex items-center space-x-2">
                <Input
                  type="text"
                  placeholder="Type a message..."
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      sendMessage();
                    }
                  }}
                  className="flex-grow"
                />
                <Button onClick={sendMessage}>
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

export default ChatPage

