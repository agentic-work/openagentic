/**
 * User Data Management Routes
 * 
 * Handles user data operations including soft deletion of chat messages,
 * user statistics, and administrative data management functions.
 * 
 * @see {@link https://docs.openagentic.io/api/chat/user-data-management}
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import pino from 'pino';
import { prisma } from '../../utils/prisma.js';

// Import the proper AuthenticatedRequest interface
import { AuthenticatedRequest } from '../../middleware/unifiedAuth.js';

const logger = pino({ name: 'user-data-management' });

interface DeleteUserChatsRequest {
  userId?: string; // Admin can specify userId, regular users delete their own
}

/**
 * Soft delete all chat messages for a user
 * - Users can only delete their own messages
 * - Admins can delete any user's messages  
 * - Messages are marked as deleted but remain in database for admin access
 */
export async function softDeleteUserChatsHandler(
  request: AuthenticatedRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const { userId: targetUserId } = request.body as DeleteUserChatsRequest;
    const currentUser = request.user;
    
    if (!currentUser) {
      return reply.code(401).send({
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication required'
        }
      });
    }
    
    // Determine which user's chats to delete
    let userIdToDelete: string;
    
    if (targetUserId && currentUser.isAdmin) {
      // Admin deleting another user's chats
      userIdToDelete = targetUserId;
    } else if (targetUserId && !currentUser.isAdmin) {
      // Non-admin trying to delete someone else's chats
      return reply.code(403).send({
        error: {
          code: 'FORBIDDEN',
          message: 'You can only delete your own chat messages'
        }
      });
    } else {
      // User deleting their own chats
      userIdToDelete = currentUser.id;
    }

    // Get all sessions for the user
    const sessions = await prisma.chatSession.findMany({
      where: { 
        user_id: userIdToDelete,
        deleted_at: null // Only get non-deleted sessions
      },
      select: { id: true }
    });

    const sessionIds = sessions.map(s => s.id);

    // Soft delete all messages in these sessions
    const deletedMessages = await prisma.chatMessage.updateMany({
      where: {
        session_id: { in: sessionIds },
        deleted_at: null // Only delete non-deleted messages
      },
      data: {
        deleted_at: new Date()
      }
    });

    // Soft delete all sessions
    const deletedSessions = await prisma.chatSession.updateMany({
      where: {
        user_id: userIdToDelete,
        deleted_at: null
      },
      data: {
        deleted_at: new Date()
      }
    });

    // Log the admin action if admin deleted someone else's data
    if (targetUserId && currentUser.isAdmin && targetUserId !== currentUser.id) {
      // Create admin audit log entry in database
      await prisma.adminAuditLog.create({
        data: {
          admin_user_id: currentUser.id,
          admin_email: currentUser.email || '',
          action: 'DELETE_USER_CHATS',
          resource_type: 'ChatMessage',
          resource_id: userIdToDelete,
          details: {
            deletedSessions: deletedSessions.count,
            deletedMessages: deletedMessages.count,
            timestamp: new Date().toISOString(),
            user_agent: request.headers['user-agent'] || ''
          },
          ip_address: request.ip || '',
          created_at: new Date()
        }
      });
      
      logger.info({
        adminUserId: currentUser.id,
        adminEmail: currentUser.email || '',
        action: 'DELETE_USER_CHATS',
        resourceType: 'ChatMessage',
        resourceId: userIdToDelete,
        details: {
          deletedSessions: deletedSessions.count,
          deletedMessages: deletedMessages.count
        }
      }, 'Admin audit log persisted to database');
    }

    reply.send({
      success: true,
      message: `Successfully deleted ${deletedMessages.count} messages from ${deletedSessions.count} chat sessions`,
      details: {
        deletedSessions: deletedSessions.count,
        deletedMessages: deletedMessages.count,
        userId: userIdToDelete,
        deleted_at: new Date()
      }
    });

  } catch (error) {
    request.log.error({
      error: error instanceof Error ? error.message : String(error)
    }, 'Failed to delete user chats');

    reply.code(500).send({
      error: {
        code: 'DELETE_FAILED',
        message: 'Failed to delete chat messages'
      }
    });
  }
}

/**
 * Get user's chat statistics (for admin use)
 */
export async function getUserChatStatsHandler(
  request: AuthenticatedRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const { userId } = request.params as { userId: string };
    const currentUser = request.user;
    
    if (!currentUser) {
      return reply.code(401).send({
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication required'
        }
      });
    }
    
    // Only admins can view other users' stats
    if (!currentUser.isAdmin && userId !== currentUser.id) {
      return reply.code(403).send({
        error: {
          code: 'FORBIDDEN',
          message: 'Insufficient permissions'
        }
      });
    }

    // Get chat statistics including soft-deleted items
    const stats = await prisma.$transaction(async (tx) => {
      const totalSessions = await tx.chatSession.count({
        where: { user_id: userId }
      });
      
      const activeSessions = await tx.chatSession.count({
        where: { user_id: userId, deleted_at: null }
      });
      
      const deletedSessions = await tx.chatSession.count({
        where: { user_id: userId, deleted_at: { not: null } }
      });
      
      const totalMessages = await tx.chatMessage.count({
        where: { 
          session: { user_id: userId }
        }
      });
      
      const activeMessages = await tx.chatMessage.count({
        where: { 
          session: { user_id: userId },
          deleted_at: null
        }
      });
      
      const deletedMessages = await tx.chatMessage.count({
        where: { 
          session: { user_id: userId },
          deleted_at: { not: null }
        }
      });

      return {
        sessions: {
          total: totalSessions,
          active: activeSessions,
          deleted: deletedSessions
        },
        messages: {
          total: totalMessages,
          active: activeMessages,
          deleted: deletedMessages
        }
      };
    });

    reply.send({
      success: true,
      userId,
      statistics: stats
    });

  } catch (error) {
    request.log.error({
      error: error instanceof Error ? error.message : String(error)
    }, 'Failed to get user chat stats');

    reply.code(500).send({
      error: {
        code: 'STATS_FAILED',
        message: 'Failed to retrieve chat statistics'
      }
    });
  }
}

/**
 * Admin-only: Permanently delete soft-deleted messages older than specified days
 */
export async function permanentDeleteOldMessagesHandler(
  request: AuthenticatedRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const currentUser = request.user;
    
    if (!currentUser) {
      return reply.code(401).send({
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication required'
        }
      });
    }
    
    if (!currentUser.isAdmin) {
      return reply.code(403).send({
        error: {
          code: 'ADMIN_REQUIRED',
          message: 'Administrative privileges required'
        }
      });
    }

    const { daysOld = 30 } = request.body as { daysOld?: number };
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    // Permanently delete messages that were soft-deleted more than X days ago
    const deletedMessages = await prisma.chatMessage.deleteMany({
      where: {
        deleted_at: {
          not: null,
          lt: cutoffDate
        }
      }
    });

    // Permanently delete sessions that were soft-deleted more than X days ago
    const deletedSessions = await prisma.chatSession.deleteMany({
      where: {
        deleted_at: {
          not: null,
          lt: cutoffDate
        }
      }
    });

    // Create admin audit log entry in database
    await prisma.adminAuditLog.create({
      data: {
        admin_user_id: currentUser.id,
        admin_email: currentUser.email || '',
        action: 'PERMANENT_DELETE_OLD_CHATS',
        resource_type: 'ChatMessage',
        resource_id: 'bulk',
        details: {
          cutoffDate: cutoffDate.toISOString(),
          daysOld,
          deletedSessions: deletedSessions.count,
          deletedMessages: deletedMessages.count,
          user_agent: request.headers['user-agent'] || ''
        },
        ip_address: request.ip || '',
        created_at: new Date()
      }
    });
    
    logger.info({
      adminUserId: currentUser.id,
      adminEmail: currentUser.email || '',
      action: 'PERMANENT_DELETE_OLD_CHATS',
      resourceType: 'ChatMessage',
      resourceId: 'bulk',
      details: {
        cutoffDate,
        daysOld,
        deletedSessions: deletedSessions.count,
        deletedMessages: deletedMessages.count
      }
    }, 'Admin audit log persisted to database');

    reply.send({
      success: true,
      message: `Permanently deleted ${deletedMessages.count} messages and ${deletedSessions.count} sessions older than ${daysOld} days`,
      details: {
        cutoffDate,
        daysOld,
        deletedSessions: deletedSessions.count,
        deletedMessages: deletedMessages.count
      }
    });

  } catch (error) {
    request.log.error({
      error: error instanceof Error ? error.message : String(error)
    }, 'Failed to permanently delete old messages');

    reply.code(500).send({
      error: {
        code: 'PERMANENT_DELETE_FAILED',
        message: 'Failed to permanently delete old messages'
      }
    });
  }
}