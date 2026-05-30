/**

 * Editable Message Component
 *
 * Allows users to edit their chat messages inline with a textarea
 * that automatically resizes and provides save/cancel functionality.
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, X, Edit3 } from '@/shared/icons';
import clsx from 'clsx';
import { ChatMessage } from '@/types/index';

interface EditableMessageProps {
  message: ChatMessage;
  isEditing: boolean;
  onUpdate: (messageId: string, newContent: string) => void;
  onCancel: () => void;
}

const EditableMessage: React.FC<EditableMessageProps> = ({
  message,
  isEditing,
  onUpdate,
  onCancel,
}) => {
  const [editContent, setEditContent] = useState(message.content);
  const [hasChanges, setHasChanges] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Update edit content when message changes
  useEffect(() => {
    setEditContent(message.content);
    setHasChanges(false);
  }, [message.content]);

  // Focus and resize textarea when editing starts
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      // Set cursor to end
      textareaRef.current.setSelectionRange(
        textareaRef.current.value.length,
        textareaRef.current.value.length
      );
      // Resize to fit content
      autoResize();
    }
  }, [isEditing]);

  const autoResize = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.max(textarea.scrollHeight, 48)}px`;
    }
  };

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value;
    setEditContent(newContent);
    setHasChanges(newContent !== message.content);
    autoResize();
  };

  const handleSave = () => {
    if (hasChanges && editContent.trim()) {
      onUpdate(message.id, editContent.trim());
    } else {
      onCancel();
    }
  };

  const handleCancel = () => {
    setEditContent(message.content);
    setHasChanges(false);
    onCancel();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  };

  if (!isEditing) {
    return (
      <div className="whitespace-pre-wrap break-words text-gray-900 dark:text-gray-200">
        {message.content}
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.15 }}
      className="space-y-3"
    >
      {/* Editing Header */}
      <div className="flex items-center gap-2 text-sm">
        <Edit3 className="w-4 h-4 text-blue-600 dark:text-blue-400" />
        <span className="font-medium text-blue-600 dark:text-blue-400">
          Editing message
        </span>
        <span className="text-xs text-gray-400 dark:text-gray-500">
          Ctrl+Enter to save, Esc to cancel
        </span>
      </div>

      {/* Textarea */}
      <div className="relative rounded-lg border transition-colors duration-150 bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 focus-within:border-blue-500">
        <textarea
          ref={textareaRef}
          value={editContent}
          onChange={handleContentChange}
          onKeyDown={handleKeyDown}
          className="w-full p-3 bg-transparent resize-none outline-none text-sm leading-relaxed text-gray-900 dark:text-gray-200 placeholder-gray-500"
          placeholder="Edit your message..."
          style={{
            minHeight: '48px',
            maxHeight: '400px',
          }}
        />
      </div>

      {/* Action Buttons */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {hasChanges && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-center gap-1 text-xs"
            >
              <div className="w-1.5 h-1.5 rounded-full bg-yellow-600 dark:bg-yellow-500" />
              <span className="text-yellow-600 dark:text-yellow-400">
                Unsaved changes
              </span>
            </motion.div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Cancel Button */}
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleCancel}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors duration-150 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
          >
            <X className="w-3.5 h-3.5" />
            Cancel
          </motion.button>

          {/* Save Button */}
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleSave}
            disabled={!editContent.trim()}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors duration-150',
              editContent.trim()
                ? 'bg-blue-500 dark:bg-blue-600 hover:bg-blue-600 dark:hover:bg-blue-700 text-white'
                : 'opacity-50 cursor-not-allowed bg-gray-400 text-gray-600'
            )}
          >
            <Check className="w-3.5 h-3.5" />
            {hasChanges ? 'Save Changes' : 'Done'}
          </motion.button>
        </div>
      </div>

      {/* Character Count */}
      <div className="flex justify-end">
        <span className="text-xs text-gray-400 dark:text-gray-500">
          {editContent.length} characters
        </span>
      </div>
    </motion.div>
  );
};

export default EditableMessage;
