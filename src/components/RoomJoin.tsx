import React, { useState, useEffect } from 'react';
import { ref, get, update } from 'firebase/database';
import { db } from '../firebase';
import { Room, User } from '../types';
import { CreateRoom } from './CreateRoom';

interface RoomJoinProps {
  onJoinRoom: (roomId: string) => void;
  currentUser: User;
  initialError?: string | null;
  onTryJoinRoom?: (roomCode: string) => Promise<boolean>;
}

export const RoomJoin: React.FC<RoomJoinProps> = ({ 
  onJoinRoom, 
  currentUser, 
  initialError = null,
  onTryJoinRoom
}) => {
  const [roomCode, setRoomCode] = useState('');
  const [error, setError] = useState<string | null>(initialError);
  const [showCreate, setShowCreate] = useState(false);

  // Update error when initialError prop changes
  useEffect(() => {
    setError(initialError);
  }, [initialError]);

  async function handleJoinRoom(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (onTryJoinRoom) {
      // Use the parent component's join function if provided
      const success = await onTryJoinRoom(roomCode);
      if (!success) {
        // Error will be set by the parent component
        return;
      }
    } else {
      // Original join logic
      try {
        const roomRef = ref(db, `rooms/${roomCode}`);
        const snapshot = await get(roomRef);
        
        if (!snapshot.exists()) {
          setError('Room not found');
          return;
        }

        const room = snapshot.val() as Room;

        if (room.isPrivate) {
          // Add to pending requests
          await update(roomRef, {
            pendingRequests: [...(room.pendingRequests || []), currentUser.id]
          });
          setError('Request sent to room host');
          return;
        }

        // Add user to room participants
        await update(roomRef, {
          [`participants/${currentUser.id}`]: {
            ...currentUser,
            status: 'online'
          }
        });

        onJoinRoom(roomCode);
      } catch (error) {
        console.error('Error joining room:', error);
        setError('Failed to join room');
      }
    }
  }

  // Copy room link to clipboard
  const copyRoomLink = () => {
    if (!roomCode) {
      setError('Please enter a room code first');
      return;
    }
    
    const roomLink = `${window.location.origin}/${roomCode}`;
    navigator.clipboard.writeText(roomLink)
      .then(() => {
        setError('Room link copied to clipboard!');
        setTimeout(() => setError(null), 3000);
      })
      .catch(() => {
        setError('Failed to copy link');
      });
  };

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      {showCreate ? (
        <CreateRoom onRoomCreated={onJoinRoom} currentUser={currentUser} />
      ) : (
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full">
          <h1 className="text-2xl font-bold mb-6 text-center">Join Chat Room</h1>
          
          <form onSubmit={handleJoinRoom} className="space-y-4">
            <div>
              <label 
                htmlFor="roomCode" 
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Room Code
              </label>
              <input
                id="roomCode"
                type="text"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value)}
                placeholder="Enter room code"
                className="w-full rounded-lg border p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {error && (
              <p className={`text-sm ${error.includes('copied') ? 'text-green-500' : 'text-red-500'}`}>
                {error}
              </p>
            )}

            <div className="flex gap-2">
              <button
                type="submit"
                className="flex-1 bg-blue-500 text-white rounded-lg py-2 px-4 hover:bg-blue-600 transition-colors"
              >
                Join Room
              </button>
              
              <button
                type="button"
                onClick={copyRoomLink}
                className="bg-gray-200 text-gray-700 rounded-lg py-2 px-4 hover:bg-gray-300 transition-colors"
              >
                Copy Link
              </button>
            </div>

            <div className="text-center">
              <span className="text-gray-500">or</span>
            </div>

            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="w-full bg-gray-100 text-gray-700 rounded-lg py-2 px-4 hover:bg-gray-200 transition-colors"
            >
              Create New Room
            </button>
          </form>
        </div>
      )}
    </div>
  );
};