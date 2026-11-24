import React, { useState, useEffect } from 'react';
import { NetworkManager } from '../../network/NetworkManager';

interface RoomJoinProps {
  playerName: string;
  colorIndex: number;
  onJoinSuccess: () => void;
}

const RoomJoin: React.FC<RoomJoinProps> = ({ playerName, colorIndex, onJoinSuccess }) => {
  const [roomCode, setRoomCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);
  const networkManager = NetworkManager.getInstance();

  useEffect(() => {
    const handleError = (error: string) => {
      setError(error);
      setIsJoining(false);
    };

    networkManager.onError(handleError);

    return () => {
      networkManager.onError(() => {}); // Cleanup
    };
  }, []);

  const handleCreateRoom = () => {
    setIsJoining(true);
    setError(null);
    networkManager.createRoom();
  };

  const handleJoinRoom = () => {
    if (!roomCode.trim()) {
      setError('Please enter a room code');
      return;
    }

    setIsJoining(true);
    setError(null);
    networkManager.joinRoom(roomCode.toUpperCase(), playerName, colorIndex);
  };

  useEffect(() => {
    const handleRoomCreated = (code: string) => {
      networkManager.joinRoom(code, playerName, colorIndex);
    };

    const handleJoinedRoom = () => {
      setIsJoining(false);
      onJoinSuccess();
    };

    networkManager.on('roomCreated', handleRoomCreated);
    networkManager.on('joinedRoom', handleJoinedRoom);

    return () => {
      networkManager.off('roomCreated', handleRoomCreated);
      networkManager.off('joinedRoom', handleJoinedRoom);
    };
  }, [playerName, colorIndex, onJoinSuccess]);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg p-6 max-w-md w-full">
        <h2 className="text-2xl font-bold mb-4">Join Game</h2>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Room Code
            </label>
            <input
              type="text"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              placeholder="Enter room code"
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              maxLength={6}
              disabled={isJoining}
            />
          </div>

          {error && (
            <div className="text-red-500 text-sm">
              {error}
            </div>
          )}

          <div className="flex gap-4">
            <button
              onClick={handleJoinRoom}
              disabled={isJoining}
              className="flex-1 bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
            >
              {isJoining ? 'Joining...' : 'Join Room'}
            </button>
            
            <button
              onClick={handleCreateRoom}
              disabled={isJoining}
              className="flex-1 bg-green-500 text-white px-4 py-2 rounded-md hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50"
            >
              {isJoining ? 'Creating...' : 'Create Room'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RoomJoin; 