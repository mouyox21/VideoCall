export interface User {
  id: string;
  name: string;
  status: 'online' | 'offline' | 'typing' | 'in-call';
  avatar?: string;
}

export interface Message {
  id: string;
  userId: string;
  content: string;
  type: 'text' | 'file';
  fileUrl?: string;
  fileName?: string;
  createdAt: number;
  expiresAt: number;
}

export interface Room {
  id: string;
  name: string;
  hostId: string;
  isPrivate: boolean;
  participants: { [key: string]: User };
  pendingRequests: string[];
}