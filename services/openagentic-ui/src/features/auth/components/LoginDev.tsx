/**
 * Development Login Component - Generic OpenAgentic Branding
 * Azure AD only, no local login, no government branding
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Shield } from '@/shared/icons';
import UnauthorizedWarning from './UnauthorizedWarning';

// Authorized IP allowlist. Loopback + the Docker bridge are always in.
// Add your own LAN/public IPs by setting VITE_DEV_AUTHORIZED_IPS in your
// .env as a comma-separated list of IPs or CIDR ranges
// (e.g. "10.0.0.0/8,203.0.113.7,2001:db8::/32").
const extraAuthorizedIps = (import.meta.env.VITE_DEV_AUTHORIZED_IPS ?? '')
  .split(',')
  .map((s: string) => s.trim())
  .filter(Boolean);

const AUTHORIZED_IPS = [
  '172.18.0.0/16',     // Default Docker bridge
  '127.0.0.1',
  '::1',
  ...extraAuthorizedIps,
];

const isIpInRange = (ip: string, range: string): boolean => {
  if (!range.includes('/')) {
    return ip === range;
  }

  const [rangeIp, cidr] = range.split('/');
  const rangeParts = rangeIp.split('.').map(Number);
  const ipParts = ip.split('.').map(Number);
  const mask = ~(0xffffffff >>> Number.parseInt(cidr));

  const rangeInt = (rangeParts[0] << 24) + (rangeParts[1] << 16) + (rangeParts[2] << 8) + rangeParts[3];
  const ipInt = (ipParts[0] << 24) + (ipParts[1] << 16) + (ipParts[2] << 8) + ipParts[3];

  return (rangeInt & mask) === (ipInt & mask);
};

const isAuthorizedIp = (ip: string): boolean => {
  return AUTHORIZED_IPS.some(range => isIpInRange(ip, range));
};

const LoginDev: React.FC = () => {
  const canvasRef = useRef<SVGSVGElement>(null);
  const [clientIp, setClientIp] = useState<string | null>(null);
  const [isCheckingIp, setIsCheckingIp] = useState(true);

  // Fetch client IP on mount
  useEffect(() => {
    const fetchClientIp = async () => {
      try {
        // Try to get IP from our API first
        const response = await fetch('/api/auth/client-ip');
        if (response.ok) {
          const data = await response.json();
          setClientIp(data.ip);
        } else {
          // Fallback to external service
          const extResponse = await fetch('https://api.ipify.org?format=json');
          const extData = await extResponse.json();
          setClientIp(extData.ip);
        }
      } catch (error) {
        console.error('Failed to fetch client IP:', error);
        // Default to showing unauthorized warning if we can't determine IP
        setClientIp('UNKNOWN');
      } finally {
        setIsCheckingIp(false);
      }
    };

    fetchClientIp();
  }, []);

  // NOTE: the "checking IP" and "unauthorized IP" early returns are DEFERRED
  // to just before the main render below — all hooks must run unconditionally
  // (rules-of-hooks: no hook may sit after an early return).

  // Midjourney-style ASCII Unscramble Effect
  useEffect(() => {
    const svg = canvasRef.current;
    if (!svg) return;

    const width = window.innerWidth;
    const height = window.innerHeight;
    const charWidth = 12;
    const lineHeight = 24;
    const cols = Math.floor(width / charWidth);
    const rows = Math.floor(height / lineHeight);
    const density = 0.08;

    const codeWords = [
      'function', 'const', 'let', 'var', 'return', 'if', 'else', 'for', 'while',
      'class', 'import', 'export', 'async', 'await', 'try', 'catch', 'throw',
      'new', 'this', 'true', 'false', 'null', 'undefined', 'break', 'continue',
      'switch', 'case', 'default', 'extends', 'static', 'public', 'private',
      'interface', 'type', 'enum', 'namespace', 'module', 'require', 'package'
    ];

    const generateCodeLine = (length: number) => {
      let line = '';
      while (line.length < length) {
        const word = codeWords[Math.floor(Math.random() * codeWords.length)];
        line += word + ' ';
      }
      return line.substring(0, length);
    };

    const chars: {
      element: SVGTextElement;
      baseX: number;
      baseY: number;
      char: string;
      baseOpacity: number;
    }[] = [];

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (Math.random() > density) continue;

        const charText = generateCodeLine(1);
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('class', 'ascii-text');
        text.textContent = charText;

        const baseOpacity = 0.3 + Math.random() * 0.5;
        const blueShade = Math.floor(150 + Math.random() * 105);
        // theme-allow: generated decorative "matrix-rain" animation color (per-char computed channel), not a theme surface
        text.setAttribute('fill', `rgb(100, ${blueShade}, 255)`);

        svg.appendChild(text);

        chars.push({
          element: text,
          baseX: col * charWidth,
          baseY: row * lineHeight + lineHeight,
          char: charText,
          baseOpacity
        });
      }
    }

    let startTime: number | null = null;
    let animationFrame: number;

    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp * 0.001;

      const elapsed = timestamp * 0.001 - startTime;

      for (let i = 0; i < chars.length; i++) {
        const char = chars[i];
        const normY = char.baseY / height;
        const wave = Math.sin(normY * 6 + elapsed * 2) * 15 + Math.cos(normY * 4 - elapsed * 1.5) * 10;

        const finalX = char.baseX;
        const finalY = char.baseY + wave;

        char.element.setAttribute('x', String(finalX));
        char.element.setAttribute('y', String(finalY));

        const pulse = Math.sin(elapsed * 2 + normY * 8) * 0.15;
        char.element.setAttribute('opacity', String(Math.max(0.2, Math.min(0.8, char.baseOpacity + pulse))));
      }

      animationFrame = requestAnimationFrame(animate);
    };

    animationFrame = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationFrame);
      chars.forEach(char => char.element.remove());
    };
  }, []);

  // Typing animation state for OPENAGENTIC
  const [typedText, setTypedText] = useState('');
  const fullText = 'OPENAGENTIC';

  useEffect(() => {
    let currentIndex = 0;
    const typingDelay = 100;

    const typeInterval = setInterval(() => {
      if (currentIndex < fullText.length) {
        setTypedText(fullText.substring(0, currentIndex + 1));
        currentIndex++;
      } else {
        clearInterval(typeInterval);
      }
    }, typingDelay);

    return () => clearInterval(typeInterval);
  }, []);

  // Glitch effect
  const [glitchedText, setGlitchedText] = useState('');
  const glitchChars = '!@#$%^&*()_+-=[]{}|;:,.<>?/~`';

  useEffect(() => {
    if (typedText.length === 0) {
      setGlitchedText('');
      return;
    }

    const glitchInterval = setInterval(() => {
      if (Math.random() > 0.8) {
        const chars = typedText.split('');
        const numGlitches = Math.random() > 0.5 ? 1 : 2;

        for (let i = 0; i < numGlitches; i++) {
          const randomIndex = Math.floor(Math.random() * chars.length);
          chars[randomIndex] = glitchChars[Math.floor(Math.random() * glitchChars.length)];
        }

        setGlitchedText(chars.join(''));

        setTimeout(() => {
          setGlitchedText(typedText);
        }, 50);
      } else {
        setGlitchedText(typedText);
      }
    }, 150);

    return () => clearInterval(glitchInterval);
  }, [typedText]);

  // Deferred early returns — all hooks above have now run unconditionally.
  // Show loading while checking IP.
  if (isCheckingIp) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 mx-auto" style={{ borderBottomColor: 'var(--color-ok)' }}></div>
          <p className="mt-4 text-fg-muted">Verifying access...</p>
        </div>
      </div>
    );
  }

  // Show scary warning for unauthorized IPs.
  if (clientIp && !isAuthorizedIp(clientIp)) {
    return <UnauthorizedWarning clientIp={clientIp} />;
  }

  const handleAzureLogin = () => {
    window.location.href = '/api/auth/microsoft';
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-bg">
      {/* ASCII Unscramble Background */}
      <svg
        ref={canvasRef}
        xmlns="http://www.w3.org/2000/svg"
        className="absolute inset-0 w-full h-full"
      />

      {/* theme-allow: decorative retro-CRT phosphor scanline effect (green-glow terminal Easter-egg on the dev login), not a themeable surface */}
      <style>
        {`
          svg {
            user-select: none;
            -webkit-user-select: none;
            -moz-user-select: none;
            -ms-user-select: none;
          }

          .ascii-text {
            font-size: 10px;
            font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
            letter-spacing: 0.05em;
            pointer-events: none;
            font-weight: 500;
          }

          @keyframes crt-scan {
            0% {
              background-position: 0% 0%;
            }
            100% {
              background-position: 0% 100%;
            }
          }

          .crt-effect {
            position: relative;
          }

          .crt-effect::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: repeating-linear-gradient(
              0deg,
              rgba(0, 255, 0, 0.15) 0px,
              rgba(0, 0, 0, 0.05) 1px,
              transparent 2px,
              transparent 3px
            );
            background-size: 100% 4px;
            animation: crt-scan 8s linear infinite;
            pointer-events: none;
            z-index: 1;
          }

          .crt-effect::after {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: linear-gradient(
              to bottom,
              transparent 0%,
              rgba(0, 255, 0, 0.05) 50%,
              transparent 100%
            );
            background-size: 100% 200px;
            animation: crt-scan 3s linear infinite;
            pointer-events: none;
            z-index: 2;
          }
        `}
      </style>

      {/* Typing Logo Text with CRT Effect and Glitching */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="absolute z-10 w-full flex justify-center"
        style={{
          top: 'calc(50% - 80px)',
        }}
      >
        <h1
          className="text-2xl font-black tracking-widest text-center crt-effect"
          style={{
            fontFamily: 'var(--font-mono)',
            color: 'var(--color-ok)',
            // theme-allow: decorative green-phosphor CRT glow for the retro terminal Easter-egg
            textShadow: `
              0 0 10px rgba(0, 255, 0, 0.8),
              0 0 20px rgba(0, 255, 0, 0.5),
              0 0 30px rgba(0, 255, 0, 0.3),
              2px 2px 0 rgba(0, 0, 0, 0.5)
            `,
            filter: 'drop-shadow(0 4px 12px rgba(0, 255, 0, 0.5))',
            letterSpacing: '0.15em',
            position: 'relative',
            zIndex: 3,
            padding: '8px 16px',
          }}
        >
          {glitchedText || typedText}
          {typedText.length < fullText.length && (
            <span className="animate-pulse">|</span>
          )}
        </h1>
      </motion.div>

      {/* Azure AD Login Button */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.5, duration: 1 }}
        className="absolute z-10 flex flex-col items-center justify-center gap-6"
        style={{
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, 0)',
        }}
      >
        <motion.button
          onClick={handleAzureLogin}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="px-8 py-4 border-2 rounded-xl font-bold transition-all duration-150 flex items-center gap-3 shadow-2xl"
          style={{
            background: 'linear-gradient(to right, var(--color-ok), color-mix(in srgb, var(--color-ok) 80%, var(--color-bg)))',
            borderColor: 'color-mix(in srgb, var(--color-ok) 50%, transparent)',
            color: 'var(--color-on-accent)',
            // theme-allow: decorative green-phosphor CRT glow for the retro terminal Easter-egg
            boxShadow: '0 0 30px rgba(0, 255, 0, 0.3)',
          }}
        >
          <Shield className="w-6 h-6" />
          <span className="text-lg tracking-wider">Sign in with Microsoft</span>
        </motion.button>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 2, duration: 1 }}
          className="text-fg-muted text-sm"
        >
          Secure enterprise authentication
        </motion.p>
      </motion.div>

      {/* Footer - Generic OpenAgentic Branding */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 3, duration: 1 }}
        className="absolute bottom-8 left-1/2 transform -translate-x-1/2 z-10 text-center space-y-4"
      >
        {/* Copyright */}
        <div className="text-xs text-fg-subtle space-y-1">
          <p>© {new Date().getFullYear()} Agenticwork™ LLC</p>
        </div>
      </motion.div>
    </div>
  );
};

export default LoginDev;
