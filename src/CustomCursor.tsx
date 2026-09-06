import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

interface CustomCursorProps {
  type: 'default' | 'hanger';
  speed: 'slow' | 'medium' | 'fast';
}

const CustomCursor = ({ type, speed }: CustomCursorProps) => {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isHovering, setIsHovering] = useState(false);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setPosition({ x: e.clientX, y: e.clientY });
      const target = e.target as HTMLElement;
      setIsHovering(target.tagName === 'A' || target.closest('a') !== null || target.tagName === 'BUTTON' || target.closest('button') !== null);
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  const speedMultiplier = speed === 'slow' ? 1 : speed === 'medium' ? 1.3 : 1.5;

  if (type === 'default') {
    return (
      <motion.div
        className="fixed top-0 left-0 w-[60px] h-[60px] rounded-full border border-brand-peach/30 pointer-events-none z-[9999] flex items-center justify-center hidden md:flex"
        animate={{
          x: position.x - 30,
          y: position.y - 30,
          scale: isHovering ? 1.5 : 1,
          backgroundColor: isHovering ? 'rgba(232, 194, 176, 0.4)' : 'rgba(232, 194, 176, 0.1)',
          boxShadow: isHovering ? '0 0 30px rgba(232, 194, 176, 0.6)' : '0 0 15px rgba(232, 194, 176, 0.3)'
        }}
        transition={{ type: 'spring', damping: 20, stiffness: 400, mass: 0.3 }}
      >
        <div className="w-2 h-2 rounded-full bg-brand-peach" />
      </motion.div>
    );
  }

  return (
    <motion.div
      className="fixed pointer-events-none z-[9999] text-brand-peach"
      animate={{
        x: position.x - 20,
        y: position.y - 20,
      }}
      transition={{ 
        type: 'spring', 
        damping: isHovering ? 30 : 20, 
        stiffness: isHovering ? 50 : 200 / speedMultiplier 
      }}
    >
      <div className={`w-12 h-12 transition-transform duration-500 ${isHovering ? 'scale-110' : 'scale-100'}`}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M12 6c0-1.1.9-2 2-2h2c1.1 0 2 .9 2 2v2h-6V6z" />
          <path d="M2 18h20" />
          <path d="M22 18l-10-12-10 12" />
        </svg>
      </div>
    </motion.div>
  );
};

export default CustomCursor;
