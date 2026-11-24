import React, { useState, useEffect } from 'react';
import { FaTimes, FaUsers, FaLock, FaGlobeAmericas } from 'react-icons/fa';
import { NetworkManager } from '../../network/NetworkManager';

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

interface PlayerStatus {
  name: string;
  isReady: boolean;
}

export const RoomModal: React.FC<RoomModalProps> = ({ onClose, onStartGame, playerName, selectedColor }) => {
  const [mode, setMode] = useState<'select' | 'create' | 'join'>('select');
  const [isPublic, setIsPublic] = useState(true);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  const [players, setPlayers] = useState<PlayerStatus[]>([]);
  const [roomCode, setRoomCode] = useState<string>('');
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [isReady, setIsReady] = useState(false);
  const [isStarting, setIsStarting] = useState(false);

  useEffect(() => {
    const networkManager = NetworkManager.getInstance();

    // Set up room list listener
    networkManager.onRoomList((roomList) => {
      setRooms(roomList);
    });

    // Set up room join success listener
    networkManager.onRoomJoined((data) => {
      setRoomCode(data.code);
      setPlayers(data.players.map(name => ({ name, isReady: false })));
      setError('');
    });

    // Set up player ready status updates
    networkManager.onPlayerReadyUpdate((data) => {
      console.log('Player ready update:', data);
      setPlayers(currentPlayers => 
        currentPlayers.map(player => 
          player.name === data.playerName 
            ? { ...player, isReady: data.isReady }
            : player
        )
      );
      
      // Update local ready state if it's for the current player
      if (data.playerName === playerName) {
        setIsReady(data.isReady);
      }
    });

    // Add game start listener - only start if we're actually in the room
    networkManager.onGameStart(() => {
      console.log('Game start received, starting game...');
      if (roomCode && !isStarting) {
        setIsStarting(true);
        onStartGame(playerName, selectedColor, roomCode);
      }
    });

    // Set up error listener
    networkManager.onRoomError((message) => {
      setError(message);
      if (message.includes('Not all players are ready')) {
        setIsStarting(false);
      }
    });

    // Get initial room list
    networkManager.getRoomList();

    // Set up periodic room list refresh
    const interval = setInterval(() => {
      networkManager.getRoomList();
    }, 5000);

    return () => {
      clearInterval(interval);
      // Clean up listeners
      networkManager.off('roomList', () => {});
      networkManager.off('roomJoined', () => {});
      networkManager.off('playerReadyUpdate', () => {});
      networkManager.off('gameStart', () => {});
      networkManager.off('roomError', () => {});
    };
  }, [onStartGame, playerName, selectedColor, roomCode, isStarting]);

  const handleCreateRoom = () => {
    const networkManager = NetworkManager.getInstance();
    networkManager.createRoom(isPublic, playerName);
  };

  const handleJoinRoom = (code: string) => {
    const networkManager = NetworkManager.getInstance();
    networkManager.joinRoom(code, playerName);
  };

  const handleJoinWithCode = (e: React.FormEvent) => {
    e.preventDefault();
    if (joinCode.trim()) {
      handleJoinRoom(joinCode.toUpperCase());
    }
  };

  const handleReadyClick = () => {
    if (players[0].name === playerName) {
      // Host clicks start game
      handleStartGame();
    } else {
      // Non-host players toggle ready status
      const networkManager = NetworkManager.getInstance();
      const newReadyState = !isReady;
      networkManager.updateReadyStatus(roomCode, newReadyState);
    }
  };

  const handleStartGame = () => {
    if (players[0].name === playerName && !isStarting) {
      // Check if all non-host players are ready
      const allPlayersReady = players.slice(1).every(player => player.isReady);
      if (allPlayersReady || players.length === 1) {
        setIsStarting(true);
        const networkManager = NetworkManager.getInstance();
        networkManager.startGame();
      } else {
        setError('Not all players are ready!');
        setTimeout(() => setError(''), 3000);
      }
    }
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
          <div className="space-y-6">
            <form onSubmit={handleJoinWithCode} className="space-y-4">
              <div>
                <label htmlFor="roomCode" className="block text-white mb-2">
                  Enter Room Code
                </label>
                <div className="flex gap-2">
                  <input
                    id="roomCode"
                    type="text"
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                    placeholder="Enter room code"
                    className="flex-1 bg-gray-700 text-white p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    maxLength={6}
                  />
                  <button
                    type="submit"
                    className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg transition-colors"
                  >
                    Join
                  </button>
                </div>
              </div>
            </form>

            {error && (
              <div className="text-red-500 bg-red-900 bg-opacity-20 p-3 rounded-lg">
                {error}
              </div>
            )}

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-600"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-gray-800 text-gray-400">or join an available room</span>
              </div>
            </div>

            <div className="space-y-4">
              {rooms.length === 0 ? (
                <div className="text-center text-gray-400 py-4">
                  No public rooms available
                </div>
              ) : (
                rooms.map((room) => (
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
                ))
              )}
            </div>
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
                    className={`p-3 rounded-lg text-white ${
                      player.isReady ? 'bg-green-600' : 'bg-gray-600'
                    } ${player.name === playerName ? 'border-2 border-yellow-400' : ''}`}
                  >
                    {player.name} {index === 0 ? '(Host)' : ''}
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
              onClick={players[0].name === playerName ? handleStartGame : handleReadyClick}
              disabled={isStarting}
              className={`w-full ${
                isStarting ? 'bg-gray-500 cursor-not-allowed' :
                players[0].name === playerName 
                  ? 'bg-blue-600 hover:bg-blue-700' 
                  : isReady 
                    ? 'bg-green-600 hover:bg-green-700'
                    : 'bg-gray-600 hover:bg-gray-700'
              } text-white p-4 rounded-lg font-bold text-xl transition-colors`}
            >
              {isStarting ? 'Starting...' :
               players[0].name === playerName ? 'Start Game' : 
               isReady ? 'Ready!' : 'Ready Up'}
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