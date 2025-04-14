import React, { useEffect, useRef, useState } from 'react';
import SimplePeer from 'simple-peer';
import { ref, onValue, set, remove } from 'firebase/database';
import { Video, Phone, Monitor, X } from 'lucide-react';
import { db } from '../firebase';
import { User } from '../types';

interface MediaCallProps {
  roomId: string;
  currentUser: User;
  participants: { [key: string]: User };
}

type CallType = 'video' | 'audio' | 'screen';

export const MediaCall: React.FC<MediaCallProps> = ({ roomId, currentUser, participants }) => {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [peers, setPeers] = useState<{ [key: string]: SimplePeer.Instance }>({});
  const [activeCallType, setActiveCallType] = useState<CallType | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteStreams = useRef<{ [key: string]: MediaStream }>({});
  const peersRef = useRef(peers);

  useEffect(() => {
    peersRef.current = peers;
  }, [peers]);

  useEffect(() => {
    const callsRef = ref(db, `calls/${roomId}`);
    
    const unsubscribe = onValue(callsRef, (snapshot) => {
      const callData = snapshot.val();
      if (!callData) return;

      Object.entries(callData).forEach(([userId, signal]) => {
        if (userId === currentUser.id) return;
        
        if (!peersRef.current[userId]) {
          const peer = createPeer(userId, currentUser.id, localStream);
          setPeers(prev => ({ ...prev, [userId]: peer }));
        }
        
        try {
          peersRef.current[userId].signal(signal);
        } catch (error) {
          console.error('Error signaling peer:', error);
        }
      });
    });

    return () => {
      unsubscribe();
      stopLocalStream();
    };
  }, [roomId, currentUser.id, localStream]);

  const createPeer = (userId: string, initiatorId: string, stream: MediaStream | null) => {
    const peer = new SimplePeer({
      initiator: currentUser.id === initiatorId,
      stream,
      trickle: false
    });

    peer.on('signal', (signal) => {
      const signalRef = ref(db, `calls/${roomId}/${currentUser.id}`);
      set(signalRef, signal);
    });

    peer.on('stream', (remoteStream) => {
      remoteStreams.current[userId] = remoteStream;
      const videoElement = document.getElementById(`remote-video-${userId}`) as HTMLVideoElement;
      if (videoElement) {
        videoElement.srcObject = remoteStream;
      }
    });

    return peer;
  };

  const startLocalStream = async (type: CallType) => {
    try {
      const constraints = {
        audio: true,
        video: type === 'video' ? true : false
      };

      let stream;
      if (type === 'screen') {
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      } else {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      }

      setLocalStream(stream);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      setActiveCallType(type);

      // Update user status
      const userRef = ref(db, `rooms/${roomId}/participants/${currentUser.id}`);
      set(userRef, { ...currentUser, status: 'in-call' });
    } catch (error) {
      console.error('Error accessing media devices:', error);
    }
  };

  const stopLocalStream = () => {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      setLocalStream(null);
    }
    
    Object.values(peers).forEach(peer => peer.destroy());
    setPeers({});
    setActiveCallType(null);

    // Remove call signals
    const callRef = ref(db, `calls/${roomId}/${currentUser.id}`);
    remove(callRef);

    // Update user status
    const userRef = ref(db, `rooms/${roomId}/participants/${currentUser.id}`);
    set(userRef, { ...currentUser, status: 'online' });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-4 w-full max-w-4xl">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold">
            {activeCallType === 'video' ? 'Video Call' :
             activeCallType === 'audio' ? 'Voice Call' :
             'Screen Sharing'}
          </h3>
          <button
            onClick={stopLocalStream}
            className="p-2 rounded-full bg-red-500 text-white hover:bg-red-600"
          >
            <X size={20} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* Local Stream */}
          <div className="relative">
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              className="w-full rounded-lg bg-gray-900"
            />
            <div className="absolute bottom-2 left-2 text-white text-sm bg-black bg-opacity-50 px-2 py-1 rounded">
              You
            </div>
          </div>

          {/* Remote Streams */}
          {Object.keys(participants).map(userId => (
            userId !== currentUser.id && (
              <div key={userId} className="relative">
                <video
                  id={`remote-video-${userId}`}
                  autoPlay
                  playsInline
                  className="w-full rounded-lg bg-gray-900"
                />
                <div className="absolute bottom-2 left-2 text-white text-sm bg-black bg-opacity-50 px-2 py-1 rounded">
                  {participants[userId].name}
                </div>
              </div>
            )
          ))}
        </div>

        {!activeCallType && (
          <div className="flex justify-center gap-4 mt-4">
            <button
              onClick={() => startLocalStream('video')}
              className="p-3 rounded-full bg-blue-500 text-white hover:bg-blue-600"
            >
              <Video size={24} />
            </button>
            <button
              onClick={() => startLocalStream('audio')}
              className="p-3 rounded-full bg-blue-500 text-white hover:bg-blue-600"
            >
              <Phone size={24} />
            </button>
            <button
              onClick={() => startLocalStream('screen')}
              className="p-3 rounded-full bg-blue-500 text-white hover:bg-blue-600"
            >
              <Monitor size={24} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};