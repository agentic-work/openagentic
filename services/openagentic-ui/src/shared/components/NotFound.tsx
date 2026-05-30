import React from 'react';
import { Link } from 'react-router-dom';
import { Home, ArrowLeft } from '@/shared/icons';
import { motion } from 'framer-motion';

const NotFound: React.FC = () => {
  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
      {/* Background gradient - uses CSS variables that respond to theme */}
      <div className="absolute inset-0 bg-gradient-to-br from-bg-primary via-bg-secondary to-bg-primary dark:from-bg-primary dark:via-bg-secondary dark:to-bg-primary" />

      {/* Content container */}
      <div className="relative z-10 text-center max-w-2xl mx-auto px-6">
        {/* Chaos animation */}
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
          className="mb-8"
        >
          <img
            src="/animations/chaos.gif"
            alt="Chaos animation"
            className="w-96 md:w-[500px] lg:w-[600px] h-auto mx-auto rounded-lg shadow-2xl"
          />
        </motion.div>

        {/* 404 text */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.5 }}
        >
          <h1 className="text-8xl font-bold mb-4 text-primary">
            404
          </h1>

          <h2 className="text-4xl font-semibold mb-6 text-primary">
            Uh oh! Something went wrong
          </h2>

          <p className="text-2xl mb-8 text-secondary">
            This page doesn't exist. Look what you did!
          </p>
        </motion.div>

        {/* Action buttons */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.5 }}
          className="flex flex-col sm:flex-row gap-4 justify-center"
        >
          <Link
            to="/"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-lg font-medium transition-all transform hover:scale-105 bg-info hover:bg-info/80 text-white"
          >
            <Home size={20} />
            Go to Homepage
          </Link>

          <button
            onClick={() => window.history.back()}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-lg font-medium transition-all transform hover:scale-105 bg-secondary hover:bg-tertiary text-primary"
          >
            <ArrowLeft size={20} />
            Go Back
          </button>
        </motion.div>

      </div>
    </div>
  );
};

export default NotFound;