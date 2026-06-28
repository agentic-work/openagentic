/**
 * Response Feedback API Service
 * Handles user feedback on LLM responses (thumbs up/down, copy tracking)
 */

import { getApiUrl } from '@/config/runtime';

// Helper to get auth token from localStorage
const getAuthToken = () => localStorage.getItem('auth_token');

export type FeedbackType = 'thumbs_up' | 'thumbs_down' | 'copy' | 'regenerate' | 'share' | 'report';

export interface FeedbackSubmission {
  messageId: string;
  sessionId: string;
  feedbackType: FeedbackType;
  rating?: number;
  comment?: string;
  tags?: string[];
  model?: string;
  provider?: string;
  responseTime?: number;
  tokenCount?: number;
}

export interface FeedbackResponse {
  success: boolean;
  feedback?: {
    id: string;
    feedbackType: string;
    rating?: number;
    createdAt: string;
  };
  error?: string;
}

export interface FeedbackStats {
  thumbs_up?: number;
  thumbs_down?: number;
  copy?: number;
  [key: string]: number | undefined;
}

export interface MessageFeedback {
  userFeedback: Array<{
    id: string;
    feedback_type: string;
    rating?: number;
    comment?: string;
    tags?: string[];
    created_at: string;
  }>;
  stats: FeedbackStats;
}

/**
 * Submit feedback for a message
 */
export async function submitFeedback(feedback: FeedbackSubmission): Promise<FeedbackResponse> {
  const apiUrl = getApiUrl();
  const token = getAuthToken();

  try {
    // apiUrl already includes /api, so don't duplicate it
    const response = await fetch(`${apiUrl}/feedback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(feedback),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to submit feedback');
    }

    return await response.json();
  } catch (error: any) {
    console.error('[Feedback] Failed to submit:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get feedback for a specific message
 */
export async function getMessageFeedback(messageId: string): Promise<MessageFeedback | null> {
  const apiUrl = getApiUrl();
  const token = getAuthToken();

  try {
    // apiUrl already includes /api, so don't duplicate it
    const response = await fetch(`${apiUrl}/feedback/${messageId}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error('[Feedback] Failed to get:', error);
    return null;
  }
}

/**
 * Delete feedback
 */
export async function deleteFeedback(feedbackId: string): Promise<boolean> {
  const apiUrl = getApiUrl();
  const token = getAuthToken();

  try {
    // apiUrl already includes /api, so don't duplicate it
    const response = await fetch(`${apiUrl}/feedback/${feedbackId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    return response.ok;
  } catch (error) {
    console.error('[Feedback] Failed to delete:', error);
    return false;
  }
}
