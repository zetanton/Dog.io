import React, { useState } from 'react';
import Game from './components/Game/Game';
import MainMenu from './components/UI/MainMenu';

interface GameState {
  isPlaying: boolean;
  playerName: string;
  colorIndex: number;
}

const App: React.FC = () => {
  const [gameState, setGameState] = useState<GameState>({
    isPlaying: false,
    playerName: '',
    colorIndex: 0
  });

  const handleStartGame = (playerName: string, colorIndex: number) => {
    setGameState({
      isPlaying: true,
      playerName,
      colorIndex
    });
  };

  const handleReturnToMenu = () => {
    setGameState({
      isPlaying: false,
      playerName: '',
      colorIndex: 0
    });
  };

  return (
    <div className="w-full h-screen">
      {gameState.isPlaying ? (
        <Game 
          playerName={gameState.playerName} 
          colorIndex={gameState.colorIndex}
          onReturnToMenu={handleReturnToMenu}
        />
      ) : (
        <MainMenu onStartGame={handleStartGame} />
      )}
    </div>
  );
};

export default App;