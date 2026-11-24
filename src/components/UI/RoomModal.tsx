import React, { useState, useEffect } from 'react';
import { FaTimes, FaUsers, FaLock, FaGlobeAmericas } from 'react-icons/fa';

interface RoomModalProps {
  onClose: () => void;
  onStartGame: (playerName: string, colorIndex: number, roomCode?: string) => void;
  playerName: string;
  selectedColor: number;
}

interface Room {
  code: string;
  playerCount: number;
  isPublic: boolean;
}

export const RoomModal: React.FC<RoomModalProps> = ({ onClose, onStartGame, playerName, selectedColor }) => {
  const [mode, setMode] = useState<'select' | 'create' | 'join'>('select');
  const [isPublic, setIsPublic] = useState(true);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  const [players, setPlayers] = useState<string[]>([]);
  const [roomCode, setRoomCode] = useState<string>('');

  useEffect(() => {
    // TODO: Implement socket connection to get room list and player updates
    // This is a mock implementation
    setRooms([
      { code: 'ROOM1', playerCount: 3, isPublic: true },
      { code: 'ROOM2', playerCount: 5, isPublic: true },
      { code: 'ROOM3', playerCount: 2, isPublic: true },
    ]);
  }, []);

  const handleCreateRoom = () => {
    // TODO: Implement room creation
    const newRoomCode = 'ROOM' + Math.random().toString(36).substr(2, 4).toUpperCase();
    setRoomCode(newRoomCode);
    setPlayers([playerName]);
  };

  const handleJoinRoom = (code: string) => {
    setSelectedRoom(code);
    setRoomCode(code);
    // TODO: Implement room joining
    setPlayers(['Host', playerName]);
  };

  const handleStartGame = () => {
    onStartGame(playerName, selectedColor, roomCode);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-8 max-w-2xl w-full mx-4">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-white">
            {mode === 'select' ? 'Select Mode' : mode === 'create' ? 'Create Room' : 'Join Room'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <FaTimes size={24} />
          </button>
        </div>

        {mode === 'select' && (
          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={() => setMode('create')}
              className="bg-blue-600 hover:bg-blue-700 text-white p-6 rounded-lg flex flex-col items-center transition-colors"
            >
              <FaUsers size={48} className="mb-4" />
              <span className="text-xl font-bold">Create Room</span>
            </button>
            <button
              onClick={() => setMode('join')}
              className="bg-green-600 hover:bg-green-700 text-white p-6 rounded-lg flex flex-col items-center transition-colors"
            >
              <FaGlobeAmericas size={48} className="mb-4" />
              <span className="text-xl font-bold">Join Room</span>
            </button>
          </div>
        )}

        {mode === 'create' && !roomCode && (
          <div className="space-y-4">
            <div className="flex justify-center space-x-4">
              <button
                onClick={() => setIsPublic(true)}
                className={`p-4 rounded-lg flex items-center space-x-2 ${
                  isPublic ? 'bg-green-600' : 'bg-gray-600'
                }`}
              >
                <FaGlobeAmericas size={24} />
                <span>Public Room</span>
              </button>
              <button
                onClick={() => setIsPublic(false)}
                className={`p-4 rounded-lg flex items-center space-x-2 ${
                  !isPublic ? 'bg-yellow-600' : 'bg-gray-600'
                }`}
              >
                <FaLock size={24} />
                <span>Private Room</span>
              </button>
            </div>
            <button
              onClick={handleCreateRoom}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white p-4 rounded-lg font-bold text-xl transition-colors"
            >
              Create Room
            </button>
          </div>
        )}

        {mode === 'join' && !selectedRoom && (
          <div className="space-y-4">
            {rooms.map((room) => (
              <button
                key={room.code}
                onClick={() => handleJoinRoom(room.code)}
                className="w-full bg-gray-700 hover:bg-gray-600 p-4 rounded-lg flex items-center justify-between transition-colors"
              >
                <div className="flex items-center space-x-4">
                  <FaUsers className="text-gray-400" />
                  <span className="text-white font-bold">Room {room.code}</span>
                </div>
                <div className="text-gray-400">
                  {room.playerCount}/10 players
                </div>
              </button>
            ))}
          </div>
        )}

        {roomCode && (
          <div className="space-y-4">
            <div className="bg-gray-700 p-4 rounded-lg">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold text-white">Room Code: {roomCode}</h3>
                <span className="text-gray-400">{players.length}/10 players</span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {players.map((player, index) => (
                  <div
                    key={index}
                    className="bg-gray-600 p-3 rounded-lg text-white"
                  >
                    {player}
                  </div>
                ))}
                {Array.from({ length: 10 - players.length }).map((_, index) => (
                  <div
                    key={`empty-${index}`}
                    className="bg-gray-800 p-3 rounded-lg text-gray-500"
                  >
                    Empty Slot
                  </div>
                ))}
              </div>
            </div>
            <button
              onClick={handleStartGame}
              className="w-full bg-green-600 hover:bg-green-700 text-white p-4 rounded-lg font-bold text-xl transition-colors"
            >
              {players[0] === playerName ? 'Start Game' : 'Ready'}
            </button>
          </div>
        )}

        {mode !== 'select' && !roomCode && (
          <button
            onClick={() => {
              setMode('select');
              setSelectedRoom(null);
            }}
            className="mt-4 text-gray-400 hover:text-white transition-colors"
          >
            ← Back to Selection
          </button>
        )}
      </div>
    </div>
  );
}; 