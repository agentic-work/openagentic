/**
 * Honeypot Warning Screen for Unauthorized Access Attempts
 * Displays a scary warning to deter attackers while logging their IP
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Shield, Eye, Skull, Zap } from '@/shared/icons';

interface UnauthorizedWarningProps {
  clientIp: string;
}

const UnauthorizedWarning: React.FC<UnauthorizedWarningProps> = ({ clientIp }) => {
  const [countdown, setCountdown] = useState(10);
  const [showSkull, setShowSkull] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    // Log the unauthorized access attempt
    fetch('/api/security/log-intrusion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ip: clientIp,
        timestamp: new Date().toISOString(),
        action: 'unauthorized_login_attempt'
      })
    }).catch(() => {
      // Silent fail - don't reveal if logging works
    });

    // Countdown timer
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    // Skull animation
    const skullTimer = setInterval(() => {
      setShowSkull(prev => !prev);
    }, 500);

    return () => {
      clearInterval(timer);
      clearInterval(skullTimer);
    };
  }, [clientIp]);

  // Glitching text effect
  const [glitchText, setGlitchText] = useState('UNAUTHORIZED ACCESS DETECTED');
  const glitchChars = '!@#$%^&*()_+-=[]{}|;:,.<>?/~`';

  useEffect(() => {
    const glitchInterval = setInterval(() => {
      if (Math.random() > 0.7) {
        const original = 'UNAUTHORIZED ACCESS DETECTED';
        const chars = original.split('');
        const numGlitches = Math.floor(Math.random() * 3) + 1;

        for (let i = 0; i < numGlitches; i++) {
          const randomIndex = Math.floor(Math.random() * chars.length);
          chars[randomIndex] = glitchChars[Math.floor(Math.random() * glitchChars.length)];
        }

        setGlitchText(chars.join(''));

        setTimeout(() => {
          setGlitchText('UNAUTHORIZED ACCESS DETECTED');
        }, 50);
      }
    }, 150);

    return () => clearInterval(glitchInterval);
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-black">
      {/* Animated red background */}
      <div
        className="absolute inset-0 opacity-30"
        style={{
          background: 'radial-gradient(circle at 50% 50%, #ff0000 0%, #000000 100%)',
          animation: 'pulse 2s ease-in-out infinite'
        }}
      />

      <style>
        {`
          @keyframes pulse {
            0%, 100% { opacity: 0.2; }
            50% { opacity: 0.4; }
          }

          @keyframes glitch {
            0% { transform: translate(0); }
            20% { transform: translate(-2px, 2px); }
            40% { transform: translate(-2px, -2px); }
            60% { transform: translate(2px, 2px); }
            80% { transform: translate(2px, -2px); }
            100% { transform: translate(0); }
          }

          @keyframes flicker {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.3; }
          }

          @keyframes scan {
            0% { top: 0%; }
            100% { top: 100%; }
          }

          .glitch-effect {
            animation: glitch 0.3s infinite;
          }

          .scanline {
            position: absolute;
            left: 0;
            right: 0;
            height: 4px;
            background: linear-gradient(to bottom, transparent, rgba(255, 0, 0, 0.8), transparent);
            animation: scan 2s linear infinite;
            pointer-events: none;
          }

          .warning-border {
            border: 4px solid #ff0000;
            box-shadow:
              0 0 20px #ff0000,
              inset 0 0 20px rgba(255, 0, 0, 0.3);
            animation: flicker 1.5s infinite;
          }

          .text-glow-red {
            text-shadow:
              0 0 10px #ff0000,
              0 0 20px #ff0000,
              0 0 30px #ff0000,
              0 0 40px #ff0000;
          }
        `}
      </style>

      {/* Scanline effect */}
      <div className="scanline" />

      {/* Warning container */}
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="relative z-10 max-w-4xl mx-auto p-8"
      >
        <div className="warning-border bg-black rounded-lg p-12">
          {/* Skull icon */}
          <AnimatePresence>
            {showSkull && (
              <motion.div
                initial={{ scale: 0, rotate: -180 }}
                animate={{ scale: 1, rotate: 0 }}
                exit={{ scale: 0, rotate: 180 }}
                className="flex justify-center mb-8"
              >
                <Skull className="w-24 h-24 text-red-600" strokeWidth={2} />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Main warning text */}
          <motion.h1
            className="text-5xl font-black text-center mb-6 text-red-600 glitch-effect text-glow-red"
            style={{
              fontFamily: '"Courier New", monospace',
              letterSpacing: '0.1em'
            }}
          >
            {glitchText}
          </motion.h1>

          {/* IP Address display */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-3 bg-red-900/30 border-2 border-red-600 rounded-lg px-6 py-3">
              <Eye className="w-6 h-6 text-red-500" />
              <p className="text-2xl font-mono text-red-400">
                IP: <span className="text-red-300 font-bold">{clientIp}</span>
              </p>
            </div>
          </div>

          {/* Threat message */}
          <div className="space-y-6 text-center text-red-300 text-lg font-mono">
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              className="flex items-center justify-center gap-3"
            >
              <Zap className="w-6 h-6 text-yellow-500" />
              <span className="text-yellow-400 font-bold">
                THANK YOU FOR YOUR IP
              </span>
              <Zap className="w-6 h-6 text-yellow-500" />
            </motion.p>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.8 }}
              className="text-2xl font-bold text-red-500"
            >
              INITIATING AI MULTI-AGENT COUNTER-ATTACK
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.1 }}
              className="bg-red-950/50 border border-red-700 rounded-lg p-6 mt-6"
            >
              <div className="flex items-center justify-center gap-3 mb-4">
                <Shield className="w-8 h-8 text-red-500 animate-pulse" />
                <p className="text-xl font-bold text-red-400">SECURITY MEASURES ACTIVATED</p>
                <Shield className="w-8 h-8 text-red-500 animate-pulse" />
              </div>

              <ul className="text-left space-y-2 text-red-300">
                <li className="flex items-center gap-2">
                  <span className="text-green-500">✓</span> IP Address Logged: {clientIp}
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-500">✓</span> Geolocation Traced
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-500">✓</span> ISP Information Captured
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-500">✓</span> Autonomous Defense Systems Deployed
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-500">✓</span> AI Agents Monitoring Your Network
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-yellow-500 animate-pulse">⚠</span>
                  <span className="text-yellow-400">Federal Authorities Notified</span>
                </li>
              </ul>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 1.5 }}
              className="mt-8 p-6 bg-black/60 border-2 border-yellow-600 rounded-lg"
            >
              <p className="text-yellow-500 text-xl font-bold mb-2">
                ⚠️ COUNTER-INTRUSION DEPLOYMENT
              </p>
              <p className="text-yellow-400 text-lg">
                Advanced Persistent Threat (APT) Response Initiated
              </p>
              <div className="mt-4 text-6xl font-black text-red-600 animate-pulse">
                {countdown}
              </div>
              <p className="text-sm text-gray-500 mt-2">
                Defensive measures activating in {countdown} seconds...
              </p>
            </motion.div>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 2 }}
              className="text-sm text-gray-600 mt-8 italic"
            >
              This system is protected by autonomous AI security agents.
              <br />
              Unauthorized access attempts are monitored, logged, and actively defended against.
              <br />
              <span className="text-red-500">Your intrusion attempt has been permanently recorded.</span>
            </motion.p>
          </div>

          {/* Fake loading bars */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 2.5 }}
            className="mt-8 space-y-3"
          >
            {['Analyzing threat level', 'Deploying countermeasures', 'Activating AI defense grid'].map((text, i) => (
              <div key={i} className="space-y-1">
                <p className="text-xs text-red-400 font-mono">{text}...</p>
                <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
                  <motion.div
                    initial={{ width: '0%' }}
                    animate={{ width: '100%' }}
                    transition={{ duration: 2, delay: 2.5 + i * 0.3 }}
                    className="h-full bg-gradient-to-r from-red-600 to-red-400"
                  />
                </div>
              </div>
            ))}
          </motion.div>
        </div>
      </motion.div>

      {/* Warning icons floating in background */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {[...Array(8)].map((_, i) => (
          <motion.div
            key={i}
            initial={{
              x: Math.random() * window.innerWidth,
              y: Math.random() * window.innerHeight,
              opacity: 0.1
            }}
            animate={{
              y: [null, Math.random() * window.innerHeight],
              opacity: [0.1, 0.3, 0.1]
            }}
            transition={{
              duration: 5 + Math.random() * 5,
              repeat: Infinity,
              repeatType: 'reverse'
            }}
            className="absolute"
          >
            <AlertTriangle className="w-16 h-16 text-red-600" />
          </motion.div>
        ))}
      </div>
    </div>
  );
};

export default UnauthorizedWarning;
