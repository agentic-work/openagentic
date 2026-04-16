/**
 * Stub NotificationService for workflow service.
 */

export class NotificationServiceImpl {
  async sendNotification(..._args: any[]): Promise<void> {}
  async sendApprovalRequest(..._args: any[]): Promise<void> {}
  [key: string]: any;
}

const instance = new NotificationServiceImpl();

export function getNotificationService(): NotificationServiceImpl {
  return instance;
}
