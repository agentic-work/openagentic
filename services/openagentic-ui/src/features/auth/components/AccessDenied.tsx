/**
 * Access Denied Page
 *
 * Shown when an unauthorized user attempts to login via Google OAuth.
 * Displays a friendly message informing them their access request has been received.
 */

import React, { useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Mail, Clock, ArrowLeft } from '@/shared/icons';

const AccessDenied: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const email = searchParams.get('email') || '';
  const canvasRef = useRef<SVGSVGElement>(null);

  // Simplified background effect
  useEffect(() => {
    const svg = canvasRef.current;
    if (!svg) return;

    const width = window.innerWidth;
    const height = window.innerHeight;
    const charWidth = 14;
    const lineHeight = 28;
    const cols = Math.floor(width / charWidth);
    const rows = Math.floor(height / lineHeight);
    const density = 0.05;

    const chars: {
      element: SVGTextElement;
      baseX: number;
      baseY: number;
      baseOpacity: number;
    }[] = [];

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (Math.random() > density) continue;

        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('class', 'ascii-text');
        text.textContent = '.';

        const baseOpacity = 0.15 + Math.random() * 0.25;
        text.setAttribute('fill', `rgba(100, 200, 255, ${baseOpacity})`);

        svg.appendChild(text);

        chars.push({
          element: text,
          baseX: col * charWidth,
          baseY: row * lineHeight + lineHeight,
          baseOpacity
        });
      }
    }

    let animationFrame: number;
    let startTime: number | null = null;

    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp * 0.001;
      const elapsed = timestamp * 0.001 - startTime;

      for (const char of chars) {
        const normY = char.baseY / height;
        const wave = Math.sin(normY * 4 + elapsed * 1.5) * 8;

        char.element.setAttribute('x', String(char.baseX));
        char.element.setAttribute('y', String(char.baseY + wave));

        const pulse = Math.sin(elapsed * 1.5 + normY * 6) * 0.1;
        char.element.setAttribute('opacity', String(Math.max(0.1, Math.min(0.4, char.baseOpacity + pulse))));
      }

      animationFrame = requestAnimationFrame(animate);
    };

    animationFrame = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationFrame);
      chars.forEach(char => char.element.remove());
    };
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-black">
      {/* Background */}
      <svg
        ref={canvasRef}
        xmlns="http://www.w3.org/2000/svg"
        className="absolute inset-0 w-full h-full"
      />

      <style>
        {`
          .ascii-text {
            font-size: 12px;
            font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
            pointer-events: none;
          }
        `}
      </style>

      {/* Content Card */}
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="relative z-10 max-w-md w-full mx-4"
      >
        <div className="bg-gray-900/90 backdrop-blur-sm rounded-2xl p-8 border border-cyan-500/30 shadow-2xl">
          {/* Icon */}
          <div className="flex justify-center mb-6">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-cyan-500/20 to-blue-500/20 border border-cyan-500/30 flex items-center justify-center">
              <Mail className="w-10 h-10 text-cyan-400" />
            </div>
          </div>

          {/* Title */}
          <h1 className="text-2xl font-bold text-center text-white mb-2">
            Thank You For Your Interest
          </h1>

          {/* Message */}
          <p className="text-center text-gray-300 mb-6 leading-relaxed">
            We will get back to you with your evaluation request soon.
          </p>

          {/* Team signature */}
          <p className="text-center text-cyan-400 font-medium mb-6">
            — OpenAgentic Team
          </p>

          {/* Info box */}
          <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700/50 mb-6">
            <div className="flex items-center gap-3 text-gray-400 text-sm">
              <Clock className="w-4 h-4 text-cyan-400 flex-shrink-0" />
              <span>
                We've received your request{email && (
                  <> for <span className="text-cyan-300">{email}</span></>
                )}. Our team will review it and reach out shortly.
              </span>
            </div>
          </div>

          {/* Back button */}
          <motion.button
            onClick={() => navigate('/login')}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="w-full py-3 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 hover:text-white hover:bg-gray-700 hover:border-cyan-500/50 transition-all duration-150 flex items-center justify-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Login</span>
          </motion.button>

          {/* Contact info */}
          <p className="text-center text-gray-500 text-xs mt-6">
            Questions? Contact your administrator.
          </p>
        </div>

        {/* Footer */}
        <div className="text-center mt-6 text-gray-600 text-xs">
          <p>
            <a
              href="https://gnomus.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-gray-400 underline"
            >
              Learn more
            </a>
          </p>
        </div>
      </motion.div>
    </div>
  );
};

export default AccessDenied;
