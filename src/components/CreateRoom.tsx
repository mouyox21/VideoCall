import React, { useState } from 'react';
import { ref, set } from 'firebase/database';
import { v4 as uuidv4 } from 'uuid';
import { Lock, Unlock, Copy, Check } from 'lucide-react';
import { db } from '../firebase';
import { Room, User } from '../types';

interface CreateRoomProps {
  onRoomCreated: (roomId: string) => void;
  currentUser: User;
}

export const CreateRoom: React.FC<CreateRoomProps> = ({ onRoomCreated, currentUser }) => {
  const [roomName, setRoomName] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [error, setError] = useState('');
  const [roomId, setRoomId] = useState('');
  const [hasCopied, setHasCopied] = useState(false);
  const [isCreated, setIsCreated] = useState(false);

  async function handleCreateRoom(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!roomName.trim()) {
      setError('Room name is required');
      return;
    }

    try {
      const newRoomId = uuidv4().substring(0, 8); // Shorter room ID for easier sharing
      setRoomId(newRoomId);
      
      const room: Room = {
        id: newRoomId,
        name: roomName,
        hostId: currentUser.id,
        isPrivate,
        participants: {
          [currentUser.id]: {
            ...currentUser,
            status: 'online'
          }
        },
        pendingRequests: []
      };

      await set(ref(db, `rooms/${newRoomId}`), room);
      setIsCreated(true);
      
      // Don't automatically join room, let user copy link first if they want
    } catch (error) {
      console.error('Error creating room:', error);
      setError('Failed to create room');
    }
  }

  function handleJoinCreatedRoom() {
    onRoomCreated(roomId);
  }

  function copyRoomLink() {
    const roomLink = `${window.location.origin}/${roomId}`;
    navigator.clipboard.writeText(roomLink)
      .then(() => {
        setHasCopied(true);
        setTimeout(() => setHasCopied(false), 3000);
      })
      .catch(() => {
        setError('Failed to copy link');
      });
  }

  return (
    <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full">
      <h2 className="text-2xl font-bold mb-6 text-center">Create New Room</h2>
      
      {isCreated ? (
        <div className="space-y-6">
          <div className="text-center mb-4">
            <div className="bg-green-100 text-green-700 p-3 rounded-lg mb-4">
              Room successfully created!
            </div>
            <h3 className="font-semibold text-lg">{roomName}</h3>
            <p className="text-gray-500">Room Code: {roomId}</p>
          </div>
          
          <div className="border rounded-lg p-4 flex items-center justify-between bg-gray-50">
            <span className="font-mono text-sm truncate">{`${window.location.origin}/${roomId}`}</span>
            <button 
              onClick={copyRoomLink}
              className="ml-2 p-2 rounded-full hover:bg-gray-200"
            >
              {hasCopied ? <Check size={20} className="text-green-500" /> : <Copy size={20} />}
            </button>
          </div>
          
          <button
            onClick={handleJoinCreatedRoom}
            className="w-full bg-blue-500 text-white rounded-lg py-3 px-4 hover:bg-blue-600 transition-colors"
          >
            Join Room
          </button>
        </div>
      ) : (
        <form onSubmit={handleCreateRoom} className="space-y-4">
          <div>
            <label 
              htmlFor="roomName" 
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Room Name
            </label>
            <input
              id="roomName"
              type="text"
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              placeholder="Enter room name"
              className="w-full rounded-lg border p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsPrivate(!isPrivate)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                isPrivate 
                  ? 'bg-blue-500 text-white' 
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {isPrivate ? <Lock size={18} /> : <Unlock size={18} />}
              {isPrivate ? 'Private Room' : 'Public Room'}
            </button>
            
            <div className="text-sm text-gray-500 flex-1">
              {isPrivate 
                ? 'Users need approval to join' 
                : 'Anyone with the code can join'}
            </div>
          </div>

          {error && (
            <p className="text-red-500 text-sm">{error}</p>
          )}

          <button
            type="submit"
            className="w-full bg-blue-500 text-white rounded-lg py-2 px-4 hover:bg-blue-600 transition-colors"
          >
            Create Room
          </button>
        </form>
      )}
    </div>
  );
};