import { useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { ref, get, update } from 'firebase/database';
import { Chat } from './components/Chat';
import { RoomJoin } from './components/RoomJoin';
import { User, Room } from './types';
import { db } from './firebase';

function App() {
  const [currentRoom, setCurrentRoom] = useState<string | null>(null);
  const [currentUser] = useState<User>({
    id: uuidv4(),
    name: `User_${Math.floor(Math.random() * 1000)}`,
    status: 'online'
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Try to join room from URL path when component mounts
  useEffect(() => {
    async function checkForRoomInUrl() {
      try {
        // Get room code from URL path (everything after the first slash)
        const pathElements = window.location.pathname.split('/').filter(Boolean);
        const roomCode = pathElements[0];

        if (!roomCode) {
          setIsLoading(false);
          return;
        }

        // Try to join the room with the code from URL
        await joinRoom(roomCode);
      } catch (error) {
        console.error("Error checking room from URL:", error);
        setError("Failed to join room from URL");
      } finally {
        setIsLoading(false);
      }
    }

    checkForRoomInUrl();
  }, []);

  // Function to join a room, can be used by the URL check and the join form
  async function joinRoom(roomCode: string) {
    try {
      const roomRef = ref(db, `rooms/${roomCode}`);
      const snapshot = await get(roomRef);
      
      if (!snapshot.exists()) {
        setError('Room not found');
        return false;
      }

      const room = snapshot.val() as Room;

      if (room.isPrivate) {
        // Add to pending requests
        await update(roomRef, {
          pendingRequests: [...(room.pendingRequests || []), currentUser.id]
        });
        setError('Request sent to room host');
        return false;
      }

      // Add user to room participants
      await update(roomRef, {
        [`participants/${currentUser.id}`]: {
          ...currentUser,
          status: 'online'
        }
      });

      // Update URL to include room code without reloading the page
      window.history.pushState({}, '', `/${roomCode}`);
      
      // Set current room state
      setCurrentRoom(roomCode);
      return true;
    } catch (error) {
      console.error('Error joining room:', error);
      setError('Failed to join room');
      return false;
    }
  }

  // Handling room join from join component
  const handleJoinRoom = (roomCode: string) => {
    setCurrentRoom(roomCode);
    // Update URL to include room code
    window.history.pushState({}, '', `/${roomCode}`);
  };

  // Show loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-xl">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {currentRoom ? (
        <Chat roomId={currentRoom} currentUser={currentUser} />
      ) : (
        <RoomJoin 
          onJoinRoom={handleJoinRoom} 
          currentUser={currentUser} 
          initialError={error} 
          onTryJoinRoom={joinRoom}
        />
      )}
    </div>
  );
}

export default App;