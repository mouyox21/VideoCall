import React, { useState, useEffect, useRef } from 'react';
import { ref, onValue, push, update } from 'firebase/database';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { v4 as uuidv4 } from 'uuid';
import { formatDistanceToNow } from 'date-fns';
import { useDropzone } from 'react-dropzone';
import { 
  Send, 
  Upload, 
  Video, 
  Phone, 
  Monitor,
  Clock,
  Mic,
  MicOff,
  VideoOff,
  Maximize2,
  Minimize2
} from 'lucide-react';
import { db, storage } from '../firebase';
import { Message, User, Room } from '../types';

interface ChatProps {
  roomId: string;
  currentUser: User;
}

// WebRTC configuration
const configuration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

export const Chat: React.FC<ChatProps> = ({ roomId, currentUser }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [room, setRoom] = useState<Room | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageCache = useRef<Map<string, Message>>(new Map());
  
  // WebRTC states
  const [isInCall, setIsInCall] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isCameraFacingUser, setIsCameraFacingUser] = useState(true);
  const [isCallMinimized, setIsCallMinimized] = useState(false);
  const [callType, setCallType] = useState<'video' | 'audio' | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [activeSpeaker, setActiveSpeaker] = useState<string | null>(null);
  
  // WebRTC refs
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const dataChannelsRef = useRef<Map<string, RTCDataChannel>>(new Map());

  const { getRootProps, getInputProps } = useDropzone({
    onDrop: handleFileDrop,
    multiple: true
  });

  // Setup room and message listeners
  useEffect(() => {
    const roomRef = ref(db, `rooms/${roomId}`);
    const messagesRef = ref(db, `messages/${roomId}`);

    const roomUnsubscribe = onValue(roomRef, (snapshot) => {
      setRoom(snapshot.val());
    });

    const messagesUnsubscribe = onValue(messagesRef, (snapshot) => {
      const messagesData = snapshot.val();
      if (messagesData) {
        const messagesList = Object.values(messagesData) as Message[];
        setMessages(messagesList.filter(msg => msg.expiresAt > Date.now()));
      }
    });

    return () => {
      roomUnsubscribe();
      messagesUnsubscribe();
      
      // Cleanup any active call
      if (isInCall) {
        handleEndCall();
      }
    };
  }, [roomId]);

  // Setup WebRTC signaling
  useEffect(() => {
    const signalRef = ref(db, `signals/${roomId}`);
    
    const signalHandler = onValue(signalRef, (snapshot) => {
      const signals = snapshot.val();
      if (!signals) return;
      
      Object.keys(signals).forEach(async (signalId) => {
        const signal = signals[signalId];
        
        // Skip if the signal is from the current user or already processed
        if (signal.from === currentUser.id || signal.processed) return;
        
        if (signal.type === 'offer' && signal.to === currentUser.id) {
          await handleReceivedOffer(signal);
          // Mark signal as processed
          update(ref(db, `signals/${roomId}/${signalId}`), { processed: true });
        } else if (signal.type === 'answer' && signal.to === currentUser.id) {
          await handleReceivedAnswer(signal);
          // Mark signal as processed
          update(ref(db, `signals/${roomId}/${signalId}`), { processed: true });
        } else if (signal.type === 'ice-candidate' && signal.to === currentUser.id) {
          await handleReceivedICECandidate(signal);
          // Mark signal as processed
          update(ref(db, `signals/${roomId}/${signalId}`), { processed: true });
        } else if (signal.type === 'end-call' && (signal.to === currentUser.id || signal.to === 'all')) {
          handleEndCall();
          // Mark signal as processed
          update(ref(db, `signals/${roomId}/${signalId}`), { processed: true });
        }
      });
    });
    
    return () => {
      signalHandler();
    };
  }, [roomId, currentUser.id, isInCall]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);
  
  // Set local video stream to video element
  useEffect(() => {
    if (localVideoRef.current && localStreamRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }
  }, [isInCall]);
  
  // Update user status when in call
  useEffect(() => {
    if (room) {
      update(ref(db, `rooms/${roomId}/participants/${currentUser.id}`), {
        status: isInCall ? 'in-call' : 'online'
      });
    }
    
    return () => {
      if (room) {
        update(ref(db, `rooms/${roomId}/participants/${currentUser.id}`), {
          status: 'online'
        });
      }
    };
  }, [isInCall, currentUser.id, roomId, room]);

  async function handleFileDrop(acceptedFiles: File[]) {
    for (const file of acceptedFiles) {
      const fileId = uuidv4();
      const fileRef = storageRef(storage, `files/${roomId}/${fileId}`);
      
      try {
        const snapshot = await uploadBytes(fileRef, file);
        const downloadURL = await getDownloadURL(snapshot.ref);
        
        const message: Message = {
          id: fileId,
          userId: currentUser.id,
          content: '',
          type: 'file',
          fileUrl: downloadURL,
          fileName: file.name,
          createdAt: Date.now(),
          expiresAt: Date.now() + 3600000 // 1 hour
        };

        await push(ref(db, `messages/${roomId}`), message);
      } catch (error) {
        console.error('Error uploading file:', error);
      }
    }
  }

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!newMessage.trim()) return;

    const messageId = uuidv4();
    const message: Message = {
      id: messageId,
      userId: currentUser.id,
      content: newMessage,
      type: 'text',
      createdAt: Date.now(),
      expiresAt: Date.now() + 3600000 // 1 hour
    };

    await push(ref(db, `messages/${roomId}`), message);
    setNewMessage('');
  }

  // WebRTC functions
  async function initializeMediaStream(type: 'video' | 'audio') {
    try {
      const constraints = {
        audio: true,
        video: type === 'video' ? { facingMode: isCameraFacingUser ? 'user' : 'environment' } : false
      };
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = stream;
      
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      
      setCallType(type);
      setIsInCall(true);
      
      // Connect to other participants in the room
      if (room && room.participants) {
        Object.keys(room.participants)
          .filter(userId => userId !== currentUser.id)
          .forEach(userId => {
            createPeerConnection(userId);
          });
      }
    } catch (error) {
      console.error('Error accessing media devices:', error);
    }
  }

  async function switchCamera() {
    if (!localStreamRef.current || callType !== 'video') return;
    
    // Stop current stream
    localStreamRef.current.getTracks().forEach(track => track.stop());
    
    // Toggle camera facing mode
    setIsCameraFacingUser(!isCameraFacingUser);
    
    // Get new stream with different camera
    try {
      const constraints = {
        audio: true,
        video: { facingMode: !isCameraFacingUser ? 'user' : 'environment' }
      };
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = stream;
      
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      
      // Replace streams in peer connections
      peerConnectionsRef.current.forEach((pc, userId) => {
        pc.getSenders().forEach(sender => {
          if (sender.track?.kind === 'video' && localStreamRef.current) {
            const videoTrack = localStreamRef.current.getVideoTracks()[0];
            if (videoTrack) {
              sender.replaceTrack(videoTrack);
            }
          }
        });
      });
    } catch (error) {
      console.error('Error switching camera:', error);
    }
  }

  async function toggleScreenSharing() {
    if (!isInCall) return;
    
    if (!isScreenSharing) {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        screenStreamRef.current = stream;
        
        // Replace video track with screen sharing track
        peerConnectionsRef.current.forEach((pc, userId) => {
          pc.getSenders().forEach(sender => {
            if (sender.track?.kind === 'video' && screenStreamRef.current) {
              const screenTrack = screenStreamRef.current.getVideoTracks()[0];
              if (screenTrack) {
                sender.replaceTrack(screenTrack);
              }
            }
          });
        });
        
        // Update local video preview to show screen
        if (localVideoRef.current && screenStreamRef.current) {
          localVideoRef.current.srcObject = screenStreamRef.current;
        }
        
        // Handle when user stops sharing via browser UI
        screenStreamRef.current.getVideoTracks()[0].onended = () => {
          toggleScreenSharing();
        };
        
        setIsScreenSharing(true);
      } catch (error) {
        console.error('Error sharing screen:', error);
      }
    } else {
      // Stop screen sharing
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach(track => track.stop());
        screenStreamRef.current = null;
      }
      
      // Switch back to camera
      if (localStreamRef.current && callType === 'video') {
        peerConnectionsRef.current.forEach((pc, userId) => {
          pc.getSenders().forEach(sender => {
            if (sender.track?.kind === 'video' && localStreamRef.current) {
              const videoTrack = localStreamRef.current.getVideoTracks()[0];
              if (videoTrack) {
                sender.replaceTrack(videoTrack);
              }
            }
          });
        });
        
        // Update local video preview to show camera again
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = localStreamRef.current;
        }
      }
      
      setIsScreenSharing(false);
    }
  }

  function toggleAudio() {
    if (!localStreamRef.current) return;
    
    const audioTracks = localStreamRef.current.getAudioTracks();
    if (audioTracks.length > 0) {
      audioTracks[0].enabled = !isAudioEnabled;
      setIsAudioEnabled(!isAudioEnabled);
    }
  }

  function toggleVideo() {
    if (!localStreamRef.current || callType !== 'video') return;
    
    const videoTracks = localStreamRef.current.getVideoTracks();
    if (videoTracks.length > 0) {
      videoTracks[0].enabled = !isVideoEnabled;
      setIsVideoEnabled(!isVideoEnabled);
    }
  }

  async function startVideoCall() {
    await initializeMediaStream('video');
  }

  async function startAudioCall() {
    await initializeMediaStream('audio');
  }

  async function handleEndCall() {
    // Send end call signal to all participants
    await push(ref(db, `signals/${roomId}`), {
      type: 'end-call',
      from: currentUser.id,
      to: 'all',
      createdAt: Date.now()
    });
    
    // Clean up local streams
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => track.stop());
      screenStreamRef.current = null;
    }
    
    // Clean up peer connections
    peerConnectionsRef.current.forEach((pc) => {
      pc.close();
    });
    peerConnectionsRef.current.clear();
    dataChannelsRef.current.clear();
    
    // Reset state
    setIsInCall(false);
    setCallType(null);
    setIsScreenSharing(false);
    setRemoteStreams(new Map());
    setActiveSpeaker(null);
  }

  function createPeerConnection(userId: string) {
    // Skip if connection already exists
    if (peerConnectionsRef.current.has(userId)) return;
    
    const peerConnection = new RTCPeerConnection(configuration);
    peerConnectionsRef.current.set(userId, peerConnection);
    
    // Add local stream tracks to peer connection
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        if (localStreamRef.current) {
          peerConnection.addTrack(track, localStreamRef.current);
        }
      });
    }
    
    // Create data channel
    const dataChannel = peerConnection.createDataChannel(`chat-${roomId}`);
    dataChannelsRef.current.set(userId, dataChannel);
    
    // Set up event handlers
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        // Send ICE candidate to remote peer via Firebase
        push(ref(db, `signals/${roomId}`), {
          type: 'ice-candidate',
          from: currentUser.id,
          to: userId,
          candidate: event.candidate,
          createdAt: Date.now()
        });
      }
    };
    
    peerConnection.ontrack = (event) => {
      // Create a copy of the remoteStreams map
      const newRemoteStreams = new Map(remoteStreams);
      newRemoteStreams.set(userId, event.streams[0]);
      setRemoteStreams(newRemoteStreams);
      
      // If this is the first remote stream, set as active speaker
      if (remoteStreams.size === 0) {
        setActiveSpeaker(userId);
      }
    };
    
    peerConnection.onnegotiationneeded = async () => {
      try {
        // Create offer
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        
        // Send offer to remote peer via Firebase
        push(ref(db, `signals/${roomId}`), {
          type: 'offer',
          from: currentUser.id,
          to: userId,
          sdp: peerConnection.localDescription,
          createdAt: Date.now()
        });
      } catch (error) {
        console.error('Error creating offer:', error);
      }
    };
    
    return peerConnection;
  }

  async function handleReceivedOffer(signal: any) {
    const { from, sdp } = signal;
    
    // If not in a call, start one
    if (!isInCall) {
      await initializeMediaStream('video');
    }
    
    // Create peer connection if it doesn't exist
    let peerConnection = peerConnectionsRef.current.get(from);
    if (!peerConnection) {
      peerConnection = createPeerConnection(from);
    }
    
    if (!peerConnection) return;
    
    try {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      
      // Send answer back
      push(ref(db, `signals/${roomId}`), {
        type: 'answer',
        from: currentUser.id,
        to: from,
        sdp: peerConnection.localDescription,
        createdAt: Date.now()
      });
    } catch (error) {
      console.error('Error handling offer:', error);
    }
  }

  async function handleReceivedAnswer(signal: any) {
    const { from, sdp } = signal;
    
    const peerConnection = peerConnectionsRef.current.get(from);
    if (peerConnection) {
      try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
      } catch (error) {
        console.error('Error handling answer:', error);
      }
    }
  }

  async function handleReceivedICECandidate(signal: any) {
    const { from, candidate } = signal;
    
    const peerConnection = peerConnectionsRef.current.get(from);
    if (peerConnection) {
      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.error('Error adding ICE candidate:', error);
      }
    }
  }

  function toggleCallWindow() {
    setIsCallMinimized(!isCallMinimized);
  }

  function getRemainingTime(expiresAt: number) {
    const remaining = expiresAt - Date.now();
    return formatDistanceToNow(new Date(Date.now() + remaining), { addSuffix: true });
  }

  // Render a video element for a remote stream
  const renderRemoteVideo = (userId: string, stream: MediaStream) => {
    const isActive = activeSpeaker === userId;
    
    return (
      <div 
        key={userId} 
        className={`relative rounded-lg overflow-hidden ${
          isActive ? 'border-2 border-blue-500' : ''
        }`}
      >
        <video
          autoPlay
          playsInline
          ref={(video) => {
            if (video) video.srcObject = stream;
          }}
          className="w-full h-full object-cover"
        />
        <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 rounded px-2 py-1 text-white text-xs">
          {room?.participants[userId]?.name || 'Unknown'}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      <div className="bg-white shadow-sm p-4">
        <h2 className="text-xl font-semibold">{room?.name}</h2>
        <div className="flex gap-2 mt-2">
          {Object.values(room?.participants || {}).map((participant) => (
            <div 
              key={participant.id} 
              className="flex items-center gap-2"
            >
              <div className={`w-2 h-2 rounded-full ${
                participant.status === 'online' ? 'bg-green-500' :
                participant.status === 'typing' ? 'bg-yellow-500' :
                participant.status === 'in-call' ? 'bg-blue-500' :
                'bg-gray-500'
              }`} />
              <span>{participant.name}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${
              message.userId === currentUser.id ? 'justify-end' : 'justify-start'
            }`}
          >
            <div className={`max-w-[70%] rounded-lg p-3 ${
              message.userId === currentUser.id 
                ? 'bg-blue-500 text-white' 
                : 'bg-white'
            }`}>
              {message.type === 'text' ? (
                <p>{message.content}</p>
              ) : (
                <a 
                  href={message.fileUrl} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm"
                >
                  <Upload size={16} />
                  {message.fileName}
                </a>
              )}
              <div className="flex items-center gap-1 mt-1 text-xs opacity-75">
                <Clock size={12} />
                {getRemainingTime(message.expiresAt)}
              </div>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Call UI */}
      {isInCall && (
        <div 
          className={`${
            isCallMinimized 
              ? 'fixed bottom-20 right-4 w-64 h-36 rounded-lg shadow-lg overflow-hidden z-10' 
              : 'fixed inset-0 z-10 bg-black bg-opacity-90 flex items-center justify-center'
          }`}
        >
          <div className={`${isCallMinimized ? 'h-full' : 'w-full h-full max-w-6xl max-h-[80vh] p-4'}`}>
            {/* Call controls */}
            <div className={`${
              isCallMinimized 
                ? 'absolute top-2 right-2 z-20' 
                : 'absolute bottom-8 left-1/2 transform -translate-x-1/2 flex items-center gap-4 bg-black bg-opacity-50 rounded-full px-6 py-3 z-20'
            }`}>
              {!isCallMinimized && (
                <>
                  <button 
                    onClick={toggleAudio}
                    className={`p-3 rounded-full ${
                      isAudioEnabled ? 'bg-blue-500 hover:bg-blue-600' : 'bg-red-500 hover:bg-red-600'
                    }`}
                  >
                    {isAudioEnabled ? <Mic size={24} color="white" /> : <MicOff size={24} color="white" />}
                  </button>
                  
                  {callType === 'video' && (
                    <button 
                      onClick={toggleVideo}
                      className={`p-3 rounded-full ${
                        isVideoEnabled ? 'bg-blue-500 hover:bg-blue-600' : 'bg-red-500 hover:bg-red-600'
                      }`}
                    >
                      {isVideoEnabled ? <Video size={24} color="white" /> : <VideoOff size={24} color="white" />}
                    </button>
                  )}
                  
                  <button 
                    onClick={toggleScreenSharing}
                    className={`p-3 rounded-full ${
                      isScreenSharing ? 'bg-green-500 hover:bg-green-600' : 'bg-blue-500 hover:bg-blue-600'
                    }`}
                  >
                    <Monitor size={24} color="white" />
                  </button>
                </>
              )}
              
              <button 
                onClick={toggleCallWindow}
                className="p-2 rounded-full bg-gray-700 hover:bg-gray-600"
              >
                {isCallMinimized ? <Maximize2 size={16} color="white" /> : <Minimize2 size={20} color="white" />}
              </button>
              
              {!isCallMinimized && (
                <button 
                  onClick={handleEndCall}
                  className="p-3 rounded-full bg-red-500 hover:bg-red-600"
                >
                  <Phone size={24} color="white" />
                </button>
              )}
            </div>
            
            {/* Video grid */}
            <div className={`${
              isCallMinimized 
                ? 'h-full' 
                : 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 h-full'
            }`}>
              {/* Local video */}
              <div className={`relative rounded-lg overflow-hidden ${
                isCallMinimized ? 'h-full' : 'h-64'
              }`}>
                {callType === 'video' && (
                  <video
                    ref={localVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                  />
                )}
                {callType === 'audio' && (
                  <div className="w-full h-full flex items-center justify-center bg-gray-800">
                    <div className="bg-blue-500 rounded-full p-4">
                      <Mic size={32} color="white" />
                    </div>
                  </div>
                )}
                <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 rounded px-2 py-1 text-white text-xs">
                  You{isScreenSharing ? ' (Screen)' : ''}
                </div>
              </div>
              
              {/* Remote videos */}
              {!isCallMinimized && Array.from(remoteStreams).map(([userId, stream]) => 
                renderRemoteVideo(userId, stream)
              )}
            </div>
          </div>
        </div>
      )}

      <div className="bg-white p-4 border-t">
        <form onSubmit={handleSendMessage} className="flex gap-2">
          <div 
            {...getRootProps()} 
            className="flex-shrink-0 p-2 rounded-lg bg-gray-100 hover:bg-gray-200 cursor-pointer"
          >
            <input {...getInputProps()} />
            <Upload size={20} />
          </div>
          
          <div className="flex gap-2">
            <button 
              type="button" 
              className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200"
              onClick={startVideoCall}
            >
              <Video size={20} />
            </button>
            <button 
              type="button" 
              className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200"
              onClick={startAudioCall}
            >
              <Phone size={20} />
            </button>
            <button 
              type="button" 
              className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200"
              onClick={toggleScreenSharing}
              disabled={!isInCall}
            >
              <Monitor size={20} />
            </button>
          </div>

          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 rounded-lg border p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          
          <button 
            type="submit" 
            className="p-2 rounded-lg bg-blue-500 text-white hover:bg-blue-600"
          >
            <Send size={20} />
          </button>
        </form>
      </div>
    </div>
  );
}