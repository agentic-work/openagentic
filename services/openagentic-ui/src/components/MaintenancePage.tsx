import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// theme-allow: the hidden "Arcade Mode" easter-egg game below uses a
// deliberate neon / synthwave CRT aesthetic (glowing magenta/cyan/yellow,
// scanlines) that is an intentional standalone visual identity, not the app
// theme. The maintenance-page CHROME (outer background, docs/retry buttons,
// footer) reads SOT tokens; only the retro game keeps its bespoke palette.

interface GameEmoji {
  id: string;
  x: number;
  y: number;
  createdAt: number;
  popping?: boolean;
}

interface HighScore {
  name: string;
  score: number;
  date: number;
}

const MaintenancePage: React.FC = () => {
  const [isHovered, setIsHovered] = useState(false);

  // Game state
  const [gameActive, setGameActive] = useState(false);
  const [score, setScore] = useState(0);
  const [gameEmojis, setGameEmojis] = useState<GameEmoji[]>([]);
  const [gameTime, setGameTime] = useState(30);
  const [showGame, setShowGame] = useState(false);
  const [highScores, setHighScores] = useState<HighScore[]>([]);
  const [showHighScoreEntry, setShowHighScoreEntry] = useState(false);
  const [initials, setInitials] = useState('');
  const [combo, setCombo] = useState(0);
  const [lastHitTime, setLastHitTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Get the current hostname for the docs link
  const hostname = window.location.hostname;
  const protocol = window.location.protocol;
  const docsUrl = `${protocol}//${hostname}/docs`;

  // Game functions
  const generateRandomEmoji = useCallback(() => {
    if (!gameActive) return;

    const newEmoji: GameEmoji = {
      id: Math.random().toString(36).substr(2, 9),
      x: Math.random() * 80 + 10, // 10% to 90% of container width
      y: Math.random() * 60 + 20, // 20% to 80% of container height
      createdAt: Date.now()
    };

    setGameEmojis(prev => [...prev, newEmoji]);

    // Remove emoji after 2 seconds if not clicked
    setTimeout(() => {
      setGameEmojis(prev => prev.filter(emoji => emoji.id !== newEmoji.id));
    }, 2000);
  }, [gameActive]);

  const handleEmojiClick = (emojiId: string) => {
    // Mark emoji as popping for animation
    setGameEmojis(prev => prev.map(emoji =>
      emoji.id === emojiId ? { ...emoji, popping: true } : emoji
    ));

    // Calculate combo bonus
    const now = Date.now();
    if (now - lastHitTime < 1000) {
      setCombo(prev => Math.min(prev + 1, 10));
    } else {
      setCombo(1);
    }
    setLastHitTime(now);

    const points = 10 * combo;
    setScore(prev => prev + points);

    // Remove emoji after animation
    setTimeout(() => {
      setGameEmojis(prev => prev.filter(emoji => emoji.id !== emojiId));
    }, 500);
  };

  const startGame = () => {
    setGameActive(true);
    setScore(0);
    setGameEmojis([]);
    setGameTime(30);
    setCombo(0);
    setLastHitTime(0);
  };

  const endGame = () => {
    setGameActive(false);
    setGameEmojis([]);
    setCombo(0);

    // Check for high score
    const savedScores = localStorage.getItem('emojiPopHighScores');
    const scores = savedScores ? JSON.parse(savedScores) : [];
    const isHighScore = scores.length < 10 || score > scores[scores.length - 1]?.score || 0;

    if (isHighScore && score > 0) {
      setShowHighScoreEntry(true);
    }
  };

  const saveHighScore = () => {
    if (initials.length !== 3) return;

    const savedScores = localStorage.getItem('emojiPopHighScores');
    const scores: HighScore[] = savedScores ? JSON.parse(savedScores) : [];

    scores.push({ name: initials.toUpperCase(), score, date: Date.now() });
    scores.sort((a, b) => b.score - a.score);
    const topScores = scores.slice(0, 10);

    localStorage.setItem('emojiPopHighScores', JSON.stringify(topScores));
    setHighScores(topScores);
    setShowHighScoreEntry(false);
    setInitials('');
  };

  // Game timer effect
  useEffect(() => {
    if (!gameActive) return;

    const timer = setInterval(() => {
      setGameTime(prev => {
        if (prev <= 1) {
          endGame();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [gameActive]);

  // Emoji generation effect
  useEffect(() => {
    if (!gameActive) return;

    const interval = setInterval(generateRandomEmoji, 800);
    return () => clearInterval(interval);
  }, [gameActive, generateRandomEmoji]);

  // Load high scores on mount
  useEffect(() => {
    const savedScores = localStorage.getItem('emojiPopHighScores');
    if (savedScores) {
      setHighScores(JSON.parse(savedScores));
    }
  }, []);

  // Enhanced 3D Thinking Emoji Component (same as Login page)
  const ThinkingEmoji = () => {
    return (
      <motion.div
        whileHover={{ scale: 1.1 }}
        onHoverStart={() => setIsHovered(true)}
        onHoverEnd={() => setIsHovered(false)}
        className="inline-block"
      >
        <div className="relative w-48 h-48 flex items-center justify-center mx-auto mb-8">
          {/* Glow effect behind the emoji */}
          <motion.div
            className="absolute inset-0 bg-gradient-to-r from-purple-500/40 to-pink-500/40 rounded-full blur-3xl"
            animate={{
              scale: isHovered ? [1, 1.3, 1] : [1, 1.1, 1],
              opacity: isHovered ? [0.6, 1, 0.6] : [0.3, 0.5, 0.3],
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: "easeInOut"
            }}
          />

          {/* Secondary glow for depth */}
          <motion.div
            className="absolute inset-0 bg-gradient-to-br from-yellow-400/30 to-orange-500/30 rounded-full blur-2xl"
            animate={{
              scale: isHovered ? [1.1, 1, 1.1] : 1,
              opacity: isHovered ? [0.3, 0.6, 0.3] : 0.2,
              rotate: [0, 180, 360]
            }}
            transition={{
              duration: 4,
              repeat: Infinity,
              ease: "linear"
            }}
          />

          {/* 3D Thinking Emoji */}
          <motion.div
            className="text-8xl relative z-10"
            style={{
              perspective: "1000px",
              transformStyle: "preserve-3d",
            }}
            animate={{
              rotateY: isHovered ? [0, 360] : [0, 20, -20, 0],
              rotateX: isHovered ? [0, 10, -10, 0] : 0,
            }}
            transition={{
              rotateY: {
                duration: isHovered ? 3 : 4,
                repeat: Infinity,
                ease: isHovered ? "linear" : "easeInOut"
              },
              rotateX: {
                duration: 2,
                repeat: Infinity,
                ease: "easeInOut"
              }
            }}
          >
            <motion.span
              className="block"
              style={{
                textShadow: `
                  0 0 20px rgba(168, 85, 247, 0.5),
                  0 0 40px rgba(168, 85, 247, 0.3),
                  0 5px 15px rgba(0, 0, 0, 0.3),
                  0 10px 25px rgba(0, 0, 0, 0.2)
                `,
                filter: 'drop-shadow(0 10px 20px rgba(0,0,0,0.3))',
                transform: 'translateZ(50px)',
              }}
              animate={{
                scale: isHovered ? [1, 1.1, 1] : 1,
              }}
              transition={{
                duration: 0.5,
                repeat: isHovered ? Infinity : 0,
                repeatDelay: 1
              }}
            >
              🤔
            </motion.span>
          </motion.div>

          {/* Floating particles effect */}
          {[...new Array(6)].map((_, i) => (
            <motion.div
              key={i}
              className="absolute w-2 h-2 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full"
              style={{
                left: `${50 + 40 * Math.cos((i * Math.PI * 2) / 6)}%`,
                top: `${50 + 40 * Math.sin((i * Math.PI * 2) / 6)}%`,
              }}
              animate={{
                scale: [0, 1, 0],
                opacity: [0, 1, 0],
                y: [-20, -40, -60],
              }}
              transition={{
                duration: 3,
                repeat: Infinity,
                delay: i * 0.5,
                ease: "easeOut"
              }}
            />
          ))}
        </div>
      </motion.div>
    );
  };

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center">
      <div className="max-w-md w-full space-y-8 p-8">
        <div className="text-center">
          {/* Animated Logo/Icon */}
          <ThinkingEmoji />
          
          {/* Title */}
          <h1 
          className="text-3xl font-bold mb-4"
          style={{ color: 'var(--color-text)' }}>
            Maintenance Mode
          </h1>

          {/* Message */}
          <p
          className="mb-6"
          style={{ color: 'var(--color-text)' }}>
            OpenAgentic Chat is starting up. We'll be back up and running shortly.
          </p>

          {/* Chaos GIF */}
          <div className="mb-6 flex justify-center">
            <img
              src="/animations/chaos.gif"
              alt="Chaos animation"
              className="rounded-lg shadow-lg max-w-full h-auto"
              style={{ maxHeight: '300px' }}
            />
          </div>

          {/* Game Section */}
          <div className="mb-6">
            <motion.button
              onClick={() => setShowGame(!showGame)}
              className="w-full p-3 bg-gradient-to-r from-purple-900/50 to-pink-900/50 rounded-lg border border-purple-500 hover:from-purple-800/60 hover:to-pink-800/60 transition-all duration-150 shadow-lg shadow-purple-500/20"
              style={{
                color: 'var(--color-text)',
                background: 'linear-gradient(135deg, rgba(147, 51, 234, 0.3), rgba(219, 39, 119, 0.3))',
                textShadow: '0 0 20px rgba(168, 85, 247, 0.5)'
              }}
              whileHover={{ scale: 1.02, boxShadow: '0 20px 25px -5px rgba(168, 85, 247, 0.3)' }}
              whileTap={{ scale: 0.98 }}
            >
              <div className="flex items-center justify-center space-x-2">
                <motion.span
                  className="text-2xl"
                  animate={{
                    rotateY: showGame ? [0, 360] : 0,
                    scale: showGame ? [1, 1.2, 1] : 1
                  }}
                  transition={{ duration: 0.6 }}
                >
                  🎮
                </motion.span>
                <span className="text-sm font-bold tracking-wider uppercase"
                  style={{
                    fontFamily: 'monospace',
                    letterSpacing: '2px'
                  }}
                >
                  {showGame ? 'Hide' : 'Play'} Arcade Mode
                </span>
                <motion.div
                  animate={{ rotate: showGame ? 180 : 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <span className="text-sm">▼</span>
                </motion.div>
              </div>
            </motion.button>

            <AnimatePresence>
              {showGame && (
                <motion.div
                  initial={{ opacity: 0, height: 0, scale: 0.9, y: 20 }}
                  animate={{ opacity: 1, height: 'auto', scale: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0, scale: 0.9, y: 20 }}
                  transition={{ duration: 0.4, type: 'spring', stiffness: 200 }}
                  className="mt-4 relative"
                  style={{
                    transform: 'perspective(1000px) rotateX(-2deg)',
                    transformStyle: 'preserve-3d'
                  }}
                >
                  {/* Glassmorphic container with CRT effect */}
                  <div
                    className="relative p-6 rounded-xl overflow-hidden"
                    style={{
                      background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.95), rgba(15, 23, 42, 0.98))',
                      border: '2px solid rgba(168, 85, 247, 0.3)',
                      boxShadow: `
                        0 25px 50px -12px rgba(0, 0, 0, 0.5),
                        inset 0 0 0 1px rgba(255, 255, 255, 0.1),
                        0 0 50px rgba(168, 85, 247, 0.2)
                      `
                    }}
                  >
                    {/* CRT scan lines effect */}
                    <div
                      className="pointer-events-none absolute inset-0 z-50"
                      style={{
                        background: `
                          repeating-linear-gradient(
                            0deg,
                            transparent,
                            transparent 2px,
                            rgba(255, 255, 255, 0.03) 2px,
                            rgba(255, 255, 255, 0.03) 4px
                          )
                        `,
                        animation: 'scanlines 8s linear infinite'
                      }}
                    />

                    {/* CRT glow effect */}
                    <div
                      className="pointer-events-none absolute inset-0 z-40"
                      style={{
                        background: 'radial-gradient(ellipse at center, transparent 0%, rgba(0, 0, 0, 0.4) 100%)',
                        animation: 'flicker 0.15s infinite'
                      }}
                    />

                    <style dangerouslySetInnerHTML={{ __html: `
                      @keyframes scanlines {
                        0% { transform: translateY(0); }
                        100% { transform: translateY(10px); }
                      }
                      @keyframes flicker {
                        0% { opacity: 0.95; }
                        50% { opacity: 1; }
                        100% { opacity: 0.98; }
                      }
                      @keyframes neonGlow {
                        0%, 100% { text-shadow: 0 0 10px #ff00ff, 0 0 20px #ff00ff, 0 0 30px #ff00ff; }
                        50% { text-shadow: 0 0 20px #ff00ff, 0 0 30px #ff00ff, 0 0 40px #ff00ff; }
                      }
                    ` }} />

                  {!gameActive ? (
                    <div className="text-center">
                      {/* Arcade Title */}
                      <h2
                        className="text-3xl font-bold mb-4 text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-pink-500"
                        style={{
                          fontFamily: 'monospace',
                          letterSpacing: '3px',
                          textShadow: '0 0 30px rgba(255, 0, 255, 0.8)',
                          animation: 'neonGlow 2s ease-in-out infinite'
                        }}
                      >
                        🤔 EMOJI POP ARCADE 🤔
                      </h2>

                      <p className="text-green-400 text-sm mb-4 font-mono">
                        CLICK THE THINKING EMOJIS!
                        <br />
                        <span className="text-cyan-300 text-xs">30 SECONDS • COMBO MULTIPLIER • HIGH SCORE</span>
                      </p>
                      {score > 0 && !showHighScoreEntry && (
                        <motion.div
                          initial={{ scale: 0, rotate: -180 }}
                          animate={{ scale: 1, rotate: 0 }}
                          transition={{ type: 'spring', damping: 10 }}
                          className="mb-4 p-3 bg-gradient-to-r from-green-900/50 to-emerald-900/50 rounded-lg border-2 border-green-400/50"
                          style={{
                            boxShadow: '0 0 30px rgba(34, 197, 94, 0.3)',
                            background: 'repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(34, 197, 94, 0.1) 10px, rgba(34, 197, 94, 0.1) 20px)'
                          }}
                        >
                          <p className="text-green-400 font-bold text-xl font-mono tracking-wider">FINAL SCORE: {score.toString().padStart(6, '0')}</p>
                          <p className="text-green-300 text-sm font-mono mt-1">
                            {score >= 500 ? "🏆 LEGENDARY!" : score >= 300 ? "🌟 EPIC!" : score >= 200 ? "🎉 AMAZING!" : score >= 100 ? "💪 GREAT!" : "👍 NICE TRY!"}
                          </p>
                        </motion.div>
                      )}

                      {/* High Score Entry */}
                      {showHighScoreEntry && (
                        <motion.div
                          initial={{ scale: 0, y: -50 }}
                          animate={{ scale: 1, y: 0 }}
                          className="mb-4 p-4 bg-gradient-to-r from-purple-900/60 to-pink-900/60 rounded-lg border-2 border-yellow-400"
                          style={{
                            boxShadow: '0 0 40px rgba(250, 204, 21, 0.4)',
                            animation: 'pulse 2s infinite'
                          }}
                        >
                          <h3 className="text-yellow-400 font-bold text-lg mb-3 font-mono">NEW HIGH SCORE!</h3>
                          <p 
                          className="font-mono mb-3"
                          style={{ color: 'var(--color-text)' }}>SCORE: {score.toString().padStart(6, '0')}</p>
                          <p className="text-cyan-300 text-sm mb-2 font-mono">ENTER YOUR INITIALS:</p>
                          <div className="flex justify-center space-x-2 mb-3">
                            {[0, 1, 2].map(i => (
                              <input
                                key={i}
                                type="text"
                                maxLength={1}
                                className="w-12 h-12 text-center text-2xl font-bold border-2 border-cyan-400 text-cyan-400 rounded font-mono"
                                style={{
                                  backgroundColor: 'var(--color-background)',
                                  boxShadow: 'inset 0 0 10px rgba(0, 255, 255, 0.3)',
                                  textTransform: 'uppercase'
                                }}
                                value={initials[i] || ''}
                                onChange={(e) => {
                                  const newInitials = initials.padEnd(3, ' ').split('');
                                  newInitials[i] = e.target.value.toUpperCase();
                                  setInitials(newInitials.join('').trim());
                                  if (e.target.value && i < 2) {
                                    const nextInput = e.target.nextElementSibling as HTMLInputElement;
                                    nextInput?.focus();
                                  }
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && initials.length === 3) {
                                    saveHighScore();
                                  }
                                }}
                              />
                            ))}
                          </div>
                          <button
                            onClick={saveHighScore}
                            disabled={initials.length !== 3}
                            className="px-6 py-2 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 disabled:from-gray-600 disabled:to-gray-600 rounded-lg font-bold font-mono transition-all"
                            style={{
                              color: 'var(--color-text)',
                              textShadow: '0 2px 4px rgba(0, 0, 0, 0.3)',
                              boxShadow: '0 4px 15px rgba(34, 197, 94, 0.3)'
                            }}
                          >
                            SAVE SCORE
                          </button>
                        </motion.div>
                      )}

                      {/* High Scores Display */}
                      {highScores.length > 0 && !gameActive && !showHighScoreEntry && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="mb-4 p-3 rounded-lg border border-purple-500/50"
                          style={{
                            backgroundColor: 'var(--color-background)',
                            boxShadow: 'inset 0 0 20px rgba(168, 85, 247, 0.2)'
                          }}
                        >
                          <h3 className="text-yellow-400 font-bold text-sm mb-2 font-mono tracking-wider">HIGH SCORES</h3>
                          <div className="space-y-1">
                            {highScores.slice(0, 5).map((hs, i) => (
                              <div
                                key={i}
                                className="flex justify-between items-center text-xs font-mono"
                                style={{
                                  color: i === 0 ? '#FFD700' : i === 1 ? '#C0C0C0' : i === 2 ? '#CD7F32' : '#22C55E'
                                }}
                              >
                                <span>{i + 1}. {hs.name}</span>
                                <span>{hs.score.toString().padStart(6, '0')}</span>
                              </div>
                            ))}
                          </div>
                        </motion.div>
                      )}
                      <motion.button
                        onClick={startGame}
                        className="px-8 py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 rounded-lg font-bold font-mono tracking-wider transition-all"
                        style={{
                          color: 'var(--color-text)',
                          textShadow: '0 2px 4px rgba(0, 0, 0, 0.5)',
                          boxShadow: '0 0 30px rgba(168, 85, 247, 0.5), inset 0 0 20px rgba(255, 255, 255, 0.1)',
                          fontSize: '18px'
                        }}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                      >
                        🕹️ INSERT COIN 🕹️
                      </motion.button>
                    </div>
                  ) : (
                    <div>
                      {/* Game HUD */}
                      <div
                      className="flex justify-between items-center mb-4 p-3 rounded-lg border border-cyan-400/50"
                      style={{
                        backgroundColor: 'var(--color-background)',
                        boxShadow: 'inset 0 0 20px rgba(0, 255, 255, 0.2)',
                        fontFamily: 'monospace'
                      }}
                      >
                        <div className="text-lg font-bold">
                          <span className="text-yellow-400">SCORE:</span>
                          <span 
                          className="ml-2"
                          style={{ color: 'var(--color-text)' }}>{score.toString().padStart(6, '0')}</span>
                        </div>
                        <div className="text-lg font-bold">
                          <span className="text-cyan-400">COMBO:</span>
                          <motion.span
                            key={combo}
                            initial={{ scale: 1.5, color: '#FFD700' }}
                            animate={{ scale: 1, color: combo > 5 ? '#FF00FF' : combo > 2 ? '#00FFFF' : '#FFFFFF' }}
                            className="ml-2"
                          >
                            x{combo}
                          </motion.span>
                        </div>
                        <div className="text-lg font-bold">
                          <span className="text-blue-400">TIME:</span>
                          <span className={`ml-2 ${gameTime <= 10 ? 'text-red-400 animate-pulse' : 'text-white'}`}>
                            {gameTime.toString().padStart(2, '0')}
                          </span>
                        </div>
                        <button
                          onClick={endGame}
                          className="text-sm px-3 py-1 bg-gradient-to-r from-red-600 to-red-800 hover:from-red-500 hover:to-red-700 rounded font-bold transition-all"
                          style={{
                            boxShadow: '0 0 20px rgba(239, 68, 68, 0.5)',
                            textShadow: '0 2px 4px rgba(0, 0, 0, 0.5)'
                          }}
                        >
                          QUIT
                        </button>
                      </div>

                      {/* Game Area */}
                      <div
                      className="relative rounded-lg border-2 border-purple-500 h-80 overflow-hidden"
                      style={{
                        backgroundColor: 'var(--color-background)',
                        boxShadow: `
                          inset 0 0 50px rgba(168, 85, 247, 0.2),
                          0 0 30px rgba(168, 85, 247, 0.3)
                        `,
                        background: `
                          radial-gradient(ellipse at center, rgba(30, 41, 59, 0.9) 0%, rgba(0, 0, 0, 0.95) 100%),
                          repeating-linear-gradient(
                            90deg,
                            transparent,
                            transparent 2px,
                            rgba(168, 85, 247, 0.03) 2px,
                            rgba(168, 85, 247, 0.03) 4px
                          )
                        `
                      }}
                      >
                        <AnimatePresence>
                          {gameEmojis.map((emoji) => (
                            <motion.div
                              key={emoji.id}
                              initial={{ scale: 0, opacity: 0, rotate: -180 }}
                              animate={{
                                scale: emoji.popping ? [1, 1.5, 0] : [1, 1.1, 1],
                                opacity: emoji.popping ? [1, 1, 0] : 1,
                                rotate: emoji.popping ? 360 : 0,
                              }}
                              exit={{ scale: 0, opacity: 0 }}
                              transition={{
                                scale: { duration: emoji.popping ? 0.5 : 2, repeat: emoji.popping ? 0 : Infinity },
                                rotate: { duration: emoji.popping ? 0.5 : 0.3 }
                              }}
                              className="absolute cursor-pointer select-none"
                              style={{
                                left: `${emoji.x}%`,
                                top: `${emoji.y}%`,
                                transform: 'translate(-50%, -50%)',
                              }}
                            >
                              {emoji.popping && (
                                <motion.div
                                  initial={{ scale: 0 }}
                                  animate={{ scale: [1, 2, 3], opacity: [1, 0.5, 0] }}
                                  transition={{ duration: 0.5 }}
                                  className="absolute inset-0 flex items-center justify-center"
                                >
                                  <span className="text-yellow-400 font-bold text-2xl font-mono"
                                    style={{
                                      textShadow: '0 0 20px rgba(250, 204, 21, 0.8)'
                                    }}
                                  >
                                    +{10 * (combo || 1)}
                                  </span>
                                </motion.div>
                              )}
                              <motion.button
                                whileHover={{ scale: 1.3, rotate: [0, -10, 10, 0] }}
                                whileTap={{ scale: 0.8 }}
                                className="text-4xl"
                                style={{
                                  filter: emoji.popping ? 'brightness(2)' : 'brightness(1)',
                                  textShadow: `
                                    0 0 20px rgba(168, 85, 247, 0.8),
                                    0 0 40px rgba(168, 85, 247, 0.4),
                                    0 5px 15px rgba(0, 0, 0, 0.5)
                                  `,
                                  animation: !emoji.popping ? 'bounce 2s infinite, glow 2s infinite' : 'none'
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleEmojiClick(emoji.id);
                                }}
                              >
                                🤔
                              </motion.button>
                              {emoji.popping && (
                                <>
                                  {[...new Array(6)].map((_, i) => (
                                    <motion.div
                                      key={i}
                                      initial={{ scale: 0, x: 0, y: 0 }}
                                      animate={{
                                        scale: [0, 1, 0],
                                        x: Math.cos(i * Math.PI / 3) * 50,
                                        y: Math.sin(i * Math.PI / 3) * 50,
                                        opacity: [1, 0]
                                      }}
                                      transition={{ duration: 0.6 }}
                                      className="absolute w-3 h-3 bg-gradient-to-r from-yellow-400 to-pink-500 rounded-full"
                                      style={{
                                        boxShadow: '0 0 10px rgba(250, 204, 21, 0.8)'
                                      }}
                                    />
                                  ))}
                                </>
                              )}
                            </motion.div>
                          ))}
                        </AnimatePresence>

                        <style dangerouslySetInnerHTML={{ __html: `
                          @keyframes bounce {
                            0%, 100% { transform: translateY(0); }
                            50% { transform: translateY(-10px); }
                          }
                          @keyframes glow {
                            0%, 100% { filter: brightness(1) drop-shadow(0 0 15px rgba(168, 85, 247, 0.6)); }
                            50% { filter: brightness(1.2) drop-shadow(0 0 25px rgba(168, 85, 247, 0.8)); }
                          }
                        ` }} />

                        {gameEmojis.length === 0 && (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span className="text-cyan-400 text-lg font-mono animate-pulse"
                              style={{
                                textShadow: '0 0 20px rgba(0, 255, 255, 0.5)'
                              }}
                            >
                              GET READY...
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Docs Link */}
          <div className="mb-6 p-3 bg-surface rounded-lg border border-rule">
            <p
            className="text-sm"
            style={{ color: 'var(--color-text)' }}>
              Still bored? Check out the{' '}
              <a
                href={docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:opacity-80 underline"
              >
                documentation page
              </a>
              {' '}while you wait.
            </p>
          </div>

          {/* Retry button */}
          <button
            onClick={() => window.location.reload()}

            className="w-full bg-accent text-on-accent hover:opacity-90 font-medium py-3 px-4 rounded-lg transition-colors duration-200"
          >
            Try Again
          </button>

          {/* Footer */}
          <p className="mt-6 text-xs text-fg-subtle">
            If this issue persists, please contact support.
          </p>
        </div>
      </div>
    </div>
  );
};

export default MaintenancePage;