import React from 'react';

interface WinModalProps {
  playerName: string;
  onPlayAgain: () => void;
  onReturnToMenu: () => void;
}

const WinModal: React.FC<WinModalProps> = ({ playerName, onPlayAgain, onReturnToMenu }) => {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-4 z-50">
      <div className="bg-black bg-opacity-50 p-8 rounded-lg text-white w-full max-w-lg backdrop-blur-sm">
        {/* Victory Title with Glow Effect */}
        <div className="text-center mb-12">
          <h1 className="text-6xl font-bold tracking-wider animate-pulse">
            <span className="text-yellow-400">VICTORY!</span>
          </h1>
          <p className="text-2xl text-gray-300 mt-4">
            {playerName} is the Top Dog!
          </p>
        </div>

        {/* Buttons */}
        <div className="space-y-4">
          <button
            onClick={onPlayAgain}
            className="w-full py-4 bg-yellow-500 rounded-lg font-bold text-xl text-black transition-all transform hover:scale-105 hover:bg-yellow-400 shadow-lg"
          >
            PLAY AGAIN
          </button>
          
          <button
            onClick={onReturnToMenu}
            className="w-full py-4 bg-white bg-opacity-20 rounded-lg font-bold text-xl text-white transition-all transform hover:scale-105 hover:bg-opacity-30 shadow-lg"
          >
            RETURN TO MENU
          </button>
        </div>
      </div>
    </div>
  );
};

export default WinModal; 