/**
 * NotificationService
 *
 * Handles sending notifications for workflow approvals and other events.
 * Supports multiple channels: in_app, email, slack, teams
 *
 * This is a key component of the Human-in-the-Loop (HITL) system.
 */

import { prisma } from '../utils/prisma.js';
import { loggers } from '../utils/logger.js';
import axios from 'axios';

const logger = loggers.services;

// =============================================================================
// Types
// =============================================================================

export interface ApprovalRequestNotification {
  approvalId: string;
  recipients: string[];       // User IDs or email addresses
  message: string;
  channels: string[];         // 'in_app', 'email', 'slack', 'teams'
  workflowId: string;
  executionId: string;
  approvalUrl: string;
}

export interface NotificationPayload {
  type: 'approval_request' | 'approval_reminder' | 'approval_timeout' | 'workflow_complete' | 'workflow_error';
  recipientId: string;
  title: string;
  message: string;
  data?: Record<string, any>;
  actionUrl?: string;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
}

export interface InAppNotification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  message: string;
  data: Record<string, any>;
  action_url?: string;
  is_read: boolean;
  created_at: Date;
}

// =============================================================================
// NotificationService Class
// =============================================================================

export class NotificationService {
  private slackWebhookUrl?: string;
  private teamsWebhookUrl?: string;
  private emailServiceUrl?: string;
  private appBaseUrl: string;

  constructor() {
    this.slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;
    this.teamsWebhookUrl = process.env.TEAMS_WEBHOOK_URL;
    this.emailServiceUrl = process.env.EMAIL_SERVICE_URL;
    this.appBaseUrl = process.env.APP_URL || 'http://localhost:3000';
  }

  /**
   * Send approval request notifications to all approvers
   */
  async sendApprovalRequest(request: ApprovalRequestNotification): Promise<void> {
    const { approvalId, recipients, message, channels, workflowId, executionId, approvalUrl } = request;

    logger.info({
      approvalId,
      recipientCount: recipients.length,
      channels
    }, '[NotificationService] Sending approval request notifications');

    const fullApprovalUrl = `${this.appBaseUrl}${approvalUrl}`;

    // Get workflow details for richer notifications
    let workflowName = 'Workflow';
    try {
      const workflow = await prisma.workflow.findUnique({
        where: { id: workflowId },
        select: { name: true }
      });
      if (workflow) workflowName = workflow.name;
    } catch (e) {
      // Ignore - use default name
    }

    // Send to each channel
    const sendPromises: Promise<void>[] = [];

    for (const channel of channels) {
      switch (channel) {
        case 'in_app':
          sendPromises.push(
            this.sendInAppNotifications(recipients, {
              type: 'approval_request',
              title: 'Approval Required',
              message: `${message}\n\nWorkflow: ${workflowName}`,
              data: { approvalId, workflowId, executionId },
              actionUrl: fullApprovalUrl,
              priority: 'high'
            })
          );
          break;

        case 'email':
          sendPromises.push(
            this.sendEmailNotifications(recipients, {
              type: 'approval_request',
              title: `Approval Required: ${workflowName}`,
              message,
              data: { approvalId, workflowId, executionId },
              actionUrl: fullApprovalUrl,
              priority: 'high'
            })
          );
          break;

        case 'slack':
          sendPromises.push(
            this.sendSlackNotification({
              type: 'approval_request',
              title: `Approval Required: ${workflowName}`,
              message,
              data: { approvalId, workflowId, executionId, recipients },
              actionUrl: fullApprovalUrl,
              priority: 'high'
            })
          );
          break;

        case 'teams':
          sendPromises.push(
            this.sendTeamsNotification({
              type: 'approval_request',
              title: `Approval Required: ${workflowName}`,
              message,
              data: { approvalId, workflowId, executionId, recipients },
              actionUrl: fullApprovalUrl,
              priority: 'high'
            })
          );
          break;
      }
    }

    // Wait for all notifications (don't fail if some fail)
    const results = await Promise.allSettled(sendPromises);
    const failures = results.filter(r => r.status === 'rejected');

    if (failures.length > 0) {
      logger.warn({
        approvalId,
        failureCount: failures.length,
        failures: failures.map(f => (f as PromiseRejectedResult).reason?.message)
      }, '[NotificationService] Some notifications failed');
    }
  }

  /**
   * Send in-app notifications to users
   */
  private async sendInAppNotifications(
    recipientIds: string[],
    notification: Omit<NotificationPayload, 'recipientId'>
  ): Promise<void> {
    logger.debug({
      recipientCount: recipientIds.length,
      type: notification.type
    }, '[NotificationService] Sending in-app notifications');

    // Create notification records for each recipient
    const notifications = recipientIds.map(recipientId => ({
      user_id: recipientId,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      data: notification.data || {},
      action_url: notification.actionUrl,
      priority: notification.priority || 'normal',
      is_read: false
    }));

    try {
      // Check if Notification table exists (may not in all deployments)
      // Use raw query to avoid Prisma model issues
      for (const notif of notifications) {
        await prisma.$executeRaw`
          INSERT INTO notifications (id, user_id, type, title, message, data, action_url, priority, is_read, created_at)
          VALUES (gen_random_uuid(), ${notif.user_id}::uuid, ${notif.type}, ${notif.title}, ${notif.message}, ${JSON.stringify(notif.data)}::jsonb, ${notif.action_url}, ${notif.priority}, false, NOW())
          ON CONFLICT DO NOTHING
        `;
      }
    } catch (error: any) {
      // If table doesn't exist, log and continue
      if (error.message?.includes('does not exist')) {
        logger.warn('[NotificationService] Notifications table not found - skipping in-app notifications');
        return;
      }
      throw error;
    }
  }

  /**
   * Send email notifications
   */
  private async sendEmailNotifications(
    recipientIds: string[],
    notification: Omit<NotificationPayload, 'recipientId'>
  ): Promise<void> {
    if (!this.emailServiceUrl) {
      logger.debug('[NotificationService] Email service URL not configured - skipping email notifications');
      return;
    }

    logger.debug({
      recipientCount: recipientIds.length,
      type: notification.type
    }, '[NotificationService] Sending email notifications');

    // Get email addresses for user IDs
    const users = await prisma.user.findMany({
      where: { id: { in: recipientIds } },
      select: { id: true, email: true, name: true }
    });

    for (const user of users) {
      try {
        await axios.post(this.emailServiceUrl, {
          to: user.email,
          subject: notification.title,
          template: 'approval_request',
          data: {
            userName: user.name || user.email,
            message: notification.message,
            actionUrl: notification.actionUrl,
            ...notification.data
          }
        }, {
          timeout: 10000
        });
      } catch (error: any) {
        logger.warn({
          email: user.email,
          error: error.message
        }, '[NotificationService] Failed to send email');
      }
    }
  }

  /**
   * Send Slack notification
   */
  private async sendSlackNotification(
    notification: Omit<NotificationPayload, 'recipientId'> & { data?: Record<string, any> }
  ): Promise<void> {
    if (!this.slackWebhookUrl) {
      logger.debug('[NotificationService] Slack webhook URL not configured - skipping Slack notification');
      return;
    }

    logger.debug({
      type: notification.type
    }, '[NotificationService] Sending Slack notification');

    const payload = {
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: notification.title,
            emoji: true
          }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: notification.message
          }
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*Workflow:*\n${notification.data?.workflowId || 'Unknown'}`
            },
            {
              type: 'mrkdwn',
              text: `*Execution:*\n${notification.data?.executionId || 'Unknown'}`
            }
          ]
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: 'Review & Approve',
                emoji: true
              },
              style: 'primary',
              url: notification.actionUrl
            }
          ]
        }
      ]
    };

    try {
      await axios.post(this.slackWebhookUrl, payload, { timeout: 10000 });
    } catch (error: any) {
      logger.warn({ error: error.message }, '[NotificationService] Failed to send Slack notification');
      throw error;
    }
  }

  /**
   * Send Microsoft Teams notification
   */
  private async sendTeamsNotification(
    notification: Omit<NotificationPayload, 'recipientId'> & { data?: Record<string, any> }
  ): Promise<void> {
    if (!this.teamsWebhookUrl) {
      logger.debug('[NotificationService] Teams webhook URL not configured - skipping Teams notification');
      return;
    }

    logger.debug({
      type: notification.type
    }, '[NotificationService] Sending Teams notification');

    // Adaptive Card format for Teams
    const payload = {
      '@type': 'MessageCard',
      '@context': 'http://schema.org/extensions',
      themeColor: notification.priority === 'urgent' ? 'FF0000' : '0076D7',
      summary: notification.title,
      sections: [
        {
          activityTitle: notification.title,
          activitySubtitle: `Workflow: ${notification.data?.workflowId || 'Unknown'}`,
          text: notification.message,
          facts: [
            {
              name: 'Execution ID',
              value: notification.data?.executionId || 'Unknown'
            },
            {
              name: 'Approval ID',
              value: notification.data?.approvalId || 'Unknown'
            }
          ]
        }
      ],
      potentialAction: [
        {
          '@type': 'OpenUri',
          name: 'Review & Approve',
          targets: [
            {
              os: 'default',
              uri: notification.actionUrl
            }
          ]
        }
      ]
    };

    try {
      await axios.post(this.teamsWebhookUrl, payload, { timeout: 10000 });
    } catch (error: any) {
      logger.warn({ error: error.message }, '[NotificationService] Failed to send Teams notification');
      throw error;
    }
  }

  /**
   * Send approval reminder
   */
  async sendApprovalReminder(approvalId: string): Promise<void> {
    const approval = await prisma.workflowApproval.findUnique({
      where: { id: approvalId },
      include: {
        execution: {
          include: { workflow: true }
        }
      }
    });

    if (!approval || approval.status !== 'pending') {
      return;
    }

    const channels = (approval.context_data as any)?.notificationChannels || ['in_app'];
    const remainingApprovers = approval.required_approvers.filter(
      a => !approval.approved_by.includes(a)
    );

    await this.sendApprovalRequest({
      approvalId,
      recipients: remainingApprovers,
      message: `Reminder: ${approval.message || 'Approval is still pending'}`,
      channels,
      workflowId: approval.execution?.workflow_id || '',
      executionId: approval.execution_id,
      approvalUrl: `/workflows/approvals/${approvalId}`
    });
  }

  /**
   * Send approval timeout notification
   */
  async sendApprovalTimeout(approvalId: string, action: string): Promise<void> {
    const approval = await prisma.workflowApproval.findUnique({
      where: { id: approvalId },
      include: {
        execution: {
          include: { workflow: true }
        }
      }
    });

    if (!approval) return;

    const channels = (approval.context_data as any)?.notificationChannels || ['in_app'];

    // Notify all approvers about timeout
    await Promise.allSettled(
      approval.required_approvers.map(recipientId =>
        this.sendInAppNotifications([recipientId], {
          type: 'approval_timeout',
          title: 'Approval Timed Out',
          message: `The approval request has timed out and was automatically ${action}ed.`,
          data: {
            approvalId,
            workflowId: approval.execution?.workflow_id,
            executionId: approval.execution_id,
            action
          },
          priority: 'normal'
        })
      )
    );
  }

  /**
   * Get unread notifications for a user
   */
  async getUnreadNotifications(userId: string, limit = 20): Promise<InAppNotification[]> {
    try {
      const notifications = await prisma.$queryRaw<InAppNotification[]>`
        SELECT id, user_id, type, title, message, data, action_url, is_read, created_at
        FROM notifications
        WHERE user_id = ${userId}::uuid AND is_read = false
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
      return notifications;
    } catch (error: any) {
      if (error.message?.includes('does not exist')) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Mark notification as read
   */
  async markAsRead(notificationId: string, userId: string): Promise<void> {
    try {
      await prisma.$executeRaw`
        UPDATE notifications
        SET is_read = true, read_at = NOW()
        WHERE id = ${notificationId}::uuid AND user_id = ${userId}::uuid
      `;
    } catch (error: any) {
      if (!error.message?.includes('does not exist')) {
        throw error;
      }
    }
  }

  /**
   * Mark all notifications as read for a user
   */
  async markAllAsRead(userId: string): Promise<void> {
    try {
      await prisma.$executeRaw`
        UPDATE notifications
        SET is_read = true, read_at = NOW()
        WHERE user_id = ${userId}::uuid AND is_read = false
      `;
    } catch (error: any) {
      if (!error.message?.includes('does not exist')) {
        throw error;
      }
    }
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let notificationServiceInstance: NotificationService | null = null;

export function getNotificationService(): NotificationService {
  if (!notificationServiceInstance) {
    notificationServiceInstance = new NotificationService();
  }
  return notificationServiceInstance;
}

export default NotificationService;
